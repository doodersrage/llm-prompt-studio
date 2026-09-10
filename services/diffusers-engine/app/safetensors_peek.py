"""Peek at a .safetensors header without the safetensors/torch packages.

The format is trivial to parse without dependencies: an 8-byte little-endian
length prefix followed by a JSON header describing every tensor's name,
shape, and dtype (never the tensor bytes themselves). Used to tell apart
checkpoint *architectures* that share a file extension but need different
diffusers pipeline classes — e.g. a plain single-task SDXL ControlNet vs. a
xinsir-style "Union" ControlNet, or a diffusers-native Flux ControlNet vs. an
XLabs-style one diffusers can't load directly — before committing to a torch
load that would otherwise fail deep inside model construction with a
confusing error, or silently drop unexpected keys.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path


def read_safetensors_header(path: str | Path) -> dict:
    """Tensor name -> {shape, dtype, ...} (no __metadata__). {} if unreadable."""
    try:
        with open(path, "rb") as f:
            n = struct.unpack("<Q", f.read(8))[0]
            if n <= 0 or n > 100_000_000:
                return {}
            header = json.loads(f.read(n))
    except (OSError, ValueError, json.JSONDecodeError, struct.error):
        return {}
    if not isinstance(header, dict):
        return {}
    header.pop("__metadata__", None)
    return header


def sdxl_controlnet_is_union(path: str | Path) -> bool:
    """xinsir/controlnet-union-sdxl-style checkpoints add task_embedding /
    control_add_embedding tensors that plain ControlNetModel doesn't have —
    those need ControlNetUnionModel + the Union pipeline + a control_mode."""
    header = read_safetensors_header(path)
    return any(
        k.startswith("task_embedding") or k.startswith("control_add_embedding")
        for k in header
    )


def flux_controlnet_mode_count(path: str | Path) -> int | None:
    """Number of control modes if this is a union/multi-mode Flux ControlNet
    (has controlnet_mode_embedder), else None for a single-task checkpoint."""
    header = read_safetensors_header(path)
    entry = header.get("controlnet_mode_embedder.weight")
    shape = entry.get("shape") if isinstance(entry, dict) else None
    if isinstance(shape, list) and len(shape) == 2:
        return int(shape[0])
    return None


def looks_like_diffusers_flux_controlnet(path: str | Path) -> bool:
    """diffusers' FluxControlNetModel expects diffusers-native key names
    (x_embedder / transformer_blocks / controlnet_blocks). XLabs-style Flux
    ControlNets (double_blocks / img_in / input_hint_block) are a different
    architecture diffusers can't load via from_single_file. Returns True
    (benefit of the doubt) when the header can't be read at all — let the
    real loader raise its own error rather than blocking on a guess."""
    header = read_safetensors_header(path)
    if not header:
        return True
    prefixes = {k.split(".")[0] for k in header}
    if "double_blocks" in prefixes or "input_hint_block" in prefixes:
        return False
    return True


def looks_like_diffusers_qwen_controlnet(path: str | Path) -> bool:
    """diffusers' QwenImageControlNetModel expects diffusers-native key names
    (controlnet_x_embedder / transformer_blocks / txt_in / plain
    controlnet_blocks.N.{weight,bias}). DiffSynth-Studio's Qwen ControlNet
    "model patch" checkpoints use a different forward-hook architecture
    (controlnet_blocks.N.{input_proj,output_proj,x_rms,y_rms}, no
    controlnet_x_embedder or transformer_blocks) that diffusers can't load
    via from_single_file. Returns True (benefit of the doubt) when the
    header can't be read at all — let the real loader raise its own error
    rather than blocking on a guess."""
    header = read_safetensors_header(path)
    if not header:
        return True
    prefixes = {k.split(".")[0] for k in header}
    if "controlnet_x_embedder" not in prefixes or "transformer_blocks" not in prefixes:
        return False
    if any(
        ".input_proj." in k or ".x_rms." in k or ".y_rms." in k
        for k in header
        if k.startswith("controlnet_blocks.")
    ):
        return False
    return True


def qwen_controlnet_expects_mask(path: str | Path) -> bool:
    """InstantX's Qwen-Image-ControlNet-Inpainting variant widens
    controlnet_x_embedder to take 4 extra mask channels beyond img_in's
    width (68 vs 64) — the diffusers call signature for feeding those extra
    channels isn't verified here, so callers should reject this variant
    rather than guess at how it gets filled. The plain Union/Canny variant
    matches img_in's width exactly and needs no special handling."""
    header = read_safetensors_header(path)
    x_embed = header.get("controlnet_x_embedder.weight")
    img_in = header.get("img_in.weight")
    x_shape = x_embed.get("shape") if isinstance(x_embed, dict) else None
    img_shape = img_in.get("shape") if isinstance(img_in, dict) else None
    if not (
        isinstance(x_shape, list)
        and len(x_shape) == 2
        and isinstance(img_shape, list)
        and len(img_shape) == 2
    ):
        return False
    return x_shape[1] > img_shape[1]
