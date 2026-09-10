from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import torch
from safetensors.torch import save_file

from app.ip_adapter_resolve import (
    HUB_IP_ADAPTER_IMAGE_ENCODER,
    HUB_IP_ADAPTER_WEIGHT,
    classify_ip_adapter_weights,
    resolve_sdxl_ip_adapter_load,
)


class IpAdapterResolveTests(unittest.TestCase):
    def test_classify_classic(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ip-adapter-plus_sdxl_vit-h.safetensors"
            save_file(
                {
                    "ip_adapter.1.to_k_ip.weight": torch.zeros(8, 8),
                    "image_proj.proj.weight": torch.zeros(8, 8),
                },
                str(path),
            )
            self.assertEqual(classify_ip_adapter_weights(path), "classic")
            load = resolve_sdxl_ip_adapter_load(path)
            self.assertEqual(load["kind"], "classic")
            self.assertIn("local-classic", load["source"])
            self.assertTrue(load["preload_hub_image_encoder"])
            self.assertIsNone(load["image_encoder_folder"])

    def test_faceid_falls_back_to_hub_plus(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ip-adapter_pulid_sdxl_fp16.safetensors"
            save_file(
                {
                    "ip_adapter.1.to_k_ip.weight": torch.zeros(8, 8),
                    "image_proj.mapping_0.0.weight": torch.zeros(8, 8),
                },
                str(path),
            )
            self.assertEqual(classify_ip_adapter_weights(path), "faceid")
            load = resolve_sdxl_ip_adapter_load(path)
            self.assertEqual(load["weight_name"], HUB_IP_ADAPTER_WEIGHT)
            self.assertEqual(load["image_encoder_folder"], HUB_IP_ADAPTER_IMAGE_ENCODER)
            self.assertIn("hub-plus-fallback", load["source"])

    def test_missing_uses_hub(self) -> None:
        load = resolve_sdxl_ip_adapter_load(None)
        self.assertEqual(load["weight_name"], HUB_IP_ADAPTER_WEIGHT)
        self.assertEqual(load["image_encoder_folder"], HUB_IP_ADAPTER_IMAGE_ENCODER)


if __name__ == "__main__":
    unittest.main()
