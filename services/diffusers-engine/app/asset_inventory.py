"""Drop-in Comfy-style asset discovery (checkpoints, UNETs, CLIP, VAE, LoRAs)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.model_resolve import (
    _is_diffusers_dir,
    _looks_like_weight_file,
    _normalize_token,
    comfyui_root,
    local_model_roots,
)


@dataclass(frozen=True)
class AssetFile:
    id: str
    label: str
    kind: str  # single_file | diffusers_dir
    family: str
    path: str
    bucket: str  # checkpoints | diffusion_models | text_encoders | vaes | loras | controlnets


def _comfy_subdir(*parts: str) -> Path | None:
    root = comfyui_root()
    if root is None:
        return None
    path = root.joinpath(*parts)
    return path if path.is_dir() else None


def _service_dir(name: str) -> Path:
    path = Path(__file__).resolve().parents[1] / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def _iter_weight_files(root: Path) -> list[Path]:
    out: list[Path] = []
    try:
        for child in root.iterdir():
            if _looks_like_weight_file(child) or _is_diffusers_dir(child):
                out.append(child)
    except OSError:
        pass
    return out


def _infer_asset_family(name: str) -> str:
    token = _normalize_token(name)
    if "qwen" in token:
        return "qwen"
    if "flux" in token or "klein" in token:
        return "flux"
    if "xl" in token or "realvis" in token or "juggernaut" in token:
        return "sdxl"
    if any(n in token for n in ("sd15", "sd1.5", "dreamshaper", "realisticvision")):
        return "sd15"
    return "other"


def _is_picker_weight(name: str, *, bucket: str) -> bool:
    """Skip obvious non-base weights from Studio pickers."""
    token = _normalize_token(name)
    if bucket != "controlnets" and any(
        n in token for n in ("lora", "controlnet", "ipadapter", "embedding")
    ):
        return False
    if bucket == "checkpoints" and "refiner" in token:
        return False
    if bucket == "checkpoints" and (
        token.endswith("vae") or "_vae" in token or "vae_" in token
    ):
        return False
    return True


def _list_bucket(bucket: str, roots: list[Path], *, family_fn) -> list[AssetFile]:
    found: dict[str, AssetFile] = {}
    for root in roots:
        for child in _iter_weight_files(root):
            if not _is_picker_weight(child.name, bucket=bucket):
                continue
            kind = "diffusers_dir" if _is_diffusers_dir(child) else "single_file"
            entry = AssetFile(
                id=child.name,
                label=child.stem.replace("_", " ") if child.is_file() else child.name,
                kind=kind,
                family=family_fn(child.name),
                path=str(child.resolve()),
                bucket=bucket,
            )
            found.setdefault(entry.id, entry)
    return sorted(found.values(), key=lambda item: item.id.lower())


def list_asset_inventory() -> dict[str, list[AssetFile]]:
    """Full drop-in inventory for Studio pickers (includes Flux/Qwen weights)."""
    checkpoint_roots = [
        p
        for p in (
            _comfy_subdir("models", "checkpoints"),
            _service_dir("checkpoints"),
            *local_model_roots(),
        )
        if p is not None
    ]
    # Dedupe roots while preserving order.
    seen_roots: set[str] = set()
    unique_checkpoint_roots: list[Path] = []
    for root in checkpoint_roots:
        key = str(root.resolve()) if root.exists() else str(root)
        if key in seen_roots:
            continue
        seen_roots.add(key)
        unique_checkpoint_roots.append(root)

    diffusion_roots = [
        p
        for p in (
            _comfy_subdir("models", "diffusion_models"),
            _comfy_subdir("models", "unet"),
            _service_dir("diffusion_models"),
        )
        if p is not None
    ]
    text_roots = [
        p
        for p in (
            _comfy_subdir("models", "text_encoders"),
            _comfy_subdir("models", "clip"),
            _service_dir("text_encoders"),
        )
        if p is not None
    ]
    vae_roots = [
        p
        for p in (
            _comfy_subdir("models", "vae"),
            _service_dir("vae"),
        )
        if p is not None
    ]
    lora_roots = [
        p
        for p in (
            _comfy_subdir("models", "loras"),
            _service_dir("loras"),
        )
        if p is not None
    ]
    controlnet_roots = [
        p
        for p in (
            _comfy_subdir("models", "controlnet"),
            _service_dir("controlnets"),
        )
        if p is not None
    ]
    upscale_roots = [
        p
        for p in (
            _comfy_subdir("models", "upscale_models"),
            _service_dir("upscale_models"),
        )
        if p is not None
    ]

    return {
        "checkpoints": _list_bucket(
            "checkpoints",
            unique_checkpoint_roots,
            family_fn=_infer_asset_family,
        ),
        "diffusion_models": _list_bucket(
            "diffusion_models", diffusion_roots, family_fn=_infer_asset_family
        ),
        "text_encoders": _list_bucket(
            "text_encoders", text_roots, family_fn=lambda n: "other"
        ),
        "vaes": _list_bucket("vaes", vae_roots, family_fn=lambda n: "other"),
        "loras": _list_bucket("loras", lora_roots, family_fn=_infer_asset_family),
        "controlnets": _list_bucket(
            "controlnets", controlnet_roots, family_fn=lambda n: "other"
        ),
        "upscale_models": _list_bucket(
            "upscale_models", upscale_roots, family_fn=lambda n: "other"
        ),
    }


def resolve_asset_file(name: str, *buckets: str) -> Path | None:
    """Resolve a filename from one or more inventory buckets."""
    needle = Path(name).name
    if not needle or needle.startswith("{{"):
        return None
    inventory = list_asset_inventory()
    search = buckets or (
        "checkpoints",
        "diffusion_models",
        "text_encoders",
        "vaes",
        "loras",
    )
    for bucket in search:
        for item in inventory.get(bucket, []):
            if item.id == needle or Path(item.id).stem == Path(needle).stem:
                path = Path(item.path)
                if path.exists():
                    return path
    # Fallback: scan all local model roots by name.
    for root in local_model_roots():
        direct = root / needle
        if direct.exists():
            return direct.resolve()
    return None


def first_existing_asset(*names: str, buckets: tuple[str, ...] = ()) -> str | None:
    """Return the first filename that resolves under the given buckets."""
    for name in names:
        if resolve_asset_file(name, *(buckets or ("text_encoders", "clip", "vaes"))) is not None:
            return Path(name).name
    return None


def infer_native_family(model_name: str | None) -> str | None:
    """Return 'flux' / 'qwen' when txt2img should use native compiled paths."""
    token = _normalize_token(model_name or "")
    if not token:
        return None
    if "qwen" in token:
        return "qwen"
    if "flux" in token or "klein" in token:
        return "flux"
    return None


def default_flux_txt2img_stack(unet_name: str) -> dict[str, str | None]:
    """Pick drop-in TE/VAE names for Flux / Flux2-Klein txt2img (no Comfy graph)."""
    from app.dropin_loaders import is_flux_klein_unet

    if is_flux_klein_unet(unet_name):
        # Klein 9B txt_in expects 12288 (= 3×4096 Qwen3-8B stacked layers).
        # Klein 4B expects 7680 (= 3×2560 Qwen3-4B). Mismatch → matmul errors.
        token = unet_name.lower().replace("_", "-")
        if "4b" in token:
            clip = first_existing_asset(
                "qwen_3_4b.safetensors",
                "qwen3-4b-heretic.safetensors",
                buckets=("text_encoders", "clip"),
            )
        else:
            clip = first_existing_asset(
                "flux2-klein-9b-base.safetensors",
                "flux2-klein-9b-uncensored.safetensors",
                "qwen_3_8b.safetensors",
                buckets=("text_encoders", "clip"),
            )
            if clip is None:
                raise FileNotFoundError(
                    "Flux2-Klein 9B needs an 8B-class TE in models/text_encoders "
                    "(flux2-klein-9b-base.safetensors or qwen_3_8b*.safetensors). "
                    "qwen_3_4b produces 7680-d embeds; 9B expects 12288."
                )
        vae = first_existing_asset(
            "flux2-vae.safetensors",
            "FLUX.2-klein-9B.safetensors",
            buckets=("vaes",),
        )
        return {
            "clip": clip,
            "clip2": None,
            "clip_type": "flux2",
            "vae": vae,
        }

    clip = first_existing_asset("clip_l.safetensors", buckets=("text_encoders", "clip"))
    clip2 = first_existing_asset(
        "t5xxl_fp8_e4m3fn_scaled.safetensors",
        "t5xxl_fp16.safetensors",
        buckets=("text_encoders", "clip"),
    )
    vae = first_existing_asset(
        "ae.safetensors",
        "flux_vae.safetensors",
        buckets=("vaes",),
    )
    return {
        "clip": clip,
        "clip2": clip2,
        "clip_type": "flux",
        "vae": vae,
    }


def default_qwen_txt2img_stack(model_name: str) -> dict[str, str | None | bool]:
    """Pick drop-in TE/VAE for native Qwen txt2img (no Comfy graph)."""
    from app.dropin_loaders import is_rapid_aio_name

    if is_rapid_aio_name(model_name):
        return {"clip": None, "vae": None, "is_rapid_aio": True}

    clip = first_existing_asset(
        "qwen_2.5_vl_7b.safetensors",
        "Qwen2.5-VL-7B-Instruct-Ablit.safetensors",
        "qwen_2.5_vl_7b_fp8_scaled.safetensors",
        buckets=("text_encoders", "clip"),
    )
    vae = first_existing_asset(
        "qwen_image_vae.safetensors",
        buckets=("vaes",),
    )
    return {"clip": clip, "vae": vae, "is_rapid_aio": False}


def describe_asset_search_paths() -> list[str]:
    paths = [str(p) for p in local_model_roots()]
    for rel in (
        ("models", "vae"),
        ("models", "loras"),
        ("models", "text_encoders"),
        ("models", "clip"),
        ("models", "diffusion_models"),
    ):
        path = _comfy_subdir(*rel)
        if path is not None:
            paths.append(str(path))
    for name in ("vae", "loras", "text_encoders", "diffusion_models", "checkpoints"):
        paths.append(str(_service_dir(name)))
    # Dedupe preserve order
    seen: set[str] = set()
    out: list[str] = []
    for path in paths:
        if path not in seen:
            seen.add(path)
            out.append(path)
    return out
