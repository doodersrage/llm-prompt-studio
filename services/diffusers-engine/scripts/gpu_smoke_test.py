#!/usr/bin/env python3
"""Manual GPU smoke test for the diffusers-engine ControlNet + inpaint work.

NOT part of the unittest suite — it needs torch, CUDA, and real checkpoints
on disk, none of which are available in the sandbox this was written in.
Run it yourself with the project's venv, on the machine with the GPU:

    $DIFFUSERS_VENV/bin/python services/diffusers-engine/scripts/gpu_smoke_test.py [test_name ...]

(or ~/.cache/comfyui-prompt-studio/diffusers-engine/.venv/bin/python, or
services/diffusers-engine/.venv/bin/python — whichever run.sh resolves to
on your machine.)

With no arguments it runs every test below. Pass one or more test names to
run a subset, e.g. just the newest Qwen ControlNet work:

    python scripts/gpu_smoke_test.py qwen_controlnet_union qwen_controlnet_inpaint_variant_txt2img_rejected

Or the newer stills-parity group (FluxGuidance / Klein ReferenceLatent /
Klein inpaint / Qwen Image Edit):

    python scripts/gpu_smoke_test.py new

List names with ``--list``.

Each test calls app.pipeline.pipeline_holder directly — the same functions
workflow_exec.py calls — loads real checkpoints from $COMFYUI_ROOT/models
(default /opt/comfyui/models), runs a short generation (low step count,
modest resolution, just enough to exercise the real code path end to end),
and writes a PNG under services/diffusers-engine/outputs/smoke/ for you to
eyeball. Two tests are negative tests: they assert a RuntimeError is raised
for checkpoints that should be rejected (XLabs Flux ControlNet, the
mask-conditioned Qwen ControlNet-Inpainting variant) rather than silently
mis-loaded.

Loading several large checkpoints back-to-back is slow and VRAM-heavy —
running everything can take a while. Prefer a subset if you just want to
check one thing.
"""

from __future__ import annotations

import os
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # services/diffusers-engine
sys.path.insert(0, str(ROOT))

os.environ.setdefault("COMFYUI_ROOT", "/opt/comfyui")

OUT_DIR = ROOT / "outputs" / "smoke"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MODELS = Path(os.environ["COMFYUI_ROOT"]) / "models"


def _p(*parts: str) -> str:
    path = MODELS.joinpath(*parts)
    if not path.exists():
        raise FileNotFoundError(
            f"Expected checkpoint not found: {path} "
            f"(edit MODELS/COMFYUI_ROOT or the filename in this script if "
            f"your layout differs)"
        )
    return str(path)


def _save(name: str, image) -> None:
    out = OUT_DIR / f"{name}.png"
    image.save(out)
    print(f"  -> saved {out}")


def _cross_control_image(size: int):
    from PIL import Image

    img = Image.new("RGB", (size, size), (255, 255, 255))
    px = img.load()
    mid = size // 2
    for i in range(size):
        px[i, mid] = (0, 0, 0)
        px[mid, i] = (0, 0, 0)
    return img


def test_sdxl_controlnet_union() -> None:
    """SDXL + xinsir Union ControlNet (Canny task bucket). Verifies the
    Union-checkpoint auto-detect routes to ControlNetUnionModel /
    StableDiffusionXLControlNetUnionPipeline instead of silently dropping
    the task-routing tensors a plain ControlNetModel would ignore."""
    from app.pipeline import pipeline_holder

    control_src = OUT_DIR / "sdxl_control_src.png"
    _cross_control_image(512).save(control_src)

    image = pipeline_holder.generate_compiled_sdxl(
        checkpoint_path=_p("checkpoints", "RealVisXL_V5.0_fp16.safetensors"),
        vae_name=None,
        loras=[],
        prompt="a simple red cube on a white background, studio lighting",
        negative_prompt="blurry, low quality",
        width=512,
        height=512,
        steps=8,
        guidance_scale=5.5,
        seed=42,
        init_image_path=None,
        mask_image_path=None,
        img2img_mode="txt2img",
        denoise=1.0,
        controlnet_path=_p("controlnet", "controlnet-union-sdxl-1.0.safetensors"),
        controlnet_image_path=str(control_src),
        controlnet_preprocessor="canny",
        controlnet_strength=0.8,
    )
    _save("sdxl_controlnet_union", image)


def test_flux_controlnet_union() -> None:
    """Flux + InstantX Union ControlNet (control_mode=0 best-effort default —
    check output quality; the task-index mapping isn't verified, only that
    it loads and runs)."""
    from app.pipeline import pipeline_holder

    control_src = OUT_DIR / "flux_control_src.png"
    _cross_control_image(512).save(control_src)

    image = pipeline_holder.generate_compiled_flux(
        unet_path=_p("diffusion_models", "flux1-dev.safetensors"),
        clip_name=_p("text_encoders", "clip_l.safetensors"),
        clip2_name=_p("text_encoders", "t5xxl_fp8_e4m3fn_scaled.safetensors"),
        clip_type="flux",
        vae_name=_p("vae", "ae.safetensors"),
        loras=[],
        prompt="a simple red cube on a white background, studio lighting",
        negative_prompt="",
        width=512,
        height=512,
        steps=8,
        guidance_scale=3.5,
        seed=42,
        max_shift=1.15,
        base_shift=0.5,
        controlnet_path=_p("controlnet", "Instant_flux-union.safetensors"),
        controlnet_image_path=str(control_src),
        controlnet_preprocessor="canny",
        controlnet_strength=0.8,
    )
    _save("flux_controlnet_union", image)


def test_flux_controlnet_xlabs_rejected() -> None:
    """Negative test: flux-openpose.safetensors is XLabs-style and MUST be
    rejected with a clear RuntimeError, not crash deep in a torch load."""
    from app.pipeline import pipeline_holder

    control_src = OUT_DIR / "flux_control_src_xlabs.png"
    _cross_control_image(512).save(control_src)

    try:
        pipeline_holder.generate_compiled_flux(
            unet_path=_p("diffusion_models", "flux1-dev.safetensors"),
            clip_name=_p("text_encoders", "clip_l.safetensors"),
            clip2_name=_p("text_encoders", "t5xxl_fp8_e4m3fn_scaled.safetensors"),
            clip_type="flux",
            vae_name=_p("vae", "ae.safetensors"),
            loras=[],
            prompt="test",
            negative_prompt="",
            width=512,
            height=512,
            steps=4,
            guidance_scale=3.5,
            seed=1,
            max_shift=1.15,
            base_shift=0.5,
            controlnet_path=_p("controlnet", "flux-openpose.safetensors"),
            controlnet_image_path=str(control_src),
            controlnet_preprocessor="canny",
            controlnet_strength=0.8,
        )
    except RuntimeError as exc:
        if "XLabs-style" not in str(exc):
            raise AssertionError(f"rejected for the wrong reason: {exc}") from exc
        print(f"  -> correctly rejected: {exc}")
        return
    raise AssertionError(
        "flux-openpose.safetensors (XLabs-style) was NOT rejected — "
        "this should have raised RuntimeError"
    )


# Qwen smoke tests prefer qwen_2.5_vl_7b.safetensors (bf16) for fidelity.
# Comfy *_fp8_scaled TEs now dequantize via .scale_weight in
# load_qwen25_vl_from_single_file(); point clip_name at the fp8 file to exercise
# that path without a hub bf16 re-download.


def test_qwen_controlnet_union() -> None:
    """Qwen + InstantX Union ControlNet — the newest addition this session."""
    from app.pipeline import pipeline_holder

    control_src = OUT_DIR / "qwen_control_src.png"
    _cross_control_image(768).save(control_src)

    image = pipeline_holder.generate_compiled_qwen(
        model_path=_p("diffusion_models", "qwen_image_fp8_e4m3fn.safetensors"),
        clip_name=_p("text_encoders", "qwen_2.5_vl_7b.safetensors"),
        vae_name=_p("vae", "qwen_image_vae.safetensors"),
        loras=[],
        prompt="a simple red cube on a white background, studio lighting",
        negative_prompt="",
        width=768,
        height=768,
        steps=8,
        guidance_scale=2.5,
        seed=42,
        controlnet_path=_p("controlnet", "Qwen-Image-InstantX-ControlNet-Union.safetensors"),
        controlnet_image_path=str(control_src),
        controlnet_preprocessor="canny",
        controlnet_strength=0.8,
    )
    _save("qwen_controlnet_union", image)


def test_qwen_controlnet_inpaint_variant_txt2img_rejected() -> None:
    """Mask-conditioned Qwen ControlNet-Inpainting must not run as txt2img."""
    from app.pipeline import pipeline_holder

    control_src = OUT_DIR / "qwen_control_src_inpaint_variant.png"
    _cross_control_image(768).save(control_src)

    try:
        pipeline_holder.generate_compiled_qwen(
            model_path=_p("diffusion_models", "qwen_image_fp8_e4m3fn.safetensors"),
            clip_name=_p("text_encoders", "qwen_2.5_vl_7b.safetensors"),
            vae_name=_p("vae", "qwen_image_vae.safetensors"),
            loras=[],
            prompt="test",
            negative_prompt="",
            width=768,
            height=768,
            steps=4,
            guidance_scale=2.5,
            seed=1,
            controlnet_path=_p(
                "controlnet", "Qwen-Image-InstantX-ControlNet-Inpainting.safetensors"
            ),
            controlnet_image_path=str(control_src),
            controlnet_preprocessor="canny",
            controlnet_strength=0.8,
        )
    except RuntimeError as exc:
        if "mask-conditioned" not in str(exc) and "Inpainting variant" not in str(exc):
            raise AssertionError(f"rejected for the wrong reason: {exc}") from exc
        print(f"  -> correctly rejected: {exc}")
        return
    raise AssertionError(
        "Qwen-Image-InstantX-ControlNet-Inpainting.safetensors was NOT "
        "rejected on txt2img — this should have raised RuntimeError"
    )


def test_qwen_controlnet_inpaint() -> None:
    """Positive: mask-conditioned InstantX CN-Inpainting + init/mask."""
    from PIL import Image, ImageDraw
    from app.pipeline import pipeline_holder

    init = Image.new("RGB", (768, 768), (200, 180, 160))
    init_src = OUT_DIR / "qwen_cn_inpaint_init.png"
    init.save(init_src)
    mask = Image.new("L", (768, 768), 0)
    ImageDraw.Draw(mask).ellipse((240, 240, 528, 528), fill=255)
    mask_src = OUT_DIR / "qwen_cn_inpaint_mask.png"
    mask.save(mask_src)

    image = pipeline_holder.generate_compiled_qwen(
        model_path=_p("diffusion_models", "qwen_image_fp8_e4m3fn.safetensors"),
        clip_name=_p("text_encoders", "qwen_2.5_vl_7b.safetensors"),
        vae_name=_p("vae", "qwen_image_vae.safetensors"),
        loras=[],
        prompt="a glowing blue crystal",
        negative_prompt="",
        width=768,
        height=768,
        steps=8,
        guidance_scale=2.5,
        seed=42,
        init_image_path=str(init_src),
        mask_image_path=str(mask_src),
        img2img_mode="inpaint",
        denoise=0.9,
        controlnet_path=_p(
            "controlnet", "Qwen-Image-InstantX-ControlNet-Inpainting.safetensors"
        ),
        controlnet_image_path=str(init_src),
        controlnet_preprocessor="none",
        controlnet_strength=0.85,
    )
    _save("qwen_controlnet_inpaint", image)


def test_flux_inpaint() -> None:
    """Flux native inpaint (InpaintModelConditioning path)."""
    from PIL import Image, ImageDraw
    from app.pipeline import pipeline_holder

    init = Image.new("RGB", (512, 512), (200, 180, 160))
    init_src = OUT_DIR / "flux_inpaint_init.png"
    init.save(init_src)
    mask = Image.new("L", (512, 512), 0)
    ImageDraw.Draw(mask).ellipse((160, 160, 352, 352), fill=255)
    mask_src = OUT_DIR / "flux_inpaint_mask.png"
    mask.save(mask_src)

    image = pipeline_holder.generate_compiled_flux(
        unet_path=_p("diffusion_models", "flux1-dev.safetensors"),
        clip_name=_p("text_encoders", "clip_l.safetensors"),
        clip2_name=_p("text_encoders", "t5xxl_fp8_e4m3fn_scaled.safetensors"),
        clip_type="flux",
        vae_name=_p("vae", "ae.safetensors"),
        loras=[],
        prompt="a glowing blue crystal",
        negative_prompt="",
        width=512,
        height=512,
        steps=8,
        guidance_scale=3.5,
        seed=42,
        max_shift=1.15,
        base_shift=0.5,
        init_image_path=str(init_src),
        mask_image_path=str(mask_src),
        img2img_mode="inpaint",
        denoise=0.9,
    )
    _save("flux_inpaint", image)


def test_sdxl_controlnet_img2img() -> None:
    """SDXL ControlNet + img2img (Union) — guided edit path."""
    from PIL import Image, ImageDraw
    from app.pipeline import pipeline_holder

    init = Image.new("RGB", (512, 512), (180, 160, 140))
    ImageDraw.Draw(init).rectangle((80, 80, 432, 432), outline=(40, 40, 40), width=8)
    init_src = OUT_DIR / "sdxl_cn_img2img_init.png"
    init.save(init_src)
    control_src = OUT_DIR / "sdxl_cn_img2img_control.png"
    _cross_control_image(512).save(control_src)

    image = pipeline_holder.generate_compiled_sdxl(
        checkpoint_path=_p("checkpoints", "RealVisXL_V5.0_fp16.safetensors"),
        vae_name=None,
        loras=[],
        prompt="a red cube on a wooden table, studio lighting",
        negative_prompt="blurry, low quality",
        width=512,
        height=512,
        steps=8,
        guidance_scale=5.5,
        seed=42,
        init_image_path=str(init_src),
        mask_image_path=None,
        img2img_mode="img2img",
        denoise=0.55,
        controlnet_path=_p("controlnet", "controlnet-union-sdxl-1.0.safetensors"),
        controlnet_image_path=str(control_src),
        controlnet_preprocessor="canny",
        controlnet_strength=0.7,
    )
    _save("sdxl_controlnet_img2img", image)


def test_sdxl_ip_adapter() -> None:
    """SDXL txt2img + IP-Adapter identity lock.

    Local Comfy drop-in is often FaceID/PuLID (``mapping_*`` layout) — the
    engine falls back to hub ``h94/IP-Adapter`` Plus weights. This smoke
    exercises that path end-to-end.
    """
    from PIL import Image, ImageDraw
    from app.pipeline import pipeline_holder

    ref = Image.new("RGB", (512, 512), (210, 180, 160))
    draw = ImageDraw.Draw(ref)
    draw.ellipse((160, 120, 352, 340), fill=(90, 60, 45))
    draw.ellipse((200, 200, 230, 230), fill=(20, 20, 20))
    draw.ellipse((282, 200, 312, 230), fill=(20, 20, 20))
    ref_src = OUT_DIR / "sdxl_ip_adapter_ref.png"
    ref.save(ref_src)

    # Prefer classic Plus if present; else FaceID/PuLID → hub fallback.
    ip_dir = MODELS / "ipadapter"
    classic = ip_dir / "ip-adapter-plus_sdxl_vit-h.safetensors"
    faceid = ip_dir / "ip-adapter_pulid_sdxl_fp16.safetensors"
    if classic.is_file():
        ip_path = str(classic)
    elif faceid.is_file():
        ip_path = str(faceid)
    else:
        ip_path = None

    image = pipeline_holder.generate_compiled_sdxl(
        checkpoint_path=_p("checkpoints", "RealVisXL_V5.0_fp16.safetensors"),
        vae_name=None,
        loras=[],
        prompt="portrait photo of the same person, studio lighting, sharp focus",
        negative_prompt="blurry, low quality, different face",
        width=512,
        height=512,
        steps=8,
        guidance_scale=5.5,
        seed=42,
        init_image_path=None,
        mask_image_path=None,
        img2img_mode="txt2img",
        denoise=1.0,
        ip_adapter_path=ip_path,
        ip_adapter_image_path=str(ref_src),
        ip_adapter_strength=0.7,
    )
    _save("sdxl_ip_adapter", image)


def test_qwen_inpaint() -> None:
    """Qwen native inpaint (InpaintModelConditioning path)."""
    from PIL import Image, ImageDraw
    from app.pipeline import pipeline_holder

    init = Image.new("RGB", (768, 768), (200, 180, 160))
    init_src = OUT_DIR / "qwen_inpaint_init.png"
    init.save(init_src)
    mask = Image.new("L", (768, 768), 0)
    ImageDraw.Draw(mask).ellipse((240, 240, 528, 528), fill=255)
    mask_src = OUT_DIR / "qwen_inpaint_mask.png"
    mask.save(mask_src)

    image = pipeline_holder.generate_compiled_qwen(
        model_path=_p("diffusion_models", "qwen_image_fp8_e4m3fn.safetensors"),
        clip_name=_p("text_encoders", "qwen_2.5_vl_7b.safetensors"),
        vae_name=_p("vae", "qwen_image_vae.safetensors"),
        loras=[],
        prompt="a glowing blue crystal",
        negative_prompt="",
        width=768,
        height=768,
        steps=8,
        guidance_scale=2.5,
        seed=42,
        init_image_path=str(init_src),
        mask_image_path=str(mask_src),
        img2img_mode="inpaint",
        denoise=0.9,
    )
    _save("qwen_inpaint", image)


def _prefer(*rel_candidates: tuple[str, ...]) -> str:
    """First existing path under MODELS; raise with all tried names."""
    tried: list[str] = []
    for parts in rel_candidates:
        path = MODELS.joinpath(*parts)
        tried.append(str(path))
        if path.is_file():
            return str(path)
    raise FileNotFoundError(
        "None of the candidate checkpoints exist:\n  " + "\n  ".join(tried)
    )


def test_flux_guidance() -> None:
    """Classic FLUX.1 with embedded guidance_scale (FluxGuidance → Diffusers).

    Studio UltraReal maps sidebar CFG into FluxGuidance and forces KSampler.cfg=1;
    here we pass guidance_scale=2.5 directly the same way workflow_exec does.
    """
    from app.pipeline import pipeline_holder

    image = pipeline_holder.generate_compiled_flux(
        unet_path=_prefer(
            ("diffusion_models", "flux1-dev.safetensors"),
            ("diffusion_models", "ultrarealFineTune_v4.safetensors"),
        ),
        clip_name=_p("text_encoders", "clip_l.safetensors"),
        clip2_name=_prefer(
            ("text_encoders", "t5xxl_fp8_e4m3fn_scaled.safetensors"),
            ("text_encoders", "t5xxl_fp16.safetensors"),
        ),
        clip_type="flux",
        vae_name=_p("vae", "ae.safetensors"),
        loras=[],
        prompt="a simple red cube on a white background, studio lighting",
        negative_prompt="",
        width=512,
        height=512,
        steps=8,
        guidance_scale=2.5,
        seed=42,
        max_shift=1.15,
        base_shift=0.5,
    )
    _save("flux_guidance", image)


def test_klein_reference_edit() -> None:
    """Flux2-Klein ReferenceLatent instruction edit (Compose/Refine).

    Passes ``reference_image_paths`` into Flux2KleinPipeline(image=…) — not
    strength img2img. Prefers distilled fp8 for VRAM; steps forced to 4/cfg 1.
    """
    from PIL import Image, ImageDraw
    from app.pipeline import pipeline_holder

    ref = Image.new("RGB", (512, 512), (40, 120, 200))
    ImageDraw.Draw(ref).rectangle((120, 120, 392, 392), fill=(220, 60, 40))
    ref_src = OUT_DIR / "klein_ref_figure1.png"
    ref.save(ref_src)

    image = pipeline_holder.generate_compiled_flux(
        unet_path=_prefer(
            ("diffusion_models", "flux-2-klein-9b-distilled.safetensors"),
            ("diffusion_models", "flux-2-klein-9b-fp8.safetensors"),
            ("diffusion_models", "flux-2-klein-4b-fp8.safetensors"),
        ),
        clip_name=_prefer(
            ("text_encoders", "flux2-klein-9b-base.safetensors"),
            ("text_encoders", "qwen_3_8b_fp8mixed.safetensors"),
            ("text_encoders", "qwen_3_4b.safetensors"),
        ),
        clip2_name=None,
        clip_type="flux2",
        vae_name=_prefer(
            ("vae", "flux2-vae.safetensors"),
            ("vae", "FLUX.2-klein-9B.safetensors"),
        ),
        loras=[],
        prompt="replace the red square with a glowing blue crystal, keep the blue background",
        negative_prompt="",
        width=512,
        height=512,
        steps=4,
        guidance_scale=1.0,
        seed=7,
        max_shift=1.15,
        base_shift=0.5,
        reference_image_paths=[str(ref_src)],
    )
    _save("klein_reference_edit", image)


def test_qwen_image_edit() -> None:
    """Qwen Image Edit single-ref (TextEncodeQwenImageEdit → EditPipeline)."""
    from PIL import Image, ImageDraw
    from app.pipeline import pipeline_holder

    ref = Image.new("RGB", (512, 512), (180, 160, 140))
    ImageDraw.Draw(ref).ellipse((128, 128, 384, 384), fill=(60, 100, 180))
    ref_src = OUT_DIR / "qwen_edit_ref.png"
    ref.save(ref_src)

    image = pipeline_holder.generate_compiled_qwen(
        model_path=_prefer(
            ("diffusion_models", "qwen_image_edit_2509_fp8_e4m3fn.safetensors"),
            ("diffusion_models", "qwen_image_edit_2511_bf16.safetensors"),
            ("diffusion_models", "qwen_image_edit_2509_bf16.safetensors"),
        ),
        clip_name=_prefer(
            ("text_encoders", "qwen_2.5_vl_7b_fp8_scaled.safetensors"),
            ("text_encoders", "qwen_2.5_vl_7b.safetensors"),
        ),
        vae_name=_p("vae", "qwen_image_vae.safetensors"),
        loras=[],
        prompt="make the circle a glowing neon green ring",
        negative_prompt="",
        width=512,
        height=512,
        steps=4,
        guidance_scale=1.0,
        seed=11,
        qwen_edit_mode="edit",
        qwen_edit_image_paths=[str(ref_src)],
    )
    _save("qwen_image_edit", image)


def test_klein_inpaint() -> None:
    """Flux2-Klein inpaint via Flux2KleinInpaintPipeline."""
    from PIL import Image, ImageDraw
    from app.pipeline import pipeline_holder

    init = Image.new("RGB", (512, 512), (200, 180, 160))
    init_src = OUT_DIR / "klein_inpaint_init.png"
    init.save(init_src)
    mask = Image.new("L", (512, 512), 0)
    ImageDraw.Draw(mask).ellipse((160, 160, 352, 352), fill=255)
    mask_src = OUT_DIR / "klein_inpaint_mask.png"
    mask.save(mask_src)

    image = pipeline_holder.generate_compiled_flux(
        unet_path=_prefer(
            ("diffusion_models", "flux-2-klein-9b-distilled.safetensors"),
            ("diffusion_models", "flux-2-klein-9b-fp8.safetensors"),
            ("diffusion_models", "flux-2-klein-4b-fp8.safetensors"),
        ),
        clip_name=_prefer(
            ("text_encoders", "flux2-klein-9b-base.safetensors"),
            ("text_encoders", "qwen_3_8b_fp8mixed.safetensors"),
            ("text_encoders", "qwen_3_4b.safetensors"),
        ),
        clip2_name=None,
        clip_type="flux2",
        vae_name=_prefer(
            ("vae", "flux2-vae.safetensors"),
            ("vae", "FLUX.2-klein-9B.safetensors"),
        ),
        loras=[],
        prompt="a glowing blue crystal",
        negative_prompt="",
        width=512,
        height=512,
        steps=4,
        guidance_scale=1.0,
        seed=42,
        max_shift=1.15,
        base_shift=0.5,
        init_image_path=str(init_src),
        mask_image_path=str(mask_src),
        img2img_mode="inpaint",
        denoise=0.85,
    )
    _save("klein_inpaint", image)


TESTS = {
    "sdxl_controlnet_union": test_sdxl_controlnet_union,
    "sdxl_controlnet_img2img": test_sdxl_controlnet_img2img,
    "sdxl_ip_adapter": test_sdxl_ip_adapter,
    "flux_controlnet_union": test_flux_controlnet_union,
    "flux_controlnet_xlabs_rejected": test_flux_controlnet_xlabs_rejected,
    "qwen_controlnet_union": test_qwen_controlnet_union,
    "qwen_controlnet_inpaint_variant_txt2img_rejected": (
        test_qwen_controlnet_inpaint_variant_txt2img_rejected
    ),
    "qwen_controlnet_inpaint": test_qwen_controlnet_inpaint,
    "flux_inpaint": test_flux_inpaint,
    "qwen_inpaint": test_qwen_inpaint,
    # Newer stills-parity paths (ReferenceLatent / FluxGuidance / Edit / Klein).
    "flux_guidance": test_flux_guidance,
    "klein_reference_edit": test_klein_reference_edit,
    "klein_inpaint": test_klein_inpaint,
    "qwen_image_edit": test_qwen_image_edit,
}

# Convenience alias groups for ``python scripts/gpu_smoke_test.py new``.
TEST_GROUPS = {
    "new": [
        "flux_guidance",
        "klein_reference_edit",
        "klein_inpaint",
        "qwen_image_edit",
    ],
}


def main() -> int:
    raw = sys.argv[1:]
    if raw == ["--list"]:
        print("Tests:")
        for name in TESTS:
            print(f"  {name}")
        print("Groups:")
        for name, members in TEST_GROUPS.items():
            print(f"  {name}: {', '.join(members)}")
        return 0

    requested: list[str] = []
    for arg in raw or list(TESTS.keys()):
        if arg in TEST_GROUPS:
            requested.extend(TEST_GROUPS[arg])
        else:
            requested.append(arg)

    unknown = [name for name in requested if name not in TESTS]
    if unknown:
        print(
            f"Unknown test(s): {unknown}\n"
            f"Available: {list(TESTS.keys())}\n"
            f"Groups: {list(TEST_GROUPS.keys())}",
            file=sys.stderr,
        )
        return 2

    results: dict[str, str] = {}
    for name in requested:
        print(f"\n=== {name} ===")
        t0 = time.perf_counter()
        try:
            TESTS[name]()
            results[name] = f"PASS ({time.perf_counter() - t0:.1f}s)"
        except Exception as exc:  # noqa: BLE001 - smoke test, want the traceback
            traceback.print_exc()
            results[name] = f"FAIL: {exc}"

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    ok = True
    for name, status in results.items():
        print(f"  {name}: {status}")
        if not status.startswith("PASS"):
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
