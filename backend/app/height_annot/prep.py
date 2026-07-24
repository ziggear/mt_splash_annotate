"""Annotation-only prep: decode frames and require 060b XGBoost peak selection."""
from __future__ import annotations

import json
import logging
import os
import shutil
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import cv2

from . import frame_cache
from .paths import is_extract_only_video_rel, probe_video_meta, resolve_video_path
from .xgb_peak_060b import DEFAULT_MODEL_NAME, predict_xgb_peak_060b

logger = logging.getLogger(__name__)

_PREP_CACHE_OVERRIDE: Path | None = None
_job_video_rel: dict[str, tuple[str | None, str]] = {}
PEAK_SELECTION_MODE_XGB = "xgb_peak_060b"


def prep_cache_root() -> Path:
    if _PREP_CACHE_OVERRIDE is not None:
        root = _PREP_CACHE_OVERRIDE
    else:
        env = os.environ.get("HEIGHT_ANNOT_PREP_CACHE", "").strip()
        root = Path(env) if env else Path.home() / ".manutech-height-annotator" / "prep"
    root.mkdir(parents=True, exist_ok=True)
    return root


@dataclass
class PrepResult:
    job_id: str
    video_rel_path: str
    video_path: str
    video_width: int
    video_height: int
    fps: float
    total_source_frames: int
    sample_fps: float
    sampled_frame_ids: list[int]
    peak_frame_id: int
    tier1_peak_frame_id: int
    default_selected_frame_ids: list[int]
    curve: list[dict[str, Any]]
    peak_selection_mode: str
    tier1_search_mode: str
    xgb_peak_frame_id: int | None = None
    xgb_peak_score: float | None = None
    xgb_topk_frame_ids: list[int] | None = None
    xgb_topk_scores: list[float] | None = None
    xgb_model_name: str = DEFAULT_MODEL_NAME
    xgb_feature_set: str = DEFAULT_MODEL_NAME
    xgb_feature_status: str = ""
    xgb_available: bool = False
    final_peak_frame_id: int | None = None
    final_peak_source: str = ""
    final_peak_reason: str = ""


def _decode_sampled_frames(video_path: Path, *, fps: float, sample_fps: float) -> list[tuple[int, Any, int]]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")
    step = max(1, int(round(float(fps) / max(0.001, float(sample_fps)))))
    decoded: list[tuple[int, Any, int]] = []
    frame_idx = 0
    try:
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            frame_idx += 1
            if frame_idx == 1 or (frame_idx - 1) % step == 0:
                ts_ms = int(round(((frame_idx - 1) / max(0.001, float(fps))) * 1000.0))
                decoded.append((frame_idx, bgr, ts_ms))
    finally:
        cap.release()
    return decoded


def _neighbor_frame_ids(anchor_id: int, sampled_frame_ids: list[int], *, radius: int = 3) -> list[int]:
    if not sampled_frame_ids:
        return []
    if anchor_id not in sampled_frame_ids:
        anchor_id = min(sampled_frame_ids, key=lambda fid: abs(int(fid) - int(anchor_id)))
    idx = sampled_frame_ids.index(int(anchor_id))
    lo = max(0, idx - int(radius))
    hi = min(len(sampled_frame_ids), idx + int(radius) + 1)
    return sampled_frame_ids[lo:hi]


def _write_jpegs(frames_by_id: dict[int, Any], frames_dir: Path) -> None:
    frames_dir.mkdir(parents=True, exist_ok=True)
    for fid, bgr in frames_by_id.items():
        out = frames_dir / f"{int(fid):06d}.jpg"
        ok = cv2.imwrite(str(out), bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        if not ok:
            raise OSError(f"failed to write frame JPEG: {out}")


def _persist(cache_dir: Path, payload: dict[str, Any], *, job_id: str, dataset_id: str | None, rel_norm: str) -> None:
    (cache_dir / "prep_result.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    _job_video_rel[job_id] = (dataset_id, rel_norm)


def run_prep(
    video_rel_path: str,
    *,
    dataset_id: str | None = None,
    sample_fps: float = 10.0,
    peak_selection_mode: str = PEAK_SELECTION_MODE_XGB,
    tier1_search_mode: str = "full_frame",
    tier1_ref_mode: str = "frame1",
    job_id: Optional[str] = None,
) -> PrepResult:
    t0 = time.perf_counter()
    rel_norm = video_rel_path.replace("\\", "/")
    video_path = resolve_video_path(rel_norm, dataset_id=dataset_id)
    if not video_path.is_file():
        raise FileNotFoundError(f"video not found: {video_rel_path}")

    extract_only = is_extract_only_video_rel(rel_norm)
    if not extract_only and str(peak_selection_mode) != PEAK_SELECTION_MODE_XGB:
        raise ValueError(f"annotation app only supports {PEAK_SELECTION_MODE_XGB}")

    meta = probe_video_meta(video_path)
    jid = job_id or uuid.uuid4().hex
    cache_dir = frame_cache.cache_dir_for_video(rel_norm, dataset_id=dataset_id)
    if cache_dir.exists():
        shutil.rmtree(cache_dir)
    cache_dir.mkdir(parents=True)

    decoded = _decode_sampled_frames(video_path, fps=float(meta["fps"]), sample_fps=float(sample_fps))
    if not decoded:
        raise ValueError("No frames decoded from video")
    frames_by_id = {int(fid): bgr for fid, bgr, _ts in decoded}
    sampled_ids = [int(fid) for fid, _bgr, _ts in decoded]
    frames_dir = cache_dir / "frames"
    _write_jpegs(frames_by_id, frames_dir)

    if extract_only:
        anchor_id = sampled_ids[0]
        default_selected: list[int] = []
        mode = "extract_only"
        xgb_fields = {
            "xgb_peak_frame_id": None,
            "xgb_peak_score": None,
            "xgb_topk_frame_ids": [],
            "xgb_topk_scores": [],
            "xgb_model_name": DEFAULT_MODEL_NAME,
            "xgb_feature_set": DEFAULT_MODEL_NAME,
            "xgb_feature_status": "extract_only",
            "xgb_available": False,
            "final_peak_frame_id": anchor_id,
            "final_peak_source": "extract_only",
            "final_peak_reason": "extract_only",
        }
    else:
        xgb = predict_xgb_peak_060b(
            video_path=video_path,
            frames_by_id=frames_by_id,
            sampled_frame_ids=sampled_ids,
            video_width=int(meta["video_width"]),
            video_height=int(meta["video_height"]),
        )
        if not xgb.available or xgb.peak_frame_id is None:
            detail = xgb.feature_status or "unavailable"
            diag = xgb.diagnostics or {}
            raise RuntimeError(f"XGBoost peak selection unavailable: {detail}; diagnostics={diag}")
        anchor_id = int(xgb.peak_frame_id)
        default_selected = _neighbor_frame_ids(anchor_id, sampled_ids, radius=3)
        mode = PEAK_SELECTION_MODE_XGB
        xgb_fields = {
            "xgb_peak_frame_id": anchor_id,
            "xgb_peak_score": xgb.peak_score,
            "xgb_topk_frame_ids": xgb.topk_frame_ids,
            "xgb_topk_scores": xgb.topk_scores,
            "xgb_model_name": xgb.model_name,
            "xgb_feature_set": xgb.feature_set,
            "xgb_feature_status": xgb.feature_status,
            "xgb_available": True,
            "final_peak_frame_id": anchor_id,
            "final_peak_source": "xgb",
            "final_peak_reason": "xgb_required",
        }

    curve: list[dict[str, Any]] = []
    cache_key = frame_cache.cache_key_for_video(rel_norm, dataset_id=dataset_id)
    payload = {
        "status": "done",
        "job_id": jid,
        "cache_key": cache_key,
        "video_rel_path": rel_norm,
        "cached_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_mtime_ns": video_path.stat().st_mtime_ns,
        "video_path": str(video_path),
        "video_width": int(meta["video_width"]),
        "video_height": int(meta["video_height"]),
        "fps": float(meta["fps"]),
        "total_source_frames": int(meta["total_source_frames"]),
        "sample_fps": float(sample_fps),
        "sampled_frame_ids": sampled_ids,
        "peak_frame_id": int(anchor_id),
        "tier1_peak_frame_id": int(anchor_id),
        "default_selected_frame_ids": default_selected,
        "curve": curve,
        "peak_selection_mode": mode,
        "tier1_search_mode": str(tier1_search_mode),
        **xgb_fields,
    }
    _persist(cache_dir, payload, job_id=jid, dataset_id=dataset_id, rel_norm=rel_norm)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    logger.info(
        "annotation prep done video_rel=%s job_id=%s mode=%s sampled_frames=%d total_ms=%.1f",
        rel_norm,
        jid,
        mode,
        len(sampled_ids),
        elapsed_ms,
    )
    return PrepResult(
        job_id=jid,
        video_rel_path=rel_norm,
        video_path=str(video_path),
        video_width=int(meta["video_width"]),
        video_height=int(meta["video_height"]),
        fps=float(meta["fps"]),
        total_source_frames=int(meta["total_source_frames"]),
        sample_fps=float(sample_fps),
        sampled_frame_ids=sampled_ids,
        peak_frame_id=int(anchor_id),
        tier1_peak_frame_id=int(anchor_id),
        default_selected_frame_ids=default_selected,
        curve=curve,
        peak_selection_mode=mode,
        tier1_search_mode=str(tier1_search_mode),
        **xgb_fields,
    )


def load_prep_result(job_id: str) -> dict[str, Any]:
    job_ref = _job_video_rel.get(job_id)
    if job_ref:
        dataset_id, rel = job_ref
        path = frame_cache.prep_result_path(rel, dataset_id=dataset_id)
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    legacy = prep_cache_root() / job_id / "prep_result.json"
    if legacy.is_file():
        return json.loads(legacy.read_text(encoding="utf-8"))
    raise FileNotFoundError(f"prep job not found: {job_id}")


def frame_jpeg_path(job_id: str, frame_id: int) -> Path:
    job_ref = _job_video_rel.get(job_id)
    if job_ref:
        dataset_id, rel = job_ref
        return frame_cache.frame_jpeg_path_for_video(rel, frame_id, dataset_id=dataset_id)
    return prep_cache_root() / job_id / "frames" / f"{int(frame_id):06d}.jpg"


def frame_jpeg_path_for_video_rel(video_rel: str, frame_id: int, dataset_id: str | None = None) -> Path:
    return frame_cache.frame_jpeg_path_for_video(video_rel, frame_id, dataset_id=dataset_id)
