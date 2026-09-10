"""Load Comfy-style drop-in TE / packed Rapid-AIO weights into Diffusers modules."""

from __future__ import annotations

import gc
import tempfile
from pathlib import Path
from typing import Any

from safetensors.torch import load_file, save_file


def _strip_prefix(state: dict[str, Any], prefix: str) -> dict[str, Any]:
    if not prefix:
        return state
    out: dict[str, Any] = {}
    for key, value in state.items():
        if key.startswith(prefix):
            out[key[len(prefix) :]] = value
        else:
            out[key] = value
    return out


def load_clip_l_text_encoder(path: str | Path, dtype: Any) -> Any:
    """Load Comfy clip_l.safetensors into transformers CLIPTextModel."""
    from transformers import CLIPTextConfig, CLIPTextModel

    path = Path(path)
    raw = load_file(str(path))
    state = _strip_prefix(raw, "text_model.")
    config = CLIPTextConfig(
        vocab_size=49408,
        hidden_size=768,
        intermediate_size=3072,
        num_hidden_layers=12,
        num_attention_heads=12,
        max_position_embeddings=77,
        hidden_act="quick_gelu",
        layer_norm_eps=1e-5,
        dropout=0.0,
        attention_dropout=0.0,
        initializer_range=0.02,
        initializer_factor=1.0,
        pad_token_id=1,
        bos_token_id=0,
        eos_token_id=2,
        model_type="clip_text_model",
        projection_dim=768,
    )
    model = CLIPTextModel(config)
    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing:
        raise RuntimeError(
            f"clip_l load incomplete ({path.name}): missing {len(missing)} keys"
        )
    if unexpected:
        print(
            f"[diffusers] clip_l unexpected keys ignored: {len(unexpected)}",
            flush=True,
        )
    return model.to(dtype=dtype)


def remap_qwen25_vl_comfy_keys(state: dict[str, Any]) -> dict[str, Any]:
    """Map Comfy / older HF Qwen2.5-VL keys onto current transformers layout."""
    out: dict[str, Any] = {}
    for key, value in state.items():
        new_key = key
        if new_key.startswith("transformer."):
            new_key = new_key[len("transformer.") :]
        if new_key.startswith("model.layers."):
            new_key = "model.language_model.layers." + new_key[len("model.layers.") :]
        elif new_key.startswith("model.embed_tokens."):
            new_key = "model.language_model.embed_tokens." + new_key[
                len("model.embed_tokens.") :
            ]
        elif new_key.startswith("model.norm."):
            new_key = "model.language_model.norm." + new_key[len("model.norm.") :]
        elif new_key.startswith("visual."):
            new_key = "model.visual." + new_key[len("visual.") :]
        elif new_key == "lm_head.weight":
            new_key = "lm_head.weight"
        out[new_key] = value
    return out


def _materialize_meta_buffers(model: Any) -> int:
    """Fill rotary inv_freq buffers left on meta after assign= load."""
    import torch

    fixed = 0
    for module in model.modules():
        for name, buf in list(module._buffers.items()):
            if buf is None or getattr(buf, "device", None) is None:
                continue
            if buf.device.type != "meta":
                continue
            if name in ("inv_freq", "original_inv_freq"):
                dim = int(getattr(module, "dim", buf.shape[-1] * 2))
                base = float(getattr(module, "base", 10000.0))
                # Standard RoPE inverse frequencies.
                inv = 1.0 / (
                    base
                    ** (
                        torch.arange(0, dim, 2, dtype=torch.float32)[
                            : int(buf.shape[0])
                        ]
                        / float(dim)
                    )
                )
                module.register_buffer(name, inv, persistent=False)
            else:
                module.register_buffer(
                    name,
                    torch.zeros(buf.shape, dtype=torch.float32),
                    persistent=False,
                )
            fixed += 1
    return fixed


def load_qwen25_vl_from_single_file(
    path: str | Path,
    *,
    config_dir: str | Path,
    dtype: Any,
) -> Any:
    """Load Comfy qwen_2.5_vl_*.safetensors into Qwen2_5_VLForConditionalGeneration.

    Uses meta+assign so we never hold a hub TE shell *and* the drop-in weights
    at once (that previously peaked ~32GB host RAM and thrashed into swap).
    """
    import torch
    from safetensors import safe_open
    from transformers import Qwen2_5_VLConfig, Qwen2_5_VLForConditionalGeneration

    path = Path(path)
    config_dir = Path(config_dir)
    if is_fp8_scaled_name(path.name):
        raise RuntimeError(
            f"{path.name} is Comfy fp8-scaled (scale_weight tensors); "
            "Diffusers needs qwen_2.5_vl_7b.safetensors (bf16) instead."
        )

    config = Qwen2_5_VLConfig.from_pretrained(str(config_dir), local_files_only=True)
    print(f"[diffusers] Qwen TE meta+assign from {path.name}…", flush=True)

    # One weight copy via safe_open (mmap-backed reads), not load_file + hub shell.
    state: dict[str, Any] = {}
    with safe_open(str(path), framework="pt", device="cpu") as handle:
        for key in handle.keys():
            if key.endswith(".comfy_quant") or "weight_scale" in key:
                continue
            if key.endswith(".scale_weight") or key.endswith(".scale_input"):
                continue
            state[key] = handle.get_tensor(key)
    state = remap_qwen25_vl_comfy_keys(state)

    with torch.device("meta"):
        model = Qwen2_5_VLForConditionalGeneration(config)

    try:
        missing, unexpected = model.load_state_dict(state, strict=False, assign=True)
    except TypeError as assign_exc:
        del state
        gc.collect()
        raise RuntimeError(
            "Need PyTorch assign=True to load Qwen TE without doubling RAM"
        ) from assign_exc

    loaded = len(state) - len(unexpected)
    state.clear()
    del state
    gc.collect()

    if loaded < 100:
        raise RuntimeError(
            f"Qwen TE load failed for {path.name}: only {loaded} keys matched "
            f"(missing={len(missing)} unexpected={len(unexpected)})"
        )

    buf_fixed = _materialize_meta_buffers(model)
    if buf_fixed:
        print(f"[diffusers] Qwen TE materialized {buf_fixed} meta buffers", flush=True)

    _sample_before = next(model.parameters()).dtype
    _n_not_target = sum(1 for p in model.parameters() if p.dtype != dtype)
    print(
        f"[diffusers] Qwen TE post-load dtype check: requested={dtype!r} "
        f"sample_param_dtype={_sample_before!r} "
        f"params_not_matching_target={_n_not_target}/{sum(1 for _ in model.parameters())}",
        flush=True,
    )

    # Cast parameters only (buffers stay float32 RoPE tables).
    if dtype is not None:
        try:
            _cast_count = 0
            for param in model.parameters():
                if param.dtype != dtype:
                    param.data = param.data.to(dtype=dtype)
                    _cast_count += 1
        except Exception as cast_exc:
            print(f"[diffusers] Qwen TE dtype cast skipped: {cast_exc}", flush=True)
        else:
            print(f"[diffusers] Qwen TE dtype cast applied to {_cast_count} params", flush=True)

    _sample_after = next(model.parameters()).dtype
    _n_not_target_after = sum(1 for p in model.parameters() if p.dtype != dtype)
    print(
        f"[diffusers] Qwen TE post-cast dtype check: "
        f"sample_param_dtype={_sample_after!r} "
        f"params_not_matching_target={_n_not_target_after}/{sum(1 for _ in model.parameters())}",
        flush=True,
    )

    print(
        f"[diffusers] Qwen TE from drop-in {path.name} "
        f"(matched≈{loaded}, missing={len(missing)}, host-meta+assign)",
        flush=True,
    )
    gc.collect()
    return model


def load_qwen3_causal_from_single_file(
    path: str | Path,
    *,
    dtype: Any,
    hub_id: str = "Qwen/Qwen3-8B",
) -> Any:
    """Load Comfy qwen_3_*.safetensors into Qwen3ForCausalLM (Flux2 Klein TE)."""
    from transformers import Qwen3Config, Qwen3ForCausalLM

    path = Path(path)
    # Prefer config from a matching Hub size when possible.
    name = path.name.lower()
    if "4b" in name:
        hub_id = "Qwen/Qwen3-4B"
    elif "klein" in name or "8b" in name:
        hub_id = "Qwen/Qwen3-8B"

    model = None
    try:
        model = Qwen3ForCausalLM.from_pretrained(
            hub_id,
            torch_dtype=dtype,
            local_files_only=True,
        )
    except Exception:
        try:
            model = Qwen3ForCausalLM.from_pretrained(hub_id, torch_dtype=dtype)
        except Exception as hub_exc:
            # Offline / gated: build config from weight shapes (bf16/fp16 drop-ins).
            print(
                f"[diffusers] Qwen3 hub shell unavailable ({hub_exc}); "
                "inferring config from drop-in weights",
                flush=True,
            )
            model = _qwen3_from_weight_shapes(path, dtype=dtype)

    state = load_file(str(path))
    # Drop Comfy quant metadata keys.
    state = {
        key: value
        for key, value in state.items()
        if not key.endswith(".comfy_quant") and "weight_scale" not in key
    }
    # Skip clearly broken fp8-mixed shards (mixed dtypes / packed uint8).
    bad = [
        key
        for key, value in state.items()
        if hasattr(value, "dtype")
        and str(value.dtype) in ("torch.uint8",)
    ]
    if bad:
        raise RuntimeError(
            f"Qwen3 TE {path.name} looks like Comfy fp8-mixed/packed weights "
            f"({len(bad)} uint8 tensors). Use flux2-klein-9b-base.safetensors "
            "or a bf16/fp16 qwen_3_8b drop-in instead."
        )
    missing, unexpected = model.load_state_dict(state, strict=False)
    loaded = len(state) - len(unexpected)
    if loaded < 50:
        raise RuntimeError(
            f"Qwen3 TE load failed for {path.name}: matched≈{loaded} "
            f"(missing={len(missing)} unexpected={len(unexpected)})"
        )
    print(
        f"[diffusers] Flux2 TE from drop-in {path.name} (matched≈{loaded})",
        flush=True,
    )
    return model.to(dtype=dtype)


def _qwen3_from_weight_shapes(path: Path, *, dtype: Any) -> Any:
    """Instantiate Qwen3ForCausalLM from drop-in weight shapes (no Hub)."""
    from safetensors import safe_open
    from transformers import Qwen3Config, Qwen3ForCausalLM

    with safe_open(str(path), framework="pt") as handle:
        embed = handle.get_tensor("model.embed_tokens.weight")
        gate = handle.get_tensor("model.layers.0.mlp.gate_proj.weight")
        key_w = handle.get_tensor("model.layers.0.self_attn.k_proj.weight")
        layer_ids: set[int] = set()
        for key in handle.keys():
            if key.startswith("model.layers."):
                try:
                    layer_ids.add(int(key.split(".")[2]))
                except (IndexError, ValueError):
                    pass

    vocab, hidden = int(embed.shape[0]), int(embed.shape[1])
    intermediate = int(gate.shape[0])
    # GQA: k_proj out dim / head_dim
    num_layers = max(layer_ids) + 1 if layer_ids else 36
    # Heuristic head dims used by Qwen3 4B/8B.
    head_dim = 128
    num_kv_heads = max(1, int(key_w.shape[0]) // head_dim)
    num_heads = max(num_kv_heads, hidden // head_dim)

    config = Qwen3Config(
        vocab_size=vocab,
        hidden_size=hidden,
        intermediate_size=intermediate,
        num_hidden_layers=num_layers,
        num_attention_heads=num_heads,
        num_key_value_heads=num_kv_heads,
        head_dim=head_dim,
    )
    return Qwen3ForCausalLM(config).to(dtype=dtype)


def extract_rapid_aio_components(path: str | Path) -> tuple[Path, dict[str, Any], dict[str, Any]]:
    """Split Rapid-AIO packed safetensors into transformer temp file + TE/VAE dicts.

    Returns (transformer_temp_path, text_encoder_state, vae_state).
    Caller should unlink the temp transformer file when done loading.
    """
    path = Path(path)
    raw = load_file(str(path))
    transformer: dict[str, Any] = {}
    text_encoder: dict[str, Any] = {}
    vae: dict[str, Any] = {}
    te_prefix = None
    for key, value in raw.items():
        if key.startswith("model.diffusion_model."):
            transformer[key] = value
        elif key.startswith("text_encoders."):
            # text_encoders.<name>.transformer.<rest> or text_encoders.<name>.<rest>
            parts = key.split(".", 2)
            if len(parts) < 3:
                continue
            rest = parts[2]
            if rest.startswith("transformer."):
                rest = rest[len("transformer.") :]
            if rest in ("logit_scale",):
                continue
            text_encoder[rest] = value
            te_prefix = parts[1]
        elif key.startswith("vae."):
            vae[key[len("vae.") :]] = value
    if not transformer:
        raise RuntimeError(f"Rapid-AIO missing diffusion_model weights: {path.name}")
    if not text_encoder:
        raise RuntimeError(f"Rapid-AIO missing text_encoders weights: {path.name}")
    tmp = tempfile.NamedTemporaryFile(suffix=".safetensors", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    save_file(transformer, str(tmp_path))
    print(
        f"[diffusers] Rapid-AIO {path.name}: "
        f"transformer={len(transformer)} te={len(text_encoder)}({te_prefix}) "
        f"vae={len(vae)}",
        flush=True,
    )
    return tmp_path, text_encoder, vae


def is_rapid_aio_name(name: str | None) -> bool:
    if not name:
        return False
    lower = name.lower()
    return "rapid" in lower and "aio" in lower and "qwen" in lower


def is_flux_klein_unet(name: str | None) -> bool:
    if not name:
        return False
    lower = name.lower()
    return "klein" in lower or "flux2" in lower or "flux-2" in lower


def is_fp8_scaled_name(name: str | None) -> bool:
    if not name:
        return False
    lower = name.lower()
    return "fp8" in lower and "scaled" in lower


def remap_qwen_unet_comfy_keys(state: dict[str, Any]) -> dict[str, Any]:
    """Strip Comfy `model.diffusion_model.` prefix used by some Qwen fp8 packs."""
    return _strip_prefix(state, "model.diffusion_model.")


def _qwen_unet_diffusers_cache_path(path: Path) -> Path:
    """Sidecar with Diffusers-native keys (written once for Comfy-prefixed packs)."""
    return path.with_name(f"{path.stem}.diffusers-keys.safetensors")


def _ensure_qwen_unet_diffusers_keys(path: Path) -> tuple[Path, bool]:
    """Return (path_to_load, stripped_comfy_prefix).

    Comfy 2512 fp8 uses `model.diffusion_model.*`. We rewrite once to a sibling
    cache so Diffusers can mmap/load without holding two full copies in RAM.
    """
    from safetensors import safe_open

    cache = _qwen_unet_diffusers_cache_path(path)
    if cache.is_file() and cache.stat().st_size > 1_000_000_000:
        return cache, True

    with safe_open(str(path), framework="pt") as handle:
        keys = list(handle.keys())
    if not keys:
        raise RuntimeError(f"Empty safetensors: {path.name}")
    had_comfy_prefix = keys[0].startswith("model.diffusion_model.") or any(
        key.startswith("model.diffusion_model.") for key in keys[:32]
    )
    if not had_comfy_prefix:
        return path, False

    print(
        f"[diffusers] rewriting Comfy-prefixed UNET keys → {cache.name} "
        f"(one-time, ~{path.stat().st_size // (1024**3)}GiB peak RAM)",
        flush=True,
    )
    # Stream remap→save without keeping a second full dict longer than needed.
    # Still one in-memory copy during rewrite (unavoidable for save_file).
    remapped: dict[str, Any] = {}
    with safe_open(str(path), framework="pt", device="cpu") as handle:
        for key in handle.keys():
            new_key = (
                key[len("model.diffusion_model.") :]
                if key.startswith("model.diffusion_model.")
                else key
            )
            remapped[new_key] = handle.get_tensor(key)
    save_file(remapped, str(cache))
    remapped.clear()
    del remapped
    gc.collect()
    print(f"[diffusers] wrote {cache.name}", flush=True)
    return cache, True


def load_qwen_transformer_from_single_file(
    path: str | Path,
    *,
    config_dir: str | Path,
    dtype: Any,
) -> Any:
    """Load Qwen-Image UNET from Diffusers-native or Comfy-prefixed safetensors.

    Comfy 2512 fp8 packs ship keys as `model.diffusion_model.*`. Diffusers
    `from_single_file` ignores those, leaving a meta/empty shell — which then
    blows up on `.to(cuda)` with "Cannot copy out of meta tensor".
    """
    import torch
    from diffusers import QwenImageTransformer2DModel

    path = Path(path)
    config_dir = Path(config_dir)
    load_path, comfy_stripped = _ensure_qwen_unet_diffusers_keys(path)

    # Prefer Diffusers loader on a key-fixed file (avoids meta shells + double alloc).
    load_kwargs: dict[str, Any] = {
        "config": str(config_dir),
        "local_files_only": True,
        "low_cpu_mem_usage": True,
    }
    # Keep fp8 weights as float8 when the file is fp8; bf16 cast ≈ 39GB RAM/VRAM.
    if "fp8" in path.name.lower() and hasattr(torch, "float8_e4m3fn"):
        load_kwargs["torch_dtype"] = torch.float8_e4m3fn
    elif dtype is not None:
        load_kwargs["torch_dtype"] = dtype

    try:
        model = QwenImageTransformer2DModel.from_single_file(str(load_path), **load_kwargs)
    except Exception as primary_exc:
        # Fallback: meta shell + assign (one weight copy, no to_empty peak).
        print(
            f"[diffusers] from_single_file failed ({primary_exc}); "
            "meta+assign fallback",
            flush=True,
        )
        from safetensors import safe_open

        config = QwenImageTransformer2DModel.load_config(str(config_dir))
        with torch.device("meta"):
            model = QwenImageTransformer2DModel.from_config(config)
        state: dict[str, Any] = {}
        with safe_open(str(load_path), framework="pt", device="cpu") as handle:
            for key in handle.keys():
                state[key] = handle.get_tensor(key)
        try:
            missing, unexpected = model.load_state_dict(state, strict=False, assign=True)
        except TypeError as assign_exc:
            del state
            gc.collect()
            raise RuntimeError(
                "Need PyTorch assign=True support to load Qwen UNET without "
                f"doubling RAM: {assign_exc}"
            ) from assign_exc
        loaded = len(state) - len(unexpected)
        state.clear()
        del state
        gc.collect()
        if loaded < 100:
            raise RuntimeError(
                f"Qwen UNET load failed for {path.name}: matched≈{loaded} "
                f"(missing={len(missing)} unexpected={len(unexpected)})."
            ) from primary_exc
        print(
            f"[diffusers] Qwen UNET meta+assign {path.name} matched≈{loaded} "
            f"missing={len(missing)} unexpected={len(unexpected)}"
            f"{' comfy_prefix_stripped' if comfy_stripped else ''}",
            flush=True,
        )
        return model

    # Sanity: refuse meta shells (weights never applied).
    try:
        first = next(model.parameters())
        if first.device.type == "meta":
            raise RuntimeError("transformer still on meta after from_single_file")
    except StopIteration as exc:
        raise RuntimeError("transformer has no parameters") from exc

    print(
        f"[diffusers] Qwen UNET from drop-in {path.name} "
        f"via {load_path.name}"
        f"{' comfy_prefix_stripped' if comfy_stripped else ''}"
        f"{' dtype=float8_e4m3fn' if load_kwargs.get('torch_dtype') == getattr(torch, 'float8_e4m3fn', None) else ''}",
        flush=True,
    )
    gc.collect()
    return model
