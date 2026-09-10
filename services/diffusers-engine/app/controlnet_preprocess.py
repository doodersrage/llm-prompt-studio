"""Local ControlNet preprocessing (no ComfyUI custom nodes required).

Canny stays opencv-only. Pose/depth/lineart/softedge/normal/mlsd use
``controlnet-aux`` detectors with one-time model downloads into the HF cache —
same approach Diffusers examples use. First call for those may be slow while
weights fetch.
"""

from __future__ import annotations

from typing import Literal

import numpy as np
from PIL import Image

ControlnetPreprocessor = Literal[
    "none",
    "canny",
    "openpose",
    "depth",
    "lineart",
    "lineart_anime",
    "softedge",
    "normal",
    "mlsd",
]

# xinsir SDXL Union 6-task taxonomy (also a reasonable default for other Unions).
UNION_CONTROL_MODE: dict[str, int] = {
    "openpose": 0,
    "depth": 1,
    "softedge": 2,
    "canny": 3,
    "lineart": 3,
    "lineart_anime": 3,
    "mlsd": 3,
    "normal": 4,
    "none": 3,
}

# InstantX FLUX.1-dev-Controlnet-Union taxonomy (see model card).
# Lineart/softedge/mlsd/normal have no dedicated buckets — closest is canny (0).
FLUX_UNION_CONTROL_MODE: dict[str, int] = {
    "canny": 0,
    "lineart": 0,
    "lineart_anime": 0,
    "softedge": 0,
    "mlsd": 0,
    "normal": 0,
    "depth": 2,
    "openpose": 4,
    "none": 0,
}

_openpose_detector = None
_depth_detector = None
_lineart_detector = None
_softedge_detector = None
_normal_detector = None
_mlsd_detector = None


def union_control_mode(preprocessor: str) -> int:
    """Map a preprocessor name to xinsir SDXL Union ``control_mode`` bucket."""
    return UNION_CONTROL_MODE.get(preprocessor, 3)


def flux_union_control_mode(preprocessor: str) -> int:
    """Map a preprocessor name to InstantX Flux Union ``control_mode`` bucket."""
    return FLUX_UNION_CONTROL_MODE.get(preprocessor, 0)


def _as_rgb(result: object, size: tuple[int, int]) -> Image.Image:
    if not isinstance(result, Image.Image):
        result = Image.fromarray(np.asarray(result))
    out = result.convert("RGB")
    if out.size != size:
        out = out.resize(size, Image.Resampling.LANCZOS)
    return out


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

    rgb = image.convert("RGB")
    if _openpose_detector is None:
        print("[diffusers] loading OpenPose detector (first run may download)…", flush=True)
        _openpose_detector = OpenposeDetector.from_pretrained("lllyasviel/ControlNet")
    return _as_rgb(_openpose_detector(rgb), rgb.size)


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

    rgb = image.convert("RGB")
    if _depth_detector is None:
        print("[diffusers] loading MiDaS depth detector (first run may download)…", flush=True)
        _depth_detector = MidasDetector.from_pretrained("lllyasviel/Annotators")
    return _as_rgb(_depth_detector(rgb), rgb.size)


def lineart(image: Image.Image, *, anime: bool = False) -> Image.Image:
    """Comfy LineArtPreprocessor / AnimeLineArtPreprocessor via controlnet-aux."""
    global _lineart_detector
    try:
        from controlnet_aux import LineartDetector
    except ImportError as exc:
        raise RuntimeError(
            "Lineart ControlNet needs controlnet-aux — "
            "pip install controlnet-aux in the Diffusers engine venv."
        ) from exc

    rgb = image.convert("RGB")
    if _lineart_detector is None:
        print("[diffusers] loading Lineart detector (first run may download)…", flush=True)
        _lineart_detector = LineartDetector.from_pretrained("lllyasviel/Annotators")
    return _as_rgb(_lineart_detector(rgb, coarse=anime), rgb.size)


def softedge(image: Image.Image) -> Image.Image:
    """Comfy SoftEdge / HED / PiDiNet soft-edge map via controlnet-aux HED."""
    global _softedge_detector
    try:
        from controlnet_aux import HEDdetector
    except ImportError as exc:
        raise RuntimeError(
            "Soft-edge ControlNet needs controlnet-aux — "
            "pip install controlnet-aux in the Diffusers engine venv."
        ) from exc

    rgb = image.convert("RGB")
    if _softedge_detector is None:
        print("[diffusers] loading HED soft-edge detector (first run may download)…", flush=True)
        _softedge_detector = HEDdetector.from_pretrained("lllyasviel/Annotators")
    return _as_rgb(_softedge_detector(rgb), rgb.size)


def normal(image: Image.Image) -> Image.Image:
    """Comfy BAE-NormalMapPreprocessor via controlnet-aux NormalBae."""
    global _normal_detector
    try:
        from controlnet_aux import NormalBaeDetector
    except ImportError as exc:
        raise RuntimeError(
            "Normal-map ControlNet needs controlnet-aux — "
            "pip install controlnet-aux in the Diffusers engine venv."
        ) from exc

    rgb = image.convert("RGB")
    if _normal_detector is None:
        print("[diffusers] loading NormalBae detector (first run may download)…", flush=True)
        _normal_detector = NormalBaeDetector.from_pretrained("lllyasviel/Annotators")
    return _as_rgb(_normal_detector(rgb), rgb.size)


def mlsd(image: Image.Image) -> Image.Image:
    """Comfy M-LSDPreprocessor straight-line map via controlnet-aux MLSD."""
    global _mlsd_detector
    try:
        from controlnet_aux import MLSDdetector
    except ImportError as exc:
        raise RuntimeError(
            "MLSD ControlNet needs controlnet-aux — "
            "pip install controlnet-aux in the Diffusers engine venv."
        ) from exc

    rgb = image.convert("RGB")
    if _mlsd_detector is None:
        print("[diffusers] loading MLSD detector (first run may download)…", flush=True)
        _mlsd_detector = MLSDdetector.from_pretrained("lllyasviel/Annotators")
    return _as_rgb(_mlsd_detector(rgb), rgb.size)


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
    if preprocessor == "lineart":
        return lineart(image, anime=False)
    if preprocessor == "lineart_anime":
        return lineart(image, anime=True)
    if preprocessor == "softedge":
        return softedge(image)
    if preprocessor == "normal":
        return normal(image)
    if preprocessor == "mlsd":
        return mlsd(image)
    raise RuntimeError(f"Unknown ControlNet preprocessor: {preprocessor!r}")
