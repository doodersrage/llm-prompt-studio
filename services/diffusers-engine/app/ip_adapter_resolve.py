"""IP-Adapter helpers for native Diffusers SDXL identity lock."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from safetensors import safe_open

IpAdapterKind = Literal["classic", "faceid", "unknown"]


def classify_ip_adapter_weights(path: str | Path) -> IpAdapterKind:
    """Sniff a Comfy IP-Adapter safetensors header (no full weight load)."""
    path = Path(path)
    if not path.is_file():
        return "unknown"
    try:
        with safe_open(str(path), framework="pt") as handle:
            keys = list(handle.keys())
    except Exception:
        return "unknown"
    if not keys:
        return "unknown"
    has_ip = any(k.startswith("ip_adapter.") and "to_k_ip" in k for k in keys)
    has_faceid_proj = any("image_proj.mapping_" in k for k in keys)
    if has_faceid_proj:
        return "faceid"
    if has_ip:
        return "classic"
    return "unknown"


def looks_like_classic_ip_adapter_name(name: str | None) -> bool:
    if not name:
        return False
    lower = name.lower()
    if "faceid" in lower or "pulid" in lower:
        return False
    return "ip-adapter" in lower or "ipadapter" in lower


# Preferred Diffusers hub weights when the Comfy file is FaceID-only or missing.
HUB_IP_ADAPTER_REPO = "h94/IP-Adapter"
HUB_IP_ADAPTER_SUBFOLDER = "sdxl_models"
HUB_IP_ADAPTER_WEIGHT = "ip-adapter-plus_sdxl_vit-h.safetensors"
# Slash form: Diffusers must NOT join this under sdxl_models/ (that path
# incorrectly resolves to a ViT-G config in some hub snapshots).
HUB_IP_ADAPTER_IMAGE_ENCODER = "models/image_encoder"


def resolve_sdxl_ip_adapter_load(
    model_path: str | Path | None,
) -> dict[str, Any]:
    """Decide how to call ``pipe.load_ip_adapter`` for an SDXL graph.

    Returns kwargs for ``load_ip_adapter`` plus a ``source`` label for logs.
    FaceID/PuLID Comfy drop-ins are not Diffusers-native — fall back to the
    hub Plus weight so identity lock still works.
    """
    if model_path is not None:
        path = Path(model_path)
        if path.is_file():
            kind = classify_ip_adapter_weights(path)
            if kind == "classic":
                return {
                    "pretrained_model_name_or_path_or_dict": str(path.parent),
                    "subfolder": "",
                    "weight_name": path.name,
                    # Comfy ipadapter/ folders don't ship CLIP Vision — preload
                    # hub ViT-H in _ensure_sdxl_ip_adapter, then pass None.
                    "image_encoder_folder": None,
                    "preload_hub_image_encoder": True,
                    "source": f"local-classic:{path.name}",
                    "kind": "classic",
                }
            if kind == "faceid":
                return {
                    "pretrained_model_name_or_path_or_dict": HUB_IP_ADAPTER_REPO,
                    "subfolder": HUB_IP_ADAPTER_SUBFOLDER,
                    "weight_name": HUB_IP_ADAPTER_WEIGHT,
                    "image_encoder_folder": HUB_IP_ADAPTER_IMAGE_ENCODER,
                    "preload_hub_image_encoder": False,
                    "source": f"hub-plus-fallback-from-faceid:{path.name}",
                    "kind": "classic",
                }

    return {
        "pretrained_model_name_or_path_or_dict": HUB_IP_ADAPTER_REPO,
        "subfolder": HUB_IP_ADAPTER_SUBFOLDER,
        "weight_name": HUB_IP_ADAPTER_WEIGHT,
        "image_encoder_folder": HUB_IP_ADAPTER_IMAGE_ENCODER,
        "preload_hub_image_encoder": False,
        "source": f"hub:{HUB_IP_ADAPTER_WEIGHT}",
        "kind": "classic",
    }
