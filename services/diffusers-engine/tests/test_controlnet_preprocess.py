from __future__ import annotations

import unittest

from app.controlnet_preprocess import (
    apply_controlnet_preprocess,
    flux_union_control_mode,
    union_control_mode,
)
from PIL import Image


class ControlnetPreprocessTests(unittest.TestCase):
    def test_union_control_mode_buckets(self) -> None:
        self.assertEqual(union_control_mode("openpose"), 0)
        self.assertEqual(union_control_mode("depth"), 1)
        self.assertEqual(union_control_mode("softedge"), 2)
        self.assertEqual(union_control_mode("canny"), 3)
        self.assertEqual(union_control_mode("lineart"), 3)
        self.assertEqual(union_control_mode("lineart_anime"), 3)
        self.assertEqual(union_control_mode("mlsd"), 3)
        self.assertEqual(union_control_mode("normal"), 4)
        self.assertEqual(union_control_mode("none"), 3)
        self.assertEqual(union_control_mode("unknown"), 3)

    def test_flux_union_control_mode_buckets(self) -> None:
        self.assertEqual(flux_union_control_mode("canny"), 0)
        self.assertEqual(flux_union_control_mode("lineart"), 0)
        self.assertEqual(flux_union_control_mode("softedge"), 0)
        self.assertEqual(flux_union_control_mode("normal"), 0)
        self.assertEqual(flux_union_control_mode("depth"), 2)
        self.assertEqual(flux_union_control_mode("openpose"), 4)
        self.assertEqual(flux_union_control_mode("none"), 0)
        self.assertEqual(flux_union_control_mode("unknown"), 0)

    def test_apply_none_passthrough(self) -> None:
        img = Image.new("RGB", (32, 32), color=(12, 34, 56))
        out = apply_controlnet_preprocess(img, "none")
        self.assertEqual(out.size, (32, 32))
        self.assertEqual(out.getpixel((0, 0)), (12, 34, 56))

    def test_apply_canny_returns_rgb(self) -> None:
        img = Image.new("RGB", (64, 64), color=(200, 100, 50))
        out = apply_controlnet_preprocess(img, "canny")
        self.assertEqual(out.mode, "RGB")
        self.assertEqual(out.size, (64, 64))


if __name__ == "__main__":
    unittest.main()
