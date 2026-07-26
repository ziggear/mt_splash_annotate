"""Height annotation data export API tests that do not require video decoding."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import types
import unittest
import zipfile
from io import BytesIO
from pathlib import Path

prep_stub = types.ModuleType("app.height_annot.prep")
prep_stub.LEGACY_PEAK_SELECTION_MODE_XGB_060B = "xgb_peak_060b"
prep_stub.PEAK_SELECTION_MODE_XGB = "xgb_peak"
prep_stub._PREP_CACHE_OVERRIDE = None
prep_stub._job_video_rel = {}
prep_stub.frame_jpeg_path = lambda *args, **kwargs: None
prep_stub.frame_jpeg_path_for_video_rel = lambda *args, **kwargs: None
prep_stub.load_prep_result = lambda *args, **kwargs: None
prep_stub.run_prep = lambda *args, **kwargs: None
sys.modules.setdefault("app.height_annot.prep", prep_stub)

from fastapi.testclient import TestClient

from app.height_annot import frame_cache, paths
from app.main import app


class TestHeightAnnotDataExportApi(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="annotation_export_api_"))
        self.old_dataset_config = os.environ.get("HEIGHT_ANNOT_DATASETS_CONFIG")
        os.environ["HEIGHT_ANNOT_DATASETS_CONFIG"] = str(self.tmp / "height_annot_datasets.json")
        paths._ROOT_OVERRIDE = self.tmp
        frame_cache._FRAME_CACHE_OVERRIDE = self.tmp / "cache"
        prep_stub._PREP_CACHE_OVERRIDE = None
        prep_stub._job_video_rel.clear()
        (self.tmp / "sample.mp4").write_bytes(b"not decoded by this test")
        (self.tmp / "sample.json").write_text('{"frames":[]}', encoding="utf-8")
        (self.tmp / "notes.json").write_text("{}", encoding="utf-8")
        (self.tmp / paths.VIDEO_VALIDITY_FILENAME).write_text(
            json.dumps({"videos": [{"video_id": "sample", "valid": True}]}),
            encoding="utf-8",
        )
        self.client = TestClient(app)

    def tearDown(self) -> None:
        paths._ROOT_OVERRIDE = None
        frame_cache._FRAME_CACHE_OVERRIDE = None
        prep_stub._PREP_CACHE_OVERRIDE = None
        prep_stub._job_video_rel.clear()
        if self.old_dataset_config is None:
            os.environ.pop("HEIGHT_ANNOT_DATASETS_CONFIG", None)
        else:
            os.environ["HEIGHT_ANNOT_DATASETS_CONFIG"] = self.old_dataset_config

    def test_data_export_zip_route_exports_sidecars_and_validity(self) -> None:
        res = self.client.get("/api/height-annotate/data-export.zip")

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers["content-type"], "application/zip")
        self.assertIn("height-annot-data-", res.headers["content-disposition"])
        with zipfile.ZipFile(BytesIO(res.content)) as zf:
            names = set(zf.namelist())
            root_name = self.tmp.name
            self.assertIn("manifest.json", names)
            self.assertIn(f"{root_name}/sample.json", names)
            self.assertIn(f"{root_name}/video_validity.json", names)
            self.assertNotIn(f"{root_name}/sample.mp4", names)
            self.assertNotIn(f"{root_name}/notes.json", names)
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        self.assertEqual(manifest["dataset_id"], "auckland_default")
        self.assertEqual(manifest["source_root_path"], str(self.tmp))
        self.assertEqual(manifest["sidecar_count"], 1)
        self.assertEqual(manifest["video_validity_count"], 1)


if __name__ == "__main__":
    unittest.main()
