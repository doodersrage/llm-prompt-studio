"""Execute compiled Comfy graphs on Diffusers pipelines."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable

from PIL import Image

from app.asset_inventory import resolve_asset_file
from app.comfy_graph import CompiledWorkflow
from app.pipeline import MOCK_MODE, pipeline_holder

ROOT = Path(__file__).resolve().parents[1]
INPUT_DIR = Path(os.environ.get("DIFFUSERS_INPUT_DIR", str(ROOT / "inputs"))).resolve()


def _resolve_required(name: str | None, *buckets: str) -> str:
    if not name or name.startswith("{{"):
        raise FileNotFoundError(f"Unresolved asset token: {name!r}")
    path = resolve_asset_file(name, *buckets)
    if path is None:
        raise FileNotFoundError(f"Asset not found in drop-in folders: {name}")
    return str(path)


def _resolve_input_image(name: str | None) -> str:
    if not name or name.startswith("{{"):
        raise FileNotFoundError(f"Unresolved input image token: {name!r}")
    needle = Path(name).name
    direct = INPUT_DIR / needle
    if direct.exists():
        return str(direct)
    resolved = resolve_asset_file(needle, "input")
    if resolved is not None and resolved.exists():
        return str(resolved)
    comfy_root = os.environ.get("COMFYUI_ROOT", "").strip()
    if comfy_root:
        for sub in ("input", "output"):
            candidate = Path(comfy_root) / sub / needle
            if candidate.exists():
                return str(candidate.resolve())
    raise FileNotFoundError(f"Input image not found: {name}")


def _apply_output_post(compiled: CompiledWorkflow, image: Image.Image) -> Image.Image:
    """Neural upscale (Spandrel) then Lanczos ImageScaleBy / ImageBlur polish."""
    from app.postprocess import apply_output_post

    out = image
    if compiled.upscale_model:
        from app.neural_upscale import neural_upscale

        model_path = _resolve_required(compiled.upscale_model, "upscale_models")
        out = neural_upscale(out, model_path)
    return apply_output_post(
        out,
        scale=compiled.output_scale if compiled.output_scale > 1.001 else None,
        method="lanczos",
        moire_blur_sigma=compiled.output_blur_radius,
    )


def execute_compiled(
    compiled: CompiledWorkflow,
    *,
    on_step: Callable[[int, int], None] | None = None,
) -> Image.Image:
    if MOCK_MODE:
        image = Image.new("RGB", (compiled.width, compiled.height), (32, 36, 48))
        return _apply_output_post(compiled, image)

    init_image_path = (
        _resolve_input_image(compiled.init_image) if compiled.init_image else None
    )
    mask_image_path = (
        _resolve_input_image(compiled.mask_image) if compiled.mask_image else None
    )

    if compiled.family == "sdxl":
        ckpt = _resolve_required(compiled.checkpoint, "checkpoints")
        loras = []
        for item in compiled.loras:
            path = _resolve_required(item.name, "loras")
            loras.append((path, item.strength))
        controlnet_stack: list[dict[str, Any]] = []
        for item in compiled.controlnets:
            controlnet_stack.append(
                {
                    "path": _resolve_required(item.name, "controlnets"),
                    "image_path": _resolve_input_image(item.image),
                    "preprocessor": item.preprocessor,
                    "strength": item.strength,
                }
            )
        if not controlnet_stack and compiled.controlnet:
            controlnet_stack.append(
                {
                    "path": _resolve_required(compiled.controlnet, "controlnets"),
                    "image_path": _resolve_input_image(compiled.controlnet_image),
                    "preprocessor": compiled.controlnet_preprocessor,
                    "strength": compiled.controlnet_strength,
                }
            )
        primary = controlnet_stack[0] if controlnet_stack else None
        controlnet_path = primary["path"] if primary else None
        controlnet_image_path = primary["image_path"] if primary else None
        ip_adapter_path = None
        if compiled.ip_adapter_model:
            ip_adapter_path = resolve_asset_file(
                compiled.ip_adapter_model, "ipadapters", "controlnets"
            )
            if ip_adapter_path is not None:
                ip_adapter_path = str(ip_adapter_path)
        ip_adapter_image_path = (
            _resolve_input_image(compiled.ip_adapter_image)
            if compiled.ip_adapter_image
            else None
        )
        instantid_path = None
        if compiled.instantid_image:
            instantid_path = resolve_asset_file(
                compiled.instantid_model or "ip-adapter.bin",
                "instantid",
                "ipadapters",
            )
            if instantid_path is None:
                raise FileNotFoundError(
                    "InstantID ip-adapter.bin not found — place InstantX "
                    "InstantID/ip-adapter.bin under models/instantid or "
                    "services/diffusers-engine/instantid/."
                )
            instantid_path = str(instantid_path)
        instantid_image_path = (
            _resolve_input_image(compiled.instantid_image)
            if compiled.instantid_image
            else None
        )
        instantid_controlnet_path = None
        if compiled.instantid_image:
            cn_name = compiled.instantid_controlnet or "InstantID-ControlNet"
            instantid_controlnet_path = resolve_asset_file(cn_name, "controlnets")
            if instantid_controlnet_path is None:
                # Diffusers-dir name from hub drop-in.
                instantid_controlnet_path = resolve_asset_file(
                    "InstantID-ControlNet", "controlnets"
                )
            if instantid_controlnet_path is None:
                raise FileNotFoundError(
                    "InstantID IdentityNet ControlNet not found — place "
                    "InstantX InstantID ControlNetModel under "
                    "controlnets/InstantID-ControlNet/."
                )
            instantid_controlnet_path = str(instantid_controlnet_path)
        image = pipeline_holder.generate_compiled_sdxl(
            checkpoint_path=ckpt,
            vae_name=compiled.vae,
            loras=loras,
            prompt=compiled.positive,
            negative_prompt=compiled.negative,
            width=compiled.width,
            height=compiled.height,
            steps=compiled.steps,
            guidance_scale=compiled.cfg,
            seed=compiled.seed,
            on_step=on_step,
            init_image_path=init_image_path,
            mask_image_path=mask_image_path,
            img2img_mode=compiled.img2img_mode,
            denoise=compiled.denoise,
            controlnet_path=controlnet_path,
            controlnet_image_path=controlnet_image_path,
            controlnet_preprocessor=(
                primary["preprocessor"] if primary else compiled.controlnet_preprocessor
            ),
            controlnet_strength=(
                float(primary["strength"]) if primary else compiled.controlnet_strength
            ),
            controlnet_stack=controlnet_stack or None,
            ip_adapter_path=ip_adapter_path,
            ip_adapter_image_path=ip_adapter_image_path,
            ip_adapter_strength=compiled.ip_adapter_strength,
            instantid_path=instantid_path,
            instantid_image_path=instantid_image_path,
            instantid_strength=compiled.instantid_strength,
            instantid_controlnet_path=instantid_controlnet_path,
        )
        return _apply_output_post(compiled, image)

    if compiled.family == "flux":
        unet = _resolve_required(compiled.unet, "diffusion_models", "checkpoints")
        controlnet_stack: list[dict[str, Any]] = []
        for item in compiled.controlnets:
            controlnet_stack.append(
                {
                    "path": _resolve_required(item.name, "controlnets"),
                    "image_path": _resolve_input_image(item.image),
                    "preprocessor": item.preprocessor,
                    "strength": item.strength,
                }
            )
        if not controlnet_stack and compiled.controlnet:
            controlnet_stack.append(
                {
                    "path": _resolve_required(compiled.controlnet, "controlnets"),
                    "image_path": _resolve_input_image(compiled.controlnet_image),
                    "preprocessor": compiled.controlnet_preprocessor,
                    "strength": compiled.controlnet_strength,
                }
            )
        primary = controlnet_stack[0] if controlnet_stack else None
        controlnet_path = primary["path"] if primary else None
        controlnet_image_path = primary["image_path"] if primary else None
        image = pipeline_holder.generate_compiled_flux(
            unet_path=unet,
            clip_name=compiled.clip,
            clip2_name=compiled.clip2,
            clip_type=compiled.clip_type,
            vae_name=compiled.vae,
            loras=[
                (_resolve_required(item.name, "loras"), item.strength)
                for item in compiled.loras
            ],
            prompt=compiled.positive,
            negative_prompt=compiled.negative,
            width=compiled.width,
            height=compiled.height,
            steps=compiled.steps,
            # FluxGuidance.guidance → Diffusers guidance_scale; KSampler.cfg is
            # usually 1 on Studio UltraReal / Flux.1 scaffolds.
            guidance_scale=(
                compiled.flux_guidance
                if compiled.flux_guidance is not None
                else compiled.cfg
            ),
            seed=compiled.seed,
            max_shift=compiled.flux_max_shift,
            base_shift=compiled.flux_base_shift,
            on_step=on_step,
            init_image_path=init_image_path,
            mask_image_path=mask_image_path,
            img2img_mode=compiled.img2img_mode,
            denoise=compiled.denoise,
            controlnet_path=controlnet_path,
            controlnet_image_path=controlnet_image_path,
            controlnet_preprocessor=(
                primary["preprocessor"] if primary else compiled.controlnet_preprocessor
            ),
            controlnet_strength=(
                float(primary["strength"]) if primary else compiled.controlnet_strength
            ),
            controlnet_stack=controlnet_stack or None,
            reference_image_paths=[
                _resolve_input_image(name) for name in compiled.reference_images
            ]
            if compiled.reference_images
            else None,
        )
        return _apply_output_post(compiled, image)

    if compiled.family == "qwen":
        model_path = None
        if compiled.unet:
            model_path = _resolve_required(compiled.unet, "diffusion_models", "checkpoints")
        elif compiled.checkpoint:
            model_path = _resolve_required(compiled.checkpoint, "checkpoints")
        else:
            raise FileNotFoundError("Qwen workflow missing UNET/checkpoint.")
        controlnet_stack: list[dict[str, Any]] = []
        for item in compiled.controlnets:
            controlnet_stack.append(
                {
                    "path": _resolve_required(item.name, "controlnets"),
                    "image_path": _resolve_input_image(item.image),
                    "preprocessor": item.preprocessor,
                    "strength": item.strength,
                }
            )
        if not controlnet_stack and compiled.controlnet:
            controlnet_stack.append(
                {
                    "path": _resolve_required(compiled.controlnet, "controlnets"),
                    "image_path": _resolve_input_image(compiled.controlnet_image),
                    "preprocessor": compiled.controlnet_preprocessor,
                    "strength": compiled.controlnet_strength,
                }
            )
        primary = controlnet_stack[0] if controlnet_stack else None
        controlnet_path = primary["path"] if primary else None
        controlnet_image_path = primary["image_path"] if primary else None
        image = pipeline_holder.generate_compiled_qwen(
            model_path=model_path,
            clip_name=compiled.clip,
            vae_name=compiled.vae,
            aura_shift=compiled.aura_shift,
            scheduler_name=compiled.scheduler,
            is_rapid_aio=bool(
                compiled.checkpoint
                and "rapid" in compiled.checkpoint.lower()
                and "aio" in compiled.checkpoint.lower()
            ),
            loras=[
                (_resolve_required(item.name, "loras"), item.strength)
                for item in compiled.loras
            ],
            prompt=compiled.positive,
            negative_prompt=compiled.negative,
            width=compiled.width,
            height=compiled.height,
            steps=compiled.steps,
            guidance_scale=compiled.cfg,
            seed=compiled.seed,
            on_step=on_step,
            init_image_path=init_image_path,
            mask_image_path=mask_image_path,
            img2img_mode=compiled.img2img_mode,
            denoise=compiled.denoise,
            controlnet_path=controlnet_path,
            controlnet_image_path=controlnet_image_path,
            controlnet_preprocessor=(
                primary["preprocessor"] if primary else compiled.controlnet_preprocessor
            ),
            controlnet_strength=(
                float(primary["strength"]) if primary else compiled.controlnet_strength
            ),
            controlnet_stack=controlnet_stack or None,
            qwen_edit_mode=compiled.qwen_edit_mode,
            qwen_edit_image_paths=[
                _resolve_input_image(name) for name in compiled.qwen_edit_images
            ]
            if compiled.qwen_edit_images
            else None,
        )
        return _apply_output_post(compiled, image)

    raise RuntimeError(f"Unsupported compiled family: {compiled.family}")


def assets_preview(compiled: CompiledWorkflow | None) -> dict[str, Any]:
    if compiled is None:
        return {}
    return {
        "checkpoint": compiled.checkpoint,
        "unet": compiled.unet,
        "clip": compiled.clip,
        "clip2": compiled.clip2,
        "vae": compiled.vae,
        "loras": [item.name for item in compiled.loras],
        "family": compiled.family,
        "clip_type": compiled.clip_type,
        "aura_shift": compiled.aura_shift,
        "flux_max_shift": compiled.flux_max_shift,
        "flux_base_shift": compiled.flux_base_shift,
        "flux_guidance": compiled.flux_guidance,
        "init_image": compiled.init_image,
        "mask_image": compiled.mask_image,
        "img2img_mode": compiled.img2img_mode,
        "controlnet": compiled.controlnet,
        "controlnet_image": compiled.controlnet_image,
        "controlnet_preprocessor": compiled.controlnet_preprocessor,
        "controlnet_strength": compiled.controlnet_strength,
        "controlnets": [
            {
                "name": item.name,
                "image": item.image,
                "preprocessor": item.preprocessor,
                "strength": item.strength,
            }
            for item in compiled.controlnets
        ],
        "upscale_model": compiled.upscale_model,
        "output_scale": compiled.output_scale,
        "output_blur_radius": compiled.output_blur_radius,
        "ip_adapter_model": compiled.ip_adapter_model,
        "ip_adapter_image": compiled.ip_adapter_image,
        "ip_adapter_strength": compiled.ip_adapter_strength,
        "instantid_model": compiled.instantid_model,
        "instantid_image": compiled.instantid_image,
        "instantid_strength": compiled.instantid_strength,
        "instantid_controlnet": compiled.instantid_controlnet,
        "qwen_edit_mode": compiled.qwen_edit_mode,
        "qwen_edit_images": list(compiled.qwen_edit_images),
        "reference_images": list(compiled.reference_images),
    }
