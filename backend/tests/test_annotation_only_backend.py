from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.height_annot import frame_cache, paths, prep
from app.main import app


def _write_test_video(path: Path, *, frames: int = 12, fps: float = 12.0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (160, 120))
    for i in range(frames):
        frame = np.zeros((120, 160, 3), dtype=np.uint8)
        cv2.rectangle(frame, (20, 20 + i), (120, 70 + i), (220, 220, 220), -1)
        writer.write(frame)
    writer.release()


def _mark_video_valid(mp4: Path) -> None:
    manifest = mp4.parent / paths.VIDEO_VALIDITY_FILENAME
    manifest.write_text(
        json.dumps(
            {
                "videos": [
                    {
                        "video_id": mp4.stem,
                        "valid": True,
                        "message": "ok",
                        "duration_sec": 1.0,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )


class TestAnnotationOnlyBackend(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="annotation_only_"))
        self.old_dataset_config = os.environ.get("HEIGHT_ANNOT_DATASETS_CONFIG")
        os.environ["HEIGHT_ANNOT_DATASETS_CONFIG"] = str(self.tmp / "height_annot_datasets.json")
        paths._ROOT_OVERRIDE = self.tmp
        frame_cache._FRAME_CACHE_OVERRIDE = self.tmp / "cache"
        prep._PREP_CACHE_OVERRIDE = None
        prep._job_video_rel.clear()
        _write_test_video(self.tmp / "sample.mp4")
        _mark_video_valid(self.tmp / "sample.mp4")
        self.client = TestClient(app)

    def tearDown(self) -> None:
        paths._ROOT_OVERRIDE = None
        frame_cache._FRAME_CACHE_OVERRIDE = None
        prep._PREP_CACHE_OVERRIDE = None
        prep._job_video_rel.clear()
        if self.old_dataset_config is None:
            os.environ.pop("HEIGHT_ANNOT_DATASETS_CONFIG", None)
        else:
            os.environ["HEIGHT_ANNOT_DATASETS_CONFIG"] = self.old_dataset_config

    def test_only_annotation_routes_are_mounted(self) -> None:
        route_paths = {getattr(route, "path", "") for route in app.routes}
        self.assertIn("/api/health", route_paths)
        self.assertTrue(any(path.startswith("/api/height-annotate") for path in route_paths))
        for forbidden in ("/api/runs", "/api/models", "/api/training", "/api/tier12", "/ws"):
            self.assertFalse(any(path == forbidden or path.startswith(f"{forbidden}/") for path in route_paths))

    def test_old_peak_mode_is_rejected(self) -> None:
        res = self.client.post(
            "/api/height-annotate/prep",
            json={
                "video_rel_path": "sample.mp4",
                "sample_fps": 6.0,
                "peak_selection_mode": "v2_splash_peak",
            },
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("xgb_peak_060b", res.text)

    def test_select_folder_route_exists(self) -> None:
        route_paths = {getattr(route, "path", "") for route in app.routes}
        self.assertIn("/api/height-annotate/select-folder", route_paths)

    def test_missing_xgb_model_fails_prep_job(self) -> None:
        old_model_dir = os.environ.get("HEIGHT_ANNOT_XGB_060B_MODEL_DIR")
        os.environ["HEIGHT_ANNOT_XGB_060B_MODEL_DIR"] = str(self.tmp / "missing_model")
        try:
            res = self.client.post(
                "/api/height-annotate/prep",
                json={
                    "video_rel_path": "sample.mp4",
                    "sample_fps": 6.0,
                    "peak_selection_mode": "xgb_peak_060b",
                },
            )
            self.assertEqual(res.status_code, 200)
            job_id = res.json()["job_id"]
            status = {}
            for _ in range(50):
                poll = self.client.get(f"/api/height-annotate/prep/{job_id}")
                self.assertEqual(poll.status_code, 200)
                status = poll.json()
                if status["status"] == "failed":
                    break
                time.sleep(0.05)
            self.assertEqual(status["status"], "failed")
            self.assertIn("XGBoost peak selection unavailable", status["error"])
            self.assertIn("missing_model", status["error"])
        finally:
            if old_model_dir is None:
                os.environ.pop("HEIGHT_ANNOT_XGB_060B_MODEL_DIR", None)
            else:
                os.environ["HEIGHT_ANNOT_XGB_060B_MODEL_DIR"] = old_model_dir


if __name__ == "__main__":
    unittest.main()
