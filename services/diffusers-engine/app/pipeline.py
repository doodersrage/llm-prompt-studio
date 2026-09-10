from __future__ import annotations

import math
import os
import re
import threading
import warnings
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

from app.asset_inventory import (
    default_flux_txt2img_stack,
    default_qwen_txt2img_stack,
    infer_native_family,
)
from app.lora_resolve import lora_cache_key, resolve_loras
from app.model_resolve import (
    ResolvedModel,
    describe_search_paths,
    resolve_model,
    resolve_sdxl_refiner,
)
from app.prompt_encode import (
    encode_sdxl_prompts,
    prompt_is_workshop_role,
    prompt_wants_person,
)
from app.sampling import plan_sampling


def _host_rss_gb() -> float:
    """Current process RSS in GiB (best-effort; for load-path diagnostics)."""
    try:
        with open("/proc/self/status", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    # kB
                    return float(line.split()[1]) / (1024.0 * 1024.0)
    except Exception:
        pass
    return 0.0


def _person_portrait_canvas(prompt: str, width: int, height: int) -> tuple[int, int]:
    """Full-body people on 1:1 latents stretch — nudge square → ~3:4, keep area."""
    if height <= 0 or width <= 0:
        return width, height
    if not prompt_wants_person(prompt):
        return width, height
    ratio = width / float(height)
    if ratio < 0.92 or ratio > 1.08:
        return width, height
    area = float(width * height)
    new_h = max(64, int(round(math.sqrt(area * 4.0 / 3.0) / 16.0) * 16))
    new_w = max(64, int(round(math.sqrt(area * 3.0 / 4.0) / 16.0) * 16))
    if (new_w, new_h) != (width, height):
        print(
            f"[diffusers] person+square canvas {width}x{height} → {new_w}x{new_h}",
            flush=True,
        )
    return new_w, new_h


def _qwen_lora_haystack(loras: list[tuple[str, float]]) -> str:
    return " ".join(Path(path).name.lower() for path, _ in loras)


def _qwen_loras_are_lightning(loras: list[tuple[str, float]]) -> bool:
    hay = _qwen_lora_haystack(loras)
    return "lightning" in hay or "lightx2v" in hay


def _qwen_path_is_lightning(model_path: str) -> bool:
    return "lightning" in Path(model_path).name.lower()


def _lightning_step_target(loras: list[tuple[str, float]], steps: int) -> int:
    hay = _qwen_lora_haystack(loras)
    if "4step" in hay or "4-step" in hay or "4_step" in hay:
        return 4
    if "8step" in hay or "8-step" in hay or "8_step" in hay:
        return 8
    if steps in (4, 8):
        return steps
    return 8


_ENGINE_ROOT = Path(__file__).resolve().parents[1]
_FLUX2_KLEIN_9B_CONFIG = _ENGINE_ROOT / "configs" / "flux2-klein-9b"
_FLUX2_KLEIN_4B_CONFIG = _ENGINE_ROOT / "configs" / "flux2-klein-4b"
_FLUX2_VAE_CONFIG = _ENGINE_ROOT / "configs" / "flux2-vae" / "config.json"
_FLUX2_KLEIN_SCHEDULER_CONFIG = (
    _ENGINE_ROOT / "configs" / "flux2-klein-scheduler" / "scheduler_config.json"
)
_QWEN3_CHAT_TEMPLATE = _ENGINE_ROOT / "configs" / "qwen3_chat_template.jinja"
# Comfy ships the working Qwen2.5 BPE used by Flux2-Klein TE (same vocab as Qwen3 chat).
_QWEN25_TOKENIZER_LOCAL = _ENGINE_ROOT / "configs" / "qwen25_tokenizer"
_MIN_QWEN_VOCAB = 10_000


def _is_flux2_klein_distilled(unet_label: str) -> bool:
    """Comfy/BFL: distilled UNETs omit 'base' (e.g. flux-2-klein-9b, *-distilled)."""
    token = unet_label.lower().replace("_", "-")
    if "base" in token:
        return False
    return "klein" in token or "distilled" in token


def _flux2_klein_config_dir(unet_label: str) -> Path:
    """Local Diffusers config repo for Klein — avoids gated FLUX.2-dev hub lookup."""
    token = unet_label.lower().replace("_", "-")
    if "4b" in token:
        path = _FLUX2_KLEIN_4B_CONFIG
    else:
        path = _FLUX2_KLEIN_9B_CONFIG
    if not (path / "transformer" / "config.json").is_file():
        raise FileNotFoundError(
            f"Missing local Flux2-Klein config at {path / 'transformer' / 'config.json'}"
        )
    return path


def _ensure_qwen3_chat_template(tokenizer: Any) -> Any:
    """Force Comfy Klein chat packing (user turn + empty think), not generic Qwen system chat.

    Stock Qwen tokenizer_config templates inject a system prompt and omit the empty
    ``<think></think>`` block Comfy's KleinTokenizer hardcodes — that mismatch
    shifts TE conditioning vs the drop-in UNETs.
    """
    if _QWEN3_CHAT_TEMPLATE.is_file():
        tokenizer.chat_template = _QWEN3_CHAT_TEMPLATE.read_text(encoding="utf-8")
    else:
        # Mirrors Comfy KleinTokenizer.llama_template when enable_thinking is false.
        tokenizer.chat_template = (
            "{%- for message in messages %}"
            "{%- if message['role'] != 'system' %}"
            "{{- '<|im_start|>' + message['role'] + '\\n' + message['content'] "
            "+ '<|im_end|>' + '\\n' }}"
            "{%- endif %}"
            "{%- endfor %}"
            "{%- if add_generation_prompt %}"
            "{{- '<|im_start|>assistant\\n' }}"
            "{%- if enable_thinking is defined and enable_thinking is false %}"
            "{{- '<think>\\n\\n</think>\\n\\n' }}"
            "{%- endif %}"
            "{%- endif %}"
        )
    print("[diffusers] Qwen3 tokenizer chat_template set (Comfy Klein)", flush=True)
    return tokenizer


def _tokenizer_vocab_ok(tokenizer: Any) -> bool:
    """Reject incomplete HF cache stubs (we've seen vocab_size==1 → empty encodes → static)."""
    try:
        size = int(getattr(tokenizer, "vocab_size", 0) or 0)
        if size < _MIN_QWEN_VOCAB:
            size = len(tokenizer)
    except Exception:
        return False
    if size < _MIN_QWEN_VOCAB:
        return False
    # Smoke: real BPE must encode plain English.
    try:
        ids = tokenizer.encode("a red apple", add_special_tokens=False)
    except Exception:
        return False
    return bool(ids)


def _load_qwen3_tokenizer_for_flux(clip_name: str | None) -> Any:
    """Load Qwen2.5/3 tokenizer for Flux2-Klein; prefer vendored/Comfy over broken HF stubs."""
    from transformers import AutoTokenizer

    del clip_name  # size-specific hub ids are unreliable offline; BPE is shared
    local_dirs: list[Path] = []
    if (_QWEN25_TOKENIZER_LOCAL / "vocab.json").is_file():
        local_dirs.append(_QWEN25_TOKENIZER_LOCAL)
    comfy_root = os.environ.get("COMFYUI_ROOT", "").strip()
    if comfy_root:
        comfy_tok = Path(comfy_root) / "comfy" / "text_encoders" / "qwen25_tokenizer"
        if (comfy_tok / "vocab.json").is_file():
            local_dirs.append(comfy_tok)

    last_error: Exception | None = None
    for path in local_dirs:
        try:
            tokenizer = AutoTokenizer.from_pretrained(str(path), local_files_only=True)
            if not _tokenizer_vocab_ok(tokenizer):
                raise RuntimeError(f"tokenizer at {path} failed encode smoke")
            print(f"[diffusers] Qwen tokenizer from {path}", flush=True)
            return _ensure_qwen3_chat_template(tokenizer)
        except Exception as exc:
            last_error = exc

    # Hub fallback — but never accept a stub vocab (causes pure static / empty TE).
    hub_candidates = ["Qwen/Qwen3-8B", "Qwen/Qwen3-4B", "Qwen/Qwen2.5-7B"]
    for repo in hub_candidates:
        for local_only in (True, False):
            try:
                tokenizer = AutoTokenizer.from_pretrained(
                    repo, local_files_only=local_only
                )
                if not _tokenizer_vocab_ok(tokenizer):
                    print(
                        f"[diffusers] rejecting broken tokenizer stub {repo} "
                        f"(local_only={local_only})",
                        flush=True,
                    )
                    continue
                print(f"[diffusers] Qwen tokenizer from hub {repo}", flush=True)
                return _ensure_qwen3_chat_template(tokenizer)
            except Exception as exc:
                last_error = exc
                continue

    raise RuntimeError(
        "Failed to load a working Qwen tokenizer for Flux2-Klein. "
        f"Vendored path={_QWEN25_TOKENIZER_LOCAL}. Last error: {last_error}"
    )


def _load_flux2_vae_local(vae_path: str | Path, dtype: Any) -> Any:
    """Load drop-in flux2-vae without hitting gated FLUX.2-dev config download."""
    import json

    from diffusers import AutoencoderKLFlux2
    from safetensors.torch import load_file

    if _FLUX2_VAE_CONFIG.is_file():
        with _FLUX2_VAE_CONFIG.open("r", encoding="utf-8") as handle:
            vae = AutoencoderKLFlux2.from_config(json.load(handle))
    else:
        vae = AutoencoderKLFlux2()
    state = load_file(str(vae_path))
    missing, unexpected = vae.load_state_dict(state, strict=False)
    if missing:
        raise RuntimeError(
            f"Flux2 VAE load missing {len(missing)} keys (e.g. {missing[:3]})"
        )
    if unexpected:
        print(
            f"[diffusers] Flux2 VAE ignored {len(unexpected)} unexpected keys",
            flush=True,
        )
    # Must match transformer/latent dtype (bf16). Leaving VAE in float32 causes
    # "Input type (BFloat16) and bias type (float) should be the same" on decode.
    if dtype is not None:
        vae.to(dtype=dtype)
    return vae


def _load_flux2_klein_scheduler() -> Any:
    """Flux2Klein always passes empirical `mu` — requires dynamic shifting."""
    import json

    from diffusers import FlowMatchEulerDiscreteScheduler

    if _FLUX2_KLEIN_SCHEDULER_CONFIG.is_file():
        with _FLUX2_KLEIN_SCHEDULER_CONFIG.open("r", encoding="utf-8") as handle:
            return FlowMatchEulerDiscreteScheduler.from_config(json.load(handle))
    return FlowMatchEulerDiscreteScheduler(use_dynamic_shifting=True)


def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def env_flag_default_on(name: str) -> bool:
    """True unless explicitly disabled (0/false/no/off)."""
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return True
    return str(raw).strip().lower() not in ("0", "false", "no", "off")


@contextmanager
def _silence_model_warnings() -> Iterator[None]:
    """Hide known-noisy load/cast warnings that don't affect quality."""
    import logging

    # Diffusers often emits these via logging, not warnings.warn.
    noisy_loggers = (
        "diffusers",
        "diffusers.pipelines.pipeline_utils",
        "diffusers.models.modeling_utils",
        "transformers",
        "huggingface_hub",
    )
    previous_levels = {
        name: logging.getLogger(name).level for name in noisy_loggers
    }
    for name in noisy_loggers:
        logging.getLogger(name).setLevel(logging.ERROR)
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message=r".*should be kept in float32.*")
            warnings.filterwarnings(
                "ignore",
                message=r".*local_dir_use_symlinks.*",
            )
            warnings.filterwarnings(
                "ignore",
                message=r".*Siglip2ImageProcessorFast.*",
            )
            warnings.filterwarnings(
                "ignore",
                message=r".*clean_up_tokenization_spaces.*",
            )
            warnings.filterwarnings(
                "ignore",
                message=r".*unauthenticated requests to the HF Hub.*",
            )
            warnings.filterwarnings(
                "ignore",
                message=r".*cannot run with `cpu` device.*",
            )
            warnings.filterwarnings(
                "ignore",
                message=r".*float16` operations on this device.*",
            )
            yield
    finally:
        for name, level in previous_levels.items():
            logging.getLogger(name).setLevel(level)


DEFAULT_MODEL = os.environ.get(
    "DIFFUSERS_MODEL", "qwen_image_2512_fp8_e4m3fn.safetensors"
).strip()
MOCK_MODE = env_flag("DIFFUSERS_MOCK")
SDXL_CONFIG_ID = os.environ.get(
    "DIFFUSERS_SDXL_CONFIG",
    "stabilityai/stable-diffusion-xl-base-1.0",
).strip()
SDXL_REFINER_CONFIG_ID = os.environ.get(
    "DIFFUSERS_SDXL_REFINER_CONFIG",
    "stabilityai/stable-diffusion-xl-refiner-1.0",
).strip()
SDXL_VAE_ID = os.environ.get(
    "DIFFUSERS_SDXL_VAE",
    "madebyollin/sdxl-vae-fp16-fix",
).strip()
SDXL_FORCE_FP32 = env_flag("DIFFUSERS_SDXL_FP32")
CPU_OFFLOAD = env_flag("DIFFUSERS_CPU_OFFLOAD")
# Sequential moves every layer over PCIe — starves the desktop. Opt-in only.
SEQUENTIAL_OFFLOAD = env_flag("DIFFUSERS_SEQUENTIAL_OFFLOAD")
# Keep DiT/UNET fully on CUDA when it fits (Comfy-like). Falls back to group
# offload for oversized weights (e.g. Qwen-Image 2512 bf16 ≈ 39GB on 24GB).
UNET_RESIDENT = env_flag_default_on("DIFFUSERS_UNET_RESIDENT")
# Group/block offload is the 24GB sweet spot when residency won't fit.
# Set DIFFUSERS_GROUP_OFFLOAD=0 to fall back to model offload.
GROUP_OFFLOAD = env_flag_default_on("DIFFUSERS_GROUP_OFFLOAD")
# Qwen-Image has 60 transformer blocks (~0.65GB bf16 each). Small groups (2–4)
# thrash PCIe (~30 swaps/step) and stall the desktop. Prefer large groups so a
# 24GB card keeps ~⅓–½ of the DiT resident (~3 swaps/step). Override with env.
# Default 8: bf16 Qwen blocks ≈0.65GiB each; 18 left too little room for acts.
GROUP_OFFLOAD_BLOCKS = max(
    1, int(os.environ.get("DIFFUSERS_GROUP_OFFLOAD_BLOCKS", "8") or 8)
)
# Lightning default = fp8 storage + bf16 compute (layerwise) so DiT fits resident
# on 24GB (~40s). Opt into Comfy-style full bf16 with DIFFUSERS_QWEN_LIGHTNING_BF16=1
# (needs group-offload; much slower on 24GB — can hit multi-minute PCIe thrash).
LIGHTNING_BF16 = env_flag("DIFFUSERS_QWEN_LIGHTNING_BF16")
# Auto-on when a local refiner checkpoint exists; set DIFFUSERS_REFINER=0 to skip.
REFINER_ENABLED = env_flag_default_on("DIFFUSERS_REFINER")
# Keep refine gentle — high strength warps hands/arms on RealVis.
REFINER_STRENGTH = float(os.environ.get("DIFFUSERS_REFINER_STRENGTH", "0.18") or 0.18)
# Leave CPU headroom for compositor/UI (Comfy does not peg all cores).
_CPU_THREADS = max(
    2,
    min(8, int(os.environ.get("DIFFUSERS_CPU_THREADS", "0") or 0) or ((os.cpu_count() or 8) // 2)),
)
_COMFY_FREE_URL = os.environ.get(
    "DIFFUSERS_COMFY_FREE_URL", "http://127.0.0.1:8188/free"
).strip()


def _configure_host_scheduling() -> None:
    """Keep the desktop responsive while large models load/run."""
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    try:
        # Mildly lower priority so kwin/chrome keep CPU time during weight loads.
        os.nice(5)
    except Exception:
        pass
    try:
        import torch

        torch.set_num_threads(_CPU_THREADS)
        try:
            torch.set_num_interop_threads(max(1, min(2, _CPU_THREADS // 2)))
        except Exception:
            pass
        print(
            f"[diffusers] host sched: nice+5 torch_threads={_CPU_THREADS}",
            flush=True,
        )
    except Exception:
        pass


_configure_host_scheduling()
# Public alias for app.main startup.
configure_host_schedulers = _configure_host_scheduling


def _free_peer_comfy_vram() -> None:
    """Ask local Comfy to unload models so Diffusers isn't fighting for the 4090."""
    if not _COMFY_FREE_URL:
        return
    try:
        import json
        import urllib.request

        req = urllib.request.Request(
            _COMFY_FREE_URL,
            data=json.dumps({"unload_models": True, "free_memory": True}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            resp.read()
        print("[diffusers] freed peer Comfy VRAM", flush=True)
    except Exception:
        pass


def _load_via_hub_config_local_weights(
    model_cls: Any,
    hub_config_id: str,
    local_path: str,
    dtype: Any,
) -> Any:
    """Work around diffusers model classes that aren't in
    FromOriginalModelMixin's single-file whitelist in every release (seen in
    practice for ControlNetUnionModel, FluxControlNetModel, and
    QwenImageControlNetModel — .from_single_file() raises
    "FromOriginalModelMixin is currently only compatible with [...]" even
    though the checkpoint's architecture is fine). Fetch just the (tiny)
    config.json from a known-compatible hub repo, build the model from that
    config, then load the LOCAL checkpoint's weights into it — no multi-GB
    re-download of weights already on disk. Raises if the local state dict
    doesn't actually match the fetched config's architecture (missing or
    unexpected keys) rather than silently loading a mismatched model, since
    the hub_config_id here is a best-effort match by naming convention, not
    something verified byte-for-byte against the local file."""
    from safetensors.torch import load_file as _load_safetensors

    config = model_cls.load_config(hub_config_id)
    candidate = model_cls.from_config(config)
    state_dict = _load_safetensors(local_path)
    missing, unexpected = candidate.load_state_dict(state_dict, strict=False)
    if missing or unexpected:
        raise RuntimeError(
            f"{Path(local_path).name} doesn't match {hub_config_id}'s "
            f"architecture (missing={len(missing)} unexpected={len(unexpected)} "
            f"state_dict keys) — refusing to load a possibly-corrupted model. "
            f"The checkpoint may not actually be the same architecture as "
            f"{hub_config_id}; verify manually."
        )
    return candidate.to(dtype)


def _qwen_transformer_load_dtype(path: Path, default_dtype: Any) -> Any:
    """Keep Comfy fp8 e4m3fn UNETs in fp8 so they fit resident on 24GB."""
    import torch

    name = path.name.lower()
    if "fp8" in name and hasattr(torch, "float8_e4m3fn"):
        return torch.float8_e4m3fn
    return default_dtype


def _prefer_qwen_fp8_resident_path(model_path: str) -> str:
    """Swap 2512 bf16 → sibling fp8 when present (UNET-resident on 24GB)."""
    if not UNET_RESIDENT:
        return model_path
    path = Path(model_path)
    name = path.name.lower()
    if "fp8" in name or "bf16" not in name:
        return model_path
    if "2512" not in name and not name.startswith("qwen_image"):
        return model_path

    from app.asset_inventory import resolve_asset_file

    candidates = [
        "qwen_image_2512_fp8_e4m3fn.safetensors",
        path.name.replace("bf16", "fp8_e4m3fn"),
        path.name.replace("_bf16", "_fp8_e4m3fn"),
    ]
    for cand in candidates:
        if not cand or cand == path.name:
            continue
        hit = resolve_asset_file(cand, "diffusion_models", "unet", "checkpoints")
        if (
            hit is not None
            and hit.is_file()
            and not hit.name.endswith(".partial")
            and ".partial" not in hit.name
        ):
            print(
                f"[diffusers] preferring fp8 UNET for residency: {hit.name} "
                f"(was {path.name}; Lightning uses fp8 storage + bf16 compute "
                f"via layerwise casting — Diffusers equivalent of Comfy's fast path)",
                flush=True,
            )
            return str(hit)
    return model_path


def _prefer_qwen_lightning_bf16_path(model_path: str) -> str:
    """Swap 2512 fp8 → sibling bf16 for Lightning (Comfy forbids fp8 UNET).

    Studio's Comfy path rewrites Lightning loaders to bf16 specifically to avoid
    grid/grain / screen-door. Keep that as the Diffusers default too.
    """
    path = Path(model_path)
    name = path.name.lower()
    if "bf16" in name or "fp8" not in name:
        return model_path
    if "2512" not in name and not name.startswith("qwen_image"):
        return model_path

    from app.asset_inventory import resolve_asset_file

    candidates = [
        "qwen_image_2512_bf16.safetensors",
        path.name.replace("fp8_e4m3fn", "bf16"),
        path.name.replace("_fp8_e4m3fn", "_bf16"),
        path.name.replace("fp8", "bf16"),
    ]
    for cand in candidates:
        if not cand or cand == path.name:
            continue
        hit = resolve_asset_file(cand, "diffusion_models", "unet", "checkpoints")
        if (
            hit is not None
            and hit.is_file()
            and not hit.name.endswith(".partial")
            and ".partial" not in hit.name
        ):
            print(
                f"[diffusers] Lightning preferring bf16 UNET: {hit.name} "
                f"(was {path.name}; Comfy parity — avoids fp8 grid/grain)",
                flush=True,
            )
            return str(hit)
    print(
        f"[diffusers] Lightning bf16 sibling missing for {path.name}; "
        "keeping current weights (moire risk)",
        flush=True,
    )
    return model_path


def _resolve_qwen_unet_path(model_path: str, *, lightning: bool) -> str:
    """Pick UNET precision: default fp8 resident; opt-in Lightning bf16 via env."""
    if lightning and LIGHTNING_BF16:
        return _prefer_qwen_lightning_bf16_path(model_path)
    return _prefer_qwen_fp8_resident_path(model_path)


class PipelineHolder:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pipe: Any = None
        self._refiner: Any = None
        self._refiner_key: str | None = None
        self._model_key: str | None = None
        self._resolved: ResolvedModel | None = None
        self._lora_key: str = "none"
        self.device = "cpu"
        self._offloaded = False
        self._unet_resident = False
        self._group_offload_blocks: int = GROUP_OFFLOAD_BLOCKS
        self._controlnet_key: str | None = None
        self._controlnet_model: Any = None
        self._ip_adapter_key: str | None = None
        self._instantid_adapter_key: str | None = None

    def describe(self) -> tuple[str, str, bool]:
        if MOCK_MODE:
            return "cpu", DEFAULT_MODEL, True
        if self._resolved is not None:
            if self._unet_resident:
                mode = "unet-resident"
            elif self._offloaded:
                mode = "offload"
            else:
                mode = self.device
            return mode, f"{self._resolved.kind}:{self._resolved.label}", False
        return self.device, DEFAULT_MODEL, False

    def _is_xl_name(self, name: str) -> bool:
        label = name.lower()
        return any(
            token in label
            for token in ("xl", "sdxl", "pony", "illustrious", "noobai", "realvis")
        )

    def _load_single_file(self, path: str, dtype: Any) -> Any:
        from diffusers import StableDiffusionPipeline, StableDiffusionXLPipeline

        label = Path(path).name.lower()
        use_xl = self._is_xl_name(label)
        common: dict[str, Any] = {
            "torch_dtype": dtype,
            "use_safetensors": path.endswith(".safetensors"),
        }

        with _silence_model_warnings():
            if use_xl:
                try:
                    return StableDiffusionXLPipeline.from_single_file(
                        path,
                        config=SDXL_CONFIG_ID,
                        **common,
                    )
                except Exception:
                    return StableDiffusionXLPipeline.from_single_file(path, **common)

            try:
                return StableDiffusionPipeline.from_single_file(path, **common)
            except Exception:
                try:
                    return StableDiffusionXLPipeline.from_single_file(
                        path,
                        config=SDXL_CONFIG_ID,
                        **common,
                    )
                except Exception:
                    return StableDiffusionXLPipeline.from_single_file(path, **common)

    def _attach_sdxl_vae(self, pipe: Any, dtype: Any) -> None:
        from diffusers import AutoencoderKL

        vae = AutoencoderKL.from_pretrained(
            SDXL_VAE_ID,
            torch_dtype=dtype,
            use_safetensors=True,
        )
        if hasattr(vae, "config"):
            vae.config.force_upcast = False
        pipe.vae = vae
        print(f"[diffusers] VAE={SDXL_VAE_ID} force_upcast=False dtype={dtype}", flush=True)

    def _empty_cuda(self) -> None:
        """Aggressively return fragmented CUDA memory to the driver."""
        try:
            import gc

            import torch

            gc.collect()
            if torch.cuda.is_available():
                try:
                    torch.cuda.synchronize()
                except Exception:
                    pass
                torch.cuda.empty_cache()
                try:
                    torch.cuda.ipc_collect()
                except Exception:
                    pass
        except Exception:
            pass

    def _cuda_free_mb(self) -> float:
        try:
            import torch

            if not torch.cuda.is_available():
                return 0.0
            free, _total = torch.cuda.mem_get_info()
            return float(free) / (1024.0 * 1024.0)
        except Exception:
            return 0.0

    def _finalize_pipe(
        self,
        pipe: Any,
        device: str,
        dtype: Any,
        *,
        label: str | None = None,
    ) -> Any:
        import torch
        from diffusers import DPMSolverMultistepScheduler

        is_xl = "xl" in type(pipe).__name__.lower()
        if is_xl:
            try:
                pipe.scheduler = DPMSolverMultistepScheduler.from_config(
                    pipe.scheduler.config,
                    use_karras_sigmas=True,
                    algorithm_type="dpmsolver++",
                )
            except Exception:
                try:
                    pipe.scheduler = DPMSolverMultistepScheduler.from_config(
                        pipe.scheduler.config
                    )
                except Exception:
                    pass

        if is_xl and dtype == torch.float16:
            try:
                self._attach_sdxl_vae(pipe, dtype)
            except Exception as vae_error:
                if not env_flag("DIFFUSERS_ALLOW_STOCK_VAE"):
                    raise RuntimeError(
                        f"Need {SDXL_VAE_ID} for clean SDXL fp16 color. {vae_error}"
                    ) from vae_error

        try:
            pipe.set_progress_bar_config(disable=True)
        except Exception:
            pass

        vae = getattr(pipe, "vae", None)
        if vae is not None:
            for name in ("disable_tiling", "disable_slicing"):
                fn = getattr(vae, name, None)
                if callable(fn):
                    try:
                        fn()
                    except Exception:
                        pass

        self._offloaded = False
        if device == "cuda" and CPU_OFFLOAD:
            try:
                pipe.enable_model_cpu_offload()
                self._offloaded = True
                self.device = "cuda"
                return pipe
            except Exception:
                pass

        # Single move — avoid re-casting VAE after the fact (causes washed outputs).
        with _silence_model_warnings():
            pipe = pipe.to(device)
        self.device = device
        for tok_name in ("tokenizer", "tokenizer_2"):
            tok = getattr(pipe, tok_name, None)
            if tok is not None and hasattr(tok, "clean_up_tokenization_spaces"):
                try:
                    tok.clean_up_tokenization_spaces = False
                except Exception:
                    pass
        sched = type(getattr(pipe, "scheduler", None)).__name__
        model_label = label or (self._resolved.label if self._resolved else "?")
        print(
            f"[diffusers] pipeline ready model={model_label} device={device} "
            f"dtype={dtype} offload={self._offloaded} "
            f"class={type(pipe).__name__} scheduler={sched}",
            flush=True,
        )
        return pipe

    def _dtype_for_resolved(self, resolved: ResolvedModel, device: str) -> Any:
        import torch

        if device != "cuda":
            return torch.float32
        if resolved.kind == "single_file" and self._is_xl_name(resolved.label):
            return torch.float32 if SDXL_FORCE_FP32 else torch.float16
        return torch.float16

    def _load_pipe(self, resolved: ResolvedModel) -> Any:
        import torch
        from diffusers import AutoPipelineForText2Image

        self._empty_cuda()
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = self._dtype_for_resolved(resolved, device)
        common: dict[str, Any] = {"torch_dtype": dtype}
        if device == "cuda" and dtype == torch.float16:
            common["variant"] = "fp16"

        try:
            with _silence_model_warnings():
                if resolved.kind == "single_file":
                    pipe = self._load_single_file(resolved.source, dtype)
                    pipe = self._finalize_pipe(
                        pipe, device, dtype, label=resolved.label
                    )
                elif resolved.kind == "diffusers_dir":
                    pipe = AutoPipelineForText2Image.from_pretrained(
                        resolved.source,
                        local_files_only=True,
                        torch_dtype=dtype,
                    )
                    pipe = self._finalize_pipe(
                        pipe, device, dtype, label=resolved.label
                    )
                else:
                    try:
                        pipe = AutoPipelineForText2Image.from_pretrained(
                            resolved.source,
                            **common,
                        )
                    except TypeError:
                        pipe = AutoPipelineForText2Image.from_pretrained(
                            resolved.source,
                            torch_dtype=dtype,
                        )
                    pipe = self._finalize_pipe(
                        pipe, device, dtype, label=resolved.label
                    )
        except Exception as load_error:
            # Never silently remap Flux/Qwen UNETs onto RealVis/SDXL.
            if infer_native_family(resolved.label) in ("flux", "qwen"):
                raise load_error
            if resolved.label != "sd_xl_base_1.0.safetensors":
                fallback = resolve_model("sdxl", default_hub=DEFAULT_MODEL)
                if (
                    fallback.kind != "hub"
                    and fallback.source != resolved.source
                    and infer_native_family(fallback.label) is None
                ):
                    print(
                        f"[diffusers] load failed for {resolved.label}; "
                        f"falling back to {fallback.label}",
                        flush=True,
                    )
                    return self._load_pipe(fallback)
            raise load_error

        return pipe

    def _ensure_loaded(self, model: str) -> Any:
        if MOCK_MODE:
            return None

        resolved = resolve_model(model, default_hub=DEFAULT_MODEL)
        model_key = (
            f"{resolved.kind}:{resolved.source}:"
            f"{'fp32' if SDXL_FORCE_FP32 else 'fp16'}:"
            f"{'offload' if CPU_OFFLOAD else 'gpu'}:v4"
        )

        with self._lock:
            if self._pipe is not None and self._model_key == model_key:
                return self._pipe

            try:
                pipe = self._load_pipe(resolved)
            except Exception as first_error:
                if resolved.kind != "hub":
                    paths = ", ".join(describe_search_paths()) or "(none)"
                    raise RuntimeError(
                        f"Failed to load model {resolved.label!r} from {resolved.source}. "
                        f"Searched: {paths}. {first_error}"
                    ) from first_error

                local = resolve_model(
                    Path(resolved.source).name,
                    default_hub=DEFAULT_MODEL,
                )
                if local.kind == "hub":
                    local = resolve_model("sdxl", default_hub=DEFAULT_MODEL)
                if local.kind == "hub":
                    paths = ", ".join(describe_search_paths()) or "(none)"
                    raise RuntimeError(
                        f"Model {resolved.source!r} not on Hugging Face and not found under "
                        f"ComfyUI folders ({paths}). Set COMFYUI_ROOT or place weights in "
                        f"models/checkpoints or models/diffusers. {first_error}"
                    ) from first_error
                pipe = self._load_pipe(local)
                resolved = local
                model_key = (
                    f"{resolved.kind}:{resolved.source}:"
                    f"{'fp32' if SDXL_FORCE_FP32 else 'fp16'}:"
                    f"{'offload' if CPU_OFFLOAD else 'gpu'}:v4"
                )

            self._pipe = pipe
            self._model_key = model_key
            self._resolved = resolved
            self._lora_key = "none"
            return pipe

    def _fuse_kohya_lora(self, pipe: Any, path: str, weight: float) -> None:
        """
        Fuse a Kohya/Civitai SDXL LoRA into the UNet.

        Full `load_lora_weights()` often crashes on these files (empty TE rank map
        → IndexError). Mapping with `unet_config` + UNet-only inject is reliable.
        """
        from diffusers import StableDiffusionXLPipeline

        lora_path = Path(path)
        state_dict, network_alphas = StableDiffusionXLPipeline.lora_state_dict(
            str(lora_path.parent),
            weight_name=lora_path.name,
            unet_config=pipe.unet.config,
        )
        unet_state = {
            key: value
            for key, value in state_dict.items()
            if key.startswith("unet.")
        }
        if not unet_state:
            raise RuntimeError(f"No UNet LoRA keys in {lora_path.name}")
        unet_alphas = None
        if isinstance(network_alphas, dict):
            unet_alphas = {
                key: value
                for key, value in network_alphas.items()
                if key.startswith("unet.") or ".unet." in key
            }
            if not unet_alphas:
                unet_alphas = network_alphas
        pipe.load_lora_into_unet(
            unet_state,
            network_alphas=unet_alphas,
            unet=pipe.unet,
        )
        pipe.fuse_lora(lora_scale=float(weight))
        try:
            pipe.unload_lora_weights()
        except Exception:
            pass

    def _apply_loras(
        self,
        pipe: Any,
        *,
        wants_person: bool,
        workshop_role: bool = False,
    ) -> Any:
        """Fuse SDXL LoRAs for this generate (hand fix + optional detail)."""
        is_xl = "xl" in type(pipe).__name__.lower()
        if not is_xl:
            return pipe
        loras = resolve_loras(
            wants_person=wants_person,
            workshop_role=workshop_role,
        )
        key = lora_cache_key(loras)
        if key == self._lora_key:
            return pipe

        # Fused LoRAs bake into weights — reload a clean base when the set changes.
        if self._lora_key != "none" and self._resolved is not None:
            print("[diffusers] reloading base checkpoint to swap LoRAs", flush=True)
            pipe = self._load_pipe(self._resolved)
            self._pipe = pipe

        if not loras:
            self._lora_key = "none"
            return pipe

        fused = 0
        for item in loras:
            try:
                self._fuse_kohya_lora(pipe, item.path, item.weight)
                fused += 1
                print(
                    f"[diffusers] LoRA fused {item.name} weight={item.weight:.2f}",
                    flush=True,
                )
            except Exception as error:
                print(f"[diffusers] LoRA load failed {item.name}: {error}", flush=True)
        if workshop_role:
            print("[diffusers] workshop role: crop hands out of frame", flush=True)
        self._lora_key = key if fused else "none"
        return pipe

    def _remove_group_offload_hooks(self, module: Any) -> None:
        """Remove Diffusers group-offload hooks only (keep layerwise casting)."""
        if module is None:
            return
        try:
            from diffusers.hooks.group_offloading import (
                HookRegistry,
                _GROUP_OFFLOADING,
                _LAYER_EXECUTION_TRACKER,
                _LAZY_PREFETCH_GROUP_OFFLOADING,
            )

            registry = HookRegistry.check_if_exists_or_initialize(module)
            registry.remove_hook(_GROUP_OFFLOADING, recurse=True)
            registry.remove_hook(_LAYER_EXECUTION_TRACKER, recurse=True)
            registry.remove_hook(_LAZY_PREFETCH_GROUP_OFFLOADING, recurse=True)
        except Exception:
            pass

    def _force_module_cpu(self, module: Any) -> None:
        """Best-effort: drop group-offload hooks and move every parameter to CPU."""
        import torch

        if module is None or not isinstance(module, torch.nn.Module):
            return
        self._remove_group_offload_hooks(module)
        try:
            module.to("cpu")
        except Exception:
            pass
        # Group-offload can make .to("cpu") a silent no-op — scrub CUDA tensors.
        for tensor in list(module.parameters()) + list(module.buffers()):
            try:
                if tensor.device.type == "cuda":
                    tensor.data = tensor.data.to("cpu")
            except Exception:
                pass

    def _restore_pipe_component_dtype(self, pipe: Any, dtype: Any) -> None:
        """Re-cast text_encoder(s)/vae back to `dtype` after DiffusionPipeline
        .from_pipe() — confirmed via GPU smoke test that from_pipe() silently
        upcasts Qwen's text_encoder from bf16 to float32 (traced with explicit
        dtype prints immediately before/after the call: bf16 in, float32 out),
        doubling its footprint from ~15.4GiB to ~30.9GiB and making it
        physically unable to fit on a 24GB card no matter what else is freed.
        Only touches parameters that actually drifted, and only parameters
        (not buffers, e.g. RoPE tables) — cheap since these components are
        CPU-resident at this point, not yet moved to CUDA.
        """
        import torch

        if pipe is None or dtype is None:
            return
        for name in ("text_encoder", "text_encoder_2", "vae"):
            mod = getattr(pipe, name, None)
            if mod is None or not isinstance(mod, torch.nn.Module):
                continue
            try:
                drifted = 0
                for param in mod.parameters():
                    if param.dtype != dtype and param.is_floating_point():
                        param.data = param.data.to(dtype=dtype)
                        drifted += 1
                if drifted:
                    print(
                        f"[diffusers] from_pipe() drifted {name} dtype — "
                        f"restored {drifted} params to {dtype}",
                        flush=True,
                    )
            except Exception as exc:
                print(f"[diffusers] {name} dtype restore skipped: {exc}", flush=True)

    def _cuda_param_mb(self, module: Any) -> float:
        """MiB of parameters currently resident on CUDA (for park diagnostics)."""
        import torch

        if module is None or not isinstance(module, torch.nn.Module):
            return 0.0
        total = 0
        try:
            for tensor in module.parameters():
                if tensor.device.type == "cuda":
                    total += int(tensor.numel()) * int(tensor.element_size())
            for tensor in module.buffers():
                if tensor.device.type == "cuda":
                    total += int(tensor.numel()) * int(tensor.element_size())
        except Exception:
            return 0.0
        return float(total) / (1024.0 * 1024.0)

    def _bulk_module_to_cuda(self, module: Any, device: Any) -> None:
        """Move every CPU parameter of `module` onto CUDA as ONE allocation,
        instead of nn.Module.to(device)'s default per-parameter transfer.

        Confirmed via GPU smoke test: moving the Qwen text encoder (729
        tensors, 16.58GB bf16 on disk) with plain `te.to(cuda)` landed at
        ~19.7-19.9GB actually allocated on device — this process held
        0MiB/0MiB (allocated/reserved) immediately beforehand, so that
        ~3.1-3.3GB gap isn't anything else holding memory, it's the caching
        allocator's own per-allocation rounding/padding across hundreds of
        separate cudaMalloc-equivalent calls. Packing every parameter into
        one big buffer and handing out views into it turns that into a
        single allocation, which should reclaim most of that overhead —
        the difference between "just barely doesn't fit" and "fits".
        """
        import torch

        if module is None or not isinstance(module, torch.nn.Module):
            return
        device = torch.device(device)
        params = [
            (name, p)
            for name, p in module.named_parameters()
            if p.device.type != device.type
        ]
        if not params:
            return
        dtypes = {p.dtype for _, p in params}
        if len(dtypes) != 1:
            # Mixed dtypes: don't risk mis-packing a heterogeneous buffer —
            # fall back to the normal (slower, more allocator overhead) path.
            module.to(device)
            return
        dtype = next(iter(dtypes))
        sizes = [p.numel() for _, p in params]
        total = sum(sizes)
        if total == 0:
            module.to(device)
            return
        _raw_bytes = sum(p.numel() * p.element_size() for _, p in params)
        _itemsize = torch.empty((), dtype=dtype).element_size()
        _requested_gib = total * _itemsize / (1024**3)
        print(
            f"[diffusers] bulk-transfer plan: {len(params)} params, "
            f"dtype={dtype}, itemsize={_itemsize}B, total_elems={total}, "
            f"requested={_requested_gib:.2f}GiB, "
            f"raw_param_bytes={_raw_bytes / (1024**3):.2f}GiB",
            flush=True,
        )
        if torch.cuda.is_available():
            _dev_total_gib = torch.cuda.mem_get_info()[1] / (1024**3)
            if _requested_gib > _dev_total_gib * 1.05:
                # Something's off by roughly 2x — don't burn minutes on a
                # transfer that can never succeed. Fall back immediately;
                # the print above already captured the numbers to debug.
                print(
                    f"[diffusers] bulk-transfer request ({_requested_gib:.2f}GiB) "
                    f"exceeds device capacity ({_dev_total_gib:.2f}GiB) — "
                    "skipping, falling back to per-parameter .to()",
                    flush=True,
                )
                module.to(device)
                return
        try:
            flat_cpu = torch.empty(total, dtype=dtype)
            offset = 0
            spans: list[tuple[str, int, int, Any]] = []
            for (name, p), n in zip(params, sizes):
                flat_cpu[offset : offset + n].copy_(p.detach().reshape(-1))
                spans.append((name, offset, n, p.shape))
                offset += n
            flat_cuda = flat_cpu.to(device)
            del flat_cpu
        except Exception as exc:
            print(
                f"[diffusers] bulk CUDA transfer failed ({exc}); "
                "falling back to per-parameter .to()",
                flush=True,
            )
            module.to(device)
            return
        by_name = dict(module.named_parameters())
        for name, off, n, shape in spans:
            by_name[name].data = flat_cuda[off : off + n].view(shape)
        # Buffers (RoPE tables etc.) are tiny relative to the parameters —
        # not worth the same bulk-packing complexity, move them normally.
        for _name, buf in module.named_buffers():
            if buf.device.type != device.type:
                try:
                    buf.data = buf.data.to(device)
                except Exception:
                    pass

    def _park_pipe(self, pipe: Any) -> None:
        """Park a pipeline on CPU. Do not upcast — bf16 DiT→fp32 would explode RAM."""
        import torch

        if pipe is None:
            return
        with _silence_model_warnings():
            for name in (
                "transformer",
                "unet",
                "text_encoder",
                "text_encoder_2",
                "vae",
            ):
                mod = getattr(pipe, name, None)
                if mod is not None:
                    try:
                        self._force_module_cpu(mod)
                    except Exception:
                        pass
            try:
                pipe.to("cpu")
            except Exception:
                pass
        self._empty_cuda()

    def _release_pipe(self) -> None:
        """Drop the cached pipeline so the next load starts from a clean base."""
        import gc

        pipe = self._pipe
        self._pipe = None
        self._model_key = None
        self._lora_key = "none"
        self._resolved = None
        self._offloaded = False
        self._unet_resident = False
        self._controlnet_key = None
        self._controlnet_model = None
        self._ip_adapter_key = None
        self._instantid_adapter_key = None
        if pipe is not None:
            try:
                self._park_pipe(pipe)
            except Exception:
                pass
            del pipe
        gc.collect()
        self._empty_cuda()

    def _module_footprint_mb(self, module: Any) -> float:
        """Approximate parameter + buffer footprint in MiB."""
        try:
            import torch

            if module is None or not isinstance(module, torch.nn.Module):
                return 0.0
            total = 0
            for tensor in module.parameters():
                total += int(tensor.numel()) * int(tensor.element_size())
            for tensor in module.buffers():
                total += int(tensor.numel()) * int(tensor.element_size())
            return float(total) / (1024.0 * 1024.0)
        except Exception:
            return 0.0

    def _safe_module_to(self, mod: Any, device: str) -> None:
        """Move a module; refuse meta tensors (broken empty loads)."""
        import torch

        if mod is None or not isinstance(mod, torch.nn.Module):
            return
        try:
            for tensor in mod.parameters():
                if tensor.device.type == "meta":
                    raise RuntimeError(
                        "module still on meta device (weights never loaded)"
                    )
            mod.to(device)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

    def _park_te_vae_cpu(self, pipe: Any) -> None:
        """Park text encoders + VAE on CPU so the DiT can own the card."""
        import torch

        for name in ("text_encoder", "text_encoder_2", "vae"):
            mod = getattr(pipe, name, None)
            if mod is None or not isinstance(mod, torch.nn.Module):
                continue
            try:
                self._safe_module_to(mod, "cpu")
            except Exception as exc:
                print(f"[diffusers] {name} →cpu skipped: {exc}", flush=True)

    def _try_unet_resident(self, pipe: Any, *, after_te: bool = False) -> bool:
        """Keep DiT/UNET fully on CUDA (Comfy-style). TE/VAE stay on CPU.

        Returns False when the transformer won't fit — caller should group-offload.
        For Qwen layerwise fp8, pass after_te=True only once the TE is parked so
        residency does not starve the encode step.
        """
        import torch

        if not UNET_RESIDENT or not torch.cuda.is_available():
            return False
        transformer = getattr(pipe, "transformer", None)
        if transformer is None or not isinstance(transformer, torch.nn.Module):
            return False

        for name in ("enable_vae_slicing", "enable_vae_tiling"):
            fn = getattr(pipe, name, None)
            if callable(fn):
                try:
                    fn()
                except Exception:
                    pass

        self._park_te_vae_cpu(pipe)
        self._empty_cuda()
        free_mb = self._cuda_free_mb()
        need_mb = self._module_footprint_mb(transformer)
        # Already staged on CUDA during sequential load — just confirm residency.
        try:
            first = next(transformer.parameters())
            if first.device.type == "cuda":
                try:
                    pipe._execution_device = torch.device("cuda")  # type: ignore[attr-defined]
                except Exception:
                    pass
                self._unet_resident = True
                self._offloaded = False
                print(
                    f"[diffusers] placement=unet-resident (pre-staged) "
                    f"(DiT≈{need_mb:.0f}MiB, free≈{free_mb:.0f}MiB)",
                    flush=True,
                )
                return True
        except StopIteration:
            pass

        # Layerwise fp8 ≈19.5GiB on 24GB. Before TE, demand enough free VRAM
        # that a 7B encode could still run (~14GiB) — i.e. skip residency.
        # After TE, tighten to denoise headroom only.
        headroom_after = free_mb - need_mb if need_mb > 0 else free_mb
        if need_mb <= 20000:
            if after_te:
                min_headroom = 400.0
                slop_mb = 512.0
            else:
                min_headroom = 14000.0
                slop_mb = 0.0
        elif need_mb <= 22000:
            min_headroom = 1500.0 if after_te else 14000.0
            slop_mb = 256.0 if after_te else 0.0
        else:
            min_headroom = 3500.0
            slop_mb = 0.0
        if need_mb > 0 and (
            need_mb > free_mb + slop_mb
            or headroom_after + slop_mb < min_headroom
        ):
            print(
                f"[diffusers] unet-resident skipped "
                f"(need≈{need_mb:.0f}MiB free≈{free_mb:.0f}MiB "
                f"headroom≈{headroom_after:.0f}MiB"
                f"{' after_te' if after_te else ''}) — will group-offload",
                flush=True,
            )
            return False

        try:
            self._safe_module_to(transformer, "cuda")
            try:
                pipe._execution_device = torch.device("cuda")  # type: ignore[attr-defined]
            except Exception:
                pass
            self._unet_resident = True
            self._offloaded = False
            print(
                f"[diffusers] placement=unet-resident "
                f"(DiT≈{need_mb:.0f}MiB, free≈{self._cuda_free_mb():.0f}MiB)",
                flush=True,
            )
            return True
        except torch.cuda.OutOfMemoryError:
            print(
                "[diffusers] unet-resident OOM — falling back to group offload",
                flush=True,
            )
            try:
                self._safe_module_to(transformer, "cpu")
            except Exception:
                pass
            self._empty_cuda()
            self._unet_resident = False
            return False
        except Exception as exc:
            print(f"[diffusers] unet-resident failed: {exc}", flush=True)
            try:
                if not any(
                    getattr(p, "device", None) is not None and p.device.type == "meta"
                    for p in transformer.parameters()
                ):
                    self._safe_module_to(transformer, "cpu")
            except Exception:
                pass
            self._empty_cuda()
            self._unet_resident = False
            return False

    def _place_compiled_pipe(
        self,
        pipe: Any,
        dtype: Any,
        *,
        prefer_offload: bool = False,
        prefer_sequential: bool = False,
        pixel_count: int = 0,
    ) -> Any:
        """Move a Flux/Qwen compiled pipeline onto CUDA (or leave on CPU)."""
        import torch

        del dtype  # placement only; dtypes already set at load time
        del pixel_count  # reserved for future heuristics
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self._offloaded = False
        self._unet_resident = False
        if device == "cuda":
            # Prefer DiT/UNET fully resident (TE/VAE parked). Group-offload only
            # when the transformer won't fit — block thrash is much slower.
            if CPU_OFFLOAD or prefer_offload:
                try:
                    free_mb = self._cuda_free_mb()
                    critically_low = free_mb > 0 and free_mb < 1500
                    use_sequential = (
                        SEQUENTIAL_OFFLOAD or prefer_sequential or critically_low
                    ) and hasattr(pipe, "enable_sequential_cpu_offload")
                    for name in ("enable_vae_slicing", "enable_vae_tiling"):
                        fn = getattr(pipe, name, None)
                        if callable(fn):
                            try:
                                fn()
                            except Exception:
                                pass
                    self._empty_cuda()
                    if use_sequential:
                        pipe.enable_sequential_cpu_offload()
                        reason = (
                            "env"
                            if SEQUENTIAL_OFFLOAD
                            else ("requested" if prefer_sequential else "critical-vram")
                        )
                        print(
                            f"[diffusers] offload=sequential ({reason}, "
                            f"free≈{free_mb:.0f}MiB) — may slow the desktop",
                            flush=True,
                        )
                        self._offloaded = True
                    elif self._try_unet_resident(pipe):
                        self.device = "cuda"
                        return pipe
                    elif GROUP_OFFLOAD and self._try_group_offload_transformer(pipe):
                        print(
                            f"[diffusers] offload=group(transformer) "
                            f"(free≈{free_mb:.0f}MiB)",
                            flush=True,
                        )
                        self._offloaded = True
                    else:
                        pipe.enable_model_cpu_offload()
                        print(
                            f"[diffusers] offload=model (free≈{free_mb:.0f}MiB)",
                            flush=True,
                        )
                        self._offloaded = True
                    self.device = "cuda"
                    return pipe
                except Exception as exc:
                    print(f"[diffusers] cpu_offload failed: {exc}", flush=True)
            pipe = pipe.to(device)
        self.device = device
        return pipe

    def _adaptive_group_blocks(self, pipe: Any, free_mb: float) -> int:
        """Pick block group size from free VRAM (fewer PCIe swaps when headroom)."""
        env_override = os.environ.get("DIFFUSERS_GROUP_OFFLOAD_BLOCKS", "").strip()
        if env_override:
            return max(1, int(env_override))

        blocks = 60
        transformer = getattr(pipe, "transformer", None)
        try:
            tb = getattr(transformer, "transformer_blocks", None)
            if tb is not None and len(tb) > 0:
                blocks = len(tb)
        except Exception:
            pass

        # Measure real footprint — bf16 DiT ≈0.65GiB/block; fp8 ≈0.32GiB/block.
        per_block_mb = 680.0
        try:
            footprint = self._module_footprint_mb(transformer)
            if footprint > 0 and blocks > 0:
                per_block_mb = max(200.0, footprint / float(blocks))
        except Exception:
            pass

        # Leave ≥50% of free VRAM for activations / attention (Qwen is heavy).
        usable = max(2048.0, (free_mb if free_mb > 0 else 12000.0) * 0.45)
        n = int(usable / per_block_mb)
        half = blocks // 2 if blocks >= 16 else blocks
        # Cap aggressively on 24GB cards — 18 bf16 blocks ≈12GiB + acts → OOM.
        hard_cap = 8 if per_block_mb >= 500 else 18
        n = max(2, min(n, hard_cap, half, 30))
        floor = min(GROUP_OFFLOAD_BLOCKS, hard_cap, half)
        if free_mb <= 0 or free_mb >= floor * per_block_mb * 2.0:
            n = max(n, min(floor, hard_cap))
        return max(1, n)

    def _try_group_offload_transformer(
        self,
        pipe: Any,
        *,
        num_blocks: int | None = None,
    ) -> bool:
        """Group-offload DiT blocks; park TE/VAE on CPU (device-safe)."""
        import torch

        transformer = getattr(pipe, "transformer", None)
        if transformer is None or not hasattr(transformer, "enable_group_offload"):
            return False

        free_mb = self._cuda_free_mb()
        blocks = num_blocks or self._adaptive_group_blocks(pipe, free_mb)
        try:
            # use_stream=False: streams force num_blocks_per_group=1 (worse thrash)
            # and previously caused CUDA/CPU bf16 mismatches.
            # non_blocking=False: async onload left TE+DiT overlapping on 24GB.
            transformer.enable_group_offload(
                onload_device=torch.device("cuda"),
                offload_device=torch.device("cpu"),
                offload_type="block_level",
                num_blocks_per_group=blocks,
                use_stream=False,
                non_blocking=False,
                low_cpu_mem_usage=False,
            )
            self._group_offload_blocks = blocks
        except Exception as exc:
            print(f"[diffusers] transformer group_offload failed: {exc}", flush=True)
            return False

        # TE/VAE stay on CPU; Qwen encode path moves TE explicitly then parks it
        # so large DiT groups get the full card during denoise.
        self._park_te_vae_cpu(pipe)

        # Diffusers reads this for device placement of intermediates.
        try:
            pipe._execution_device = torch.device("cuda")  # type: ignore[attr-defined]
        except Exception:
            pass
        block_total = 60
        try:
            tb = getattr(transformer, "transformer_blocks", None)
            if tb is not None and len(tb) > 0:
                block_total = len(tb)
        except Exception:
            pass
        swaps = max(1, (block_total + blocks - 1) // blocks)
        print(
            f"[diffusers] group_offload blocks={blocks}/{block_total} "
            f"(~{swaps} swaps/step, free≈{free_mb:.0f}MiB)",
            flush=True,
        )
        self._unet_resident = False
        return True

    def _wake_pipe(self, pipe: Any, device: str, dtype: Any) -> None:
        """Restore a parked pipeline to the inference device/dtype."""
        if pipe is None:
            return
        with _silence_model_warnings():
            pipe.to(device=device, dtype=dtype)

    def _ensure_refiner(self, dtype: Any, device: str) -> Any | None:
        """Lazily load SDXL img2img refiner when enabled and present on disk."""
        if not REFINER_ENABLED:
            return None
        resolved = resolve_sdxl_refiner()
        if resolved is None:
            return None
        key = f"{resolved.kind}:{resolved.source}"
        if self._refiner is not None and self._refiner_key == key:
            return self._refiner

        from diffusers import (
            DPMSolverMultistepScheduler,
            StableDiffusionXLImg2ImgPipeline,
        )

        import torch

        print(f"[diffusers] loading refiner {resolved.label}", flush=True)
        # Load in float32 so CPU parking between jobs is valid; cast on wake.
        common: dict[str, Any] = {
            "torch_dtype": torch.float32,
            "use_safetensors": resolved.source.endswith(".safetensors"),
        }
        with _silence_model_warnings():
            try:
                refiner = StableDiffusionXLImg2ImgPipeline.from_single_file(
                    resolved.source,
                    config=SDXL_REFINER_CONFIG_ID,
                    **common,
                )
            except Exception:
                refiner = StableDiffusionXLImg2ImgPipeline.from_single_file(
                    resolved.source,
                    **common,
                )
            try:
                self._attach_sdxl_vae(refiner, torch.float32)
            except Exception:
                pass
            try:
                refiner.scheduler = DPMSolverMultistepScheduler.from_config(
                    refiner.scheduler.config,
                    use_karras_sigmas=True,
                    algorithm_type="dpmsolver++",
                )
            except Exception:
                pass
            try:
                refiner.set_progress_bar_config(disable=True)
            except Exception:
                pass
            self._park_pipe(refiner)

        self._refiner = refiner
        self._refiner_key = key
        return refiner

    def _refine_image(
        self,
        *,
        image: Image.Image,
        prompt: str,
        negative_prompt: str,
        steps: int,
        guidance_scale: float,
        seed: int,
        device: str,
        dtype: Any,
    ) -> Image.Image:
        import torch

        refiner = self._ensure_refiner(dtype, device)
        if refiner is None:
            return image

        strength = max(0.05, min(REFINER_STRENGTH, 0.6))
        refine_steps = max(12, min(steps, 28))
        print(
            f"[diffusers] refine steps={refine_steps} strength={strength:.2f} "
            f"cfg={guidance_scale}",
            flush=True,
        )

        # Free base VRAM, run refiner on GPU, then restore base.
        base = self._pipe
        try:
            if base is not None and device == "cuda":
                self._park_pipe(base)
            if device == "cuda":
                self._wake_pipe(refiner, device, dtype)
            generator = torch.Generator(device=device).manual_seed(seed + 1)
            # Prompt is already CLIP-fitted by the base pass — clamp only, no re-lock.
            encoded = encode_sdxl_prompts(
                refiner,
                prompt=prompt,
                negative_prompt=negative_prompt,
                device=device,
            )
            with _silence_model_warnings():
                result = refiner(
                    image=image,
                    num_inference_steps=refine_steps,
                    strength=strength,
                    guidance_scale=guidance_scale,
                    generator=generator,
                    **encoded,
                )
            return result.images[0]
        except torch.cuda.OutOfMemoryError:
            print("[diffusers] refine OOM — returning base image", flush=True)
            self._empty_cuda()
            return image
        except Exception as error:
            print(f"[diffusers] refine failed: {error}", flush=True)
            return image
        finally:
            self._park_pipe(refiner)
            if base is not None and device == "cuda" and not self._offloaded:
                try:
                    self._wake_pipe(base, device, dtype)
                    self._pipe = base
                except Exception as restore_error:
                    print(
                        f"[diffusers] base restore failed: {restore_error}",
                        flush=True,
                    )

    def _decode_latents_fp32(self, pipe: Any, latents: Any) -> Image.Image:
        """Decode in float32 — stock/fp16 VAE paths often wash to grey soup."""
        import torch

        vae = pipe.vae
        scaling = float(getattr(vae.config, "scaling_factor", 0.13025))
        original_dtype = next(vae.parameters()).dtype

        # Diffusers warns on temporary fp32 cast even when intentional for color.
        with _silence_model_warnings():
            vae_fp32 = vae.to(dtype=torch.float32)
            latents_fp32 = latents.to(dtype=torch.float32) / scaling
            with torch.inference_mode():
                decoded = vae_fp32.decode(latents_fp32, return_dict=False)[0]
            try:
                vae.to(dtype=original_dtype)
            except Exception:
                pass

        decoded = (decoded / 2 + 0.5).clamp(0, 1)
        decoded = decoded.detach().cpu().permute(0, 2, 3, 1).float().numpy()
        decoded = (decoded * 255.0).round().astype("uint8")
        image = Image.fromarray(decoded[0])
        arr = decoded[0].astype("float32")
        color = float(
            np.abs(arr[:, :, 0] - arr[:, :, 1]).mean()
            + np.abs(arr[:, :, 1] - arr[:, :, 2]).mean()
        )
        print(f"[diffusers] decode color_spread={color:.3f}", flush=True)
        return image

    def _decode_qwen_latents(
        self,
        pipe: Any,
        latents: Any,
        *,
        height: int,
        width: int,
        quality_decode: bool = False,
    ) -> Image.Image:
        """VAE-decode Qwen latents (full-frame; DiT fully parked first)."""
        import gc

        import torch

        rearm_blocks = int(getattr(self, "_group_offload_blocks", GROUP_OFFLOAD_BLOCKS))
        was_resident = bool(self._unet_resident)
        transformer = getattr(pipe, "transformer", None)
        vae = getattr(pipe, "vae", None)
        if vae is None:
            raise RuntimeError("Qwen pipeline missing VAE for decode.")

        try:
            latents = latents.detach().to("cpu")
        except Exception:
            pass
        self._force_module_cpu(getattr(pipe, "text_encoder", None))

        # Tiling/slicing leaves seam HF that reads as moiré — Comfy is full-frame.
        for name in ("disable_vae_tiling", "disable_vae_slicing"):
            for owner in (pipe, vae):
                fn = getattr(owner, name, None)
                if callable(fn):
                    try:
                        fn()
                    except Exception:
                        pass

        # Always strip offload hooks + park DiT so VAE owns the card.
        # Leaving group-offload hooks attached can keep ~19GiB pinned → decode OOM.
        parked_dit = False
        if transformer is not None:
            self._force_module_cpu(transformer)
            parked_dit = True
            dit_cuda = self._cuda_param_mb(transformer)
            if dit_cuda > 64:
                print(
                    f"[diffusers] DiT park incomplete ({dit_cuda:.0f}MiB still CUDA) "
                    "— forcing second scrub",
                    flush=True,
                )
                self._force_module_cpu(transformer)
        self._empty_cuda()
        gc.collect()
        self._empty_cuda()
        free_mb = self._cuda_free_mb()

        original_vae_dtype = None
        try:
            original_vae_dtype = next(vae.parameters()).dtype
        except StopIteration:
            pass

        # fp32 decode only when there is real headroom; otherwise bf16 (safe).
        want_fp32 = bool(quality_decode) and free_mb >= 6000
        decode_dtype = (
            torch.float32
            if want_fp32
            else (original_vae_dtype or torch.bfloat16)
        )
        if quality_decode and not want_fp32:
            print(
                f"[diffusers] VAE decode bf16 (free≈{free_mb:.0f}MiB; "
                "skip fp32 to avoid OOM)",
                flush=True,
            )

        def _run_decode(dtype: Any) -> Image.Image:
            vae.to(device=torch.device("cuda"), dtype=dtype)
            packed = pipe._unpack_latents(
                latents.to(torch.device("cuda")),
                height,
                width,
                pipe.vae_scale_factor,
            )
            packed = packed.to(device=torch.device("cuda"), dtype=dtype)
            latents_mean = (
                torch.tensor(vae.config.latents_mean)
                .view(1, vae.config.z_dim, 1, 1, 1)
                .to(packed.device, packed.dtype)
            )
            latents_std = (
                1.0
                / torch.tensor(vae.config.latents_std)
                .view(1, vae.config.z_dim, 1, 1, 1)
                .to(packed.device, packed.dtype)
            )
            packed = packed / latents_std + latents_mean
            with torch.inference_mode():
                decoded = vae.decode(packed, return_dict=False)[0][:, :, 0]
            images = pipe.image_processor.postprocess(decoded, output_type="pil")
            return images[0] if isinstance(images, list) else images

        try:
            try:
                image = _run_decode(decode_dtype)
            except torch.cuda.OutOfMemoryError:
                print(
                    "[diffusers] VAE decode OOM — empty cache + bf16 retry",
                    flush=True,
                )
                try:
                    vae.to("cpu")
                except Exception:
                    pass
                self._force_module_cpu(transformer)
                self._empty_cuda()
                gc.collect()
                self._empty_cuda()
                image = _run_decode(torch.bfloat16)
                decode_dtype = torch.bfloat16
        finally:
            try:
                if original_vae_dtype is not None:
                    vae.to(dtype=original_vae_dtype)
                vae.to("cpu")
            except Exception:
                pass
            self._empty_cuda()
            if parked_dit and transformer is not None:
                try:
                    if was_resident:
                        self._safe_module_to(transformer, "cuda")
                        self._unet_resident = True
                    elif GROUP_OFFLOAD:
                        self._try_group_offload_transformer(
                            pipe, num_blocks=rearm_blocks
                        )
                except Exception as rearm_exc:
                    print(
                        f"[diffusers] DiT re-arm after VAE: {rearm_exc}",
                        flush=True,
                    )
        print(
            f"[diffusers] Qwen VAE decode ok "
            f"dtype={decode_dtype} tiling=off "
            f"resident={was_resident} free≈{self._cuda_free_mb():.0f}MiB",
            flush=True,
        )
        return image

    def _rearm_qwen_group_offload(
        self,
        pipe: Any,
        *,
        num_blocks: int,
        pixel_count: int = 0,
    ) -> bool:
        """Cleanly strip + re-apply group offload (safe after OOM / size change)."""
        transformer = getattr(pipe, "transformer", None)
        if transformer is None:
            return False
        self._force_module_cpu(getattr(pipe, "text_encoder", None))
        self._force_module_cpu(getattr(pipe, "vae", None))
        self._force_module_cpu(transformer)
        self._empty_cuda()
        blocks = max(1, int(num_blocks))
        dit_mb = self._module_footprint_mb(transformer)
        fp8_sized = dit_mb > 0 and dit_mb <= 22000
        if pixel_count >= 1152 * 1400:
            blocks = min(blocks, 8 if fp8_sized else 2)
        elif pixel_count >= 1024 * 1024:
            blocks = min(blocks, 12 if fp8_sized else 4)
        print(
            f"[diffusers] re-arm group_offload blocks={blocks} "
            f"free≈{self._cuda_free_mb():.0f}MiB pixels={pixel_count} "
            f"dit≈{dit_mb:.0f}MiB",
            flush=True,
        )
        return self._try_group_offload_transformer(pipe, num_blocks=blocks)

    def generate(
        self,
        *,
        prompt: str,
        negative_prompt: str,
        model: str,
        width: int,
        height: int,
        steps: int,
        guidance_scale: float,
        seed: int,
        on_step: Callable[[int, int], None] | None = None,
        on_status: Callable[[str], None] | None = None,
        workshop_crop: bool | None = None,
    ) -> Image.Image:
        model_id = (model or DEFAULT_MODEL).strip() or DEFAULT_MODEL

        if MOCK_MODE:
            if on_step:
                on_step(1, max(steps, 1))
            image = Image.new("RGB", (width, height), (28, 32, 48))
            draw = ImageDraw.Draw(image)
            draw.text((24, 24), "DIFFUSERS_MOCK", fill=(220, 220, 230))
            draw.text((24, 48), prompt[:80], fill=(180, 190, 210))
            draw.text((24, 72), f"seed={seed}", fill=(140, 150, 170))
            if on_step:
                on_step(max(steps, 1), max(steps, 1))
            return image

        # Flux/Qwen UNETs cannot load via AutoPipeline/SDXL — route natively.
        # (Silent RealVis fallback was producing elongated "Flux"/"Qwen" outputs.)
        native = infer_native_family(model_id)
        if native in ("flux", "qwen"):
            resolved = resolve_model(model_id, default_hub=DEFAULT_MODEL)
            if resolved.kind == "hub":
                raise RuntimeError(
                    f"Native {native} weights not found for {model_id!r}. "
                    f"Searched: {', '.join(describe_search_paths()) or '(none)'}."
                )
            gen_w, gen_h = _person_portrait_canvas(prompt, int(width), int(height))
            if native == "flux":
                return self._generate_txt2img_flux(
                    unet_path=resolved.source,
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    width=gen_w,
                    height=gen_h,
                    steps=steps,
                    guidance_scale=guidance_scale,
                    seed=seed,
                    on_step=on_step,
                )
            return self._generate_txt2img_qwen(
                model_path=resolved.source,
                prompt=prompt,
                negative_prompt=negative_prompt,
                width=gen_w,
                height=gen_h,
                steps=steps,
                guidance_scale=guidance_scale,
                seed=seed,
                on_step=on_step,
                on_status=on_status,
            )

        import torch

        self._empty_cuda()
        pipe = self._ensure_loaded(model_id)
        wants_person = prompt_wants_person(prompt)
        if workshop_crop is True:
            workshop_role = True
        elif workshop_crop is False:
            workshop_role = False
        else:
            workshop_role = prompt_is_workshop_role(prompt)
        pipe = self._apply_loras(
            pipe,
            wants_person=wants_person,
            workshop_role=workshop_role,
        )
        self._pipe = pipe
        plan = plan_sampling(
            pipe=pipe,
            width=width,
            height=height,
            steps=steps,
            guidance_scale=guidance_scale,
            negative_prompt=negative_prompt,
            resolved_label=self._resolved.label if self._resolved else None,
        )

        gen_width, gen_height = plan.width, plan.height
        if self._offloaded and max(gen_width, gen_height) > 896:
            scale = 896 / max(gen_width, gen_height)
            gen_width = max(768, int(gen_width * scale) // 8 * 8)
            gen_height = max(768, int(gen_height * scale) // 8 * 8)

        device_for_gen = "cuda" if torch.cuda.is_available() else "cpu"
        generator = torch.Generator(device=device_for_gen).manual_seed(seed)

        if on_step:
            on_step(1, plan.steps)

        run_kwargs: dict[str, Any] = {
            "width": gen_width,
            "height": gen_height,
            "num_inference_steps": plan.steps,
            "guidance_scale": plan.guidance_scale,
            "generator": generator,
            "output_type": "latent",
        }

        is_xl = "xl" in type(pipe).__name__.lower()
        if is_xl:
            run_kwargs.update(
                encode_sdxl_prompts(
                    pipe,
                    prompt=prompt,
                    negative_prompt=plan.negative_prompt,
                    device=device_for_gen,
                    workshop_crop=workshop_crop,
                )
            )
            # SDXL clarity helper — reduces washed midtones / overcooked CFG look.
            run_kwargs["guidance_rescale"] = 0.7
        else:
            run_kwargs["prompt"] = prompt
            run_kwargs["negative_prompt"] = plan.negative_prompt or None

        model_label = self._resolved.label if self._resolved else model_id
        print(
            f"[diffusers] sample model={model_label} "
            f"{gen_width}x{gen_height} steps={plan.steps} "
            f"cfg={plan.guidance_scale}",
            flush=True,
        )

        try:
            with _silence_model_warnings():
                result = pipe(**run_kwargs)
            latents = result.images
            image = self._decode_latents_fp32(pipe, latents)
        except torch.cuda.OutOfMemoryError:
            self._empty_cuda()
            run_kwargs["width"] = 768
            run_kwargs["height"] = 768
            run_kwargs["generator"] = torch.Generator(device=device_for_gen).manual_seed(
                seed
            )
            with _silence_model_warnings():
                result = pipe(**run_kwargs)
            image = self._decode_latents_fp32(pipe, result.images)
        finally:
            self._empty_cuda()

        # Refiner needs a full-GPU base swap; skip under CPU offload.
        if is_xl and REFINER_ENABLED and not self._offloaded:
            dtype = self._dtype_for_resolved(
                self._resolved
                or ResolvedModel("hub", model_id, model_id),
                device_for_gen,
            )
            # Use the CLIP-fitted prompt text when available.
            refine_prompt = run_kwargs.get("prompt") or prompt
            refine_negative = (
                run_kwargs.get("negative_prompt") or plan.negative_prompt or ""
            )
            if on_step:
                on_step(max(plan.steps - 1, 1), plan.steps)
            image = self._refine_image(
                image=image,
                prompt=str(refine_prompt),
                negative_prompt=str(refine_negative or ""),
                steps=plan.steps,
                guidance_scale=plan.guidance_scale,
                seed=seed,
                device=device_for_gen,
                dtype=dtype,
            )

        if on_step:
            on_step(plan.steps, plan.steps)
        return image

    def generate_compiled_sdxl(
        self,
        *,
        checkpoint_path: str,
        vae_name: str | None,
        loras: list[tuple[str, float]],
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        steps: int,
        guidance_scale: float,
        seed: int,
        on_step: Callable[[int, int], None] | None = None,
        workshop_crop: bool | None = None,
        init_image_path: str | None = None,
        mask_image_path: str | None = None,
        img2img_mode: str = "txt2img",
        denoise: float = 1.0,
        controlnet_path: str | None = None,
        controlnet_image_path: str | None = None,
        controlnet_preprocessor: str = "none",
        controlnet_strength: float = 1.0,
        controlnet_stack: list[dict[str, Any]] | None = None,
        ip_adapter_path: str | None = None,
        ip_adapter_image_path: str | None = None,
        ip_adapter_strength: float = 0.5,
        instantid_path: str | None = None,
        instantid_image_path: str | None = None,
        instantid_strength: float = 0.8,
        instantid_controlnet_path: str | None = None,
    ) -> Image.Image:
        """
        Native SDXL from a Comfy graph — same quality stack as txt2img
        (CLIP fit, hand LoRA, RealVis CFG, fp32 VAE decode).

        Supported combinations (SDXL):
        - txt2img / img2img / inpaint ± ControlNet ± IP-Adapter
        - InstantID identity lock (txt2img; mutually exclusive with IP-Adapter /
          extra ControlNetApply stacks)
        """
        import torch
        from diffusers import (
            DPMSolverMultistepScheduler,
            StableDiffusionXLPipeline,
        )

        if MOCK_MODE:
            if on_step:
                on_step(1, max(steps, 1))
            image = Image.new("RGB", (width, height), (28, 32, 48))
            if on_step:
                on_step(max(steps, 1), max(steps, 1))
            return image

        path = Path(checkpoint_path)
        # Ignore graph LoRA list in the cache key's fuse set; quality LoRAs applied below.
        key = f"compiled-sdxl:{path}:{vae_name or 'auto'}"
        with self._lock:
            if self._model_key != key or self._pipe is None:
                self._release_pipe()
                pipe = StableDiffusionXLPipeline.from_single_file(
                    str(path),
                    torch_dtype=torch.float16,
                    use_safetensors=True,
                )
                if vae_name and not vae_name.startswith("{{"):
                    from app.asset_inventory import resolve_asset_file
                    from diffusers import AutoencoderKL

                    vae_path = resolve_asset_file(vae_name, "vaes", "checkpoints")
                    if vae_path is not None:
                        try:
                            pipe.vae = AutoencoderKL.from_single_file(
                                str(vae_path),
                                torch_dtype=torch.float32,
                            )
                        except Exception as exc:
                            print(f"[diffusers] compiled VAE load failed: {exc}", flush=True)
                            self._attach_sdxl_vae(pipe, torch.float32)
                    else:
                        self._attach_sdxl_vae(pipe, torch.float32)
                else:
                    self._attach_sdxl_vae(pipe, torch.float32)
                pipe.scheduler = DPMSolverMultistepScheduler.from_config(
                    pipe.scheduler.config,
                    use_karras_sigmas=True,
                    algorithm_type="dpmsolver++",
                )
                pipe = self._place_compiled_pipe(pipe, torch.float16)
                self._pipe = pipe
                self._model_key = key
                self._lora_key = "none"
                self._resolved = ResolvedModel(
                    "single_file",
                    str(path),
                    path.name,
                )

            pipe = self._pipe

        wants_person = prompt_wants_person(prompt)
        if workshop_crop is True:
            workshop_role = True
        elif workshop_crop is False:
            workshop_role = False
        else:
            workshop_role = prompt_is_workshop_role(prompt)

        # Auto hand/detail LoRAs first (quality baseline), then graph LoRAs.
        pipe = self._apply_loras(
            pipe,
            wants_person=wants_person,
            workshop_role=workshop_role,
        )
        if loras:
            for lora_path, strength in loras:
                try:
                    self._fuse_kohya_lora(pipe, lora_path, strength)
                except Exception as exc:
                    print(f"[diffusers] compiled LoRA skip {lora_path}: {exc}", flush=True)
            self._lora_key = f"{self._lora_key}+graph:{sorted(loras)}"
        self._pipe = pipe

        plan = plan_sampling(
            pipe=pipe,
            width=width,
            height=height,
            steps=steps,
            guidance_scale=guidance_scale,
            negative_prompt=negative_prompt,
            resolved_label=self._resolved.label if self._resolved else path.name,
        )
        gen_width, gen_height = plan.width, plan.height
        if self._offloaded and max(gen_width, gen_height) > 896:
            scale = 896 / max(gen_width, gen_height)
            gen_width = max(768, int(gen_width * scale) // 8 * 8)
            gen_height = max(768, int(gen_height * scale) // 8 * 8)

        device_for_gen = "cuda" if torch.cuda.is_available() else "cpu"
        generator = torch.Generator(device=device_for_gen).manual_seed(int(seed) & 0xFFFFFFFF)

        if on_step:
            on_step(1, plan.steps)

        encode_kwargs = encode_sdxl_prompts(
            pipe,
            prompt=prompt,
            negative_prompt=plan.negative_prompt,
            device=device_for_gen,
            workshop_crop=workshop_crop,
        )

        strength = max(0.01, min(1.0, float(denoise)))
        use_img2img = init_image_path is not None and strength < 0.999
        cn_stack: list[dict[str, Any]] = list(controlnet_stack or [])
        if not cn_stack and controlnet_path and controlnet_image_path:
            cn_stack = [
                {
                    "path": controlnet_path,
                    "image_path": controlnet_image_path,
                    "preprocessor": controlnet_preprocessor,
                    "strength": controlnet_strength,
                }
            ]
        use_controlnet = bool(cn_stack)
        use_ip_adapter = ip_adapter_image_path is not None
        use_instantid = (
            instantid_path is not None
            and instantid_image_path is not None
            and instantid_controlnet_path is not None
        )
        use_inpaint = (
            use_img2img and img2img_mode == "inpaint" and mask_image_path is not None
        )

        if use_instantid:
            if use_img2img:
                raise RuntimeError(
                    "InstantID + img2img/inpaint is not supported yet — use "
                    "txt2img InstantID or ComfyUI."
                )
            if use_controlnet or use_ip_adapter:
                raise RuntimeError(
                    "InstantID cannot combine with ControlNetApply / IP-Adapter "
                    "in the Diffusers engine — use one identity path."
                )
            from diffusers import ControlNetModel
            from app.pipeline_stable_diffusion_xl_instantid import (
                StableDiffusionXLInstantIDPipeline,
            )
            from app.instantid_face import extract_face_embedding_and_kps

            face_image = Image.open(instantid_image_path).convert("RGB")
            face_emb, face_kps = extract_face_embedding_and_kps(face_image)
            face_kps = face_kps.resize(
                (gen_width, gen_height), Image.Resampling.LANCZOS
            )

            cn_key = f"instantid-cn:{instantid_controlnet_path}"
            if self._controlnet_key != cn_key or self._controlnet_model is None:
                print(
                    f"[diffusers] loading InstantID IdentityNet "
                    f"{Path(instantid_controlnet_path).name}",
                    flush=True,
                )
                cn_source = Path(instantid_controlnet_path)
                if cn_source.is_dir():
                    self._controlnet_model = ControlNetModel.from_pretrained(
                        str(cn_source), torch_dtype=torch.float16
                    )
                else:
                    self._controlnet_model = ControlNetModel.from_single_file(
                        str(cn_source), torch_dtype=torch.float16
                    )
                self._controlnet_key = cn_key

            self._clear_sdxl_ip_adapter(pipe)
            iid_pipe = StableDiffusionXLInstantIDPipeline.from_pipe(
                pipe, controlnet=self._controlnet_model
            )
            iid_key = f"instantid-adapter:{instantid_path}"
            if getattr(self, "_instantid_adapter_key", None) != iid_key:
                print(
                    f"[diffusers] loading InstantID adapter "
                    f"{Path(instantid_path).name}",
                    flush=True,
                )
                iid_pipe.load_ip_adapter_instantid(instantid_path)
                self._instantid_adapter_key = iid_key
            else:
                # from_pipe may not keep proj weights — reload when key matches
                # but pipeline is fresh.
                if not hasattr(iid_pipe, "image_proj_model"):
                    iid_pipe.load_ip_adapter_instantid(instantid_path)

            strength = float(instantid_strength)
            iid_pipe.set_ip_adapter_scale(strength)
            iid_pipe = self._place_compiled_pipe(iid_pipe, torch.float16)

            import torch as _torch

            emb = _torch.from_numpy(face_emb).to(device=device_for_gen, dtype=_torch.float16)
            if emb.ndim == 1:
                emb = emb.unsqueeze(0)

            iid_kwargs: dict[str, Any] = {
                "image_embeds": emb,
                "image": face_kps,
                "controlnet_conditioning_scale": strength,
                "num_inference_steps": plan.steps,
                "guidance_scale": plan.guidance_scale,
                "generator": generator,
                "guidance_rescale": 0.7,
                "width": gen_width,
                "height": gen_height,
                "output_type": "latent",
            }
            iid_kwargs.update(encode_kwargs)
            print(
                f"[diffusers] compiled-sdxl instantid "
                f"model={path.name} adapter={Path(instantid_path).name} "
                f"{gen_width}x{gen_height} steps={plan.steps} "
                f"cfg={plan.guidance_scale} strength={strength:.2f}",
                flush=True,
            )
            try:
                with _silence_model_warnings():
                    result = iid_pipe(**iid_kwargs)
                image = self._decode_latents_fp32(iid_pipe, result.images)
            except torch.cuda.OutOfMemoryError:
                self._empty_cuda()
                iid_kwargs["width"] = 768
                iid_kwargs["height"] = 768
                iid_kwargs["image"] = face_kps.resize(
                    (768, 768), Image.Resampling.LANCZOS
                )
                iid_kwargs["generator"] = torch.Generator(
                    device=device_for_gen
                ).manual_seed(int(seed) & 0xFFFFFFFF)
                with _silence_model_warnings():
                    result = iid_pipe(**iid_kwargs)
                image = self._decode_latents_fp32(iid_pipe, result.images)
            finally:
                self._empty_cuda()
            if on_step:
                on_step(plan.steps, plan.steps)
            return image

        if use_img2img and not use_controlnet:
            from diffusers import (
                StableDiffusionXLImg2ImgPipeline,
                StableDiffusionXLInpaintPipeline,
            )

            if not use_ip_adapter:
                self._clear_sdxl_ip_adapter(pipe)
            init = Image.open(init_image_path).convert("RGB")
            init = init.resize((gen_width, gen_height), Image.Resampling.LANCZOS)
            i2i_kwargs: dict[str, Any] = {
                "image": init,
                "strength": strength,
                "num_inference_steps": plan.steps,
                "guidance_scale": plan.guidance_scale,
                "generator": generator,
                "guidance_rescale": 0.7,
            }
            i2i_kwargs.update(encode_kwargs)
            if use_inpaint:
                mask = Image.open(mask_image_path).convert("L")
                mask = mask.resize((gen_width, gen_height), Image.Resampling.LANCZOS)
                i2i_pipe = StableDiffusionXLInpaintPipeline.from_pipe(pipe)
                i2i_kwargs["mask_image"] = mask
                mode_label = "inpaint"
            else:
                i2i_pipe = StableDiffusionXLImg2ImgPipeline.from_pipe(pipe)
                mode_label = "img2img"
            i2i_pipe = self._place_compiled_pipe(i2i_pipe, torch.float16)
            if use_ip_adapter:
                self._ensure_sdxl_ip_adapter(
                    i2i_pipe,
                    model_path=ip_adapter_path,
                    strength=ip_adapter_strength,
                )
                ip_image = Image.open(ip_adapter_image_path).convert("RGB")
                ip_image = ip_image.resize(
                    (gen_width, gen_height), Image.Resampling.LANCZOS
                )
                i2i_kwargs["ip_adapter_image_embeds"] = (
                    self._sdxl_ip_adapter_image_embeds(
                        i2i_pipe, ip_image, device=device_for_gen
                    )
                )
                mode_label = f"{mode_label}+ip-adapter"
            print(
                f"[diffusers] compiled-sdxl {mode_label} model={path.name} "
                f"{gen_width}x{gen_height} steps={plan.steps} "
                f"cfg={plan.guidance_scale} strength={strength:.2f}"
                + (
                    f" ip={float(ip_adapter_strength):.2f}"
                    if use_ip_adapter
                    else ""
                ),
                flush=True,
            )
            try:
                with _silence_model_warnings():
                    result = i2i_pipe(**i2i_kwargs)
                image = result.images[0]
            except torch.cuda.OutOfMemoryError:
                self._empty_cuda()
                i2i_kwargs["generator"] = torch.Generator(device=device_for_gen).manual_seed(
                    int(seed) & 0xFFFFFFFF
                )
                init_small = init.resize((768, 768), Image.Resampling.LANCZOS)
                i2i_kwargs["image"] = init_small
                if "mask_image" in i2i_kwargs:
                    i2i_kwargs["mask_image"] = i2i_kwargs["mask_image"].resize(
                        (768, 768), Image.Resampling.LANCZOS
                    )
                if use_ip_adapter:
                    ip_small = ip_image.resize((768, 768), Image.Resampling.LANCZOS)
                    i2i_kwargs["ip_adapter_image_embeds"] = (
                        self._sdxl_ip_adapter_image_embeds(
                            i2i_pipe, ip_small, device=device_for_gen
                        )
                    )
                with _silence_model_warnings():
                    result = i2i_pipe(**i2i_kwargs)
                image = result.images[0]
            finally:
                self._empty_cuda()
            if on_step:
                on_step(plan.steps, plan.steps)
            return image

        if use_controlnet:
            from app.safetensors_peek import sdxl_controlnet_is_union
            from app.controlnet_preprocess import (
                apply_controlnet_preprocess,
                union_control_mode,
            )
            from diffusers import ControlNetModel, MultiControlNetModel

            control_images: list[Image.Image] = []
            strengths: list[float] = []
            preprocessors: list[str] = []
            for entry in cn_stack:
                img = Image.open(entry["image_path"]).convert("RGB")
                img = apply_controlnet_preprocess(
                    img, str(entry.get("preprocessor") or "none")
                )
                img = img.resize((gen_width, gen_height), Image.Resampling.LANCZOS)
                control_images.append(img)
                strengths.append(float(entry.get("strength", 1.0)))
                preprocessors.append(str(entry.get("preprocessor") or "none"))

            union_flags = [
                sdxl_controlnet_is_union(str(entry["path"])) for entry in cn_stack
            ]
            if any(union_flags) and not all(union_flags):
                raise RuntimeError(
                    "Mixed Union and plain ControlNet stack is not supported — use ComfyUI."
                )
            is_union = bool(union_flags) and all(union_flags)
            if is_union:
                resolved = {str(Path(e["path"]).resolve()) for e in cn_stack}
                if len(resolved) > 1:
                    raise RuntimeError(
                        "Stacked Union ControlNets must share one checkpoint file — "
                        "use ComfyUI for different Union weights."
                    )

            is_multi = len(cn_stack) > 1
            paths_key = "|".join(str(Path(e["path"]).resolve()) for e in cn_stack)
            cn_key = (
                f"sdxl-{'union' if is_union else 'plain'}:n{len(cn_stack)}:{paths_key}"
            )
            if self._controlnet_key != cn_key or self._controlnet_model is None:
                label = "Union " if is_union else ""
                names = "+".join(Path(e["path"]).name for e in cn_stack)
                print(
                    f"[diffusers] loading {label}ControlNet stack ({len(cn_stack)}): {names}",
                    flush=True,
                )
                if is_union:
                    from diffusers import ControlNetUnionModel

                    union_path = str(cn_stack[0]["path"])
                    try:
                        self._controlnet_model = ControlNetUnionModel.from_single_file(
                            union_path, torch_dtype=torch.float16,
                        )
                    except Exception as exc:
                        print(
                            f"[diffusers] ControlNetUnionModel.from_single_file "
                            f"failed ({exc}); trying hub config + local weights",
                            flush=True,
                        )
                        self._controlnet_model = _load_via_hub_config_local_weights(
                            ControlNetUnionModel,
                            "xinsir/controlnet-union-sdxl-1.0",
                            union_path,
                            torch.float16,
                        )
                else:
                    models = [
                        ControlNetModel.from_single_file(
                            str(entry["path"]), torch_dtype=torch.float16
                        )
                        for entry in cn_stack
                    ]
                    self._controlnet_model = (
                        models[0] if len(models) == 1 else MultiControlNetModel(models)
                    )
                self._controlnet_key = cn_key

            if not use_ip_adapter:
                self._clear_sdxl_ip_adapter(pipe)

            init = None
            mask = None
            if use_img2img:
                init = Image.open(init_image_path).convert("RGB")
                init = init.resize((gen_width, gen_height), Image.Resampling.LANCZOS)
            if use_inpaint:
                mask = Image.open(mask_image_path).convert("L")
                mask = mask.resize((gen_width, gen_height), Image.Resampling.LANCZOS)

            if use_inpaint:
                if is_union:
                    from diffusers import (
                        StableDiffusionXLControlNetUnionInpaintPipeline,
                    )

                    cn_pipe = StableDiffusionXLControlNetUnionInpaintPipeline.from_pipe(
                        pipe, controlnet=self._controlnet_model
                    )
                else:
                    from diffusers import StableDiffusionXLControlNetInpaintPipeline

                    cn_pipe = StableDiffusionXLControlNetInpaintPipeline.from_pipe(
                        pipe, controlnet=self._controlnet_model
                    )
            elif use_img2img:
                if is_union:
                    from diffusers import StableDiffusionXLControlNetUnionImg2ImgPipeline

                    cn_pipe = StableDiffusionXLControlNetUnionImg2ImgPipeline.from_pipe(
                        pipe, controlnet=self._controlnet_model
                    )
                else:
                    from diffusers import StableDiffusionXLControlNetImg2ImgPipeline

                    cn_pipe = StableDiffusionXLControlNetImg2ImgPipeline.from_pipe(
                        pipe, controlnet=self._controlnet_model
                    )
            elif is_union:
                from diffusers import StableDiffusionXLControlNetUnionPipeline

                cn_pipe = StableDiffusionXLControlNetUnionPipeline.from_pipe(
                    pipe, controlnet=self._controlnet_model
                )
            else:
                from diffusers import StableDiffusionXLControlNetPipeline

                cn_pipe = StableDiffusionXLControlNetPipeline.from_pipe(
                    pipe, controlnet=self._controlnet_model
                )
            cn_pipe = self._place_compiled_pipe(cn_pipe, torch.float16)

            scale_arg: float | list[float]
            if is_union or is_multi:
                scale_arg = strengths
            else:
                scale_arg = strengths[0]

            def _control_maps(images: list[Image.Image]) -> Any:
                if is_union or is_multi:
                    return images
                return images[0]

            cn_kwargs: dict[str, Any] = {
                "controlnet_conditioning_scale": scale_arg,
                "num_inference_steps": plan.steps,
                "guidance_scale": plan.guidance_scale,
                "generator": generator,
                "guidance_rescale": 0.7,
            }
            if use_img2img:
                cn_kwargs["image"] = init
                cn_kwargs["strength"] = strength
                cn_kwargs["control_image"] = _control_maps(control_images)
                if use_inpaint:
                    cn_kwargs["mask_image"] = mask
            else:
                cn_kwargs["width"] = gen_width
                cn_kwargs["height"] = gen_height
                cn_kwargs["output_type"] = "latent"
                if is_union:
                    cn_kwargs["control_image"] = control_images
                else:
                    # Plain ControlNet txt2img uses ``image`` for the control map(s).
                    cn_kwargs["image"] = _control_maps(control_images)
            if is_union:
                cn_kwargs["control_mode"] = [
                    union_control_mode(p) for p in preprocessors
                ]
            cn_kwargs.update(encode_kwargs)

            if use_ip_adapter:
                self._ensure_sdxl_ip_adapter(
                    cn_pipe,
                    model_path=ip_adapter_path,
                    strength=ip_adapter_strength,
                )
                ip_image = Image.open(ip_adapter_image_path).convert("RGB")
                ip_image = ip_image.resize(
                    (gen_width, gen_height), Image.Resampling.LANCZOS
                )
                cn_kwargs["ip_adapter_image_embeds"] = self._sdxl_ip_adapter_image_embeds(
                    cn_pipe, ip_image, device=device_for_gen
                )

            mode_bits = [
                "controlnet",
                "+".join(preprocessors),
                "union" if is_union else ("multi" if is_multi else "plain"),
            ]
            if use_inpaint:
                mode_bits.append("inpaint")
            elif use_img2img:
                mode_bits.append("img2img")
            if use_ip_adapter:
                mode_bits.append("ip-adapter")
            cn_names = "+".join(Path(e["path"]).name for e in cn_stack)
            print(
                f"[diffusers] compiled-sdxl {'+'.join(mode_bits)} "
                f"model={path.name} cn={cn_names} "
                f"{gen_width}x{gen_height} steps={plan.steps} "
                f"cfg={plan.guidance_scale} cn_strength={strengths}"
                + (f" denoise={strength:.2f}" if use_img2img else "")
                + (
                    f" ip={float(ip_adapter_strength):.2f}"
                    if use_ip_adapter
                    else ""
                ),
                flush=True,
            )
            try:
                with _silence_model_warnings():
                    result = cn_pipe(**cn_kwargs)
                image = (
                    result.images[0]
                    if use_img2img
                    else self._decode_latents_fp32(cn_pipe, result.images)
                )
            except torch.cuda.OutOfMemoryError:
                self._empty_cuda()
                small_maps = [
                    img.resize((768, 768), Image.Resampling.LANCZOS)
                    for img in control_images
                ]
                if use_img2img:
                    cn_kwargs["image"] = init.resize(
                        (768, 768), Image.Resampling.LANCZOS
                    )
                    cn_kwargs["control_image"] = _control_maps(small_maps)
                    if use_inpaint and mask is not None:
                        cn_kwargs["mask_image"] = mask.resize(
                            (768, 768), Image.Resampling.LANCZOS
                        )
                else:
                    cn_kwargs["width"] = 768
                    cn_kwargs["height"] = 768
                    if is_union:
                        cn_kwargs["control_image"] = small_maps
                    else:
                        cn_kwargs["image"] = _control_maps(small_maps)
                if use_ip_adapter:
                    ip_small = ip_image.resize((768, 768), Image.Resampling.LANCZOS)
                    cn_kwargs["ip_adapter_image_embeds"] = (
                        self._sdxl_ip_adapter_image_embeds(
                            cn_pipe, ip_small, device=device_for_gen
                        )
                    )
                cn_kwargs["generator"] = torch.Generator(device=device_for_gen).manual_seed(
                    int(seed) & 0xFFFFFFFF
                )
                with _silence_model_warnings():
                    result = cn_pipe(**cn_kwargs)
                image = (
                    result.images[0]
                    if use_img2img
                    else self._decode_latents_fp32(cn_pipe, result.images)
                )
            finally:
                self._empty_cuda()
            if on_step:
                on_step(plan.steps, plan.steps)
            return image

        if use_ip_adapter:
            self._ensure_sdxl_ip_adapter(
                pipe,
                model_path=ip_adapter_path,
                strength=ip_adapter_strength,
            )
            ip_image = Image.open(ip_adapter_image_path).convert("RGB")
            ip_image = ip_image.resize(
                (gen_width, gen_height), Image.Resampling.LANCZOS
            )
            ip_adapter_image_embeds = self._sdxl_ip_adapter_image_embeds(
                pipe, ip_image, device=device_for_gen
            )
        else:
            self._clear_sdxl_ip_adapter(pipe)
            ip_adapter_image_embeds = None

        run_kwargs: dict[str, Any] = {
            "width": gen_width,
            "height": gen_height,
            "num_inference_steps": plan.steps,
            "guidance_scale": plan.guidance_scale,
            "generator": generator,
            "output_type": "latent",
            "guidance_rescale": 0.7,
        }
        run_kwargs.update(encode_kwargs)
        if use_ip_adapter:
            run_kwargs["ip_adapter_image_embeds"] = ip_adapter_image_embeds
            print(
                f"[diffusers] compiled-sdxl ip-adapter model={path.name} "
                f"strength={float(ip_adapter_strength):.2f} "
                f"{gen_width}x{gen_height} steps={plan.steps} "
                f"cfg={plan.guidance_scale}",
                flush=True,
            )
        else:
            print(
                f"[diffusers] compiled-sdxl model={path.name} "
                f"{gen_width}x{gen_height} steps={plan.steps} "
                f"cfg={plan.guidance_scale}",
                flush=True,
            )

        try:
            with _silence_model_warnings():
                result = pipe(**run_kwargs)
            image = self._decode_latents_fp32(pipe, result.images)
        except torch.cuda.OutOfMemoryError:
            self._empty_cuda()
            run_kwargs["width"] = 768
            run_kwargs["height"] = 768
            if use_ip_adapter and ip_adapter_image_embeds is not None:
                # Re-encode at the fallback size so spatial tokens stay aligned.
                ip_small = ip_image.resize((768, 768), Image.Resampling.LANCZOS)
                run_kwargs["ip_adapter_image_embeds"] = self._sdxl_ip_adapter_image_embeds(
                    pipe, ip_small, device=device_for_gen
                )
            run_kwargs["generator"] = torch.Generator(device=device_for_gen).manual_seed(
                int(seed) & 0xFFFFFFFF
            )
            with _silence_model_warnings():
                result = pipe(**run_kwargs)
            image = self._decode_latents_fp32(pipe, result.images)
        finally:
            self._empty_cuda()

        if REFINER_ENABLED and not self._offloaded:
            refine_prompt = run_kwargs.get("prompt") or prompt
            refine_negative = (
                run_kwargs.get("negative_prompt") or plan.negative_prompt or ""
            )
            if on_step:
                on_step(max(plan.steps - 1, 1), plan.steps)
            image = self._refine_image(
                image=image,
                prompt=str(refine_prompt),
                negative_prompt=str(refine_negative or ""),
                steps=plan.steps,
                guidance_scale=plan.guidance_scale,
                seed=seed,
                device=device_for_gen,
                dtype=self._dtype_for_resolved(
                    self._resolved
                    or ResolvedModel("single_file", str(path), path.name),
                    device_for_gen,
                ),
            )

        if on_step:
            on_step(plan.steps, plan.steps)
        return image

    def _ensure_sdxl_ip_adapter(
        self,
        pipe: Any,
        *,
        model_path: str | None,
        strength: float,
    ) -> None:
        """Attach Diffusers IP-Adapter Plus weights for SDXL identity lock.

        CLIP ViT-H is large — load it on CPU (by parking the SDXL modules first
        so ``load_ip_adapter`` targets ``self.device == cpu``), then restore the
        UNet/TEs/VAE to CUDA. Callers should pass precomputed
        ``ip_adapter_image_embeds`` (see ``_sdxl_ip_adapter_image_embeds``).
        """
        from app.ip_adapter_resolve import resolve_sdxl_ip_adapter_load

        load = resolve_sdxl_ip_adapter_load(model_path)
        key = str(load["source"])
        if self._ip_adapter_key != key:
            self._clear_sdxl_ip_adapter(pipe)
            print(f"[diffusers] loading IP-Adapter ({load['source']})…", flush=True)
            parked: list[tuple[str, Any]] = []
            for attr in ("unet", "text_encoder", "text_encoder_2", "vae"):
                mod = getattr(pipe, attr, None)
                if mod is None:
                    continue
                try:
                    device = next(mod.parameters()).device
                except StopIteration:
                    continue
                try:
                    mod.to("cpu")
                    parked.append((attr, device))
                except Exception:
                    pass
            self._empty_cuda()
            try:
                if load.get("preload_hub_image_encoder"):
                    from transformers import CLIPVisionModelWithProjection

                    from app.ip_adapter_resolve import (
                        HUB_IP_ADAPTER_IMAGE_ENCODER,
                        HUB_IP_ADAPTER_REPO,
                    )

                    if getattr(pipe, "image_encoder", None) is None:
                        print(
                            "[diffusers] loading IP-Adapter image encoder "
                            f"({HUB_IP_ADAPTER_REPO}/{HUB_IP_ADAPTER_IMAGE_ENCODER})…",
                            flush=True,
                        )
                        enc = CLIPVisionModelWithProjection.from_pretrained(
                            HUB_IP_ADAPTER_REPO,
                            subfolder=HUB_IP_ADAPTER_IMAGE_ENCODER,
                            torch_dtype=getattr(pipe, "dtype", None),
                        ).to("cpu")
                        pipe.register_modules(image_encoder=enc)
                pipe.load_ip_adapter(
                    load["pretrained_model_name_or_path_or_dict"],
                    subfolder=load["subfolder"] or "",
                    weight_name=load["weight_name"],
                    image_encoder_folder=load.get("image_encoder_folder"),
                )
            finally:
                for attr, device in parked:
                    try:
                        getattr(pipe, attr).to(device)
                    except Exception:
                        pass
            # Keep ViT-H on CPU; denoise uses precomputed image embeds.
            try:
                if getattr(pipe, "image_encoder", None) is not None:
                    pipe.image_encoder.to("cpu")
            except Exception:
                pass
            self._empty_cuda()
            self._ip_adapter_key = key
        pipe.set_ip_adapter_scale(max(0.0, min(1.0, float(strength))))

    def _sdxl_ip_adapter_image_embeds(
        self,
        pipe: Any,
        ip_image: Any,
        *,
        device: str,
    ) -> list[Any]:
        """Run the IP-Adapter image encoder (CPU) and move embeds to ``device``."""
        import torch

        enc = getattr(pipe, "image_encoder", None)
        if enc is None:
            enc = getattr(pipe, "_studio_ip_image_encoder", None)
            if enc is not None:
                pipe.image_encoder = enc
        if getattr(pipe, "image_encoder", None) is None:
            raise RuntimeError("IP-Adapter image_encoder missing after load")
        enc_device = next(pipe.image_encoder.parameters()).device
        # CFG is always on for our SDXL path (guidance_scale > 1).
        embeds = pipe.prepare_ip_adapter_image_embeds(
            ip_image,
            None,
            enc_device,
            1,
            True,
        )
        # ``DiffusionPipeline.device`` returns the first *alphabetical*
        # component's device. ``image_encoder`` sorts before ``unet``/``vae``,
        # so a CPU-resident ViT-H makes encode_prompt send input_ids to CPU
        # while the restored TEs sit on CUDA. Stash it off the component graph.
        pipe._studio_ip_image_encoder = pipe.image_encoder
        pipe.image_encoder = None
        target = torch.device(device)
        return [e.to(device=target) for e in embeds]

    def _clear_sdxl_ip_adapter(self, pipe: Any) -> None:
        if self._ip_adapter_key is None:
            return
        # Restore stashed encoder so unload_ip_adapter can tear it down.
        if getattr(pipe, "image_encoder", None) is None and getattr(
            pipe, "_studio_ip_image_encoder", None
        ) is not None:
            pipe.image_encoder = pipe._studio_ip_image_encoder
            pipe._studio_ip_image_encoder = None
        try:
            pipe.unload_ip_adapter()
        except Exception:
            pass
        pipe._studio_ip_image_encoder = None
        self._ip_adapter_key = None

    def _load_flux_pipeline(
        self,
        *,
        unet_path: str,
        clip_name: str | None,
        clip2_name: str | None,
        clip_type: str | None,
        vae_name: str | None,
        dtype: Any,
    ) -> Any:
        """Load Flux / Flux2-Klein from drop-in UNET + TE + VAE files."""
        from app.asset_inventory import resolve_asset_file
        from app.dropin_loaders import (
            is_flux_klein_unet,
            is_fp8_scaled_name,
            load_clip_l_text_encoder,
            load_qwen3_causal_from_single_file,
            load_t5_encoder_from_single_file,
        )
        from diffusers import (
            AutoencoderKL,
            Flux2KleinPipeline,
            Flux2Transformer2DModel,
            FluxPipeline,
            FluxTransformer2DModel,
        )
        from transformers import CLIPTokenizer, Qwen2Tokenizer, T5EncoderModel, T5TokenizerFast

        unet_label = Path(unet_path).name
        clip_type_l = (clip_type or "").lower()
        klein = clip_type_l == "flux2" or is_flux_klein_unet(unet_label)

        if klein:
            print(f"[diffusers] Flux2-Klein load {unet_label}", flush=True)
            # Diffusers maps all Flux2 single-files to gated FLUX.2-dev for config.
            # Point at vendored Klein configs so drop-in UNETs load offline.
            klein_config = _flux2_klein_config_dir(unet_label)
            # from_single_file only auto-sets subfolder=transformer when config is
            # inferred from the checkpoint — not when config= is passed explicitly.
            klein_transformer_config = klein_config / "transformer"
            print(
                f"[diffusers] Flux2-Klein config={klein_config.name}/transformer (local)",
                flush=True,
            )
            transformer = Flux2Transformer2DModel.from_single_file(
                unet_path,
                config=str(klein_transformer_config),
                torch_dtype=dtype,
                local_files_only=True,
            )
            if not clip_name or str(clip_name).startswith("{{"):
                raise FileNotFoundError(
                    "Flux2-Klein workflow missing CLIPLoader drop-in (qwen_3_*)."
                )
            clip_path = resolve_asset_file(clip_name, "text_encoders", "clip")
            if clip_path is None:
                raise FileNotFoundError(
                    f"Flux2 text encoder not found in drop-in folders: {clip_name}"
                )
            text_encoder = load_qwen3_causal_from_single_file(clip_path, dtype=dtype)
            tokenizer = _load_qwen3_tokenizer_for_flux(clip_path.name)

            if vae_name and not str(vae_name).startswith("{{"):
                vae_path = resolve_asset_file(vae_name, "vaes")
            else:
                vae_path = resolve_asset_file("flux2-vae.safetensors", "vaes")
            if vae_path is None:
                raise FileNotFoundError(
                    "Flux2-Klein requires flux2-vae.safetensors in models/vae."
                )
            vae = _load_flux2_vae_local(vae_path, dtype=dtype)
            # Empirical-mu schedule (BFL/Diffusers). Empty default scheduler ignores mu
            # and yields near-static noise on distilled 4-step Klein.
            scheduler = _load_flux2_klein_scheduler()
            distilled = _is_flux2_klein_distilled(unet_label)
            pipe = Flux2KleinPipeline(
                scheduler=scheduler,
                vae=vae,
                text_encoder=text_encoder,
                tokenizer=tokenizer,
                transformer=transformer,
                is_distilled=distilled,
            )
            try:
                pipe.set_progress_bar_config(disable=True)
            except Exception:
                pass
            print(
                f"[diffusers] Flux2-Klein assembled TE={clip_path.name} "
                f"VAE={vae_path.name} distilled={distilled}",
                flush=True,
            )
            return pipe

        # Classic FLUX.1
        print(f"[diffusers] Flux.1 load {unet_label}", flush=True)
        transformer = FluxTransformer2DModel.from_single_file(
            unet_path,
            torch_dtype=dtype,
        )

        text_encoder = None
        if clip_name and not str(clip_name).startswith("{{"):
            clip_path = resolve_asset_file(clip_name, "text_encoders", "clip")
            if clip_path is None:
                raise FileNotFoundError(
                    f"Flux CLIP (clip_l) not found in drop-in folders: {clip_name}"
                )
            text_encoder = load_clip_l_text_encoder(clip_path, dtype=dtype)
            print(f"[diffusers] Flux CLIP-L {clip_path.name}", flush=True)

        text_encoder_2 = None
        if clip2_name and not str(clip2_name).startswith("{{"):
            clip2_path = resolve_asset_file(clip2_name, "text_encoders", "clip")
            if clip2_path is None:
                raise FileNotFoundError(
                    f"Flux T5 encoder not found in drop-in folders: {clip2_name}"
                )
            if is_fp8_scaled_name(clip2_path.name):
                try:
                    text_encoder_2 = load_t5_encoder_from_single_file(
                        clip2_path, dtype=dtype
                    )
                except Exception as exc:
                    print(
                        f"[diffusers] Flux T5 fp8-scaled load failed ({exc}); "
                        "falling back to hub TE2",
                        flush=True,
                    )
            else:
                try:
                    text_encoder_2 = load_t5_encoder_from_single_file(
                        clip2_path, dtype=dtype
                    )
                except Exception as exc:
                    print(
                        f"[diffusers] local T5 load failed ({exc}); trying folder/hub",
                        flush=True,
                    )
                    try:
                        text_encoder_2 = T5EncoderModel.from_pretrained(
                            str(clip2_path.parent),
                            torch_dtype=dtype,
                        )
                    except Exception as hub_exc:
                        print(
                            f"[diffusers] local T5 folder load failed ({hub_exc}); hub TE2",
                            flush=True,
                        )

        vae = None
        if vae_name and not str(vae_name).startswith("{{"):
            vae_path = resolve_asset_file(vae_name, "vaes")
            if vae_path is None:
                raise FileNotFoundError(
                    f"Flux VAE not found in drop-in folders: {vae_name}"
                )
            vae = AutoencoderKL.from_single_file(str(vae_path), torch_dtype=dtype)
            print(f"[diffusers] Flux VAE {vae_path.name}", flush=True)

        # Shell from hub for tokenizers / missing TE2; never replace local transformer.
        hub_kwargs: dict[str, Any] = {
            "transformer": transformer,
            "torch_dtype": dtype,
        }
        if text_encoder is not None:
            hub_kwargs["text_encoder"] = text_encoder
        if text_encoder_2 is not None:
            hub_kwargs["text_encoder_2"] = text_encoder_2
        if vae is not None:
            hub_kwargs["vae"] = vae
        try:
            pipe = FluxPipeline.from_pretrained(
                "black-forest-labs/FLUX.1-dev",
                local_files_only=True,
                **hub_kwargs,
            )
        except Exception:
            pipe = FluxPipeline.from_pretrained(
                "black-forest-labs/FLUX.1-dev",
                **hub_kwargs,
            )
        # Ensure tokenizers exist even when TE came from drop-ins.
        if getattr(pipe, "tokenizer", None) is None:
            pipe.tokenizer = CLIPTokenizer.from_pretrained(
                "openai/clip-vit-large-patch14"
            )
        if getattr(pipe, "tokenizer_2", None) is None:
            pipe.tokenizer_2 = T5TokenizerFast.from_pretrained("google/t5-v1_1-xxl")
        print(
            f"[diffusers] Flux.1 assembled transformer={unet_label} "
            f"clip_l={'drop-in' if text_encoder is not None else 'hub'} "
            f"t5={'drop-in' if text_encoder_2 is not None else 'hub'} "
            f"vae={'drop-in' if vae is not None else 'hub'}",
            flush=True,
        )
        return pipe

    def _qwen_hub_snapshot(self) -> Path | None:
        """Locate a usable cached Qwen/Qwen-Image snapshot (TE/tokenizer/scheduler/vae)."""
        hub = Path.home() / ".cache/huggingface/hub/models--Qwen--Qwen-Image/snapshots"
        if not hub.is_dir():
            return None
        for snap in sorted(hub.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            required = [
                snap / "model_index.json",
                snap / "text_encoder" / "config.json",
                snap / "tokenizer" / "tokenizer_config.json",
                snap / "scheduler" / "scheduler_config.json",
                snap / "transformer" / "config.json",
            ]
            if all(path.is_file() for path in required):
                return snap
        return None

    def _ensure_qwen_hub_snap(self) -> Path:
        from huggingface_hub import snapshot_download

        snap = self._qwen_hub_snapshot()
        if snap is not None and (snap / "vae" / "config.json").is_file():
            return snap
        print("[diffusers] ensuring Qwen hub TE/VAE cache…", flush=True)
        snap_str = snapshot_download(
            "Qwen/Qwen-Image",
            allow_patterns=[
                "model_index.json",
                "scheduler/*",
                "text_encoder/*",
                "tokenizer/*",
                "transformer/config.json",
                "vae/*",
            ],
        )
        return Path(snap_str)

    def _enable_qwen_layerwise_casting(self, transformer: Any) -> bool:
        """Store DiT in fp8, compute in bf16 — resident on 24GB, Diffusers-safe."""
        import gc

        import torch

        if transformer is None or not hasattr(transformer, "enable_layerwise_casting"):
            return False
        if not hasattr(torch, "float8_e4m3fn"):
            return False
        try:
            sample = next(transformer.parameters())
        except StopIteration:
            return False
        try:
            # Bake / fuse leave bf16; fp8 loads can cast storage in-place.
            if sample.dtype not in (
                torch.float8_e4m3fn,
                getattr(torch, "float8_e5m2", type(None)),
                torch.bfloat16,
            ):
                transformer.to(dtype=torch.bfloat16)
            # enable_layerwise_casting() skips modules matching its default
            # pattern ("pos_embed", "patch_embed", "norm" substrings) — it
            # assumes those were already loaded in compute_dtype and leaves
            # them alone, never wrapping them with a cast hook. This specific
            # checkpoint (Comfy's qwen_image_fp8_e4m3fn export) quantizes
            # EVERY tensor to fp8, including norm layers/scales — confirmed
            # by inspecting the safetensors header directly (1933/1933
            # tensors are F8_E4M3, txt_norm.weight included). That breaks
            # diffusers' assumption: skip-pattern weights stay permanently
            # fp8 with no runtime upcast, so `hidden_states * self.weight`
            # crashes with "Promotion for Float8 Types is not supported"
            # the moment a skipped norm layer runs — confirmed via GPU
            # smoke test. Upcast exactly what the skip pattern will leave
            # untouched, before enabling the hook.
            _skip_patterns = ("pos_embed", "patch_embed", "norm")
            _upcast_count = 0
            for _name, _param in transformer.named_parameters():
                if _param.dtype not in (
                    torch.float8_e4m3fn,
                    getattr(torch, "float8_e5m2", type(None)),
                ):
                    continue
                if any(pat in _name for pat in _skip_patterns):
                    _param.data = _param.data.to(dtype=torch.bfloat16)
                    _upcast_count += 1
            if _upcast_count:
                print(
                    f"[diffusers] upcast {_upcast_count} layerwise-cast-skipped "
                    "DiT params (pos_embed/patch_embed/norm) fp8→bf16",
                    flush=True,
                )
            transformer.enable_layerwise_casting(
                storage_dtype=torch.float8_e4m3fn,
                compute_dtype=torch.bfloat16,
            )
            gc.collect()
            print(
                f"[diffusers] layerwise_casting storage=fp8 compute=bf16 "
                f"rss≈{_host_rss_gb():.1f}GiB "
                f"footprint≈{self._module_footprint_mb(transformer):.0f}MiB",
                flush=True,
            )
            return True
        except Exception as exc:
            print(f"[diffusers] layerwise_casting failed: {exc}", flush=True)
            return False

    def _prepare_qwen_transformer_compute(
        self,
        transformer: Any,
        *,
        lightning: bool = False,
    ) -> None:
        """Diffusers-safe DiT compute dtype.

        Default: fp8 storage + bf16 compute (layerwise) so Lightning fits resident.
        Opt-in DIFFUSERS_QWEN_LIGHTNING_BF16=1 keeps full bf16 (Comfy weights;
        group-offload on 24GB — slow).
        """
        import gc

        import torch

        if transformer is None:
            return

        if lightning and LIGHTNING_BF16:
            try:
                sample = next(transformer.parameters())
            except StopIteration:
                return
            if sample.dtype != torch.bfloat16:
                print(
                    f"[diffusers] Lightning DiT → bf16 (LIGHTNING_BF16=1) "
                    f"(rss≈{_host_rss_gb():.1f}GiB)…",
                    flush=True,
                )
                transformer.to(dtype=torch.bfloat16)
                gc.collect()
            print(
                f"[diffusers] Lightning DiT bf16 "
                f"footprint≈{self._module_footprint_mb(transformer):.0f}MiB "
                f"(opt-in; expect group-offload on 24GB)",
                flush=True,
            )
            return

        if self._enable_qwen_layerwise_casting(transformer):
            return
        try:
            sample = next(transformer.parameters())
        except StopIteration:
            return
        if sample.dtype in (
            getattr(torch, "float8_e4m3fn", type(None)),
            getattr(torch, "float8_e5m2", type(None)),
        ):
            print(
                f"[diffusers] upcasting fp8 DiT → bf16 (layerwise unavailable) "
                f"(rss≈{_host_rss_gb():.1f}GiB)…",
                flush=True,
            )
            transformer.to(dtype=torch.bfloat16)
            gc.collect()
            print(
                f"[diffusers] DiT now bf16 rss≈{_host_rss_gb():.1f}GiB "
                f"(will group-offload)",
                flush=True,
            )

    def _bake_loras_into_fp8_transformer(
        self,
        transformer: Any,
        loras: list[tuple[str, float]],
    ) -> int:
        """Fuse Lightning LoRAs in bf16, then layerwise-cast storage back to fp8.

        Call *before* TE load so host RAM only holds the DiT during the upcast.
        """
        if not loras:
            return 0
        import gc

        import torch
        from diffusers import QwenImagePipeline

        print(
            f"[diffusers] baking {len(loras)} LoRA(s) into DiT via bf16 "
            f"(rss≈{_host_rss_gb():.1f}GiB)…",
            flush=True,
        )
        try:
            transformer.to(dtype=torch.bfloat16)
        except Exception as cast_exc:
            print(f"[diffusers] DiT→bf16 for LoRA bake failed: {cast_exc}", flush=True)
            return 0

        baked = 0
        try:
            for index, (lora_path, strength) in enumerate(loras):
                path = Path(lora_path)
                stem = re.sub(r"[^A-Za-z0-9_]+", "_", path.stem).strip("_")
                adapter = f"bake{index}_{stem}"[:60]
                state = QwenImagePipeline.lora_state_dict(
                    str(path.parent),
                    weight_name=path.name,
                )
                if isinstance(state, tuple):
                    state = state[0]
                QwenImagePipeline.load_lora_into_transformer(
                    state,
                    transformer,
                    adapter_name=adapter,
                )
                if hasattr(transformer, "set_adapters"):
                    transformer.set_adapters([adapter], [float(strength)])
                if hasattr(transformer, "fuse_lora"):
                    try:
                        transformer.fuse_lora(
                            adapter_names=[adapter],
                            lora_scale=float(strength),
                        )
                    except TypeError:
                        transformer.fuse_lora()
                baked += 1
                print(
                    f"[diffusers] baked LoRA {path.name} @{strength}",
                    flush=True,
                )
            # Drop PEFT modules so denoise cannot reintroduce adapter dtype mixes.
            if hasattr(transformer, "delete_adapters"):
                try:
                    names = list(getattr(transformer, "peft_config", {}) or {})
                    if names:
                        transformer.delete_adapters(names)
                except Exception as del_exc:
                    print(f"[diffusers] delete_adapters: {del_exc}", flush=True)
            if hasattr(transformer, "unload_lora"):
                try:
                    transformer.unload_lora()
                except Exception:
                    pass
        except Exception as bake_exc:
            print(f"[diffusers] LoRA bake failed: {bake_exc}", flush=True)
            baked = 0

        print(
            f"[diffusers] LoRA bake done applied={baked} "
            f"rss≈{_host_rss_gb():.1f}GiB",
            flush=True,
        )
        gc.collect()
        return baked

    def _load_qwen_pipeline(
        self,
        *,
        model_path: str,
        clip_name: str | None,
        vae_name: str | None,
        dtype: Any,
        is_rapid_aio: bool = False,
        loras: list[tuple[str, float]] | None = None,
        lightning: bool = False,
    ) -> Any:
        """Load Qwen-Image from local UNET/Rapid-AIO + drop-in or hub TE/VAE."""
        from app.asset_inventory import resolve_asset_file
        from app.dropin_loaders import (
            extract_rapid_aio_components,
            is_rapid_aio_name,
            load_qwen25_vl_from_single_file,
            load_qwen_transformer_from_single_file,
        )
        from transformers import Qwen2Tokenizer, Qwen2_5_VLForConditionalGeneration
        from diffusers import (
            AutoencoderKLQwenImage,
            FlowMatchEulerDiscreteScheduler,
            QwenImagePipeline,
            QwenImageTransformer2DModel,
        )

        path = Path(model_path)
        if path.is_dir():
            pipe = QwenImagePipeline.from_pretrained(str(path), torch_dtype=dtype)
            print(f"[diffusers] Qwen from_pretrained dir {path.name}", flush=True)
            return pipe

        snap = self._ensure_qwen_hub_snap()
        te_tmp: Path | None = None
        text_encoder = None
        transformer = None

        rapid = is_rapid_aio or is_rapid_aio_name(path.name)
        if rapid:
            print(f"[diffusers] Qwen Rapid-AIO unpack {path.name}", flush=True)
            te_tmp, te_state, _vae_state = extract_rapid_aio_components(path)
            try:
                transformer = QwenImageTransformer2DModel.from_single_file(
                    str(te_tmp),
                    torch_dtype=dtype,
                    config=str(snap / "transformer"),
                    local_files_only=True,
                )
            finally:
                try:
                    te_tmp.unlink(missing_ok=True)
                except Exception:
                    pass
            from app.dropin_loaders import remap_qwen25_vl_comfy_keys

            text_encoder = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                str(snap / "text_encoder"),
                torch_dtype=dtype,
                local_files_only=True,
            )
            remapped = remap_qwen25_vl_comfy_keys(te_state)
            missing, unexpected = text_encoder.load_state_dict(remapped, strict=False)
            print(
                f"[diffusers] Rapid-AIO TE applied matched≈{len(remapped) - len(unexpected)} "
                f"missing={len(missing)} unexpected={len(unexpected)}",
                flush=True,
            )
            # Comfy VAE layout ≠ Diffusers AutoencoderKLQwenImage; keep hub VAE.
        else:
            import gc

            import torch

            print(f"[diffusers] Qwen assembling from {path.name}", flush=True)
            transformer_dtype = _qwen_transformer_load_dtype(path, dtype)
            if transformer_dtype is not dtype:
                print(
                    f"[diffusers] Qwen transformer dtype={transformer_dtype} "
                    f"(file={path.name})",
                    flush=True,
                )
            # Comfy 2512 fp8 uses model.diffusion_model.* keys — remap loader
            # (plain from_single_file leaves a meta shell → .to(cuda) crashes).
            transformer = load_qwen_transformer_from_single_file(
                path,
                config_dir=snap / "transformer",
                dtype=transformer_dtype,
            )
            # Keep DiT on CPU here so Lightning LoRA can fuse before placement.
            # Host thrash was from double-loading the TE (hub shell + drop-in),
            # not from DiT residing on CPU briefly — meta+assign TE stays lean.
            gc.collect()
            print(
                f"[diffusers] DiT on CPU pending LoRA/place "
                f"(rss≈{_host_rss_gb():.1f}GiB, free≈{self._cuda_free_mb():.0f}MiB)",
                flush=True,
            )

            # Bake Lightning LoRA *before* TE load (avoids bf16+TE peak).
            # Non-Lightning then layerwise-casts to fp8 for 24GB residency;
            # Lightning stays bf16 (Comfy parity — no fp8 grid/grain).
            baked = 0
            lightning_loras = _qwen_loras_are_lightning(loras or [])
            use_lightning = bool(lightning or lightning_loras)
            if loras and (
                "fp8" in path.name.lower()
                or lightning_loras
                or (use_lightning and "bf16" in path.name.lower())
            ):
                baked = self._bake_loras_into_fp8_transformer(transformer, loras)
                if baked > 0:
                    # Caller should skip a second fuse pass.
                    self._lora_key = f"qwen:{sorted(loras)}"
            elif loras:
                # Non-Lightning LoRAs: fuse after full pipe assemble.
                pass
            self._prepare_qwen_transformer_compute(
                transformer, lightning=use_lightning
            )

            if clip_name and not str(clip_name).startswith("{{"):
                clip_path = resolve_asset_file(clip_name, "text_encoders", "clip")
                if clip_path is None:
                    raise FileNotFoundError(
                        f"Qwen CLIP not found in drop-in folders: {clip_name}"
                    )
                try:
                    print(
                        f"[diffusers] loading TE after DiT "
                        f"(rss≈{_host_rss_gb():.1f}GiB)…",
                        flush=True,
                    )
                    text_encoder = load_qwen25_vl_from_single_file(
                        clip_path,
                        config_dir=snap / "text_encoder",
                        dtype=dtype,
                    )
                except Exception as exc:
                    print(
                        f"[diffusers] Qwen drop-in TE failed ({exc}); hub TE",
                        flush=True,
                    )
            if text_encoder is None:
                # Config-only shell then weights from hub shard — still heavy;
                # prefer the drop-in path above.
                text_encoder = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                    str(snap / "text_encoder"),
                    torch_dtype=dtype,
                    local_files_only=True,
                    low_cpu_mem_usage=True,
                )
                print("[diffusers] Qwen TE from hub cache", flush=True)
            # Keep TE on CPU; encode path wakes it explicitly.
            try:
                text_encoder.to("cpu")
            except Exception:
                pass
            gc.collect()

        if vae_name and not str(vae_name).startswith("{{"):
            # Comfy qwen_image_vae key layout differs; prefer hub Diffusers VAE.
            print(
                f"[diffusers] Qwen VAE drop-in {vae_name} noted; "
                "using Diffusers AutoencoderKLQwenImage (hub cache)",
                flush=True,
            )

        tokenizer = Qwen2Tokenizer.from_pretrained(
            str(snap / "tokenizer"),
            local_files_only=True,
        )
        scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(
            str(snap / "scheduler"),
            local_files_only=True,
        )
        vae = AutoencoderKLQwenImage.from_pretrained(
            str(snap / "vae"),
            torch_dtype=dtype,
            local_files_only=True,
        )
        try:
            vae.to("cpu")
        except Exception:
            pass
        pipe = QwenImagePipeline(
            scheduler=scheduler,
            vae=vae,
            text_encoder=text_encoder,
            tokenizer=tokenizer,
            transformer=transformer,
        )
        try:
            pipe.set_progress_bar_config(disable=True)
        except Exception:
            pass
        print(
            f"[diffusers] Qwen pipeline ready model={path.name} rapid={rapid} "
            f"rss≈{_host_rss_gb():.1f}GiB",
            flush=True,
        )
        return pipe

    def _fuse_pipeline_loras(self, pipe: Any, loras: list[tuple[str, float]]) -> int:
        """Load + fuse Comfy-style LoRAs (Flux/Qwen transformer adapters).

        Returns the number of LoRAs successfully applied. Callers must not cache
        a LoRA key when this returns 0 — silent skips previously looked like
        success and blocked retries.
        """
        if not loras:
            return 0

        adapter_names: list[str] = []
        adapter_weights: list[float] = []
        for index, (lora_path, strength) in enumerate(loras):
            path = Path(lora_path)
            # PEFT adapter names cannot contain '.' (Lightning filenames have versions).
            stem = re.sub(r"[^A-Za-z0-9_]+", "_", path.stem).strip("_")
            adapter = f"ps{index}_{stem}"[:60]
            try:
                pipe.load_lora_weights(
                    str(path.parent),
                    weight_name=path.name,
                    adapter_name=adapter,
                )
                adapter_names.append(adapter)
                adapter_weights.append(float(strength))
                print(
                    f"[diffusers] loaded LoRA {path.name} as {adapter} @{strength}",
                    flush=True,
                )
            except Exception as exc:
                print(f"[diffusers] LoRA skip {path.name}: {exc}", flush=True)

        if not adapter_names:
            return 0

        # fp8 DiT cannot fuse LoRA on CPU (no Float8 mul kernels). Keep adapters
        # live for inference instead of failing the whole Lightning path.
        transformer = getattr(pipe, "transformer", None)
        is_fp8 = False
        try:
            import torch

            if transformer is not None:
                first = next(transformer.parameters())
                is_fp8 = first.dtype in (
                    getattr(torch, "float8_e4m3fn", type(None)),
                    getattr(torch, "float8_e5m2", type(None)),
                )
        except Exception:
            is_fp8 = False

        if is_fp8:
            try:
                if hasattr(pipe, "set_adapters"):
                    pipe.set_adapters(adapter_names, adapter_weights)
                print(
                    f"[diffusers] LoRA adapters active (fp8, no-fuse) "
                    f"{list(zip(adapter_names, adapter_weights))}",
                    flush=True,
                )
                return len(adapter_names)
            except Exception as exc:
                print(f"[diffusers] fp8 LoRA set_adapters failed: {exc}", flush=True)
                return 0

        try:
            # Fuse one adapter at a time so per-LoRA strengths are respected.
            # Batch set_adapters + fuse_lora(lora_scale=1) has dropped strengths
            # on some Diffusers/PEFT combos (Lightning looked "unapplied").
            fused = 0
            for name, weight in zip(adapter_names, adapter_weights):
                if hasattr(pipe, "set_adapters"):
                    pipe.set_adapters([name], [1.0])
                if hasattr(pipe, "fuse_lora"):
                    try:
                        pipe.fuse_lora(adapter_names=[name], lora_scale=float(weight))
                    except TypeError:
                        pipe.fuse_lora(lora_scale=float(weight))
                fused += 1
                print(
                    f"[diffusers] fused LoRA {name} @{weight}",
                    flush=True,
                )
            n_fused = getattr(pipe, "num_fused_loras", None)
            print(
                f"[diffusers] fused {fused}/{len(adapter_names)} LoRA(s)"
                + (f" (pipe.num_fused_loras={n_fused})" if n_fused is not None else ""),
                flush=True,
            )
            try:
                pipe.unload_lora_weights()
            except Exception:
                pass
        except Exception as exc:
            print(f"[diffusers] LoRA fuse failed: {exc}", flush=True)
            # Last resort: leave adapters attached for the forward pass.
            try:
                if hasattr(pipe, "set_adapters"):
                    pipe.set_adapters(adapter_names, adapter_weights)
                    print(
                        f"[diffusers] LoRA adapters active (fuse-fallback) "
                        f"{list(zip(adapter_names, adapter_weights))}",
                        flush=True,
                    )
                    return len(adapter_names)
            except Exception:
                pass
            return 0
        return len(adapter_names)

    def _generate_txt2img_flux(
        self,
        *,
        unet_path: str,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        steps: int,
        guidance_scale: float,
        seed: int,
        on_step: Callable[[int, int], None] | None = None,
    ) -> Image.Image:
        """Bridge /v1/txt2img Flux requests onto the native compiled path."""
        from app.dropin_loaders import is_flux_klein_unet

        stack = default_flux_txt2img_stack(Path(unet_path).name)
        if stack.get("clip_type") == "flux2" and not stack.get("clip"):
            raise FileNotFoundError(
                "Flux2-Klein needs qwen_3_*.safetensors in models/text_encoders."
            )
        cfg = float(guidance_scale)
        # Studio often still sends SDXL CFG (~7); Klein distilled wants ~1.
        if is_flux_klein_unet(Path(unet_path).name) and (
            "base" not in Path(unet_path).name.lower()
        ):
            if cfg <= 0 or cfg >= 3.5:
                cfg = 1.0
        elif cfg <= 0 or cfg >= 6.0:
            cfg = 3.5
        print(
            f"[diffusers] txt2img→native-flux model={Path(unet_path).name} "
            f"TE={stack.get('clip')} cfg={cfg}",
            flush=True,
        )
        return self.generate_compiled_flux(
            unet_path=unet_path,
            clip_name=stack.get("clip"),  # type: ignore[arg-type]
            clip2_name=stack.get("clip2"),  # type: ignore[arg-type]
            clip_type=stack.get("clip_type"),  # type: ignore[arg-type]
            vae_name=stack.get("vae"),  # type: ignore[arg-type]
            loras=[],
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            steps=steps,
            guidance_scale=cfg,
            seed=seed,
            max_shift=1.15,
            base_shift=0.5,
            on_step=on_step,
        )

    def _generate_txt2img_qwen(
        self,
        *,
        model_path: str,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        steps: int,
        guidance_scale: float,
        seed: int,
        on_step: Callable[[int, int], None] | None = None,
        on_status: Callable[[str], None] | None = None,
    ) -> Image.Image:
        """Bridge /v1/txt2img Qwen requests onto the native compiled path."""
        from app.asset_inventory import resolve_asset_file

        stack = default_qwen_txt2img_stack(Path(model_path).name)
        cfg = float(guidance_scale)
        step_count = max(1, int(steps))
        loras: list[tuple[str, float]] = []
        aura_shift: float | None = None

        # Heuristic: 4/8-step schedules match Comfy Lightning (cfg=1, shift=3, LoRA).
        lightning_guess = step_count in (4, 8)
        if lightning_guess and not stack.get("is_rapid_aio"):
            want4 = step_count == 4
            candidates = (
                (
                    "Qwen-Image-Lightning-4steps-V1.0.safetensors",
                    "Qwen-Image-2512-Lightning-4steps-V1.0.safetensors",
                )
                if want4
                else (
                    "Qwen-Image-2512-Lightning-8steps-V1.0-bf16.safetensors",
                    "Qwen-Image-Lightning-8steps-V2.0-bf16.safetensors",
                    "Qwen-Image-Lightning-8steps-V2.0.safetensors",
                )
            )
            for name in candidates:
                hit = resolve_asset_file(name, "loras")
                if hit is not None:
                    loras.append((str(hit), 1.0))
                    print(f"[diffusers] txt2img Lightning LoRA {hit.name}", flush=True)
                    break
            if loras:
                aura_shift = 3.0
                cfg = 1.0
                if step_count not in (4, 8):
                    step_count = 4 if want4 else 8
            elif cfg <= 0 or cfg >= 6.0:
                cfg = 2.5
        elif cfg <= 0 or cfg >= 6.0:
            # Studio SDXL CFG=7 is too high for Qwen-Image; prefer mid/low.
            cfg = 2.5
        else:
            pass

        if aura_shift is None and not stack.get("is_rapid_aio"):
            aura_shift = 3.1

        # Match Studio/Comfy 2512 defaults: Lightning=simple, vanilla=beta.
        scheduler_name = "simple" if loras else "beta"
        model_path = _resolve_qwen_unet_path(
            model_path, lightning=bool(loras) and lightning_guess
        )
        # Refresh TE/VAE hints after possible fp8→bf16 swap.
        stack = default_qwen_txt2img_stack(Path(model_path).name)

        print(
            f"[diffusers] txt2img→native-qwen model={Path(model_path).name} "
            f"TE={stack.get('clip')} cfg={cfg} steps={step_count} "
            f"shift={aura_shift} sched={scheduler_name} rapid={stack.get('is_rapid_aio')} "
            f"loras={len(loras)}",
            flush=True,
        )
        return self.generate_compiled_qwen(
            model_path=model_path,
            clip_name=stack.get("clip"),  # type: ignore[arg-type]
            vae_name=stack.get("vae"),  # type: ignore[arg-type]
            loras=loras,
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            steps=step_count,
            guidance_scale=cfg,
            seed=seed,
            aura_shift=aura_shift,
            scheduler_name=scheduler_name,
            is_rapid_aio=bool(stack.get("is_rapid_aio")),
            on_step=on_step,
            on_status=on_status,
        )

    def generate_compiled_flux(
        self,
        *,
        unet_path: str,
        clip_name: str | None,
        clip2_name: str | None,
        clip_type: str | None = None,
        vae_name: str | None,
        loras: list[tuple[str, float]],
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        steps: int,
        guidance_scale: float,
        seed: int,
        max_shift: float,
        base_shift: float,
        on_step: Callable[[int, int], None] | None = None,
        init_image_path: str | None = None,
        mask_image_path: str | None = None,
        img2img_mode: str = "txt2img",
        denoise: float = 1.0,
        controlnet_path: str | None = None,
        controlnet_image_path: str | None = None,
        controlnet_preprocessor: str = "none",
        controlnet_strength: float = 1.0,
        controlnet_stack: list[dict[str, Any]] | None = None,
    ) -> Image.Image:
        """Native Flux / Flux2-Klein from drop-in UNET + TE + VAE (+ LoRA).
        Classic Flux ControlNet supports txt2img / img2img / inpaint via
        FluxControlNet*Pipeline (± stacked Multi / same-file Union modes);
        Klein ControlNet stays unsupported.
        """
        import torch

        from app.qwen_prompt import shape_person_prompts

        shaped_prompt, shaped_negative = shape_person_prompts(prompt, negative_prompt)
        width, height = _person_portrait_canvas(shaped_prompt, int(width), int(height))

        key = (
            f"compiled-flux:{unet_path}:{clip_name}:{clip2_name}:"
            f"{clip_type}:{vae_name}"
        )
        with self._lock:
            if self._model_key != key or self._pipe is None:
                _free_peer_comfy_vram()
                self._release_pipe()
                device = "cuda" if torch.cuda.is_available() else "cpu"
                dtype = torch.bfloat16 if device == "cuda" else torch.float32
                pipe = self._load_flux_pipeline(
                    unet_path=unet_path,
                    clip_name=clip_name,
                    clip2_name=clip2_name,
                    clip_type=clip_type,
                    vae_name=vae_name,
                    dtype=dtype,
                )
                if loras:
                    applied = self._fuse_pipeline_loras(pipe, loras)
                    self._lora_key = f"flux:{sorted(loras)}" if applied else "none"
                else:
                    self._lora_key = "none"
                pipe = self._place_compiled_pipe(
                    pipe,
                    dtype,
                    prefer_offload=True,
                    pixel_count=max(1, int(width) * int(height)),
                )
                self._pipe = pipe
                self._model_key = key
                self._resolved = ResolvedModel(
                    "single_file",
                    unet_path,
                    Path(unet_path).name,
                )
            else:
                pipe = self._pipe
                flux_lora_key = f"flux:{sorted(loras)}"
                if loras and self._lora_key != flux_lora_key:
                    print(
                        "[diffusers] Flux LoRA set changed — reload base to re-fuse",
                        flush=True,
                    )
                    self._release_pipe()
                    device = "cuda" if torch.cuda.is_available() else "cpu"
                    dtype = torch.bfloat16 if device == "cuda" else torch.float32
                    pipe = self._load_flux_pipeline(
                        unet_path=unet_path,
                        clip_name=clip_name,
                        clip2_name=clip2_name,
                        clip_type=clip_type,
                        vae_name=vae_name,
                        dtype=dtype,
                    )
                    applied = self._fuse_pipeline_loras(pipe, loras)
                    self._lora_key = flux_lora_key if applied else "none"
                    pipe = self._place_compiled_pipe(
                        pipe,
                        dtype,
                        prefer_offload=True,
                        pixel_count=max(1, int(width) * int(height)),
                    )
                    self._pipe = pipe
                    self._model_key = key
                pipe = self._pipe

        # Flux typically wants low CFG; Klein distilled is locked to 4 / 1.0 (BFL).
        cfg = float(guidance_scale)
        if cfg <= 0:
            cfg = 1.0
        step_count = max(1, int(steps))
        klein_distilled = bool(getattr(getattr(pipe, "config", None), "is_distilled", False))
        if not klein_distilled:
            klein_distilled = _is_flux2_klein_distilled(Path(unet_path).name)
        if klein_distilled:
            if step_count != 4 or abs(cfg - 1.0) > 1e-6:
                print(
                    f"[diffusers] Klein distilled: forcing steps=4 cfg=1.0 "
                    f"(was steps={step_count} cfg={cfg})",
                    flush=True,
                )
            step_count = 4
            cfg = 1.0
        # ModelSamplingFlux shifts — apply when scheduler exposes them.
        # Do not override Klein's empirical-mu dynamic schedule with graph shifts.
        try:
            if (
                not klein_distilled
                and max_shift is not None
                and hasattr(pipe, "scheduler")
            ):
                if hasattr(pipe.scheduler.config, "max_shift"):
                    pipe.scheduler.config.max_shift = float(max_shift)
                if hasattr(pipe.scheduler.config, "base_shift") and base_shift is not None:
                    pipe.scheduler.config.base_shift = float(base_shift)
        except Exception:
            pass

        generator = torch.Generator(device="cpu").manual_seed(int(seed) & 0xFFFFFFFF)
        callback_on_step_end = None
        if on_step is not None:
            def _cb(pipe_ref, step_index, timestep, callback_kwargs):  # type: ignore[no-untyped-def]
                on_step(int(step_index) + 1, step_count)
                return callback_kwargs

            callback_on_step_end = _cb

        cn_stack: list[dict[str, Any]] = list(controlnet_stack or [])
        if not cn_stack and controlnet_path and controlnet_image_path:
            cn_stack = [
                {
                    "path": controlnet_path,
                    "image_path": controlnet_image_path,
                    "preprocessor": controlnet_preprocessor,
                    "strength": controlnet_strength,
                }
            ]
        use_controlnet = bool(cn_stack)
        strength = max(0.01, min(1.0, float(denoise)))
        use_img2img = init_image_path is not None and strength < 0.999
        use_inpaint = (
            use_img2img and img2img_mode == "inpaint" and mask_image_path is not None
        )
        if use_controlnet:
            if klein_distilled:
                raise RuntimeError(
                    "Flux2-Klein ControlNet is not supported yet — use ComfyUI "
                    "for this workflow."
                )
            from app.safetensors_peek import (
                flux_controlnet_mode_count,
                looks_like_diffusers_flux_controlnet,
            )
            from app.controlnet_preprocess import (
                apply_controlnet_preprocess,
                flux_union_control_mode,
            )
            from diffusers import (
                FluxControlNetImg2ImgPipeline,
                FluxControlNetInpaintPipeline,
                FluxControlNetModel,
                FluxControlNetPipeline,
                FluxMultiControlNetModel,
            )

            for entry in cn_stack:
                path_str = str(entry["path"])
                if not looks_like_diffusers_flux_controlnet(path_str):
                    raise RuntimeError(
                        f"{Path(path_str).name} looks like an XLabs-style Flux "
                        "ControlNet (double_blocks/img_in/input_hint_block keys) — "
                        "diffusers' FluxControlNetModel needs the diffusers-native "
                        "layout (x_embedder/transformer_blocks/controlnet_blocks). "
                        "Use ComfyUI for this checkpoint."
                    )

            control_images: list[Image.Image] = []
            strengths: list[float] = []
            preprocessors: list[str] = []
            for entry in cn_stack:
                img = Image.open(entry["image_path"]).convert("RGB")
                img = apply_controlnet_preprocess(
                    img, str(entry.get("preprocessor") or "none")
                )
                img = img.resize((int(width), int(height)), Image.Resampling.LANCZOS)
                control_images.append(img)
                strengths.append(float(entry.get("strength", 1.0)))
                preprocessors.append(str(entry.get("preprocessor") or "none"))

            mode_counts = [
                flux_controlnet_mode_count(str(entry["path"])) for entry in cn_stack
            ]
            is_union = all(c is not None for c in mode_counts)
            is_plain = all(c is None for c in mode_counts)
            if not is_union and not is_plain:
                raise RuntimeError(
                    "Mixed Union and single-task Flux ControlNet stack is not "
                    "supported — use ComfyUI."
                )
            if is_union:
                resolved = {str(Path(e["path"]).resolve()) for e in cn_stack}
                if len(resolved) > 1:
                    raise RuntimeError(
                        "Stacked Flux Union ControlNets must share one checkpoint "
                        "file — use ComfyUI for different Union weights."
                    )

            is_multi = len(cn_stack) > 1
            paths_key = "|".join(str(Path(e["path"]).resolve()) for e in cn_stack)
            cn_key = (
                f"flux-{'union' if is_union else 'plain'}:n{len(cn_stack)}:{paths_key}"
            )
            if self._controlnet_key != cn_key or self._controlnet_model is None:
                names = "+".join(Path(e["path"]).name for e in cn_stack)
                print(
                    f"[diffusers] loading Flux ControlNet stack ({len(cn_stack)}): {names}",
                    flush=True,
                )

                def _load_one_flux_cn(path_str: str) -> Any:
                    cn_source = Path(path_str)
                    errors: list[str] = []
                    model = None
                    if cn_source.is_file():
                        try:
                            model = FluxControlNetModel.from_single_file(
                                str(cn_source), torch_dtype=torch.bfloat16
                            )
                        except Exception as exc:
                            errors.append(f"from_single_file: {exc}")
                    if model is None:
                        repo_dir = cn_source.parent if cn_source.is_file() else cn_source
                        try:
                            model = FluxControlNetModel.from_pretrained(
                                str(repo_dir), torch_dtype=torch.bfloat16
                            )
                        except Exception as exc:
                            errors.append(f"from_pretrained: {exc}")
                    if model is None and flux_controlnet_mode_count(path_str) is not None:
                        try:
                            model = _load_via_hub_config_local_weights(
                                FluxControlNetModel,
                                "InstantX/FLUX.1-dev-Controlnet-Union",
                                str(cn_source),
                                torch.bfloat16,
                            )
                        except Exception as exc:
                            errors.append(f"hub-config+local-weights: {exc}")
                    if model is None:
                        raise RuntimeError(
                            f"Could not load Flux ControlNet from {path_str}: "
                            + "; ".join(errors)
                        )
                    return model

                if is_union or not is_multi:
                    self._controlnet_model = _load_one_flux_cn(str(cn_stack[0]["path"]))
                else:
                    models = [_load_one_flux_cn(str(e["path"])) for e in cn_stack]
                    self._controlnet_model = FluxMultiControlNetModel(models)
                self._controlnet_key = cn_key

            init_image: Image.Image | None = None
            mask_image: Image.Image | None = None
            if use_img2img:
                init_image = Image.open(init_image_path).convert("RGB")
                init_image = init_image.resize(
                    (int(width), int(height)), Image.Resampling.LANCZOS
                )
            if use_inpaint:
                mask_image = Image.open(mask_image_path).convert("L")
                mask_image = mask_image.resize(
                    (int(width), int(height)), Image.Resampling.LANCZOS
                )

            if use_inpaint:
                cn_pipe = FluxControlNetInpaintPipeline.from_pipe(
                    pipe, controlnet=self._controlnet_model
                )
            elif use_img2img:
                cn_pipe = FluxControlNetImg2ImgPipeline.from_pipe(
                    pipe, controlnet=self._controlnet_model
                )
            else:
                cn_pipe = FluxControlNetPipeline.from_pipe(
                    pipe, controlnet=self._controlnet_model
                )
            cn_pipe = self._place_compiled_pipe(
                cn_pipe,
                torch.bfloat16,
                prefer_offload=True,
                pixel_count=max(1, int(width) * int(height)),
            )

            control_maps: Any = control_images if is_multi else control_images[0]
            scale_arg: float | list[float] = strengths if is_multi else strengths[0]
            cn_kwargs: dict[str, Any] = {
                "prompt": shaped_prompt,
                "control_image": control_maps,
                "controlnet_conditioning_scale": scale_arg,
                "width": int(width),
                "height": int(height),
                "num_inference_steps": step_count,
                "generator": generator,
            }
            if init_image is not None:
                cn_kwargs["image"] = init_image
                cn_kwargs["strength"] = strength
            if mask_image is not None:
                cn_kwargs["mask_image"] = mask_image
            try:
                import inspect

                sig = inspect.signature(cn_pipe.__call__)
                if "guidance_scale" in sig.parameters:
                    cn_kwargs["guidance_scale"] = cfg
                if "true_cfg_scale" in sig.parameters and cfg > 1.0:
                    cn_kwargs["true_cfg_scale"] = cfg
                if "callback_on_step_end" in sig.parameters:
                    cn_kwargs["callback_on_step_end"] = callback_on_step_end
                if shaped_negative.strip() and "negative_prompt" in sig.parameters:
                    cn_kwargs["negative_prompt"] = shaped_negative
                if is_union and "control_mode" in sig.parameters:
                    modes = [flux_union_control_mode(p) for p in preprocessors]
                    cn_kwargs["control_mode"] = modes if is_multi else modes[0]
                    print(
                        f"[diffusers] Flux ControlNet is a union checkpoint — "
                        f"using control_mode={cn_kwargs['control_mode']} "
                        f"(preprocessors={preprocessors})",
                        flush=True,
                    )
            except Exception:
                cn_kwargs["guidance_scale"] = cfg
                if callback_on_step_end is not None:
                    cn_kwargs["callback_on_step_end"] = callback_on_step_end
                if shaped_negative.strip():
                    cn_kwargs["negative_prompt"] = shaped_negative

            mode_label = (
                "controlnet+inpaint" if mask_image is not None
                else "controlnet+img2img" if init_image is not None
                else f"controlnet({'+'.join(preprocessors)})"
            )
            if is_multi:
                mode_label = f"multi-{mode_label}"
            cn_names = "+".join(Path(e["path"]).name for e in cn_stack)
            print(
                f"[diffusers] compiled-flux {mode_label} "
                f"model={Path(unet_path).name} cn={cn_names} "
                f"{width}x{height} steps={step_count} cfg={cfg} "
                f"cn_strength={strengths}"
                + (f" denoise={strength:.2f}" if init_image is not None else ""),
                flush=True,
            )
            try:
                result = cn_pipe(**cn_kwargs)
                return result.images[0]
            except Exception:
                try:
                    self._release_pipe()
                except Exception:
                    pass
                raise
            finally:
                self._empty_cuda()

        if use_inpaint and klein_distilled:
            raise RuntimeError(
                "Flux2-Klein inpaint is not supported yet (no mask-capable "
                "pipeline for Klein) — use ComfyUI for this workflow."
            )
        init_image = None
        mask_image = None
        if use_img2img:
            init_image = Image.open(init_image_path).convert("RGB")
            init_image = init_image.resize((int(width), int(height)), Image.Resampling.LANCZOS)
            if use_inpaint:
                mask_image = Image.open(mask_image_path).convert("L")
                mask_image = mask_image.resize(
                    (int(width), int(height)), Image.Resampling.LANCZOS
                )

        kwargs: dict[str, Any] = {
            "prompt": shaped_prompt,
            "width": int(width),
            "height": int(height),
            "num_inference_steps": step_count,
            "generator": generator,
        }
        if init_image is not None:
            kwargs["image"] = init_image
            kwargs["strength"] = strength
        if mask_image is not None:
            kwargs["mask_image"] = mask_image
        # guidance_scale / true_cfg differ by pipeline class.
        try:
            import inspect

            sig = inspect.signature(pipe.__call__)
            if "guidance_scale" in sig.parameters:
                kwargs["guidance_scale"] = cfg
            if "true_cfg_scale" in sig.parameters and cfg > 1.0:
                kwargs["true_cfg_scale"] = cfg
            if "callback_on_step_end" in sig.parameters:
                kwargs["callback_on_step_end"] = callback_on_step_end
            if shaped_negative.strip() and "negative_prompt" in sig.parameters:
                kwargs["negative_prompt"] = shaped_negative
            if init_image is not None and "image" not in sig.parameters:
                raise RuntimeError(
                    "Flux img2img requires a pipeline that accepts image+strength."
                )
            if mask_image is not None and "mask_image" not in sig.parameters:
                raise RuntimeError(
                    "Flux inpaint requires a pipeline that accepts mask_image; "
                    "this checkpoint only supports full-image img2img via Diffusers."
                )
        except RuntimeError:
            raise
        except Exception:
            kwargs["guidance_scale"] = cfg
            if callback_on_step_end is not None:
                kwargs["callback_on_step_end"] = callback_on_step_end
            if shaped_negative.strip():
                kwargs["negative_prompt"] = shaped_negative

        mode_label = (
            "inpaint" if mask_image is not None
            else "img2img" if init_image is not None
            else "txt2img"
        )
        print(
            f"[diffusers] compiled-flux {mode_label} model={Path(unet_path).name} "
            f"{width}x{height} steps={step_count} cfg={cfg} type={clip_type}"
            + (f" strength={strength:.2f}" if init_image is not None else ""),
            flush=True,
        )
        try:
            result = pipe(**kwargs)
            return result.images[0]
        except Exception:
            # OOM / hook corruption can poison the cached offloaded pipe.
            try:
                self._release_pipe()
            except Exception:
                pass
            raise
        finally:
            self._empty_cuda()

    def generate_compiled_qwen(
        self,
        *,
        model_path: str,
        clip_name: str | None,
        vae_name: str | None,
        loras: list[tuple[str, float]],
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        steps: int,
        guidance_scale: float,
        seed: int,
        aura_shift: float | None = None,
        scheduler_name: str | None = None,
        is_rapid_aio: bool = False,
        on_step: Callable[[int, int], None] | None = None,
        on_status: Callable[[str], None] | None = None,
        init_image_path: str | None = None,
        mask_image_path: str | None = None,
        img2img_mode: str = "txt2img",
        denoise: float = 1.0,
        controlnet_path: str | None = None,
        controlnet_image_path: str | None = None,
        controlnet_preprocessor: str = "none",
        controlnet_strength: float = 1.0,
        controlnet_stack: list[dict[str, Any]] | None = None,
    ) -> Image.Image:
        """Native Qwen-Image from drop-in weights (+ optional VAE/Lightning LoRA).

        ControlNet: plain Union/Canny via ``QwenImageControlNetPipeline``
        (txt2img, ± ``QwenImageMultiControlNetModel`` stacks). Mask-conditioned
        InstantX ControlNet-Inpainting via ``QwenImageControlNetInpaintPipeline``
        when the graph is inpaint and the checkpoint's ``controlnet_x_embedder``
        is wider than ``img_in`` (single CN only).
        """
        import torch

        from app.qwen_prompt import shape_qwen_prompts

        def _status(message: str) -> None:
            if on_status:
                try:
                    on_status(message)
                except Exception:
                    pass

        lightning = _qwen_loras_are_lightning(loras) or _qwen_path_is_lightning(
            model_path
        )
        model_path = _resolve_qwen_unet_path(model_path, lightning=lightning)
        # Path swap may change filename heuristics; re-evaluate after resolve.
        lightning = (
            lightning
            or _qwen_loras_are_lightning(loras)
            or _qwen_path_is_lightning(model_path)
        )
        shaped_prompt, shaped_negative = shape_qwen_prompts(
            prompt,
            negative_prompt,
            lightning=lightning,
        )
        width, height = _person_portrait_canvas(shaped_prompt, int(width), int(height))

        precision_tag = (
            "lightning-bf16"
            if (lightning and LIGHTNING_BF16)
            else ("lightning-fp8" if lightning else "fp8-or-default")
        )
        # Needed below (from_pipe() dtype restore, ControlNet loader calls)
        # whether or not this call hits the pipe cache — the inner `dtype`
        # inside the cache-miss block further down only exists on a fresh
        # load, so compute it unconditionally here too rather than relying
        # on that one.
        dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        key = (
            f"compiled-qwen:{model_path}:{clip_name}:{vae_name}:"
            f"{is_rapid_aio}:{precision_tag}"
        )
        pixels = max(1, int(width) * int(height))
        # Model offload (component streaming) — close to Comfy speed without the
        # sequential layer thrash that freezes the desktop. Opt into sequential
        # with DIFFUSERS_SEQUENTIAL_OFFLOAD=1 only if you hit VRAM OOM.
        prefer_seq = SEQUENTIAL_OFFLOAD
        qwen_lora_key = f"qwen:{sorted(loras)}" if loras else "none"
        with self._lock:
            if self._model_key != key or self._pipe is None or (
                loras and self._lora_key != qwen_lora_key
            ):
                _status("Loading Qwen weights into RAM…")
                _free_peer_comfy_vram()
                self._release_pipe()
                self._lora_key = "none"
                device = "cuda" if torch.cuda.is_available() else "cpu"
                dtype = torch.bfloat16 if device == "cuda" else torch.float32
                pipe = self._load_qwen_pipeline(
                    model_path=model_path,
                    clip_name=clip_name,
                    vae_name=vae_name,
                    dtype=dtype,
                    is_rapid_aio=is_rapid_aio,
                    loras=loras,
                    lightning=lightning,
                )
                _status("Placing Qwen on GPU…")
                # Load path bakes Lightning LoRAs; other LoRAs still fuse here.
                if loras and self._lora_key != qwen_lora_key:
                    applied = self._fuse_pipeline_loras(pipe, loras)
                    self._lora_key = qwen_lora_key if applied else "none"
                    if not applied:
                        print("[diffusers] Qwen LoRAs failed to apply", flush=True)
                    else:
                        self._prepare_qwen_transformer_compute(
                            getattr(pipe, "transformer", None),
                            lightning=lightning,
                        )
                elif not loras:
                    self._lora_key = "none"
                pipe = self._place_compiled_pipe(
                    pipe,
                    dtype,
                    prefer_offload=True,
                    prefer_sequential=prefer_seq,
                    pixel_count=pixels,
                )
                self._pipe = pipe
                self._model_key = key
                self._resolved = ResolvedModel(
                    "single_file",
                    model_path,
                    Path(model_path).name,
                )
            pipe = self._pipe

        # ModelSamplingAuraFlow.shift → scheduler when exposed.
        if aura_shift is None:
            aura_shift = 3.0 if lightning else 3.1
        if aura_shift is not None:
            try:
                if hasattr(pipe, "scheduler") and hasattr(pipe.scheduler, "config"):
                    if hasattr(pipe.scheduler.config, "shift"):
                        pipe.scheduler.config.shift = float(aura_shift)
                        print(
                            f"[diffusers] Qwen AuraFlow shift={aura_shift}"
                            f"{' (lightning)' if lightning else ''}",
                            flush=True,
                        )
            except Exception as exc:
                print(f"[diffusers] AuraFlow shift skipped: {exc}", flush=True)

        # Comfy 2512 vanilla templates use scheduler=beta; Lightning stays simple.
        sched = (scheduler_name or "").strip().lower()
        if not sched:
            sched = "simple" if lightning else "beta"
        try:
            if hasattr(pipe, "scheduler") and hasattr(pipe.scheduler, "config"):
                want_beta = sched == "beta" and not lightning
                if hasattr(pipe.scheduler.config, "use_beta_sigmas"):
                    if bool(pipe.scheduler.config.use_beta_sigmas) != want_beta:
                        pipe.scheduler.config.use_beta_sigmas = want_beta
                        print(
                            f"[diffusers] Qwen scheduler beta_sigmas={want_beta} "
                            f"(comfy={sched})",
                            flush=True,
                        )
        except Exception as exc:
            print(f"[diffusers] Qwen scheduler tweak skipped: {exc}", flush=True)

        cfg = float(guidance_scale) if float(guidance_scale) > 0 else (1.0 if lightning else 2.5)
        # true_cfg_scale <= 1 disables negatives. Comfy Lightning keeps cfg=1 —
        # do not bump (that grainy look vs Comfy). Non-lightning can bump slightly.
        if (
            not lightning
            and shaped_negative.strip()
            and cfg <= 1.0
            and "elongated fingers" in shaped_negative.lower()
        ):
            cfg = 1.5
            print("[diffusers] Qwen CFG bumped to 1.5 so hand negatives apply", flush=True)
        if lightning and cfg > 1.25:
            print(
                f"[diffusers] Lightning CFG {cfg} → 1.0 (Comfy LightX2V default)",
                flush=True,
            )
            cfg = 1.0
        step_count = max(1, int(steps))
        if lightning and step_count not in (4, 8) and step_count > 12:
            target = _lightning_step_target(loras, step_count)
            print(
                f"[diffusers] Lightning steps {step_count} → {target} (Comfy default)",
                flush=True,
            )
            step_count = target
        # Keep caller canvas; only bump tiny sizes. Avoid extreme tall bias (mutant limbs).
        gen_width, gen_height = int(width), int(height)
        if min(gen_width, gen_height) < 768:
            gen_width = max(gen_width, 768)
            gen_height = max(gen_height, 1024)
        gen_width = max(64, (gen_width // 16) * 16)
        gen_height = max(64, (gen_height // 16) * 16)

        generator = torch.Generator(device="cpu").manual_seed(int(seed) & 0xFFFFFFFF)
        callback_on_step_end = None
        if on_step is not None:
            def _cb(pipe_ref, step_index, timestep, callback_kwargs):  # type: ignore[no-untyped-def]
                on_step(int(step_index) + 1, step_count)
                return callback_kwargs

            callback_on_step_end = _cb

        cn_stack: list[dict[str, Any]] = list(controlnet_stack or [])
        if not cn_stack and controlnet_path and controlnet_image_path:
            cn_stack = [
                {
                    "path": controlnet_path,
                    "image_path": controlnet_image_path,
                    "preprocessor": controlnet_preprocessor,
                    "strength": controlnet_strength,
                }
            ]
        use_controlnet = bool(cn_stack)
        strength = max(0.01, min(1.0, float(denoise)))
        use_img2img = init_image_path is not None and strength < 0.999
        use_inpaint = (
            use_img2img and img2img_mode == "inpaint" and mask_image_path is not None
        )
        if use_controlnet:
            from app.safetensors_peek import (
                looks_like_diffusers_qwen_controlnet,
                qwen_controlnet_expects_mask,
            )
            from app.controlnet_preprocess import apply_controlnet_preprocess

            for entry in cn_stack:
                path_str = str(entry["path"])
                if not looks_like_diffusers_qwen_controlnet(path_str):
                    raise RuntimeError(
                        f"{Path(path_str).name} doesn't look like a "
                        "diffusers-native Qwen ControlNet (missing "
                        "controlnet_x_embedder/transformer_blocks keys — e.g. "
                        "DiffSynth-Studio 'model patch' style checkpoints use a "
                        "different forward-hook architecture diffusers can't load "
                        "via from_single_file). Use ComfyUI for this checkpoint."
                    )

            mask_flags = [
                qwen_controlnet_expects_mask(str(entry["path"])) for entry in cn_stack
            ]
            if any(mask_flags) and not all(mask_flags):
                raise RuntimeError(
                    "Mixed mask-inpaint and plain Qwen ControlNet stack is not "
                    "supported — use ComfyUI."
                )
            if any(mask_flags) and len(cn_stack) > 1:
                raise RuntimeError(
                    "Stacked Qwen ControlNet-Inpainting checkpoints are not "
                    "supported — use a single InstantX inpaint CN or ComfyUI."
                )
            expects_mask = bool(mask_flags) and all(mask_flags)
            if expects_mask and not use_inpaint:
                raise RuntimeError(
                    f"{Path(str(cn_stack[0]['path'])).name} is the mask-conditioned "
                    "Qwen ControlNet-Inpainting variant — use it with an inpaint "
                    "graph (init + mask), not txt2img/img2img."
                )
            if use_img2img and not expects_mask:
                raise RuntimeError(
                    "Plain Qwen Union/Canny ControlNet does not support "
                    "img2img/inpaint — use the InstantX ControlNet-Inpainting "
                    "checkpoint with an inpaint graph, or ComfyUI."
                )
            try:
                from diffusers import (
                    QwenImageControlNetInpaintPipeline,
                    QwenImageControlNetModel,
                    QwenImageControlNetPipeline,
                    QwenImageMultiControlNetModel,
                )
            except ImportError as exc:
                raise RuntimeError(
                    "This diffusers install has no QwenImageControlNetModel/"
                    "QwenImageControlNetPipeline (added alongside the InstantX "
                    "Qwen-Image ControlNet release) — upgrade diffusers or use "
                    "ComfyUI for this workflow."
                ) from exc

            is_multi = len(cn_stack) > 1
            control_images: list[Image.Image] = []
            strengths: list[float] = []
            preprocessors: list[str] = []
            control_mask: Image.Image | None = None
            if expects_mask:
                control_image = Image.open(init_image_path).convert("RGB")
                control_mask = Image.open(mask_image_path).convert("L")
                control_image = control_image.resize(
                    (gen_width, gen_height), Image.Resampling.LANCZOS
                )
                control_mask = control_mask.resize(
                    (gen_width, gen_height), Image.Resampling.LANCZOS
                )
                control_images = [control_image]
                strengths = [float(cn_stack[0].get("strength", 1.0))]
                preprocessors = [str(cn_stack[0].get("preprocessor") or "none")]
            else:
                for entry in cn_stack:
                    img = Image.open(entry["image_path"]).convert("RGB")
                    img = apply_controlnet_preprocess(
                        img, str(entry.get("preprocessor") or "none")
                    )
                    img = img.resize(
                        (gen_width, gen_height), Image.Resampling.LANCZOS
                    )
                    control_images.append(img)
                    strengths.append(float(entry.get("strength", 1.0)))
                    preprocessors.append(str(entry.get("preprocessor") or "none"))

            paths_key = "|".join(str(Path(e["path"]).resolve()) for e in cn_stack)
            cn_key = (
                f"qwen-{'mask' if expects_mask else 'plain'}:"
                f"n{len(cn_stack)}:{paths_key}"
            )
            if self._controlnet_key != cn_key or self._controlnet_model is None:
                names = "+".join(Path(e["path"]).name for e in cn_stack)
                print(
                    f"[diffusers] loading Qwen ControlNet stack ({len(cn_stack)}): {names}",
                    flush=True,
                )

                def _load_one_qwen_cn(path_str: str, *, mask_variant: bool) -> Any:
                    cn_source = Path(path_str)
                    errors: list[str] = []
                    model = None
                    if cn_source.is_file():
                        try:
                            model = QwenImageControlNetModel.from_single_file(
                                str(cn_source), torch_dtype=torch.bfloat16
                            )
                        except Exception as exc:
                            errors.append(f"from_single_file: {exc}")
                    if model is None:
                        repo_dir = cn_source.parent if cn_source.is_file() else cn_source
                        try:
                            model = QwenImageControlNetModel.from_pretrained(
                                str(repo_dir), torch_dtype=torch.bfloat16
                            )
                        except Exception as exc:
                            errors.append(f"from_pretrained: {exc}")
                    if model is None:
                        hub_id = (
                            "InstantX/Qwen-Image-ControlNet-Inpainting"
                            if mask_variant
                            else "InstantX/Qwen-Image-ControlNet-Union"
                        )
                        try:
                            model = _load_via_hub_config_local_weights(
                                QwenImageControlNetModel,
                                hub_id,
                                str(cn_source),
                                torch.bfloat16,
                            )
                        except Exception as exc:
                            errors.append(f"hub-config+local-weights: {exc}")
                    if model is None:
                        raise RuntimeError(
                            f"Could not load Qwen ControlNet from {path_str}: "
                            + "; ".join(errors)
                        )
                    return model

                if is_multi:
                    models = [
                        _load_one_qwen_cn(str(e["path"]), mask_variant=False)
                        for e in cn_stack
                    ]
                    self._controlnet_model = QwenImageMultiControlNetModel(models)
                else:
                    self._controlnet_model = _load_one_qwen_cn(
                        str(cn_stack[0]["path"]), mask_variant=expects_mask
                    )
                self._controlnet_key = cn_key
            _te_before_cn = getattr(pipe, "text_encoder", None)
            print(
                f"[diffusers] TE dtype before controlnet from_pipe: "
                f"{next(_te_before_cn.parameters()).dtype if _te_before_cn is not None else None}",
                flush=True,
            )
            if expects_mask:
                cn_pipe = QwenImageControlNetInpaintPipeline.from_pipe(
                    pipe, controlnet=self._controlnet_model
                )
            else:
                cn_pipe = QwenImageControlNetPipeline.from_pipe(
                    pipe, controlnet=self._controlnet_model
                )
            self._restore_pipe_component_dtype(cn_pipe, dtype)
            _te_after_cn = getattr(cn_pipe, "text_encoder", None)
            print(
                f"[diffusers] TE dtype after controlnet from_pipe: "
                f"{next(_te_after_cn.parameters()).dtype if _te_after_cn is not None else None}",
                flush=True,
            )

            # Same VRAM choreography as the main Qwen txt2img/img2img path
            # below: park the DiT fully before loading the 7B text encoder
            # so it actually fits, encode via embeds, park TE back off, then
            # place the DiT for denoise.
            te = getattr(cn_pipe, "text_encoder", None)
            transformer = getattr(cn_pipe, "transformer", None)
            vae = getattr(cn_pipe, "vae", None)
            controlnet_module = getattr(cn_pipe, "controlnet", None)
            if vae is not None:
                try:
                    vae.to("cpu")
                except Exception:
                    pass
            if transformer is not None:
                self._force_module_cpu(transformer)
                self._unet_resident = False
            if controlnet_module is not None:
                self._force_module_cpu(controlnet_module)
            self._empty_cuda()
            _own_alloc_mb = torch.cuda.memory_allocated() / (1024.0 * 1024.0)
            _own_reserved_mb = torch.cuda.memory_reserved() / (1024.0 * 1024.0)
            print(
                f"[diffusers] pre-TE VRAM free≈{self._cuda_free_mb():.0f}MiB "
                f"(DiT cuda≈{self._cuda_param_mb(transformer):.0f}MiB, "
                f"controlnet cuda≈{self._cuda_param_mb(controlnet_module):.0f}MiB, "
                f"this-process allocated≈{_own_alloc_mb:.0f}MiB "
                f"reserved≈{_own_reserved_mb:.0f}MiB)",
                flush=True,
            )

            if te is None or not hasattr(cn_pipe, "encode_prompt"):
                raise RuntimeError(
                    "Qwen ControlNet pipeline has no text_encoder/"
                    "encode_prompt to place onto the GPU by hand — can't "
                    "safely run the embed path this VRAM budget needs."
                )
            try:
                self._bulk_module_to_cuda(te, torch.device("cuda"))
                prompt_embeds, prompt_embeds_mask = cn_pipe.encode_prompt(
                    prompt=shaped_prompt,
                    device=torch.device("cuda"),
                    num_images_per_prompt=1,
                )
                negative_prompt_embeds = None
                negative_prompt_embeds_mask = None
                if shaped_negative.strip() and cfg > 1.01:
                    negative_prompt_embeds, negative_prompt_embeds_mask = (
                        cn_pipe.encode_prompt(
                            prompt=shaped_negative,
                            device=torch.device("cuda"),
                            num_images_per_prompt=1,
                        )
                    )
            finally:
                self._force_module_cpu(te)
                self._empty_cuda()

            cn_pipe = self._place_compiled_pipe(
                cn_pipe,
                torch.bfloat16,
                prefer_offload=True,
                pixel_count=max(1, int(gen_width) * int(gen_height)),
            )

            control_maps: Any = control_images if is_multi else control_images[0]
            scale_arg: float | list[float] = strengths if is_multi else strengths[0]
            cn_kwargs: dict[str, Any] = {
                "prompt_embeds": prompt_embeds,
                "control_image": control_maps,
                "controlnet_conditioning_scale": scale_arg,
                "width": gen_width,
                "height": gen_height,
                "num_inference_steps": step_count,
                "generator": generator,
            }
            if control_mask is not None:
                cn_kwargs["control_mask"] = control_mask
            if prompt_embeds_mask is not None:
                cn_kwargs["prompt_embeds_mask"] = prompt_embeds_mask
            if negative_prompt_embeds is not None:
                cn_kwargs["negative_prompt_embeds"] = negative_prompt_embeds
                if negative_prompt_embeds_mask is not None:
                    cn_kwargs["negative_prompt_embeds_mask"] = (
                        negative_prompt_embeds_mask
                    )

            try:
                import inspect

                sig = inspect.signature(cn_pipe.__call__)
                if "true_cfg_scale" in sig.parameters:
                    cn_kwargs["true_cfg_scale"] = cfg
                elif "guidance_scale" in sig.parameters:
                    cn_kwargs["guidance_scale"] = cfg
                if "callback_on_step_end" in sig.parameters:
                    cn_kwargs["callback_on_step_end"] = callback_on_step_end
            except Exception:
                cn_kwargs.setdefault("true_cfg_scale", cfg)
                if callback_on_step_end is not None:
                    cn_kwargs.setdefault("callback_on_step_end", callback_on_step_end)

            mode_label = (
                "controlnet+inpaint"
                if expects_mask
                else f"controlnet({'+'.join(preprocessors)})"
            )
            if is_multi:
                mode_label = f"multi-{mode_label}"
            cn_names = "+".join(Path(e["path"]).name for e in cn_stack)
            print(
                f"[diffusers] compiled-qwen {mode_label} "
                f"model={Path(model_path).name} cn={cn_names} "
                f"{gen_width}x{gen_height} steps={step_count} cfg={cfg} "
                f"cn_strength={strengths}",
                flush=True,
            )
            try:
                result = cn_pipe(**cn_kwargs)
                return result.images[0]
            except Exception:
                try:
                    self._release_pipe()
                except Exception:
                    pass
                raise
            finally:
                self._empty_cuda()

        # strength / use_img2img / use_inpaint already computed above for CN gating
        init_image: Image.Image | None = None
        mask_image: Image.Image | None = None
        if use_img2img:
            init_image = Image.open(init_image_path).convert("RGB")
            init_image = init_image.resize(
                (gen_width, gen_height), Image.Resampling.LANCZOS
            )
            if use_inpaint:
                mask_image = Image.open(mask_image_path).convert("L")
                mask_image = mask_image.resize(
                    (gen_width, gen_height), Image.Resampling.LANCZOS
                )

            # Unlike Flux's unified pipeline (image/mask_image already in its
            # __call__ signature), QwenImagePipeline is txt2img-only — the
            # signature check below always failed for img2img/inpaint until
            # this swap was added (confirmed via GPU smoke test: "Qwen
            # img2img requires a pipeline that accepts image+strength" fired
            # every time because the plain pipe never had that parameter).
            # from_pipe() reuses every already-loaded component, same as the
            # SDXL/Flux/Qwen ControlNet swaps above.
            _te_before = getattr(pipe, "text_encoder", None)
            print(
                f"[diffusers] TE dtype before img2img/inpaint from_pipe: "
                f"{next(_te_before.parameters()).dtype if _te_before is not None else None}",
                flush=True,
            )
            try:
                if use_inpaint:
                    from diffusers import QwenImageInpaintPipeline

                    pipe = QwenImageInpaintPipeline.from_pipe(pipe)
                else:
                    from diffusers import QwenImageImg2ImgPipeline

                    pipe = QwenImageImg2ImgPipeline.from_pipe(pipe)
                self._restore_pipe_component_dtype(pipe, dtype)
                _te_after = getattr(pipe, "text_encoder", None)
                print(
                    f"[diffusers] TE dtype after img2img/inpaint from_pipe: "
                    f"{next(_te_after.parameters()).dtype if _te_after is not None else None}",
                    flush=True,
                )
            except ImportError:
                pass  # fall back to the plain pipe; the signature check
                # below still raises a clear error rather than a confusing
                # one if this diffusers version truly lacks these classes.

        kwargs: dict[str, Any] = {
            "width": gen_width,
            "height": gen_height,
            "num_inference_steps": step_count,
            "generator": generator,
            "callback_on_step_end": callback_on_step_end,
        }
        if init_image is not None:
            kwargs["image"] = init_image
            kwargs["strength"] = strength
        if mask_image is not None:
            kwargs["mask_image"] = mask_image
        # Qwen-Image uses true_cfg_scale; fall back to guidance_scale if needed.
        try:
            import inspect

            sig = inspect.signature(pipe.__call__)
            if "true_cfg_scale" in sig.parameters:
                kwargs["true_cfg_scale"] = cfg
            else:
                kwargs["guidance_scale"] = cfg
            if init_image is not None and "image" not in sig.parameters:
                raise RuntimeError(
                    "Qwen img2img requires a pipeline that accepts image+strength."
                )
            if mask_image is not None and "mask_image" not in sig.parameters:
                raise RuntimeError(
                    "Qwen inpaint requires a pipeline that accepts mask_image; "
                    "this checkpoint only supports full-image img2img via Diffusers."
                )
        except RuntimeError:
            raise
        except Exception:
            kwargs["true_cfg_scale"] = cfg

        # Comfy order: TE encode → DiT denoise → VAE. Park a resident DiT
        # before TE so the 7B encoder fits; promote DiT back after TE parks.
        import time

        t0 = time.perf_counter()
        used_embeds = False
        _status("Encoding prompt…")
        try:
            te = getattr(pipe, "text_encoder", None)
            transformer = getattr(pipe, "transformer", None)
            vae = getattr(pipe, "vae", None)
            # Only park VAE ahead of the TE encode for pure txt2img. img2img/
            # inpaint needs the VAE resident on GPU to encode init_image
            # inside this same pipe() call (mirrored by the guard below,
            # right before prepare_latents runs) — parking it here and never
            # un-parking it left the VAE running on CPU for the whole call,
            # which is what produced silently-wrong-dtype latents feeding
            # into img_in. See CHANGELOG for the GPU smoke-test trace.
            if vae is not None and init_image is None:
                try:
                    vae.to("cpu")
                except Exception:
                    pass
            # Park DiT before TE (resident or group-offload leftovers) so the
            # 7B encoder owns the card; promote DiT after TE for denoise.
            if transformer is not None:
                print(
                    "[diffusers] parking DiT for TE encode…",
                    flush=True,
                )
                self._force_module_cpu(transformer)
                self._unet_resident = False
            self._empty_cuda()
            _own_alloc_mb = torch.cuda.memory_allocated() / (1024.0 * 1024.0)
            _own_reserved_mb = torch.cuda.memory_reserved() / (1024.0 * 1024.0)
            print(
                f"[diffusers] pre-TE VRAM free≈{self._cuda_free_mb():.0f}MiB "
                f"(DiT cuda≈{self._cuda_param_mb(transformer):.0f}MiB, "
                f"this-process allocated≈{_own_alloc_mb:.0f}MiB "
                f"reserved≈{_own_reserved_mb:.0f}MiB)",
                flush=True,
            )
            if te is not None and hasattr(pipe, "encode_prompt"):
                self._bulk_module_to_cuda(te, torch.device("cuda"))
                _te_alloc_mb = torch.cuda.memory_allocated() / (1024.0 * 1024.0)
                _te_reserved_mb = torch.cuda.memory_reserved() / (1024.0 * 1024.0)
                _te_param_mb = self._cuda_param_mb(te)
                print(
                    f"[diffusers] post-TE-transfer this-process "
                    f"allocated≈{_te_alloc_mb:.0f}MiB reserved≈{_te_reserved_mb:.0f}MiB "
                    f"(TE params≈{_te_param_mb:.0f}MiB, delta over params≈"
                    f"{_te_alloc_mb - _own_alloc_mb - _te_param_mb:.0f}MiB)",
                    flush=True,
                )
                prompt_embeds, prompt_mask = pipe.encode_prompt(
                    prompt=shaped_prompt,
                    device=torch.device("cuda"),
                    num_images_per_prompt=1,
                )
                kwargs["prompt_embeds"] = prompt_embeds
                if prompt_mask is not None:
                    kwargs["prompt_embeds_mask"] = prompt_mask
                # Lightning cfg=1 ignores negatives — skip the second encode.
                if shaped_negative.strip() and cfg > 1.01:
                    neg_embeds, neg_mask = pipe.encode_prompt(
                        prompt=shaped_negative,
                        device=torch.device("cuda"),
                        num_images_per_prompt=1,
                    )
                    kwargs["negative_prompt_embeds"] = neg_embeds
                    if neg_mask is not None:
                        kwargs["negative_prompt_embeds_mask"] = neg_mask
                # Always scrub TE off CUDA — .to("cpu") can leave ~14GiB allocated
                # even when named_parameters() already report cpu.
                self._force_module_cpu(te)
                self._empty_cuda()
                used_embeds = True
                print(
                    f"[diffusers] Qwen TE encode {time.perf_counter() - t0:.1f}s "
                    f"(TE cuda≈{self._cuda_param_mb(te):.0f}MiB "
                    f"free≈{self._cuda_free_mb():.0f}MiB)",
                    flush=True,
                )
        except Exception as exc:
            # Do NOT fall back to prompt= here. That lets the pipeline's own
            # internal encode_prompt() run with the text encoder wherever it
            # was left (often CPU, after an OOM above) — a nominally-bf16
            # module executed on CPU can silently emit float32 output (CPU
            # kernels don't fully cover bf16), which downstream shows up as
            # "mat1 and mat2 must have the same dtype" inside the transformer
            # (img_in) many steps later, far from the real cause. Fail loud
            # with the actual error (usually a CUDA OOM) instead.
            print(f"[diffusers] Qwen embed path failed: {exc}", flush=True)
            try:
                self._force_module_cpu(getattr(pipe, "text_encoder", None))
                self._empty_cuda()
            except Exception:
                pass
            try:
                self._release_pipe()
            except Exception:
                pass
            raise

        # Keep VAE on CPU during DiT denoise for pure txt2img (it isn't
        # touched again until the manual decode below). img2img/inpaint is
        # different: QwenImageImg2ImgPipeline/QwenImageInpaintPipeline needs
        # the VAE to encode init_image INSIDE this same call — parking it to
        # CPU first produced silently-wrong-dtype latents (float32 VAE
        # output never got cast to the bf16 transformer expects) and a
        # "mat1 and mat2 must have the same dtype" crash in img_in, found
        # via GPU smoke test. Leaving VAE on GPU costs some VRAM but is what
        # correctness requires here.
        if init_image is None:
            try:
                self._force_module_cpu(getattr(pipe, "vae", None))
            except Exception:
                pass
        # For img2img/inpaint, VAE placement onto GPU happens further down,
        # right before pipe(**kwargs) — putting it here doesn't stick,
        # because the DiT placement/group-offload logic between here and
        # there unconditionally force-parks VAE back to CPU as a side
        # effect of clearing the card for the transformer (confirmed via
        # GPU smoke test). See the comment at that later placement call.
        kwargs["output_type"] = "latent"

        pixels = int(gen_width) * int(gen_height)
        # After TE park: prefer full DiT residency for Lightning-class speed.
        if used_embeds and not self._unet_resident:
            transformer = getattr(pipe, "transformer", None)
            if transformer is not None:
                # Group-offload may still hold block groups on CUDA — park fully
                # so residency sees ~20GiB free (same card as Comfy's fast path).
                self._force_module_cpu(transformer)
                self._empty_cuda()
                print(
                    f"[diffusers] DiT parked after TE "
                    f"free≈{self._cuda_free_mb():.0f}MiB",
                    flush=True,
                )
                if self._try_unet_resident(pipe, after_te=True):
                    print(
                        "[diffusers] DiT unet-resident after TE (fast denoise)",
                        flush=True,
                    )
                elif GROUP_OFFLOAD:
                    want = int(
                        getattr(self, "_group_offload_blocks", GROUP_OFFLOAD_BLOCKS)
                    )
                    dit_mb = self._module_footprint_mb(transformer)
                    fp8_sized = dit_mb > 0 and dit_mb <= 22000
                    if pixels >= 1152 * 1400:
                        want = min(want, 8 if fp8_sized else 2)
                    elif pixels >= 1024 * 1024:
                        want = min(want, 12 if fp8_sized else 4)
                    self._rearm_qwen_group_offload(
                        pipe, num_blocks=want, pixel_count=pixels
                    )
        elif not self._unet_resident and GROUP_OFFLOAD:
            want = int(getattr(self, "_group_offload_blocks", GROUP_OFFLOAD_BLOCKS))
            dit_mb = self._module_footprint_mb(getattr(pipe, "transformer", None))
            fp8_sized = dit_mb > 0 and dit_mb <= 22000
            if pixels >= 1152 * 1400:
                want = min(want, 8 if fp8_sized else 2)
            elif pixels >= 1024 * 1024:
                want = min(want, 12 if fp8_sized else 4)
            if want < int(getattr(self, "_group_offload_blocks", want)):
                self._rearm_qwen_group_offload(
                    pipe, num_blocks=want, pixel_count=pixels
                )

        if init_image is not None:
            # Last word before pipe(**kwargs): _try_unet_resident()/
            # _rearm_qwen_group_offload() above both unconditionally force
            # VAE back to CPU as part of clearing the card for the DiT
            # (they don't know this is img2img/inpaint and the VAE needs to
            # stay resident) — confirmed via GPU smoke test that the earlier
            # "else: vae.to(cuda)" placement got silently undone by exactly
            # this, reproducing the same "Input type (CUDABFloat16Type) and
            # weight type (CPUBFloat16Type)" crash. Placing it here, after
            # all DiT placement logic has run, is what actually sticks.
            vae_mod = getattr(pipe, "vae", None)
            if vae_mod is not None:
                try:
                    vae_mod.to(device=torch.device("cuda"), dtype=dtype)
                except Exception as exc:
                    print(f"[diffusers] VAE →cuda for img2img/inpaint failed: {exc}", flush=True)

        qwen_mode = (
            "inpaint" if mask_image is not None
            else "img2img" if init_image is not None
            else "txt2img"
        )
        print(
            f"[diffusers] compiled-qwen {qwen_mode} model={Path(model_path).name} "
            f"{gen_width}x{gen_height} steps={step_count} cfg={cfg} "
            + (f"strength={strength:.2f} " if init_image is not None else "")
            + f"loras={len(loras)} embeds={used_embeds} "
            f"place={'unet-resident' if self._unet_resident else 'offload'} "
            f"free≈{self._cuda_free_mb():.0f}MiB",
            flush=True,
        )
        _status(f"Denoising ({step_count} steps)…")
        t_denoise = time.perf_counter()

        def _denoise_latents() -> Any:
            result = pipe(**kwargs)
            return result.images

        latents = None
        try:
            try:
                latents = _denoise_latents()
            except torch.cuda.OutOfMemoryError:
                # Denoise OOM only — never collapse to 1-block thrash on bf16.
                dit_mb = self._module_footprint_mb(getattr(pipe, "transformer", None))
                fp8_sized = dit_mb > 0 and dit_mb <= 22000
                half = max(
                    4 if fp8_sized else 2,
                    int(getattr(self, "_group_offload_blocks", 8) // 2),
                )
                print(
                    f"[diffusers] Qwen denoise OOM — park+retry group_offload "
                    f"blocks={half} (free≈{self._cuda_free_mb():.0f}MiB)",
                    flush=True,
                )
                if not self._rearm_qwen_group_offload(
                    pipe, num_blocks=half, pixel_count=pixels
                ):
                    raise
                if init_image is not None:
                    # _rearm_qwen_group_offload() force-parks VAE to CPU too
                    # (same as the residency logic before the first attempt)
                    # — the retried pipe(**kwargs) call re-runs
                    # prepare_latents() from scratch, which needs VAE back
                    # on GPU to re-encode init_image. Confirmed via GPU
                    # smoke test: without this the retry hits the same
                    # "Input type (CUDABFloat16Type) and weight type
                    # (CPUBFloat16Type)" crash the first fix already solved
                    # for the non-retry path.
                    vae_mod = getattr(pipe, "vae", None)
                    if vae_mod is not None:
                        try:
                            vae_mod.to(device=torch.device("cuda"), dtype=dtype)
                        except Exception as exc:
                            print(
                                f"[diffusers] VAE →cuda retry-placement failed: {exc}",
                                flush=True,
                            )
                latents = _denoise_latents()

            print(
                f"[diffusers] Qwen denoise {time.perf_counter() - t_denoise:.1f}s "
                f"(latent; total {time.perf_counter() - t0:.1f}s)",
                flush=True,
            )
            _status("Decoding latents…")
            return self._decode_qwen_latents(
                pipe,
                latents,
                height=gen_height,
                width=gen_width,
                quality_decode=False,
            )
        except Exception as exc:
            # Device-mismatch / hook corruption — drop pipe; do not reload in-process.
            print(f"[diffusers] Qwen job failed: {exc}", flush=True)
            try:
                self._release_pipe()
            except Exception:
                pass
            raise
        finally:
            try:
                if self._pipe is not None:
                    self._park_te_vae_cpu(self._pipe)
            except Exception:
                pass
            self._empty_cuda()


pipeline_holder = PipelineHolder()
