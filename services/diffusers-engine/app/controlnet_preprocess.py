"""Local ControlNet preprocessing (no ComfyUI custom nodes required).

Canny stays opencv-only. Pose/depth use ``controlnet-aux`` detectors (OpenPose /
MiDaS) with one-time model downloads into the HF cache — same approach Diffusers
examples use. First call for pose/depth may be slow while weights fetch.
"""

from __future__ import annotations

from typing import Literal

import numpy as np
from PIL import Image

ControlnetPreprocessor = Literal["none", "canny", "openpose", "depth"]

# xinsir SDXL Union 6-task taxonomy (also a reasonable default for other Unions).
UNION_CONTROL_MODE: dict[str, int] = {
    "openpose": 0,
    "depth": 1,
    "canny": 3,
    "none": 3,
}

# InstantX FLUX.1-dev-Controlnet-Union taxonomy (see model card).
FLUX_UNION_CONTROL_MODE: dict[str, int] = {
    "canny": 0,
    "depth": 2,
    "openpose": 4,
    "none": 0,
}

_openpose_detector = None
_depth_detector = None


def union_control_mode(preprocessor: str) -> int:
    """Map a preprocessor name to xinsir SDXL Union ``control_mode`` bucket."""
    return UNION_CONTROL_MODE.get(preprocessor, 3)


def flux_union_control_mode(preprocessor: str) -> int:
    """Map a preprocessor name to InstantX Flux Union ``control_mode`` bucket."""
    return FLUX_UNION_CONTROL_MODE.get(preprocessor, 0)


def canny(image: Image.Image, low_threshold: int = 100, high_threshold: int = 200) -> Image.Image:
    """Comfy's CannyEdgePreprocessor equivalent: RGB in, RGB edge map out."""
    import cv2

    rgb = np.array(image.convert("RGB"))
    edges = cv2.Canny(rgb, int(low_threshold), int(high_threshold))
    edges_rgb = np.stack([edges, edges, edges], axis=-1)
    return Image.fromarray(edges_rgb)


def openpose(image: Image.Image) -> Image.Image:
    """Comfy DWPreprocessor-ish body skeleton map via controlnet-aux OpenPose."""
    global _openpose_detector
    try:
        from controlnet_aux import OpenposeDetector
    except ImportError as exc:
        raise RuntimeError(
            "Pose ControlNet needs controlnet-aux — "
            "pip install controlnet-aux in the Diffusers engine venv."
        ) from exc

    if _openpose_detector is None:
        print("[diffusers] loading OpenPose detector (first run may download)…", flush=True)
        _openpose_detector = OpenposeDetector.from_pretrained("lllyasviel/ControlNet")
    result = _openpose_detector(image.convert("RGB"))
    if not isinstance(result, Image.Image):
        result = Image.fromarray(np.asarray(result))
    return result.convert("RGB")


def depth(image: Image.Image) -> Image.Image:
    """Comfy DepthAnythingV2Preprocessor-ish depth map via controlnet-aux MiDaS."""
    global _depth_detector
    try:
        from controlnet_aux import MidasDetector
    except ImportError as exc:
        raise RuntimeError(
            "Depth ControlNet needs controlnet-aux — "
            "pip install controlnet-aux in the Diffusers engine venv."
        ) from exc

    if _depth_detector is None:
        print("[diffusers] loading MiDaS depth detector (first run may download)…", flush=True)
        _depth_detector = MidasDetector.from_pretrained("lllyasviel/Annotators")
    result = _depth_detector(image.convert("RGB"))
    if not isinstance(result, Image.Image):
        result = Image.fromarray(np.asarray(result))
    return result.convert("RGB")


def apply_controlnet_preprocess(
    image: Image.Image,
    preprocessor: str,
) -> Image.Image:
    """Run the named preprocessor, or return the image unchanged for ``none``."""
    if preprocessor in ("", "none", None):
        return image.convert("RGB")
    if preprocessor == "canny":
        return canny(image)
    if preprocessor == "openpose":
        return openpose(image)
    if preprocessor == "depth":
        return depth(image)
    raise RuntimeError(f"Unknown ControlNet preprocessor: {preprocessor!r}")
