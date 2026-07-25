"""video_validity.json generation for height annotation browse."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

VIDEO_VALIDITY_FILENAME = "video_validity.json"
DEFAULT_MIN_DURATION_SEC = 3.0


def top_level_mp4s_for_validity(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    videos: list[Path] = []
    for entry in sorted(folder.iterdir()):
        if not entry.is_file():
            continue
        if entry.name.startswith("._"):
            continue
        if entry.suffix.lower() == ".mp4":
            videos.append(entry)
    return videos


def _probe_video(mp4: Path, *, min_duration_sec: float) -> dict[str, Any]:
    try:
        import cv2
    except Exception as exc:
        return {
            "video_id": mp4.stem,
            "filename": mp4.name,
            "valid": False,
            "message": f"probe_error:{type(exc).__name__}",
            "duration_sec": 0.0,
        }

    cap = cv2.VideoCapture(str(mp4))
    try:
        if not cap.isOpened():
            return {
                "video_id": mp4.stem,
                "filename": mp4.name,
                "valid": False,
                "message": "cannot_open",
                "duration_sec": 0.0,
            }
        ok, _frame = cap.read()
        if not ok:
            return {
                "video_id": mp4.stem,
                "filename": mp4.name,
                "valid": False,
                "message": "first_frame_decode_failed",
                "duration_sec": 0.0,
            }
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
        if fps <= 0:
            fps = 30.0
        frames = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
        duration = round(frames / fps, 3) if frames > 0 else 0.0
        valid = duration >= float(min_duration_sec)
        return {
            "video_id": mp4.stem,
            "filename": mp4.name,
            "valid": valid,
            "message": "ok" if valid else "too_short",
            "duration_sec": duration,
        }
    finally:
        cap.release()


def generate_video_validity(
    folder: Path,
    *,
    min_duration_sec: float = DEFAULT_MIN_DURATION_SEC,
) -> dict[str, Any] | None:
    """Create sibling video_validity.json for top-level mp4s if missing."""
    manifest = folder / VIDEO_VALIDITY_FILENAME
    if manifest.is_file():
        return None
    videos = top_level_mp4s_for_validity(folder)
    if not videos:
        return None
    if manifest.is_file():
        return None

    rows = [_probe_video(mp4, min_duration_sec=min_duration_sec) for mp4 in videos]
    payload: dict[str, Any] = {
        "folder": str(folder),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "probe_ref": "height_annotate auto video validity",
        "min_duration_sec": float(min_duration_sec),
        "skip_apple_double": True,
        "summary": {
            "total": len(rows),
            "valid": sum(1 for row in rows if bool(row.get("valid"))),
            "invalid": sum(1 for row in rows if not bool(row.get("valid"))),
        },
        "videos": rows,
    }
    tmp = manifest.with_name(f".{manifest.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(tmp, manifest)
    return payload
