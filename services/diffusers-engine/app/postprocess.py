"""Comfy-parity output polish for native Diffusers jobs.

Mirrors Studio ImageScaleBy Final/Max scales, plus a light anti-moiré blur:
Diffusers Lightning decodes carry a bit more high-frequency screen-door than
Comfy, and plain Lanczos rings that into a visible moiré. Soft Gaussian before
resize (Rapid AIO–style) knocks it down without undoing the size polish.
"""

from __future__ import annotations

import logging
from typing import Literal

from PIL import Image, ImageFilter

logger = logging.getLogger(__name__)

UpscaleMethod = Literal["lanczos", "area", "bilinear", "bicubic"]

_RESAMPLE = {
    "lanczos": Image.Resampling.LANCZOS,
    "area": Image.Resampling.BOX,
    "bilinear": Image.Resampling.BILINEAR,
    "bicubic": Image.Resampling.BICUBIC,
}


def _soft_blur(image: Image.Image, *, sigma: float | None) -> Image.Image:
    if sigma is None or not (float(sigma) > 0.05):
        return image
    # Pillow GaussianBlur radius ≈ σ (matches Comfy ImageBlur soft passes).
    return image.filter(ImageFilter.GaussianBlur(radius=float(sigma)))


def _resize(
    image: Image.Image,
    *,
    scale: float,
    method: str | None,
) -> Image.Image:
    factor = float(scale)
    if not (factor > 1.001):
        return image
    src_w, src_h = image.size
    dst_w = max(1, int(round(src_w * factor)))
    dst_h = max(1, int(round(src_h * factor)))
    if dst_w == src_w and dst_h == src_h:
        return image
    key = (method or "lanczos").strip().lower()
    resample = _RESAMPLE.get(key, Image.Resampling.LANCZOS)
    logger.info(
        "Output upscale %s× %s → %dx%d (%s)",
        factor,
        f"{src_w}x{src_h}",
        dst_w,
        dst_h,
        key if key in _RESAMPLE else "lanczos",
    )
    return image.resize((dst_w, dst_h), resample=resample)


def apply_output_post(
    image: Image.Image,
    *,
    scale: float | None = None,
    method: str | None = "lanczos",
    moire_blur_sigma: float | None = None,
    moire_downscale: float | None = None,
    sharpen: float | None = None,
) -> Image.Image:
    """Anti-moiré soft blur → optional sharpen → size upscale → Max resample."""
    out = image
    if moire_blur_sigma is not None and float(moire_blur_sigma) > 0.05:
        logger.info("Output moiré polish blur σ=%.2f", float(moire_blur_sigma))
        out = _soft_blur(out, sigma=float(moire_blur_sigma))

    if sharpen is not None and float(sharpen) > 0.05:
        # Comfy ImageSharpen.alpha ≈ UnsharpMask percent (radius=2, percent≈100*α).
        percent = int(round(100.0 * float(sharpen)))
        percent = max(1, min(300, percent))
        logger.info("Output sharpen UnsharpMask percent=%d", percent)
        out = out.filter(
            ImageFilter.UnsharpMask(radius=2, percent=percent, threshold=2)
        )

    if scale is not None and float(scale) > 1.001:
        out = _resize(out, scale=float(scale), method=method)

    # Max-only stubborn screen-door: mild bicubic↓ → Lanczos↑ (Rapid AIO Max).
    down = float(moire_downscale) if moire_downscale is not None else 1.0
    if 0.5 < down < 0.999:
        src_w, src_h = out.size
        mid_w = max(1, int(round(src_w * down)))
        mid_h = max(1, int(round(src_h * down)))
        logger.info(
            "Output moiré resample %s → %dx%d → %dx%d",
            f"{src_w}x{src_h}",
            mid_w,
            mid_h,
            src_w,
            src_h,
        )
        out = out.resize((mid_w, mid_h), resample=Image.Resampling.BICUBIC)
        out = out.resize((src_w, src_h), resample=Image.Resampling.LANCZOS)

    return out


def apply_output_upscale(
    image: Image.Image,
    *,
    scale: float | None,
    method: str | None = "lanczos",
) -> Image.Image:
    """Backward-compatible resize-only helper."""
    return apply_output_post(image, scale=scale, method=method)
