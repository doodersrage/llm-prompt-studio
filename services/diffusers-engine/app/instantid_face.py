"""InsightFace helpers for InstantID (antelopev2 preferred)."""

from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image

_face_app: Any = None


def get_face_analysis() -> Any:
    """Lazy-load InsightFace antelopev2 (falls back to buffalo_l)."""
    global _face_app
    if _face_app is not None:
        return _face_app
    try:
        from insightface.app import FaceAnalysis
    except ImportError as exc:
        raise RuntimeError(
            "InstantID needs insightface — pip install insightface onnxruntime "
            "in the Diffusers engine venv."
        ) from exc

    for name in ("antelopev2", "buffalo_l"):
        try:
            app = FaceAnalysis(
                name=name,
                root="~/.insightface",
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
            )
            import torch

            ctx = 0 if torch.cuda.is_available() else -1
            app.prepare(ctx_id=ctx, det_size=(640, 640))
            _face_app = app
            print(f"[diffusers] InsightFace ready ({name})", flush=True)
            return _face_app
        except Exception as exc:
            print(f"[diffusers] InsightFace {name} failed: {exc}", flush=True)
            continue
    raise RuntimeError(
        "Could not load InsightFace antelopev2 or buffalo_l for InstantID."
    )


def extract_face_embedding_and_kps(
    image: Image.Image,
) -> tuple[np.ndarray, Image.Image]:
    """Return (512-d embedding, keypoints RGB map) for InstantID."""
    import cv2
    from app.pipeline_stable_diffusion_xl_instantid import draw_kps

    app = get_face_analysis()
    rgb = np.array(image.convert("RGB"))
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    faces = app.get(bgr)
    if not faces:
        raise RuntimeError("InstantID: no face detected in the reference image.")
    # Largest face by bbox area.
    face = max(
        faces,
        key=lambda f: float(
            (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])
        ),
    )
    embedding = np.asarray(face.embedding, dtype=np.float32)
    kps = draw_kps(image.convert("RGB"), face.kps)
    return embedding, kps
