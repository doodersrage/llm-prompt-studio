"""Classify and compile Comfy API-format workflows for native Diffusers execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


Family = Literal["sdxl", "flux", "qwen", "unsupported"]

_LORA_OK = frozenset(
    {
        "LoraLoader",
        "LoraLoaderModelOnly",
        "Power Lora Loader (rgthree)",
    }
)

_IMG2IMG_OK = frozenset({"LoadImage", "VAEEncode"})
_INPAINT_OK = frozenset({"LoadImage", "LoadImageMask", "InpaintModelConditioning", "VAEEncode"})

# Native ControlNet: SDXL, classic Flux (not Flux2-Klein), and Qwen (plain
# Union/Canny checkpoints only, not the mask-conditioned Inpainting variant —
# see safetensors_peek.qwen_controlnet_expects_mask). Canny is opencv-local;
# pose/depth/lineart/softedge/normal/mlsd use controlnet-aux with on-demand
# downloads. Class names match ComfyUI ControlNet Auxiliary Preprocessors /
# Studio's controlnet-workflow-patch candidates.
_CONTROLNET_PREPROCESSOR_OK = frozenset(
    {
        "CannyEdgePreprocessor",
        "Canny",
        "DWPreprocessor",
        "OpenposePreprocessor",
        "DepthAnythingV2Preprocessor",
        "DepthAnythingPreprocessor",
        "MiDaS-DepthMapPreprocessor",
        "LineArtPreprocessor",
        "AnimeLineArtPreprocessor",
        "SoftEdgePreprocessor",
        "HEDPreprocessor",
        "PiDiNetPreprocessor",
        "BAE-NormalMapPreprocessor",
        "NormalBaePreprocessor",
        "M-LSDPreprocessor",
        "MLSDpreprocessor",
    }
)

# Map Comfy preprocessor class → compiled controlnet_preprocessor token.
_PREPROCESSOR_BY_CLASS: dict[str, str] = {
    "CannyEdgePreprocessor": "canny",
    "Canny": "canny",
    "DWPreprocessor": "openpose",
    "OpenposePreprocessor": "openpose",
    "DepthAnythingV2Preprocessor": "depth",
    "DepthAnythingPreprocessor": "depth",
    "MiDaS-DepthMapPreprocessor": "depth",
    "LineArtPreprocessor": "lineart",
    "AnimeLineArtPreprocessor": "lineart_anime",
    "SoftEdgePreprocessor": "softedge",
    "HEDPreprocessor": "softedge",
    "PiDiNetPreprocessor": "softedge",
    "BAE-NormalMapPreprocessor": "normal",
    "NormalBaePreprocessor": "normal",
    "M-LSDPreprocessor": "mlsd",
    "MLSDpreprocessor": "mlsd",
}
_CONTROLNET_OK = frozenset(
    {
        "ControlNetLoader",
        "ControlNetApply",
        "ControlNetApplyAdvanced",
        *_CONTROLNET_PREPROCESSOR_OK,
    }
)

# Post-decode polish nodes (Final/Max enrich). Executed after sampling.
_POST_OK = frozenset(
    {
        "ImageScaleBy",
        "ImageBlur",
        "UpscaleModelLoader",
        "UpscaleModel",
        "ImageUpscaleWithModel",
        "PreviewImage",
    }
)

# SDXL-only native identity lock (Diffusers IPAdapterMixin).
_IPADAPTER_OK = frozenset(
    {
        "IPAdapterModelLoader",
        "IPAdapterAdvanced",
        "CLIPVisionLoader",
    }
)

# SDXL InstantID identity lock (InsightFace + IdentityNet ControlNet + ip-adapter.bin).
_INSTANTID_OK = frozenset(
    {
        "InstantIDModelLoader",
        "InstantIDFaceAnalysis",
        "ApplyInstantID",
        "ApplyInstantIDAdvanced",
    }
)

_SDXL_OK = frozenset(
    {
        "CheckpointLoaderSimple",
        "CheckpointLoader",
        "VAELoader",
        *_LORA_OK,
        *_IMG2IMG_OK,
        *_INPAINT_OK,
        *_CONTROLNET_OK,
        *_POST_OK,
        *_IPADAPTER_OK,
        *_INSTANTID_OK,
        "CLIPTextEncode",
        "EmptyLatentImage",
        "KSampler",
        "VAEDecode",
        "SaveImage",
    }
)

_FLUX_OK = frozenset(
    {
        "UNETLoader",
        "DualCLIPLoader",
        "CLIPLoader",
        "VAELoader",
        "ModelSamplingFlux",
        *_LORA_OK,
        *_IMG2IMG_OK,
        *_INPAINT_OK,
        *_CONTROLNET_OK,
        *_POST_OK,
        "CLIPTextEncode",
        "EmptyLatentImage",
        "KSampler",
        "VAEDecode",
        "SaveImage",
    }
)

_QWEN_OK = frozenset(
    {
        "UNETLoader",
        "CLIPLoader",
        "CheckpointLoaderSimple",
        "CheckpointLoader",
        "VAELoader",
        "ModelSamplingAuraFlow",
        *_LORA_OK,
        *_IMG2IMG_OK,
        *_INPAINT_OK,
        *_CONTROLNET_OK,
        *_POST_OK,
        "CLIPTextEncode",
        "EmptyLatentImage",
        "EmptySD3LatentImage",
        "KSampler",
        "VAEDecode",
        "SaveImage",
    }
)

_ALWAYS_UNSUPPORTED = frozenset(
    {
        "DiffControlNetLoader",
        # PuLID stays Comfy-only (EVA-CLIP + Flux attention hooks).
        # InstantID is native for SDXL — see _INSTANTID_OK.
        "PulidModelLoader",
        "PulidEvaClipLoader",
        "ApplyPulid",
        "ApplyPulidFlux",
        "PulidFluxModelLoader",
        "PulidFluxEvaClipLoader",
        "PulidFluxInsightFaceLoader",
        "FaceDetailer",
        "WanImageToVideo",
        "HunyuanImageToVideo",
        "TextEncodeQwenImageEdit",
        "TextEncodeQwenImageEditPlus",
    }
)


ControlnetPreprocessorName = Literal[
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


@dataclass(frozen=True)
class CompiledLora:
    name: str
    strength: float


@dataclass(frozen=True)
class CompiledControlNet:
    """One ControlNetApply(Advanced) link in the sampler conditioning chain."""

    name: str
    image: str
    preprocessor: ControlnetPreprocessorName = "none"
    strength: float = 1.0


@dataclass(frozen=True)
class CompiledWorkflow:
    family: Family
    positive: str
    negative: str
    width: int
    height: int
    steps: int
    cfg: float
    seed: int
    denoise: float
    sampler_name: str
    scheduler: str
    checkpoint: str | None = None
    unet: str | None = None
    clip: str | None = None
    clip2: str | None = None
    vae: str | None = None
    clip_type: str | None = None
    loras: list[CompiledLora] = field(default_factory=list)
    flux_max_shift: float | None = None
    flux_base_shift: float | None = None
    aura_shift: float | None = None
    init_image: str | None = None
    mask_image: str | None = None
    img2img_mode: Literal["txt2img", "img2img", "inpaint"] = "txt2img"
    # Full ControlNet stack (outermost Apply first). Empty = no ControlNet.
    # Scalar controlnet_* fields mirror controlnets[0] for single-CN callers.
    controlnets: list[CompiledControlNet] = field(default_factory=list)
    controlnet: str | None = None
    controlnet_image: str | None = None
    controlnet_preprocessor: ControlnetPreprocessorName = "none"
    controlnet_strength: float = 1.0
    # Neural ESRGAN / Spandrel model from UpscaleModelLoader (post-decode).
    upscale_model: str | None = None
    # Product of ImageScaleBy factors after decode (1.0 = no Lanczos polish).
    output_scale: float = 1.0
    # Optional ImageBlur radius applied before output_scale (Comfy soft pass).
    output_blur_radius: float | None = None
    # SDXL IP-Adapter identity lock (IPAdapterModelLoader → IPAdapterAdvanced).
    ip_adapter_model: str | None = None
    ip_adapter_image: str | None = None
    ip_adapter_strength: float = 0.5
    # SDXL InstantID identity lock (InstantIDModelLoader → ApplyInstantID).
    instantid_model: str | None = None
    instantid_image: str | None = None
    instantid_strength: float = 0.8
    instantid_controlnet: str | None = None


@dataclass(frozen=True)
class ClassifyResult:
    supported: bool
    family: Family
    reason: str
    unsupported_nodes: list[str] = field(default_factory=list)
    compiled: CompiledWorkflow | None = None


def _nodes(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for node_id, raw in graph.items():
        if not isinstance(raw, dict):
            continue
        class_type = raw.get("class_type")
        if not isinstance(class_type, str):
            continue
        inputs = raw.get("inputs")
        out[str(node_id)] = {
            "class_type": class_type,
            "inputs": inputs if isinstance(inputs, dict) else {},
        }
    return out


def _as_int(value: Any, default: int) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_str(value: Any, default: str = "") -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return default
    return str(value)


def _link_id(value: Any) -> str | None:
    if isinstance(value, (list, tuple)) and value:
        return str(value[0])
    return None


def detect_family(nodes: dict[str, dict[str, Any]]) -> Family:
    types = {node["class_type"] for node in nodes.values()}
    if types & _ALWAYS_UNSUPPORTED:
        return "unsupported"
    if "ModelSamplingFlux" in types or (
        "UNETLoader" in types and "DualCLIPLoader" in types
    ):
        return "flux"
    if "ModelSamplingAuraFlow" in types:
        return "qwen"
    if "UNETLoader" in types and "CLIPLoader" in types:
        # Qwen scaffold uses CLIPLoader type qwen_image; Flux Klein uses CLIPLoader type flux2.
        for node in nodes.values():
            if node["class_type"] != "CLIPLoader":
                continue
            clip_type = _as_str(node["inputs"].get("type")).lower()
            if clip_type == "qwen_image":
                return "qwen"
            if clip_type in ("flux2", "flux"):
                return "flux"
        return "qwen"
    if "CheckpointLoaderSimple" in types or "CheckpointLoader" in types:
        # Rapid-AIO qwen checkpoints still use CheckpointLoaderSimple.
        for node in nodes.values():
            if node["class_type"] not in ("CheckpointLoaderSimple", "CheckpointLoader"):
                continue
            name = _as_str(node["inputs"].get("ckpt_name")).lower()
            if "qwen" in name:
                return "qwen"
        return "sdxl"
    return "unsupported"


def _is_flux_klein(clip_type: str | None, unet: str | None) -> bool:
    """Heuristic match for Flux2-Klein — mirrors dropin_loaders.is_flux_klein_unet
    without importing torch/safetensors (comfy_graph stays dependency-free)."""
    if (clip_type or "").lower() == "flux2":
        return True
    return "klein" in (unet or "").lower()


def _collect_loras(nodes: dict[str, dict[str, Any]]) -> list[CompiledLora]:
    loras: list[CompiledLora] = []
    for node in nodes.values():
        ctype = node["class_type"]
        inputs = node["inputs"]
        if ctype in ("LoraLoader", "LoraLoaderModelOnly"):
            name = _as_str(inputs.get("lora_name")).strip()
            if not name or name.startswith("{{"):
                continue
            strength = _as_float(
                inputs.get("strength_model", inputs.get("strength", 1.0)),
                1.0,
            )
            if abs(strength) < 1e-6:
                continue
            loras.append(CompiledLora(name=name, strength=strength))
            continue
        if ctype != "Power Lora Loader (rgthree)":
            continue
        # rgthree slots: lora_1 → { on, lora, strength }
        for key, value in inputs.items():
            if not str(key).lower().startswith("lora_") or not isinstance(value, dict):
                continue
            if value.get("on") is False:
                continue
            name = _as_str(value.get("lora")).strip()
            if not name or name.startswith("{{"):
                continue
            strength = _as_float(
                value.get("strength", value.get("strength_model", 1.0)),
                1.0,
            )
            if abs(strength) < 1e-6:
                continue
            loras.append(CompiledLora(name=name, strength=strength))
    return loras


def _resolve_load_image_name(
    nodes: dict[str, dict[str, Any]], node_id: str | None
) -> str | None:
    if not node_id:
        return None
    node = nodes.get(node_id)
    if not node or node["class_type"] != "LoadImage":
        return None
    name = _as_str(node["inputs"].get("image")).strip()
    if not name or name.startswith("{{"):
        return None
    return name


def _trace_img2img_assets(
    nodes: dict[str, dict[str, Any]], latent_id: str | None
) -> tuple[str | None, str | None, Literal["txt2img", "img2img", "inpaint"]]:
    if not latent_id:
        return None, None, "txt2img"
    node = nodes.get(latent_id)
    if not node:
        return None, None, "txt2img"

    ctype = node["class_type"]
    inputs = node["inputs"]

    if ctype == "VAEEncode":
        init = _resolve_load_image_name(nodes, _link_id(inputs.get("pixels")))
        if init:
            return init, None, "img2img"
        return None, None, "txt2img"

    if ctype == "InpaintModelConditioning":
        init = _resolve_load_image_name(nodes, _link_id(inputs.get("pixels")))
        mask = _resolve_load_image_name(nodes, _link_id(inputs.get("mask")))
        if not mask:
            mask_node = nodes.get(_link_id(inputs.get("mask")) or "", {})
            if mask_node.get("class_type") == "LoadImageMask":
                mask = _as_str(mask_node["inputs"].get("image")).strip() or None
        if init:
            return init, mask, "inpaint" if mask else "img2img"
        return None, None, "txt2img"

    return None, None, "txt2img"


def _resolve_conditioning_text(
    nodes: dict[str, dict[str, Any]], node_id: str | None, branch: str
) -> str:
    """Follow CLIPTextEncode.text through ControlNetApply(Advanced) nodes,
    which pass conditioning through rather than encode it themselves."""
    node = nodes.get(node_id or "")
    if not node:
        return ""
    ctype = node["class_type"]
    if ctype == "CLIPTextEncode":
        return _as_str(node["inputs"].get("text"))
    if ctype in ("ControlNetApply", "ControlNetApplyAdvanced"):
        inner_id = _link_id(node["inputs"].get(branch))
        return _resolve_conditioning_text(nodes, inner_id, branch)
    return ""


def _resolve_one_controlnet_apply(
    nodes: dict[str, dict[str, Any]],
    apply_node: dict[str, Any],
) -> CompiledControlNet | None:
    """Resolve one ControlNetApply(Advanced) to checkpoint + image + preprocessor."""
    inputs = apply_node["inputs"]
    loader = nodes.get(_link_id(inputs.get("control_net")) or "", {})
    if loader.get("class_type") != "ControlNetLoader":
        return None
    controlnet_name = _as_str(loader["inputs"].get("control_net_name")).strip()
    if not controlnet_name or controlnet_name.startswith("{{"):
        return None

    image_id = _link_id(inputs.get("image"))
    image_node = nodes.get(image_id or "", {})
    preprocessor: ControlnetPreprocessorName = "none"
    ctype = image_node.get("class_type")
    mapped = _PREPROCESSOR_BY_CLASS.get(ctype or "")
    if mapped is not None:
        preprocessor = mapped  # pyright: ignore[reportAssignmentType]
        image_id = _link_id(image_node["inputs"].get("image"))

    control_image = _resolve_load_image_name(nodes, image_id)
    if not control_image:
        return None

    strength = _as_float(inputs.get("strength"), 1.0)
    return CompiledControlNet(
        name=controlnet_name,
        image=control_image,
        preprocessor=preprocessor,
        strength=strength,
    )


def _trace_controlnet_stack(
    nodes: dict[str, dict[str, Any]],
    sampler_positive_id: str | None,
) -> list[CompiledControlNet] | None:
    """Walk sampler positive → ControlNetApply* chain (outermost first).

    Also steps through ``InpaintModelConditioning`` (common ControlNet+inpaint
    wiring). Returns an empty list when no ControlNet Apply exists. Returns
    None when Apply nodes exist but any entry cannot be resolved.

    If Apply nodes exist but none sit on the sampler positive chain (legacy /
    miswired graphs), fall back to every resolvable Apply in the graph so a
    single dangling-but-complete ControlNet still compiles.
    """
    stack: list[CompiledControlNet] = []
    current_id = sampler_positive_id
    seen: set[str] = set()
    while current_id and current_id not in seen:
        seen.add(current_id)
        node = nodes.get(current_id)
        if not node:
            break
        ctype = node["class_type"]
        if ctype in ("ControlNetApply", "ControlNetApplyAdvanced"):
            entry = _resolve_one_controlnet_apply(nodes, node)
            if entry is None:
                return None
            stack.append(entry)
            current_id = _link_id(node["inputs"].get("positive"))
            continue
        if ctype == "InpaintModelConditioning":
            current_id = _link_id(node["inputs"].get("positive"))
            continue
        break

    if stack:
        return stack

    apply_nodes = [
        n
        for n in nodes.values()
        if n["class_type"] in ("ControlNetApply", "ControlNetApplyAdvanced")
    ]
    if not apply_nodes:
        return []

    fallback: list[CompiledControlNet] = []
    for node in apply_nodes:
        entry = _resolve_one_controlnet_apply(nodes, node)
        if entry is None:
            return None
        fallback.append(entry)
    return fallback


def _trace_output_post(
    nodes: dict[str, dict[str, Any]],
) -> tuple[str | None, float, float | None]:
    """Collect UpscaleModelLoader + ImageScaleBy / ImageBlur polish settings."""
    upscale_model: str | None = None
    for node in nodes.values():
        if node["class_type"] not in ("UpscaleModelLoader", "UpscaleModel"):
            continue
        name = _as_str(node["inputs"].get("model_name")).strip()
        if name and not name.startswith("{{"):
            upscale_model = name
            break

    # Only count ImageScaleBy that is actually used by an upscale/save chain.
    scale = 1.0
    blur_radius: float | None = None
    for node in nodes.values():
        ctype = node["class_type"]
        if ctype == "ImageScaleBy":
            factor = _as_float(node["inputs"].get("scale_by"), 1.0)
            if factor > 1.001:
                scale *= factor
        elif ctype == "ImageBlur":
            blur_radius = _as_float(
                node["inputs"].get("blur_radius", node["inputs"].get("radius")),
                0.0,
            )
            if blur_radius <= 0.05:
                blur_radius = None

    return upscale_model, scale, blur_radius


def _trace_ip_adapter(
    nodes: dict[str, dict[str, Any]],
) -> tuple[str | None, str | None, float] | None:
    """Find IPAdapterAdvanced + loader + reference LoadImage (SDXL identity)."""
    apply_node = next(
        (n for n in nodes.values() if n["class_type"] == "IPAdapterAdvanced"),
        None,
    )
    if apply_node is None:
        # Also accept bare IPAdapterModelLoader without Advanced (rare).
        if not any(n["class_type"] == "IPAdapterModelLoader" for n in nodes.values()):
            return None
        return None

    inputs = apply_node["inputs"]
    loader = nodes.get(_link_id(inputs.get("ipadapter")) or "", {})
    model_name: str | None = None
    if loader.get("class_type") == "IPAdapterModelLoader":
        model_name = _as_str(loader["inputs"].get("ipadapter_file")).strip() or None
        if model_name and model_name.startswith("{{"):
            model_name = None

    image_id = _link_id(inputs.get("image"))
    image_name = _resolve_load_image_name(nodes, image_id)
    if not image_name:
        return None

    strength = _as_float(
        inputs.get("weight", inputs.get("strength", inputs.get("ip_weight"))),
        0.5,
    )
    strength = max(0.0, min(1.0, strength))
    return model_name, image_name, strength


def _trace_instantid(
    nodes: dict[str, dict[str, Any]],
) -> tuple[str | None, str, float, str | None] | None:
    """Find ApplyInstantID(+Advanced) + loader + face LoadImage (SDXL).

    Returns (instantid_file | None, image, strength, controlnet_name | None).
    ``instantid_file`` may be None when the loader token is unresolved — caller
    should default to hub/drop-in ``ip-adapter.bin``.
    """
    apply_node = next(
        (
            n
            for n in nodes.values()
            if n["class_type"] in ("ApplyInstantID", "ApplyInstantIDAdvanced")
        ),
        None,
    )
    if apply_node is None:
        if not any(
            n["class_type"] in ("InstantIDModelLoader", "InstantIDFaceAnalysis")
            for n in nodes.values()
        ):
            return None
        return None

    inputs = apply_node["inputs"]
    loader = nodes.get(_link_id(inputs.get("instantid")) or "", {})
    model_name: str | None = None
    if loader.get("class_type") == "InstantIDModelLoader":
        model_name = _as_str(loader["inputs"].get("instantid_file")).strip() or None
        if model_name and model_name.startswith("{{"):
            model_name = None

    image_id = _link_id(inputs.get("image"))
    image_name = _resolve_load_image_name(nodes, image_id)
    if not image_name:
        return None

    strength = _as_float(inputs.get("weight", inputs.get("ip_weight")), 0.8)
    strength = max(0.0, min(2.0, strength))

    controlnet_name: str | None = None
    cn_loader = nodes.get(_link_id(inputs.get("control_net")) or "", {})
    if cn_loader.get("class_type") == "ControlNetLoader":
        controlnet_name = _as_str(cn_loader["inputs"].get("control_net_name")).strip() or None
        if controlnet_name and controlnet_name.startswith("{{"):
            controlnet_name = None

    return model_name, image_name, strength, controlnet_name


def compile_workflow(graph: dict[str, Any]) -> ClassifyResult:
    nodes = _nodes(graph)
    if not nodes:
        return ClassifyResult(
            supported=False,
            family="unsupported",
            reason="Empty or invalid Comfy API workflow.",
        )

    types = {node["class_type"] for node in nodes.values()}
    blocked = sorted(types & _ALWAYS_UNSUPPORTED)
    if blocked:
        return ClassifyResult(
            supported=False,
            family="unsupported",
            reason=f"Unsupported nodes: {', '.join(blocked)}",
            unsupported_nodes=blocked,
        )

    family = detect_family(nodes)
    if family == "unsupported":
        return ClassifyResult(
            supported=False,
            family="unsupported",
            reason="Workflow family not recognized for native execution.",
            unsupported_nodes=sorted(types),
        )

    allowed = {"sdxl": _SDXL_OK, "flux": _FLUX_OK, "qwen": _QWEN_OK}[family]
    unknown = sorted(types - allowed)
    if unknown:
        return ClassifyResult(
            supported=False,
            family=family,
            reason=f"Unsupported {family} nodes: {', '.join(unknown)}",
            unsupported_nodes=unknown,
        )

    # Sampler + latent
    sampler = next((n for n in nodes.values() if n["class_type"] == "KSampler"), None)
    if sampler is None:
        return ClassifyResult(
            supported=False,
            family=family,
            reason="Missing KSampler.",
            unsupported_nodes=["KSampler"],
        )
    latent_id = _link_id(sampler["inputs"].get("latent_image"))
    latent = nodes.get(latent_id or "", {})
    pos_id = _link_id(sampler["inputs"].get("positive"))
    neg_id = _link_id(sampler["inputs"].get("negative"))
    positive_text = _resolve_conditioning_text(nodes, pos_id, "positive")
    negative_text = _resolve_conditioning_text(nodes, neg_id, "negative")

    width = _as_int(latent.get("inputs", {}).get("width"), 1024)
    height = _as_int(latent.get("inputs", {}).get("height"), 1024)
    steps = _as_int(sampler["inputs"].get("steps"), 28)
    cfg = _as_float(sampler["inputs"].get("cfg"), 3.5 if family != "sdxl" else 5.5)
    seed = _as_int(sampler["inputs"].get("seed"), 0)
    denoise = _as_float(sampler["inputs"].get("denoise"), 1.0)
    init_image, mask_image, img2img_mode = _trace_img2img_assets(nodes, latent_id)
    if denoise < 0.999 and not init_image:
        return ClassifyResult(
            supported=False,
            family=family,
            reason="img2img/inpaint denoise < 1 requires LoadImage → VAEEncode (or inpaint conditioning).",
        )

    checkpoint = None
    unet = None
    clip = None
    clip2 = None
    vae = None
    clip_type = None
    flux_max_shift = None
    flux_base_shift = None
    aura_shift = None

    for node in nodes.values():
        ctype = node["class_type"]
        inputs = node["inputs"]
        if ctype in ("CheckpointLoaderSimple", "CheckpointLoader"):
            checkpoint = _as_str(inputs.get("ckpt_name")) or checkpoint
        elif ctype == "UNETLoader":
            unet = _as_str(inputs.get("unet_name")) or unet
        elif ctype == "DualCLIPLoader":
            clip = _as_str(inputs.get("clip_name1")) or clip
            clip2 = _as_str(inputs.get("clip_name2")) or clip2
            clip_type = _as_str(inputs.get("type")) or clip_type
        elif ctype == "CLIPLoader":
            clip = _as_str(inputs.get("clip_name")) or clip
            clip_type = _as_str(inputs.get("type")) or clip_type
        elif ctype == "VAELoader":
            vae = _as_str(inputs.get("vae_name")) or vae
        elif ctype == "ModelSamplingFlux":
            flux_max_shift = _as_float(inputs.get("max_shift"), 1.15)
            flux_base_shift = _as_float(inputs.get("base_shift"), 0.5)
        elif ctype == "ModelSamplingAuraFlow":
            aura_shift = _as_float(inputs.get("shift"), 3.1)

    if family == "sdxl" and not checkpoint:
        return ClassifyResult(
            supported=False,
            family=family,
            reason="SDXL workflow missing CheckpointLoaderSimple.",
        )
    if family in ("flux", "qwen") and not unet and not checkpoint:
        return ClassifyResult(
            supported=False,
            family=family,
            reason=f"{family} workflow missing UNETLoader/checkpoint.",
        )
    if (
        img2img_mode == "inpaint"
        and family == "flux"
        and _is_flux_klein(clip_type, unet)
    ):
        return ClassifyResult(
            supported=False,
            family=family,
            reason="Flux2-Klein inpaint has no mask-capable pipeline yet — use ComfyUI.",
        )

    controlnet_stack = _trace_controlnet_stack(nodes, pos_id)
    has_controlnet_node = any(
        n["class_type"] in ("ControlNetApply", "ControlNetApplyAdvanced")
        for n in nodes.values()
    )
    if has_controlnet_node and controlnet_stack is None:
        return ClassifyResult(
            supported=False,
            family=family,
            reason=(
                "ControlNet present but could not resolve control_net_name / "
                "source image (ControlNetLoader → optional preprocessor → "
                "LoadImage chains are supported)."
            ),
        )
    controlnets = controlnet_stack or []
    if controlnets and family not in ("sdxl", "flux", "qwen"):
        return ClassifyResult(
            supported=False,
            family=family,
            reason="Native ControlNet is supported for SDXL, Flux, and Qwen graphs only.",
        )
    if (
        controlnets
        and family == "flux"
        and _is_flux_klein(clip_type, unet)
    ):
        return ClassifyResult(
            supported=False,
            family=family,
            reason="Flux2-Klein ControlNet has no vetted pipeline yet — use ComfyUI.",
        )
    if len(controlnets) > 1 and family not in ("sdxl", "flux", "qwen"):
        return ClassifyResult(
            supported=False,
            family=family,
            reason=(
                "Stacked ControlNetApply chains compile natively for SDXL, "
                "classic Flux, and Qwen only."
            ),
        )
    if controlnets and img2img_mode != "txt2img":
        # SDXL + classic Flux: ControlNet img2img/inpaint pipelines.
        # Qwen: mask-channel ControlNet-Inpainting via
        # QwenImageControlNetInpaintPipeline (inpaint only — no Img2Img CN).
        # Klein CN already rejected above.
        if family == "qwen" and img2img_mode == "inpaint":
            pass
        elif family not in ("sdxl", "flux"):
            return ClassifyResult(
                supported=False,
                family=family,
                reason=(
                    "ControlNet combined with img2img/inpaint is not supported "
                    "for this family/mode yet — use ComfyUI."
                ),
            )
    primary = controlnets[0] if controlnets else None
    controlnet_name = primary.name if primary else None
    controlnet_image = primary.image if primary else None
    controlnet_preprocessor = primary.preprocessor if primary else "none"
    controlnet_strength = primary.strength if primary else 1.0
    upscale_model, output_scale, output_blur_radius = _trace_output_post(nodes)
    ip_adapter_info = _trace_ip_adapter(nodes)
    has_ipadapter_node = any(
        n["class_type"] in ("IPAdapterAdvanced", "IPAdapterModelLoader")
        for n in nodes.values()
    )
    if has_ipadapter_node and ip_adapter_info is None:
        return ClassifyResult(
            supported=False,
            family=family,
            reason=(
                "IP-Adapter present but could not resolve a reference LoadImage "
                "(IPAdapterModelLoader → IPAdapterAdvanced → LoadImage required)."
            ),
        )
    if ip_adapter_info is not None and family != "sdxl":
        return ClassifyResult(
            supported=False,
            family=family,
            reason="Native IP-Adapter identity lock is SDXL-only — use ComfyUI for Flux/Qwen.",
        )

    instantid_info = _trace_instantid(nodes)
    has_instantid_node = any(
        n["class_type"] in _INSTANTID_OK for n in nodes.values()
    )
    if has_instantid_node and instantid_info is None:
        return ClassifyResult(
            supported=False,
            family=family,
            reason=(
                "InstantID present but could not resolve a reference LoadImage "
                "(InstantIDModelLoader → ApplyInstantID → LoadImage required)."
            ),
        )
    if instantid_info is not None and family != "sdxl":
        return ClassifyResult(
            supported=False,
            family=family,
            reason="Native InstantID is SDXL-only — use ComfyUI for Flux/Qwen.",
        )
    if instantid_info is not None and ip_adapter_info is not None:
        return ClassifyResult(
            supported=False,
            family=family,
            reason="InstantID and IP-Adapter cannot compile together — use one identity path.",
        )
    if instantid_info is not None and controlnets:
        return ClassifyResult(
            supported=False,
            family=family,
            reason=(
                "InstantID already includes IdentityNet ControlNet — remove "
                "extra ControlNetApply chains or use ComfyUI."
            ),
        )
    if instantid_info is not None and img2img_mode == "inpaint":
        return ClassifyResult(
            supported=False,
            family=family,
            reason="InstantID + inpaint is not supported yet — use txt2img/img2img or ComfyUI.",
        )
    # SDXL IP-Adapter works with txt2img / img2img / inpaint (± ControlNet).
    ip_adapter_model, ip_adapter_image, ip_adapter_strength = (
        ip_adapter_info if ip_adapter_info is not None else (None, None, 0.5)
    )
    instantid_model, instantid_image, instantid_strength, instantid_controlnet = (
        instantid_info
        if instantid_info is not None
        else (None, None, 0.8, None)
    )

    compiled = CompiledWorkflow(
        family=family,
        positive=positive_text,
        negative=negative_text,
        width=max(64, width),
        height=max(64, height),
        steps=max(1, steps),
        cfg=cfg,
        seed=seed,
        denoise=denoise,
        sampler_name=_as_str(sampler["inputs"].get("sampler_name"), "euler"),
        scheduler=_as_str(sampler["inputs"].get("scheduler"), "simple"),
        checkpoint=checkpoint,
        unet=unet,
        clip=clip,
        clip2=clip2,
        vae=vae,
        clip_type=clip_type,
        loras=_collect_loras(nodes),
        flux_max_shift=flux_max_shift,
        flux_base_shift=flux_base_shift,
        aura_shift=aura_shift,
        init_image=init_image,
        mask_image=mask_image,
        img2img_mode=img2img_mode if denoise < 0.999 else "txt2img",
        controlnets=list(controlnets),
        controlnet=controlnet_name,
        controlnet_image=controlnet_image,
        controlnet_preprocessor=controlnet_preprocessor,
        controlnet_strength=controlnet_strength,
        upscale_model=upscale_model,
        output_scale=output_scale,
        output_blur_radius=output_blur_radius,
        ip_adapter_model=ip_adapter_model,
        ip_adapter_image=ip_adapter_image,
        ip_adapter_strength=ip_adapter_strength,
        instantid_model=instantid_model,
        instantid_image=instantid_image,
        instantid_strength=instantid_strength,
        instantid_controlnet=instantid_controlnet,
    )
    return ClassifyResult(
        supported=True,
        family=family,
        reason="ok",
        compiled=compiled,
    )
