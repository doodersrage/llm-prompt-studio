from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


WEIGHT_SUFFIXES = (".safetensors", ".ckpt", ".pt", ".pth", ".bin")

# Models that AutoPipeline can typically load from a single Comfy checkpoint.
_DIFFUSERS_FRIENDLY_NEEDLES = ("sdxl", "sd15", "sd1.5", "dreamshaper", "stable-diffusion")

# Studio / Comfy families that usually need graph packs — not single-file Diffusers.
_COMFY_GRAPH_NEEDLES = (
    "flux",
    "qwen",
    "wan",
    "hunyuan",
    "ltx",
    "svd",
    "cosmos",
)


@dataclass(frozen=True)
class ResolvedModel:
    """Where to load weights from."""

    kind: str  # "diffusers_dir" | "single_file" | "hub"
    source: str
    label: str


def _load_dotenv_files() -> None:
    """Best-effort: pull COMFYUI_ROOT from nearby .env files if unset."""
    if os.environ.get("COMFYUI_ROOT", "").strip():
        return
    here = Path(__file__).resolve()
    candidates = [
        here.parents[1] / ".env",
        here.parents[1] / ".env.local",
        here.parents[2] / ".env.local",  # repo root when service lives in services/
        here.parents[3] / ".env.local" if len(here.parents) > 3 else None,
    ]
    for path in candidates:
        if path is None or not path.is_file():
            continue
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                key, _, value = stripped.partition("=")
                key = key.strip()
                if key != "COMFYUI_ROOT":
                    continue
                value = value.strip().strip('"').strip("'")
                if value:
                    os.environ.setdefault("COMFYUI_ROOT", value)
                    return
        except OSError:
            continue


def _default_comfy_candidates() -> list[Path]:
    home = Path.home()
    return [
        Path("/opt/comfyui"),
        Path("/opt/ComfyUI"),
        home / "ComfyUI",
        home / "comfyui",
        Path("/workspace/ComfyUI"),
    ]


def comfyui_root() -> Path | None:
    _load_dotenv_files()
    raw = (
        os.environ.get("COMFYUI_ROOT", "").strip()
        or os.environ.get("DIFFUSERS_COMFYUI_ROOT", "").strip()
    )
    if raw:
        path = Path(raw).expanduser().resolve()
        if path.is_dir():
            return path

    for candidate in _default_comfy_candidates():
        try:
            resolved = candidate.expanduser().resolve()
        except OSError:
            continue
        if (resolved / "models").is_dir():
            os.environ.setdefault("COMFYUI_ROOT", str(resolved))
            return resolved
    return None


# Prefer photoreal finetunes over stock SDXL base when resolving studio aliases.
_PREFERRED_SDXL_CHECKPOINTS = (
    "RealVisXL_V5.0_fp16.safetensors",
    "RealVisXL_V5.0.safetensors",
    "RealVisXL_V5.0_fp16",
    "RealVisXL_V5.0",
    "sd_xl_base_1.0.safetensors",
    "sd_xl_base_1.0",
)


def local_model_roots() -> list[Path]:
    roots: list[Path] = []
    explicit = os.environ.get("DIFFUSERS_MODEL_DIR", "").strip()
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if path.is_dir():
            roots.append(path)
    # Service-local checkpoints (e.g. auto-downloaded RealVisXL).
    service_ckpt = Path(__file__).resolve().parents[1] / "checkpoints"
    if service_ckpt.is_dir():
        roots.append(service_ckpt)
    comfy = comfyui_root()
    if comfy is not None:
        for rel in (
            "models/diffusers",
            "models/checkpoints",
            "models/diffusion_models",
            "models/unet",
        ):
            candidate = comfy / rel
            if candidate.is_dir():
                roots.append(candidate)
    return roots


def _is_diffusers_dir(path: Path) -> bool:
    return path.is_dir() and (path / "model_index.json").is_file()


def _looks_like_weight_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in WEIGHT_SUFFIXES


def _normalize_token(value: str) -> str:
    return (
        value.strip()
        .lower()
        .replace(" ", "")
        .replace("_", "")
        .replace("-", "")
        .replace("/", "")
        .replace(".", "")
    )


def _is_comfy_graph_family(token: str) -> bool:
    return any(needle in token for needle in _COMFY_GRAPH_NEEDLES) and not any(
        needle in token for needle in _DIFFUSERS_FRIENDLY_NEEDLES
    )


def _aliases_for(model: str) -> list[str]:
    """Studio / friendly names → likely local filenames or folder names."""
    raw = model.strip()
    if not raw:
        return []
    aliases = [raw, Path(raw).name]
    token = _normalize_token(raw)

    # Common Prompt Studio model ids → local Comfy filenames.
    alias_map: list[tuple[str, list[str]]] = [
        (
            "realvis",
            [
                "RealVisXL_V5.0_fp16.safetensors",
                "RealVisXL_V5.0.safetensors",
                "RealVisXL_V5.0_fp16",
                "RealVisXL_V5.0",
            ],
        ),
        (
            "sdxl",
            [
                *_PREFERRED_SDXL_CHECKPOINTS,
                "sdxl-turbo",
                "stabilityai/sdxl-turbo",
            ],
        ),
        (
            "sdxlturbo",
            [
                "sdxl-turbo",
                "stabilityai/sdxl-turbo",
                *_PREFERRED_SDXL_CHECKPOINTS,
            ],
        ),
        ("dreamshaper", ["DreamShaper_8_pruned.safetensors", "DreamShaper_8_pruned"]),
        (
            "flux2klein9b",
            [
                "flux-2-klein-9b-distilled.safetensors",
                "flux-2-klein-9b.safetensors",
                "flux-2-klein-9b-fp8.safetensors",
                "flux-2-klein-base-9b.safetensors",
                "flux-2-klein-base-9b",
            ],
        ),
        (
            "flux2klein",
            [
                "flux-2-klein-9b-distilled.safetensors",
                "flux-2-klein-9b.safetensors",
                "flux-2-klein-base-9b.safetensors",
                "flux-2-klein-4b-fp8.safetensors",
                "flux-2-klein-base-9b",
                "flux-2-klein-4b",
            ],
        ),
        ("fluxklein", ["flux-2-klein-9b-distilled.safetensors", "flux-2-klein-9b.safetensors", "flux-2-klein-base-9b"]),
        ("fluxdev", ["flux1-dev.safetensors", "flux1-dev"]),
        ("flux", ["flux1-dev.safetensors", "flux-2-klein-9b-distilled.safetensors", "flux-2-klein-9b.safetensors", "flux-2-klein-base-9b"]),
        (
            "qwenimage2512",
            [
                "qwen_image_2512_fp8_e4m3fn.safetensors",
                "qwen_image_2512_bf16.safetensors",
                "qwen_image_bf16.safetensors",
                "qwen_image_fp8_e4m3fn.safetensors",
            ],
        ),
        (
            "qwenimage",
            [
                "qwen_image_2512_fp8_e4m3fn.safetensors",
                "qwen_image_2512_bf16.safetensors",
                "qwen_image_bf16.safetensors",
                "qwen_image_fp8_e4m3fn.safetensors",
            ],
        ),
        (
            "qwenrapid",
            [
                "Qwen-Rapid-AIO-SFW-v21.safetensors",
                "Qwen-Rapid-AIO-v21.safetensors",
                "Qwen-Rapid-AIO-NSFW-v21.safetensors",
            ],
        ),
        (
            "qwen",
            [
                "qwen_image_2512_fp8_e4m3fn.safetensors",
                "qwen_image_2512_bf16.safetensors",
                "Qwen-Rapid-AIO-SFW-v21.safetensors",
            ],
        ),
    ]
    for needle, names in alias_map:
        if needle in token:
            aliases.extend(names)

    # Dedupe preserving order.
    seen: set[str] = set()
    ordered: list[str] = []
    for entry in aliases:
        key = entry.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(key)
    return ordered


def _match_in_root(root: Path, name: str) -> ResolvedModel | None:
    direct = root / name
    if _is_diffusers_dir(direct):
        return ResolvedModel("diffusers_dir", str(direct), direct.name)
    if _looks_like_weight_file(direct):
        return ResolvedModel("single_file", str(direct), direct.name)

    # Allow name without extension for weight files.
    for suffix in WEIGHT_SUFFIXES:
        candidate = root / f"{name}{suffix}"
        if _looks_like_weight_file(candidate):
            return ResolvedModel("single_file", str(candidate), candidate.name)

    # Case-insensitive / contains match among children.
    needle = _normalize_token(Path(name).stem if "." in Path(name).name else name)
    if not needle:
        return None

    try:
        children = list(root.iterdir())
    except OSError:
        return None

    # Prefer exact normalized stem match, then contains.
    exact: list[Path] = []
    partial: list[Path] = []
    for child in children:
        child_token = _normalize_token(child.stem if child.is_file() else child.name)
        if child_token == needle:
            exact.append(child)
        elif needle in child_token or child_token in needle:
            partial.append(child)

    for child in exact + partial:
        if _is_diffusers_dir(child):
            return ResolvedModel("diffusers_dir", str(child), child.name)
        if _looks_like_weight_file(child):
            return ResolvedModel("single_file", str(child), child.name)
    return None


def _try_preferred_sdxl(roots: list[Path]) -> ResolvedModel | None:
    for alias in _PREFERRED_SDXL_CHECKPOINTS:
        for root in roots:
            if "checkpoints" not in root.parts and "diffusers" not in root.parts:
                continue
            hit = _match_in_root(root, alias)
            if hit is not None:
                return hit
    return None


def resolve_model(model: str, *, default_hub: str) -> ResolvedModel:
    """
    Resolve a studio/HF/local model id.

    Order:
    1. Absolute / relative path on disk
    2. Local DIFFUSERS_MODEL_DIR + COMFYUI_ROOT model folders (auto-detect /opt/comfyui)
    3. Hugging Face hub id (returned as-is for from_pretrained)

    Flux/Qwen aliases resolve to local UNETs/checkpoints — never remapped to SDXL.
    """
    requested = (model or "").strip() or default_hub

    # Explicit filesystem path.
    as_path = Path(requested).expanduser()
    if as_path.exists():
        resolved = as_path.resolve()
        if _is_diffusers_dir(resolved):
            return ResolvedModel("diffusers_dir", str(resolved), resolved.name)
        if _looks_like_weight_file(resolved):
            return ResolvedModel("single_file", str(resolved), resolved.name)

    roots = local_model_roots()
    token = _normalize_token(requested)
    # Explicit SDXL aliases only — do not hijack Flux/Qwen.
    if token in ("sdxl", "sdxlturbo") or "realvis" in token:
        preferred = _try_preferred_sdxl(roots)
        if preferred is not None:
            return preferred

    for alias in _aliases_for(requested):
        # Skip hub-looking aliases until local search finishes for this alias.
        if "/" in alias and not Path(alias).exists():
            continue
        for root in roots:
            hit = _match_in_root(root, alias)
            if hit is not None:
                return hit

    # Hub id (org/name) or leftover default.
    return ResolvedModel("hub", requested, requested)


def describe_search_paths() -> list[str]:
    return [str(path) for path in local_model_roots()]


@dataclass(frozen=True)
class ListedModel:
    """A local checkpoint/folder the Diffusers engine can load for txt2img."""

    id: str
    label: str
    kind: str  # "single_file" | "diffusers_dir"
    family: str  # "sdxl" | "sd15" | "other"
    default: bool = False
    path: str = ""


def _infer_family(name: str) -> str:
    token = _normalize_token(name)
    if "xl" in token or "realvis" in token or "juggernaut" in token:
        return "sdxl"
    if any(n in token for n in ("sd15", "sd1.5", "dreamshaper", "realisticvision")):
        return "sd15"
    return "other"


def _is_listable_checkpoint(name: str) -> bool:
    token = _normalize_token(name)
    if "refiner" in token:
        return False
    if _is_comfy_graph_family(token):
        return False
    # Skip tiny / non-base weights that confuse AutoPipeline.
    if any(n in token for n in ("vae", "lora", "controlnet", "ipadapter")):
        return False
    return True


def list_local_models() -> list[ListedModel]:
    """
    Enumerate Diffusers-friendly local checkpoints (Comfy checkpoints + dirs).

    Prefer unique filenames; mark RealVis as default when present.
    """
    roots = local_model_roots()
    found: dict[str, ListedModel] = {}

    for root in roots:
        try:
            children = list(root.iterdir())
        except OSError:
            continue
        for child in children:
            if _is_diffusers_dir(child):
                if not _is_listable_checkpoint(child.name):
                    continue
                entry = ListedModel(
                    id=child.name,
                    label=child.name,
                    kind="diffusers_dir",
                    family=_infer_family(child.name),
                    path=str(child.resolve()),
                )
                found.setdefault(entry.id, entry)
                continue
            if not _looks_like_weight_file(child):
                continue
            if not _is_listable_checkpoint(child.name):
                continue
            # Prefer checkpoints/ over diffusion_models/ duplicates.
            existing = found.get(child.name)
            if existing is not None and "checkpoints" not in root.parts:
                continue
            entry = ListedModel(
                id=child.name,
                label=child.stem.replace("_", " "),
                kind="single_file",
                family=_infer_family(child.name),
                path=str(child.resolve()),
            )
            found[entry.id] = entry

    preferred = {name.lower(): index for index, name in enumerate(_PREFERRED_SDXL_CHECKPOINTS)}

    def sort_key(item: ListedModel) -> tuple[int, str]:
        rank = preferred.get(item.id.lower(), 1000)
        family_rank = 0 if item.family == "sdxl" else 1 if item.family == "sd15" else 2
        return (family_rank, rank, item.id.lower())

    ordered = sorted(found.values(), key=sort_key)
    if not ordered:
        return []

    default_id = None
    for name in _PREFERRED_SDXL_CHECKPOINTS:
        if name in found:
            default_id = name
            break
    if default_id is None:
        default_id = ordered[0].id

    return [
        ListedModel(
            id=item.id,
            label=item.label,
            kind=item.kind,
            family=item.family,
            default=item.id == default_id,
            path=item.path,
        )
        for item in ordered
    ]


_REFINER_NAMES = (
    "sd_xl_refiner_1.0.safetensors",
    "sd_xl_refiner_1.0",
    "sdxl_refiner.safetensors",
)


def resolve_sdxl_refiner() -> ResolvedModel | None:
    """Locate a local SDXL refiner checkpoint, if present."""
    explicit = os.environ.get("DIFFUSERS_REFINER_PATH", "").strip()
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if _looks_like_weight_file(path):
            return ResolvedModel("single_file", str(path), path.name)
        if _is_diffusers_dir(path):
            return ResolvedModel("diffusers_dir", str(path), path.name)
        return None

    roots = local_model_roots()
    for name in _REFINER_NAMES:
        for root in roots:
            if "checkpoints" not in root.parts and "diffusers" not in root.parts:
                continue
            hit = _match_in_root(root, name)
            if hit is not None:
                return hit
    return None
