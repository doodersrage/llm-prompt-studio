from __future__ import annotations

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from app.asset_inventory import list_asset_inventory, resolve_asset_file
from app.comfy_graph import compile_workflow


def _sdxl_graph(ckpt: str = "RealVisXL_V5.0_fp16.safetensors") -> dict:
    return {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": ckpt},
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "a glassblower", "clip": ["1", 1]},
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "blurry", "clip": ["1", 1]},
        },
        "4": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
        },
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 42,
                "steps": 28,
                "cfg": 5.5,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
            },
        },
        "6": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["5", 0], "vae": ["1", 2]},
        },
        "7": {
            "class_type": "SaveImage",
            "inputs": {"images": ["6", 0], "filename_prefix": "ComfyUI"},
        },
    }


def _flux_graph() -> dict:
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": "flux1-dev.safetensors", "weight_dtype": "default"},
        },
        "2": {
            "class_type": "DualCLIPLoader",
            "inputs": {
                "clip_name1": "clip_l.safetensors",
                "clip_name2": "t5xxl_fp16.safetensors",
                "type": "flux",
            },
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "ae.safetensors"},
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "flux prompt", "clip": ["2", 0]},
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "", "clip": ["2", 0]},
        },
        "6": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
        },
        "7": {
            "class_type": "ModelSamplingFlux",
            "inputs": {
                "max_shift": 1.15,
                "base_shift": 0.5,
                "width": 1024,
                "height": 1024,
                "model": ["1", 0],
            },
        },
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 1,
                "steps": 20,
                "cfg": 3.5,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
                "model": ["7", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["6", 0],
            },
        },
        "9": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["8", 0], "vae": ["3", 0]},
        },
        "10": {
            "class_type": "SaveImage",
            "inputs": {"images": ["9", 0], "filename_prefix": "flux"},
        },
    }


def _qwen_graph() -> dict:
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": "qwen_image_bf16.safetensors", "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "qwen_2.5_vl_7b.safetensors",
                "type": "qwen_image",
            },
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "qwen_image_vae.safetensors"},
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "qwen prompt", "clip": ["2", 0]},
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "", "clip": ["2", 0]},
        },
        "6": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
        },
        "7": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"shift": 3.1, "model": ["1", 0]},
        },
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 7,
                "steps": 20,
                "cfg": 2.5,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
                "model": ["7", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["6", 0],
            },
        },
        "9": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["8", 0], "vae": ["3", 0]},
        },
        "10": {
            "class_type": "SaveImage",
            "inputs": {"images": ["9", 0], "filename_prefix": "qwen"},
        },
    }


class AssetInventoryTests(unittest.TestCase):
    def test_lists_drop_in_buckets(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            ckpt = root / "models" / "checkpoints"
            unet = root / "models" / "diffusion_models"
            te = root / "models" / "text_encoders"
            vae = root / "models" / "vae"
            lora = root / "models" / "loras"
            controlnet = root / "models" / "controlnet"
            for path in (ckpt, unet, te, vae, lora, controlnet):
                path.mkdir(parents=True)
            (ckpt / "RealVisXL_V5.0_fp16.safetensors").write_bytes(b"x")
            (ckpt / "Qwen-Rapid-AIO-SFW-v23.safetensors").write_bytes(b"x")
            (unet / "flux1-dev.safetensors").write_bytes(b"x")
            (unet / "qwen_image_2512_bf16.safetensors").write_bytes(b"x")
            (te / "clip_l.safetensors").write_bytes(b"x")
            (vae / "ae.safetensors").write_bytes(b"x")
            (lora / "detail.safetensors").write_bytes(b"x")
            (controlnet / "control-canny-sdxl.safetensors").write_bytes(b"x")

            with mock.patch.dict(os.environ, {"COMFYUI_ROOT": str(root)}, clear=False):
                inventory = list_asset_inventory()
                self.assertTrue(
                    any(item.id == "RealVisXL_V5.0_fp16.safetensors" for item in inventory["checkpoints"])
                )
                qwen_ckpt = next(
                    item
                    for item in inventory["checkpoints"]
                    if item.id == "Qwen-Rapid-AIO-SFW-v23.safetensors"
                )
                self.assertEqual(qwen_ckpt.family, "qwen")
                flux = next(
                    item
                    for item in inventory["diffusion_models"]
                    if item.id == "flux1-dev.safetensors"
                )
                self.assertEqual(flux.family, "flux")
                qwen_unet = next(
                    item
                    for item in inventory["diffusion_models"]
                    if item.id == "qwen_image_2512_bf16.safetensors"
                )
                self.assertEqual(qwen_unet.family, "qwen")
                resolved = resolve_asset_file("ae.safetensors", "vaes")
                self.assertIsNotNone(resolved)
                self.assertEqual(resolved.name, "ae.safetensors")
                self.assertTrue(
                    any(
                        item.id == "control-canny-sdxl.safetensors"
                        for item in inventory["controlnets"]
                    )
                )
                cn_resolved = resolve_asset_file(
                    "control-canny-sdxl.safetensors", "controlnets"
                )
                self.assertIsNotNone(cn_resolved)


class ComfyGraphTests(unittest.TestCase):
    def test_compiles_sdxl(self) -> None:
        result = compile_workflow(_sdxl_graph())
        self.assertTrue(result.supported)
        self.assertEqual(result.family, "sdxl")
        assert result.compiled is not None
        self.assertEqual(result.compiled.positive, "a glassblower")
        self.assertEqual(result.compiled.checkpoint, "RealVisXL_V5.0_fp16.safetensors")
        self.assertEqual(result.compiled.steps, 28)

    def test_compiles_flux(self) -> None:
        result = compile_workflow(_flux_graph())
        self.assertTrue(result.supported)
        self.assertEqual(result.family, "flux")
        assert result.compiled is not None
        self.assertEqual(result.compiled.unet, "flux1-dev.safetensors")
        self.assertEqual(result.compiled.flux_max_shift, 1.15)

    def test_compiles_qwen(self) -> None:
        result = compile_workflow(_qwen_graph())
        self.assertTrue(result.supported)
        self.assertEqual(result.family, "qwen")
        assert result.compiled is not None
        self.assertEqual(result.compiled.clip_type, "qwen_image")
        self.assertEqual(result.compiled.aura_shift, 3.1)

    def test_compiles_qwen_rapid_aio_checkpoint(self) -> None:
        graph = {
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": "Qwen-Rapid-AIO-SFW-v23.safetensors"},
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "a woman", "clip": ["1", 1]},
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "", "clip": ["1", 1]},
            },
            "4": {
                "class_type": "EmptySD3LatentImage",
                "inputs": {"width": 768, "height": 1024, "batch_size": 1},
            },
            "5": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": 1,
                    "steps": 8,
                    "cfg": 1.0,
                    "sampler_name": "euler",
                    "scheduler": "simple",
                    "denoise": 1.0,
                    "model": ["1", 0],
                    "positive": ["2", 0],
                    "negative": ["3", 0],
                    "latent_image": ["4", 0],
                },
            },
            "6": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["5", 0], "vae": ["1", 2]},
            },
            "7": {
                "class_type": "SaveImage",
                "inputs": {"images": ["6", 0], "filename_prefix": "rapid"},
            },
        }
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        self.assertEqual(result.family, "qwen")
        assert result.compiled is not None
        self.assertEqual(
            result.compiled.checkpoint,
            "Qwen-Rapid-AIO-SFW-v23.safetensors",
        )

    def test_compiles_flux_klein_cliploader(self) -> None:
        graph = {
            "1": {
                "class_type": "UNETLoader",
                "inputs": {
                    "unet_name": "flux-2-klein-9b.safetensors",
                    "weight_dtype": "default",
                },
            },
            "2": {
                "class_type": "CLIPLoader",
                "inputs": {
                    "clip_name": "qwen_3_8b_fp8mixed.safetensors",
                    "type": "flux2",
                },
            },
            "3": {
                "class_type": "VAELoader",
                "inputs": {"vae_name": "flux2-vae.safetensors"},
            },
            "4": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "klein prompt", "clip": ["2", 0]},
            },
            "5": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "", "clip": ["2", 0]},
            },
            "6": {
                "class_type": "EmptyLatentImage",
                "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
            },
            "8": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": 1,
                    "steps": 4,
                    "cfg": 1.0,
                    "sampler_name": "euler",
                    "scheduler": "simple",
                    "denoise": 1.0,
                    "model": ["1", 0],
                    "positive": ["4", 0],
                    "negative": ["5", 0],
                    "latent_image": ["6", 0],
                },
            },
            "9": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["8", 0], "vae": ["3", 0]},
            },
            "10": {
                "class_type": "SaveImage",
                "inputs": {"images": ["9", 0], "filename_prefix": "klein"},
            },
        }
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        self.assertEqual(result.family, "flux")
        assert result.compiled is not None
        self.assertEqual(result.compiled.clip_type, "flux2")
        self.assertEqual(result.compiled.clip, "qwen_3_8b_fp8mixed.safetensors")

    def test_collects_power_lora_and_loader_nodes(self) -> None:
        graph = _qwen_graph()
        graph["11"] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["1", 0],
                "lora_name": "Qwen-Image-Lightning-4steps-V1.0.safetensors",
                "strength_model": 1.0,
            },
        }
        graph["12"] = {
            "class_type": "Power Lora Loader (rgthree)",
            "inputs": {
                "model": ["11", 0],
                "lora_1": {
                    "on": True,
                    "lora": "Qwen-Image-GenatomyFixer.safetensors",
                    "strength": 0.9,
                },
                "lora_2": {
                    "on": False,
                    "lora": "ignored.safetensors",
                    "strength": 1.0,
                },
            },
        }
        graph["7"]["inputs"]["model"] = ["12", 0]
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        names = [(item.name, item.strength) for item in result.compiled.loras]
        self.assertIn(
            ("Qwen-Image-Lightning-4steps-V1.0.safetensors", 1.0),
            names,
        )
        self.assertIn(("Qwen-Image-GenatomyFixer.safetensors", 0.9), names)
        self.assertFalse(any(name == "ignored.safetensors" for name, _ in names))

    def test_controlnet_unresolvable_unsupported(self) -> None:
        # ControlNetApplyAdvanced present but not wired to a control_net loader
        # (e.g. a dangling/placeholder node) is a clear rejection, not a
        # silent txt2img fallback.
        graph = _sdxl_graph()
        graph["99"] = {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {"strength": 1.0},
        }
        result = compile_workflow(graph)
        self.assertFalse(result.supported)
        self.assertIn("resolve", result.reason.lower())

    def _controlnet_graph(
        self,
        graph: dict,
        *,
        positive_id: str,
        negative_id: str,
        ksampler_id: str,
        strength: float = 0.8,
    ) -> dict:
        graph["30"] = {
            "class_type": "ControlNetLoader",
            "inputs": {"control_net_name": "control-canny-sdxl.safetensors"},
        }
        graph["31"] = {
            "class_type": "LoadImage",
            "inputs": {"image": "source.png"},
        }
        graph["32"] = {
            "class_type": "CannyEdgePreprocessor",
            "inputs": {"image": ["31", 0], "low_threshold": 100, "high_threshold": 200},
        }
        graph["33"] = {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": [positive_id, 0],
                "negative": [negative_id, 0],
                "control_net": ["30", 0],
                "image": ["32", 0],
                "strength": strength,
                "start_percent": 0.0,
                "end_percent": 1.0,
            },
        }
        graph[ksampler_id]["inputs"]["positive"] = ["33", 0]
        graph[ksampler_id]["inputs"]["negative"] = ["33", 1]
        return graph

    def test_compiles_sdxl_ip_adapter(self) -> None:
        graph = _sdxl_graph()
        graph["50"] = {
            "class_type": "LoadImage",
            "inputs": {"image": "face-ref.png"},
        }
        graph["51"] = {
            "class_type": "IPAdapterModelLoader",
            "inputs": {"ipadapter_file": "ip-adapter-plus_sdxl_vit-h.safetensors"},
        }
        graph["52"] = {
            "class_type": "IPAdapterAdvanced",
            "inputs": {
                "model": ["1", 0],
                "ipadapter": ["51", 0],
                "image": ["50", 0],
                "weight": 0.65,
                "weight_type": "linear",
                "combine_embeds": "concat",
                "start_at": 0.0,
                "end_at": 1.0,
                "embeds_scaling": "V only",
            },
        }
        graph["5"]["inputs"]["model"] = ["52", 0]
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(
            result.compiled.ip_adapter_model, "ip-adapter-plus_sdxl_vit-h.safetensors"
        )
        self.assertEqual(result.compiled.ip_adapter_image, "face-ref.png")
        self.assertAlmostEqual(result.compiled.ip_adapter_strength, 0.65)

    def test_ip_adapter_unsupported_on_flux(self) -> None:
        graph = _flux_graph()
        graph["50"] = {
            "class_type": "LoadImage",
            "inputs": {"image": "face-ref.png"},
        }
        graph["51"] = {
            "class_type": "IPAdapterModelLoader",
            "inputs": {"ipadapter_file": "ip-adapter-plus_sdxl_vit-h.safetensors"},
        }
        graph["52"] = {
            "class_type": "IPAdapterAdvanced",
            "inputs": {
                "model": ["1", 0],
                "ipadapter": ["51", 0],
                "image": ["50", 0],
                "weight": 0.5,
            },
        }
        result = compile_workflow(graph)
        self.assertFalse(result.supported)
        self.assertTrue(
            "IP-Adapter" in result.reason or "ipadapter" in result.reason.lower()
            or result.unsupported_nodes
            or "unknown" in result.reason.lower()
            or "SDXL" in result.reason
        )

    def test_compiles_sdxl_with_upscale_and_scale_by(self) -> None:
        graph = _sdxl_graph()
        graph["40"] = {
            "class_type": "UpscaleModelLoader",
            "inputs": {"model_name": "4x-UltraSharp.pth"},
        }
        graph["41"] = {
            "class_type": "ImageUpscaleWithModel",
            "inputs": {"upscale_model": ["40", 0], "image": ["6", 0]},
        }
        graph["42"] = {
            "class_type": "ImageScaleBy",
            "inputs": {"image": ["41", 0], "scale_by": 1.5, "upscale_method": "lanczos"},
        }
        graph["7"]["inputs"]["images"] = ["42", 0]
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.upscale_model, "4x-UltraSharp.pth")
        self.assertAlmostEqual(result.compiled.output_scale, 1.5)

    def test_compiles_sdxl_controlnet_canny(self) -> None:
        graph = self._controlnet_graph(
            _sdxl_graph(), positive_id="2", negative_id="3", ksampler_id="5",
        )
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.controlnet, "control-canny-sdxl.safetensors")
        self.assertEqual(result.compiled.controlnet_image, "source.png")
        self.assertEqual(result.compiled.controlnet_preprocessor, "canny")
        self.assertAlmostEqual(result.compiled.controlnet_strength, 0.8)
        # Conditioning text must still resolve through the ControlNetApply pass-through.
        self.assertEqual(result.compiled.positive, "a glassblower")
        self.assertEqual(result.compiled.negative, "blurry")

    def test_compiles_sdxl_controlnet_openpose(self) -> None:
        graph = self._controlnet_graph(
            _sdxl_graph(), positive_id="2", negative_id="3", ksampler_id="5",
        )
        graph["32"]["class_type"] = "DWPreprocessor"
        graph["32"]["inputs"] = {"image": ["31", 0]}
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.controlnet_preprocessor, "openpose")

    def test_compiles_sdxl_controlnet_depth(self) -> None:
        graph = self._controlnet_graph(
            _sdxl_graph(), positive_id="2", negative_id="3", ksampler_id="5",
        )
        graph["32"]["class_type"] = "DepthAnythingV2Preprocessor"
        graph["32"]["inputs"] = {"image": ["31", 0]}
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.controlnet_preprocessor, "depth")

    def test_compiles_flux_controlnet_canny(self) -> None:
        graph = self._controlnet_graph(
            _flux_graph(), positive_id="4", negative_id="5", ksampler_id="8",
        )
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.family, "flux")
        self.assertEqual(result.compiled.controlnet, "control-canny-sdxl.safetensors")
        self.assertEqual(result.compiled.controlnet_preprocessor, "canny")
        self.assertEqual(result.compiled.positive, "flux prompt")

    def test_compiles_qwen_controlnet_canny(self) -> None:
        graph = self._controlnet_graph(
            _qwen_graph(), positive_id="4", negative_id="5", ksampler_id="8",
        )
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.family, "qwen")
        self.assertEqual(result.compiled.controlnet, "control-canny-sdxl.safetensors")
        self.assertEqual(result.compiled.controlnet_preprocessor, "canny")

    def test_controlnet_unsupported_for_flux_klein(self) -> None:
        graph = _flux_graph()
        graph["2"]["inputs"]["type"] = "flux2"
        graph = self._controlnet_graph(
            graph, positive_id="4", negative_id="5", ksampler_id="8",
        )
        result = compile_workflow(graph)
        self.assertFalse(result.supported)
        self.assertIn("Klein", result.reason)

    def test_controlnet_with_img2img_unsupported_for_inpaint(self) -> None:
        graph = self._controlnet_graph(
            _sdxl_graph(), positive_id="2", negative_id="3", ksampler_id="5",
        )
        graph["20"] = {"class_type": "LoadImage", "inputs": {"image": "init.png"}}
        graph["21"] = {"class_type": "LoadImage", "inputs": {"image": "mask.png"}}
        graph["22"] = {
            "class_type": "InpaintModelConditioning",
            "inputs": {
                "positive": ["2", 0],
                "negative": ["3", 0],
                "vae": ["1", 2],
                "pixels": ["20", 0],
                "mask": ["21", 0],
                "noise_mask": True,
            },
        }
        graph["5"]["inputs"]["positive"] = ["22", 0]
        graph["5"]["inputs"]["negative"] = ["22", 1]
        graph["5"]["inputs"]["latent_image"] = ["22", 2]
        graph["5"]["inputs"]["denoise"] = 0.6
        result = compile_workflow(graph)
        self.assertFalse(result.supported)
        self.assertIn("inpaint", result.reason.lower())

    def test_compiles_sdxl_controlnet_img2img(self) -> None:
        graph = self._controlnet_graph(
            _sdxl_graph(), positive_id="2", negative_id="3", ksampler_id="5",
        )
        graph["20"] = {"class_type": "LoadImage", "inputs": {"image": "init.png"}}
        graph["21"] = {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["20", 0], "vae": ["1", 2]},
        }
        graph["5"]["inputs"]["latent_image"] = ["21", 0]
        graph["5"]["inputs"]["denoise"] = 0.6
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.img2img_mode, "img2img")
        self.assertEqual(result.compiled.controlnet, "control-canny-sdxl.safetensors")
        self.assertAlmostEqual(result.compiled.denoise, 0.6)

    def test_compiles_sdxl_ip_adapter_with_controlnet(self) -> None:
        graph = self._controlnet_graph(
            _sdxl_graph(), positive_id="2", negative_id="3", ksampler_id="5",
        )
        graph["50"] = {
            "class_type": "LoadImage",
            "inputs": {"image": "face-ref.png"},
        }
        graph["51"] = {
            "class_type": "IPAdapterModelLoader",
            "inputs": {"ipadapter_file": "ip-adapter-plus_sdxl_vit-h.safetensors"},
        }
        graph["52"] = {
            "class_type": "IPAdapterAdvanced",
            "inputs": {
                "model": ["1", 0],
                "ipadapter": ["51", 0],
                "image": ["50", 0],
                "weight": 0.55,
            },
        }
        graph["5"]["inputs"]["model"] = ["52", 0]
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.controlnet, "control-canny-sdxl.safetensors")
        self.assertEqual(
            result.compiled.ip_adapter_model, "ip-adapter-plus_sdxl_vit-h.safetensors"
        )
        self.assertEqual(result.compiled.ip_adapter_image, "face-ref.png")

    def test_denoise_without_init_unsupported(self) -> None:
        graph = _sdxl_graph()
        graph["5"]["inputs"]["denoise"] = 0.65
        result = compile_workflow(graph)
        self.assertFalse(result.supported)
        self.assertIn("denoise", result.reason.lower())

    def test_compiles_sdxl_img2img(self) -> None:
        graph = _sdxl_graph()
        graph["20"] = {
            "class_type": "LoadImage",
            "inputs": {"image": "source.png"},
        }
        graph["21"] = {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["20", 0], "vae": ["1", 2]},
        }
        graph["5"]["inputs"]["latent_image"] = ["21", 0]
        graph["5"]["inputs"]["denoise"] = 0.65
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.init_image, "source.png")
        self.assertEqual(result.compiled.img2img_mode, "img2img")
        self.assertAlmostEqual(result.compiled.denoise, 0.65)

    def test_compiles_sdxl_inpaint(self) -> None:
        graph = _sdxl_graph()
        graph["20"] = {
            "class_type": "LoadImage",
            "inputs": {"image": "source.png"},
        }
        graph["21"] = {
            "class_type": "LoadImage",
            "inputs": {"image": "mask.png"},
        }
        graph["22"] = {
            "class_type": "InpaintModelConditioning",
            "inputs": {
                "positive": ["2", 0],
                "negative": ["3", 0],
                "vae": ["1", 2],
                "pixels": ["20", 0],
                "mask": ["21", 0],
            },
        }
        graph["5"]["inputs"]["positive"] = ["22", 0]
        graph["5"]["inputs"]["negative"] = ["22", 1]
        graph["5"]["inputs"]["latent_image"] = ["22", 2]
        graph["5"]["inputs"]["denoise"] = 0.75
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.img2img_mode, "inpaint")
        self.assertEqual(result.compiled.mask_image, "mask.png")

    def test_compiles_flux_img2img(self) -> None:
        graph = _flux_graph()
        graph["20"] = {
            "class_type": "LoadImage",
            "inputs": {"image": "init.png"},
        }
        graph["21"] = {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["20", 0], "vae": ["3", 0]},
        }
        graph["8"]["inputs"]["latent_image"] = ["21", 0]
        graph["8"]["inputs"]["denoise"] = 0.55
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.init_image, "init.png")
        self.assertEqual(result.compiled.img2img_mode, "img2img")

    def test_compiles_qwen_img2img(self) -> None:
        graph = _qwen_graph()
        graph["20"] = {
            "class_type": "LoadImage",
            "inputs": {"image": "init.png"},
        }
        graph["21"] = {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["20", 0], "vae": ["3", 0]},
        }
        graph["8"]["inputs"]["latent_image"] = ["21", 0]
        graph["8"]["inputs"]["denoise"] = 0.6
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.init_image, "init.png")

    def _inpaint_graph(self, graph: dict, *, positive_id: str, negative_id: str,
                        vae_link: list, ksampler_id: str) -> dict:
        graph["20"] = {"class_type": "LoadImage", "inputs": {"image": "init.png"}}
        graph["21"] = {"class_type": "LoadImage", "inputs": {"image": "mask.png"}}
        graph["22"] = {
            "class_type": "InpaintModelConditioning",
            "inputs": {
                "positive": [positive_id, 0],
                "negative": [negative_id, 0],
                "vae": vae_link,
                "pixels": ["20", 0],
                "mask": ["21", 0],
            },
        }
        graph[ksampler_id]["inputs"]["positive"] = ["22", 0]
        graph[ksampler_id]["inputs"]["negative"] = ["22", 1]
        graph[ksampler_id]["inputs"]["latent_image"] = ["22", 2]
        graph[ksampler_id]["inputs"]["denoise"] = 0.7
        return graph

    def test_compiles_flux_inpaint(self) -> None:
        graph = self._inpaint_graph(
            _flux_graph(), positive_id="4", negative_id="5",
            vae_link=["3", 0], ksampler_id="8",
        )
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.family, "flux")
        self.assertEqual(result.compiled.img2img_mode, "inpaint")
        self.assertEqual(result.compiled.init_image, "init.png")
        self.assertEqual(result.compiled.mask_image, "mask.png")

    def test_compiles_qwen_inpaint(self) -> None:
        graph = self._inpaint_graph(
            _qwen_graph(), positive_id="4", negative_id="5",
            vae_link=["3", 0], ksampler_id="8",
        )
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.family, "qwen")
        self.assertEqual(result.compiled.img2img_mode, "inpaint")
        self.assertEqual(result.compiled.mask_image, "mask.png")

    def test_flux_klein_inpaint_unsupported(self) -> None:
        graph = _flux_graph()
        graph["2"]["inputs"]["type"] = "flux2"
        graph = self._inpaint_graph(
            graph, positive_id="4", negative_id="5",
            vae_link=["3", 0], ksampler_id="8",
        )
        result = compile_workflow(graph)
        self.assertFalse(result.supported)
        self.assertIn("Klein", result.reason)

    def test_flux_klein_img2img_still_supported(self) -> None:
        # Only inpaint (mask) is blocked for Klein — plain img2img stays allowed.
        graph = _flux_graph()
        graph["2"]["inputs"]["type"] = "flux2"
        graph["20"] = {"class_type": "LoadImage", "inputs": {"image": "init.png"}}
        graph["21"] = {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["20", 0], "vae": ["3", 0]},
        }
        graph["8"]["inputs"]["latent_image"] = ["21", 0]
        graph["8"]["inputs"]["denoise"] = 0.55
        result = compile_workflow(graph)
        self.assertTrue(result.supported, result.reason)
        assert result.compiled is not None
        self.assertEqual(result.compiled.img2img_mode, "img2img")


if __name__ == "__main__":
    unittest.main()
