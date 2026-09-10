from __future__ import annotations

import json
import struct
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.safetensors_peek import (
    flux_controlnet_mode_count,
    looks_like_diffusers_flux_controlnet,
    looks_like_diffusers_qwen_controlnet,
    qwen_controlnet_expects_mask,
    read_safetensors_header,
    sdxl_controlnet_is_union,
)


def _write_fake_safetensors(path: Path, tensor_shapes: dict[str, list[int]]) -> None:
    """Write a syntactically valid safetensors file with a real header and
    dummy (zeroed) tensor bytes — enough to exercise header parsing without
    needing the safetensors/torch packages."""
    header: dict = {}
    offset = 0
    for name, shape in tensor_shapes.items():
        nbytes = 4
        for d in shape:
            nbytes *= d
        header[name] = {
            "dtype": "F16",
            "shape": shape,
            "data_offsets": [offset, offset + nbytes],
        }
        offset += nbytes
    header_bytes = json.dumps(header).encode("utf-8")
    with open(path, "wb") as f:
        f.write(struct.pack("<Q", len(header_bytes)))
        f.write(header_bytes)
        f.write(b"\x00" * offset)


class SafetensorsPeekTests(unittest.TestCase):
    def test_reads_plain_header(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "plain.safetensors"
            _write_fake_safetensors(path, {"conv_in.weight": [4, 3, 3, 3]})
            header = read_safetensors_header(path)
            self.assertIn("conv_in.weight", header)
            self.assertEqual(header["conv_in.weight"]["shape"], [4, 3, 3, 3])

    def test_missing_file_returns_empty(self) -> None:
        self.assertEqual(read_safetensors_header("/no/such/file.safetensors"), {})

    def test_not_a_safetensors_file_returns_empty(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "junk.safetensors"
            path.write_bytes(b"not a safetensors file at all, way too short")
            self.assertEqual(read_safetensors_header(path), {})

    def test_sdxl_union_detected_by_task_embedding(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "union.safetensors"
            _write_fake_safetensors(
                path,
                {
                    "conv_in.weight": [320, 4, 3, 3],
                    "task_embedding": [6, 320],
                    "control_add_embedding.linear_1.weight": [1280, 1536],
                },
            )
            self.assertTrue(sdxl_controlnet_is_union(path))

    def test_sdxl_plain_controlnet_not_union(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "plain_cn.safetensors"
            _write_fake_safetensors(
                path,
                {
                    "conv_in.weight": [320, 4, 3, 3],
                    "controlnet_down_blocks.0.weight": [320, 320, 1, 1],
                },
            )
            self.assertFalse(sdxl_controlnet_is_union(path))

    def test_flux_union_mode_count(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "flux_union.safetensors"
            _write_fake_safetensors(
                path,
                {
                    "x_embedder.weight": [3072, 64],
                    "controlnet_mode_embedder.weight": [10, 3072],
                },
            )
            self.assertEqual(flux_controlnet_mode_count(path), 10)

    def test_flux_single_task_has_no_mode_count(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "flux_single.safetensors"
            _write_fake_safetensors(path, {"x_embedder.weight": [3072, 64]})
            self.assertIsNone(flux_controlnet_mode_count(path))

    def test_diffusers_native_flux_controlnet_recognized(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "diffusers_flux_cn.safetensors"
            _write_fake_safetensors(
                path,
                {
                    "x_embedder.weight": [3072, 64],
                    "transformer_blocks.0.attn.to_q.weight": [3072, 3072],
                    "controlnet_blocks.0.weight": [3072, 3072],
                },
            )
            self.assertTrue(looks_like_diffusers_flux_controlnet(path))

    def test_xlabs_style_flux_controlnet_rejected(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "xlabs_flux_cn.safetensors"
            _write_fake_safetensors(
                path,
                {
                    "img_in.weight": [3072, 64],
                    "double_blocks.0.img_attn.qkv.weight": [9216, 3072],
                    "input_hint_block.0.weight": [16, 3, 3, 3],
                },
            )
            self.assertFalse(looks_like_diffusers_flux_controlnet(path))

    def test_diffusers_native_qwen_controlnet_recognized(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "qwen_union_cn.safetensors"
            _write_fake_safetensors(
                path,
                {
                    "img_in.weight": [3072, 64],
                    "controlnet_x_embedder.weight": [3072, 64],
                    "transformer_blocks.0.attn.to_q.weight": [3072, 3072],
                    "txt_in.weight": [3072, 3584],
                    "controlnet_blocks.0.weight": [3072, 3072],
                },
            )
            self.assertTrue(looks_like_diffusers_qwen_controlnet(path))
            self.assertFalse(qwen_controlnet_expects_mask(path))

    def test_qwen_inpaint_controlnet_expects_mask(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "qwen_inpaint_cn.safetensors"
            _write_fake_safetensors(
                path,
                {
                    "img_in.weight": [3072, 64],
                    "controlnet_x_embedder.weight": [3072, 68],
                    "transformer_blocks.0.attn.to_q.weight": [3072, 3072],
                    "txt_in.weight": [3072, 3584],
                    "controlnet_blocks.0.weight": [3072, 3072],
                },
            )
            self.assertTrue(looks_like_diffusers_qwen_controlnet(path))
            self.assertTrue(qwen_controlnet_expects_mask(path))

    def test_diffsynth_patch_style_qwen_controlnet_rejected(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "diffsynth_qwen_cn.safetensors"
            _write_fake_safetensors(
                path,
                {
                    "img_in.weight": [3072, 64],
                    "controlnet_blocks.0.input_proj.weight": [3072, 3072],
                    "controlnet_blocks.0.output_proj.weight": [3072, 3072],
                    "controlnet_blocks.0.x_rms.weight": [3072],
                    "controlnet_blocks.0.y_rms.weight": [3072],
                },
            )
            self.assertFalse(looks_like_diffusers_qwen_controlnet(path))

    def test_unreadable_header_defaults_to_true(self) -> None:
        # Benefit of the doubt when we can't parse it at all — let the real
        # loader raise its own error rather than blocking on a guess.
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "empty.safetensors"
            path.write_bytes(b"")
            self.assertTrue(looks_like_diffusers_flux_controlnet(path))


if __name__ == "__main__":
    unittest.main()
