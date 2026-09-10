"""Local ControlNet preprocessing (no ComfyUI custom nodes required).

Only Canny is implemented — it's a cheap, dependency-light edge filter
(opencv-python is already a hard requirement for image IO elsewhere in the
stack). Pose/depth preprocessors (DWPose, DepthAnythingV2) need extra model
weights and stay routed to ComfyUI; see comfy_graph._ALWAYS_UNSUPPORTED.
"""

from __future__ import annotations

import numpy as np
from PIL import Image


def canny(image: Image.Image, low_threshold: int = 100, high_threshold: int = 200) -> Image.Image:
    """Comfy's CannyEdgePreprocessor equivalent: RGB in, RGB edge map out."""
    import cv2

    rgb = np.array(image.convert("RGB"))
    edges = cv2.Canny(rgb, int(low_threshold), int(high_threshold))
    edges_rgb = np.stack([edges, edges, edges], axis=-1)
    return Image.fromarray(edges_rgb)
