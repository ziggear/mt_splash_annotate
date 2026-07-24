"""Persistent prep frame cache keyed by video stem (038 WP-A)."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .datasets import DEFAULT_DATASET_ID
from .paths import resolve_video_path

_FRAME_CACHE_OVERRIDE: Path | None = None


def frame_cache_root() -> Path:
    if _FRAME_CACHE_OVERRIDE is not None:
        return _FRAME_CACHE_OVERRIDE
    env = os.environ.get("HEIGHT_ANNOT_FRAME_CACHE", "").strip()
    if env:
        return Path(env)
    return Path("/tmp/ManuTech/video_frames")


def cache_key_for_video(rel_path: str, dataset_id: str | None = None) -> str:
    name = rel_path.replace("\\", "/").split("/")[-1]
    if name.lower().endswith(".mp4"):
        name = name[:-4]
    if dataset_id and dataset_id != DEFAULT_DATASET_ID:
        return f"{dataset_id}__{name}"
    return name


def cache_dir_for_video(rel_path: str, dataset_id: str | None = None) -> Path:
    return frame_cache_root() / cache_key_for_video(rel_path, dataset_id=dataset_id)


def prep_result_path(rel_path: str, dataset_id: str | None = None) -> Path:
    return cache_dir_for_video(rel_path, dataset_id=dataset_id) / "prep_result.json"


def frame_jpeg_path_for_video(rel_path: str, frame_id: int, dataset_id: str | None = None) -> Path:
    return cache_dir_for_video(rel_path, dataset_id=dataset_id) / "frames" / f"{int(frame_id):06d}.jpg"


def read_prep_cache(rel_path: str, dataset_id: str | None = None) -> dict[str, Any] | None:
    rel_norm = rel_path.replace("\\", "/")
    path = prep_result_path(rel_norm, dataset_id=dataset_id)
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(payload, dict):
        return None
    cached_rel = str(payload.get("video_rel_path") or "").replace("\\", "/")
    if cached_rel != rel_norm:
        return None
    return payload


def is_cache_stale(rel_path: str, prep_meta: dict[str, Any], dataset_id: str | None = None) -> bool:
    try:
        video_path = resolve_video_path(rel_path, dataset_id=dataset_id)
    except Exception:
        return False
    prep_path = prep_result_path(rel_path, dataset_id=dataset_id)
    if not video_path.is_file() or not prep_path.is_file():
        return False
    return video_path.stat().st_mtime_ns > prep_path.stat().st_mtime_ns
