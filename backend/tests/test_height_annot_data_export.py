"""Height annotation data zip export tests (075)."""
from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from app.height_annot.data_export import build_height_annot_data_export_zip
from app.height_annot.datasets import HeightAnnotDataset


class TestHeightAnnotDataExport(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="height_annot_export_"))
        self.root = self.tmp / "Hamilton Day 1"
        self.root.mkdir()
        self.dataset = HeightAnnotDataset(
            dataset_id="auckland_default",
            label="Hamilton Day 1",
            root=str(self.root),
            enabled=True,
            created_at="2026-07-26T00:00:00Z",
        )

    def test_zip_contains_sidecars_validity_and_manifest_under_archive_root(self) -> None:
        (self.root / "10am").mkdir()
        (self.root / "10am" / "clip001.mp4").write_bytes(b"video")
        (self.root / "10am" / "clip001.json").write_text('{"frames":[]}', encoding="utf-8")
        (self.root / "10am" / "video_validity.json").write_text('{"videos":[]}', encoding="utf-8")
        (self.root / "11am" / "heat-a").mkdir(parents=True)
        (self.root / "11am" / "heat-a" / "clip002.mp4").write_bytes(b"video")
        (self.root / "11am" / "heat-a" / "clip002.json").write_text('{"frames":[]}', encoding="utf-8")
        (self.root / "11am" / "heat-a" / "video_validity.json").write_text(
            '{"videos":[]}',
            encoding="utf-8",
        )
        (self.root / "orphan.json").write_text("{}", encoding="utf-8")
        (self.root / "._clip001.json").write_text("{}", encoding="utf-8")

        result = build_height_annot_data_export_zip(
            self.dataset,
            self.tmp / "export.zip",
            exported_at="2026-07-26T00:00:00Z",
        )

        self.assertEqual(
            result.filename,
            "height-annot-data-Hamilton-Day-1-20260726T000000Z.zip",
        )
        with zipfile.ZipFile(result.zip_path) as zf:
            names = set(zf.namelist())
            self.assertEqual(
                names,
                {
                    "manifest.json",
                    "Hamilton Day 1/10am/clip001.json",
                    "Hamilton Day 1/10am/video_validity.json",
                    "Hamilton Day 1/11am/heat-a/clip002.json",
                    "Hamilton Day 1/11am/heat-a/video_validity.json",
                },
            )
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))

        self.assertEqual(manifest["source_root_path"], str(self.root))
        self.assertEqual(manifest["source_root_name"], "Hamilton Day 1")
        self.assertEqual(manifest["archive_root"], "Hamilton Day 1")
        self.assertEqual(manifest["sidecar_count"], 2)
        self.assertEqual(manifest["video_validity_count"], 2)
        self.assertEqual(
            sorted(row["source_rel_path"] for row in manifest["files"]),
            [
                "10am/clip001.json",
                "10am/video_validity.json",
                "11am/heat-a/clip002.json",
                "11am/heat-a/video_validity.json",
            ],
        )
        sidecar = next(row for row in manifest["files"] if row["kind"] == "sidecar")
        self.assertEqual(sidecar["video_rel_path"], "10am/clip001.mp4")

    def test_archive_root_sanitizes_illegal_path_characters(self) -> None:
        bad_root = self.tmp / "Hamilton:Day?1"
        bad_root.mkdir()
        (bad_root / "clip.mp4").write_bytes(b"video")
        (bad_root / "clip.json").write_text("{}", encoding="utf-8")
        dataset = HeightAnnotDataset(
            dataset_id="bad",
            label="Bad",
            root=str(bad_root),
            enabled=True,
            created_at="2026-07-26T00:00:00Z",
        )

        result = build_height_annot_data_export_zip(
            dataset,
            self.tmp / "bad.zip",
            exported_at="2026-07-26T00:00:00Z",
        )

        with zipfile.ZipFile(result.zip_path) as zf:
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
            self.assertIn("Hamilton-Day-1/clip.json", zf.namelist())
        self.assertEqual(manifest["source_root_name"], "Hamilton:Day?1")
        self.assertEqual(manifest["archive_root"], "Hamilton-Day-1")


if __name__ == "__main__":
    unittest.main()
