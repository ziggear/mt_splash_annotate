"""CSV export for manual splash ROI annotations (066)."""
from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any

from .datasets import HeightAnnotDataset
from .schema import normalize_sidecar_for_save, validate_sidecar

ROI_EXPORT_FIELDS = [
    "video_rel",
    "frame_id",
    "water_y",
    "splash_top_y",
    "splash_height_px",
    "roi_x1",
    "roi_y1",
    "roi_x2",
    "roi_y2",
    "roi_width",
    "roi_height",
    "roi_contains_top",
    "roi_contains_water",
    "roi_warning_count",
]


def _csv_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _video_rel_for_sidecar(sidecar_path: Path, dataset_root: Path, video_path: str) -> str:
    try:
        return Path(video_path).resolve().relative_to(dataset_root.resolve()).as_posix()
    except (OSError, ValueError):
        return sidecar_path.with_suffix(".mp4").relative_to(dataset_root).as_posix()


def export_roi_rows(dataset: HeightAnnotDataset) -> list[dict[str, Any]]:
    root = Path(dataset.root)
    rows: list[dict[str, Any]] = []
    if not root.is_dir():
        return rows

    for path in sorted(root.rglob("*.json")):
        if path.name == "video_validity.json":
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            doc = normalize_sidecar_for_save(
                validate_sidecar(payload, allow_unknown_schema_version=True),
                preserve_created_at=True,
            )
        except Exception:
            continue
        video_rel = _video_rel_for_sidecar(path, root, doc.video_path)
        for fr in doc.frames:
            roi = fr.splash_roi_xyxy
            quality = fr.splash_roi_quality or {}
            warnings = quality.get("warnings") if isinstance(quality, dict) else []
            x1 = y1 = x2 = y2 = None
            if roi:
                x1, y1, x2, y2 = roi
            rows.append(
                {
                    "video_rel": video_rel,
                    "frame_id": fr.frame_id,
                    "water_y": fr.water_y,
                    "splash_top_y": fr.splash_top_y,
                    "splash_height_px": fr.splash_height_px,
                    "roi_x1": x1,
                    "roi_y1": y1,
                    "roi_x2": x2,
                    "roi_y2": y2,
                    "roi_width": (x2 - x1) if roi else None,
                    "roi_height": (y2 - y1) if roi else None,
                    "roi_contains_top": quality.get("top_contains_splash_top") if roi else None,
                    "roi_contains_water": quality.get("bottom_contains_water_y") if roi else None,
                    "roi_warning_count": len(warnings) if isinstance(warnings, list) else 0,
                }
            )
    return rows


def export_roi_csv(dataset: HeightAnnotDataset) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=ROI_EXPORT_FIELDS, lineterminator="\n")
    writer.writeheader()
    for row in export_roi_rows(dataset):
        writer.writerow({field: _csv_value(row.get(field)) for field in ROI_EXPORT_FIELDS})
    return out.getvalue()
