"""Neural ESRGAN / Spandrel upscale for Comfy UpscaleModelLoader parity."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image

_model_cache: dict[str, Any] = {}


def neural_upscale(image: Image.Image, model_path: str | Path) -> Image.Image:
    """Run a Comfy-style ``.pth`` upscale model via Spandrel."""
    import torch
    from spandrel import ImageModelDescriptor, ModelLoader
    from torchvision.transforms.functional import to_pil_image, to_tensor

    path = Path(model_path)
    if not path.is_file():
        raise FileNotFoundError(f"Upscale model not found: {path}")

    key = str(path.resolve())
    descriptor = _model_cache.get(key)
    if descriptor is None:
        print(f"[diffusers] loading upscale model {path.name}…", flush=True)
        loaded = ModelLoader().load_from_file(str(path))
        if not isinstance(loaded, ImageModelDescriptor):
            raise RuntimeError(
                f"{path.name} is not an image upscale model Spandrel can run "
                f"(got {type(loaded)!r})."
            )
        descriptor = loaded.cuda().eval() if torch.cuda.is_available() else loaded.cpu().eval()
        _model_cache[key] = descriptor

    rgb = image.convert("RGB")
    tensor = to_tensor(rgb).unsqueeze(0)
    device = next(descriptor.model.parameters()).device
    dtype = next(descriptor.model.parameters()).dtype
    tensor = tensor.to(device=device, dtype=dtype)
    with torch.inference_mode():
        out = descriptor(tensor)
    out = out.squeeze(0).clamp(0, 1).float().cpu()
    return to_pil_image(out)
