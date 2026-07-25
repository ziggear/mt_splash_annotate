"""XGBoost peak inference for height annotation prep."""
from __future__ import annotations

import json
import math
import os
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import mean
from typing import Any

import numpy as np

from tools.light_xgb_peak_055 import FEATURE_COLUMNS as BASE_055_COLUMNS, FrameImage, extract_light_features

from .paths import annotation_path_for
from .schema import validate_sidecar

DEFAULT_MODEL_NAME = "055_base"
DEFAULT_TOP_K = 15
MODEL_ENV = "HEIGHT_ANNOT_XGB_055_MODEL_DIR"
LEGACY_MODEL_ENV = "HEIGHT_ANNOT_XGB_060B_MODEL_DIR"
DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[3] / "models" / "xgb_peak" / DEFAULT_MODEL_NAME

DINO_GEOMETRY_COLUMNS: tuple[str, ...] = (
    "has_dino_box",
    "dino_no_box",
    "dino_box_score",
    "dino_x1_norm",
    "dino_y1_norm",
    "dino_x2_norm",
    "dino_y2_norm",
    "dino_w_norm",
    "dino_h_norm",
    "dino_area_norm",
    "dino_aspect_ratio",
    "dino_center_x_norm",
    "dino_center_y_norm",
    "dino_box_bottom_norm",
    "dino_box_top_norm",
    "dino_top_to_water_norm",
    "dino_bottom_to_water_norm",
    "dino_center_to_water_norm",
)

DINO_QUALITY_COLUMNS: tuple[str, ...] = (
    "dino_overlap_gt_ratio",
    "dino_overlap_bucket_id",
    "dino_overlap_30_50",
    "dino_overlap_50_80",
    "dino_overlap_80_plus",
    "dino_overlap_below_30",
    "dino_overlap_y_px",
)

DINO_TEMPORAL_COLUMNS: tuple[str, ...] = (
    "dino_h_delta_prev",
    "dino_h_delta_next",
    "dino_area_delta_prev",
    "dino_area_delta_next",
    "dino_top_delta_prev",
    "dino_top_delta_next",
    "dino_overlap_delta_prev",
    "dino_overlap_delta_next",
    "dino_h_roll_mean_3",
    "dino_h_roll_max_5",
    "dino_area_roll_mean_3",
    "dino_area_roll_max_5",
    "dino_overlap_roll_mean_3",
    "dino_overlap_roll_max_5",
    "dino_h_local_rank_5",
    "dino_area_local_rank_5",
    "dino_overlap_local_rank_5",
    "dino_h_is_local_max_5",
    "dino_area_is_local_max_5",
    "dino_overlap_is_local_max_5",
)

PHRASE_COLUMNS: tuple[str, ...] = (
    "phrase_splash",
    "phrase_upward_splash",
    "phrase_vertical_water_jet",
    "phrase_tall_water_splash",
    "phrase_splash_plume",
    "fusion_mode_anchor_only",
    "fusion_mode_expanded_by_candidate",
    "fusion_mode_candidate_rescue_no_anchor",
)

DINO_FEATURE_COLUMNS: frozenset[str] = frozenset(
    DINO_GEOMETRY_COLUMNS + DINO_QUALITY_COLUMNS + DINO_TEMPORAL_COLUMNS + PHRASE_COLUMNS
)

BANNED_FEATURE_COLUMNS: frozenset[str] = frozenset(
    {
        "splash_top_y",
        "splash_height_px",
        "gt_peak_frame_id",
        "gt_frame",
        "gap",
        "target",
        "is_near3",
        "is_near10",
    }
)

BUCKET_ID = {
    "": 0,
    "no_box": 0,
    "missing": 0,
    "overlap_below_30": 1,
    "overlap_30_50": 2,
    "overlap_50_80": 3,
    "overlap_80_plus": 4,
}


@dataclass(frozen=True)
class DinoFrame:
    frame_id: int
    water_y: float | None
    box_xyxy: tuple[float, float, float, float] | None
    phrase: str
    source: str
    score: float
    overlap_gt_ratio: float
    overlap_y_px: float
    overlap_bucket: str


@dataclass(frozen=True)
class DinoSidecarInfo:
    video_width: int
    video_height: int
    default_water_y: float | None
    frames_by_id: dict[int, DinoFrame]
    annotated_frame_count: int
    dino_frame_count: int
    bucket_counts: dict[str, int]


@dataclass(frozen=True)
class XgbPeakResult:
    available: bool
    feature_status: str
    model_name: str
    feature_set: str
    peak_frame_id: int | None
    peak_score: float | None
    topk_frame_ids: list[int]
    topk_scores: list[float]
    diagnostics: dict[str, Any]


@dataclass(frozen=True)
class FinalPeakDecision:
    final_peak_frame_id: int
    final_peak_source: str
    final_peak_reason: str
    peak_agreement_frames: int | None
    peak_agreement_bucket: str


def model_dir_from_env() -> Path:
    raw = os.environ.get(MODEL_ENV, "").strip()
    if raw:
        return Path(raw)
    legacy_raw = os.environ.get(LEGACY_MODEL_ENV, "").strip()
    return Path(legacy_raw) if legacy_raw else DEFAULT_MODEL_DIR


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return float(default)
        out = float(value)
        if math.isnan(out) or math.isinf(out):
            return float(default)
        return out
    except (TypeError, ValueError):
        return float(default)


def _box_tuple(raw: Any) -> tuple[float, float, float, float] | None:
    if not isinstance(raw, list) or len(raw) < 4:
        return None
    vals = tuple(_safe_float(raw[i]) for i in range(4))
    x1, y1, x2, y2 = vals
    if x2 <= x1 or y2 <= y1:
        return None
    return vals


def _safe_ratio(num: float, den: float) -> float:
    return float(num / den) if abs(den) > 1e-9 else 0.0


def dino_features_for_frame(info: DinoSidecarInfo, frame_id: int) -> dict[str, Any]:
    fr = info.frames_by_id.get(int(frame_id))
    h = max(1.0, float(info.video_height))
    w = max(1.0, float(info.video_width))
    base: dict[str, Any] = {"dino_overlap_bucket_label": "missing"}
    for col in DINO_GEOMETRY_COLUMNS + DINO_QUALITY_COLUMNS + PHRASE_COLUMNS + DINO_TEMPORAL_COLUMNS:
        base[col] = 0.0
    base["dino_no_box"] = 1.0
    if fr is None or fr.box_xyxy is None:
        return base

    x1, y1, x2, y2 = fr.box_xyxy
    bw = max(0.0, x2 - x1)
    bh = max(0.0, y2 - y1)
    cx = x1 + bw / 2.0
    cy = y1 + bh / 2.0
    water_y = fr.water_y if fr.water_y is not None else info.default_water_y
    water_norm = _safe_float(water_y) / h if water_y is not None else 0.0
    bucket = fr.overlap_bucket or "missing"
    phrase = fr.phrase.strip().lower()

    base.update(
        {
            "dino_overlap_bucket_label": bucket,
            "has_dino_box": 1.0,
            "dino_no_box": 0.0,
            "dino_box_score": float(fr.score),
            "dino_x1_norm": x1 / w,
            "dino_y1_norm": y1 / h,
            "dino_x2_norm": x2 / w,
            "dino_y2_norm": y2 / h,
            "dino_w_norm": bw / w,
            "dino_h_norm": bh / h,
            "dino_area_norm": (bw * bh) / (w * h),
            "dino_aspect_ratio": _safe_ratio(bw, bh),
            "dino_center_x_norm": cx / w,
            "dino_center_y_norm": cy / h,
            "dino_box_bottom_norm": y2 / h,
            "dino_box_top_norm": y1 / h,
            "dino_top_to_water_norm": water_norm - (y1 / h) if water_y is not None else 0.0,
            "dino_bottom_to_water_norm": water_norm - (y2 / h) if water_y is not None else 0.0,
            "dino_center_to_water_norm": water_norm - (cy / h) if water_y is not None else 0.0,
            "dino_overlap_gt_ratio": float(fr.overlap_gt_ratio),
            "dino_overlap_bucket_id": float(BUCKET_ID.get(bucket, 0)),
            "dino_overlap_30_50": 1.0 if bucket == "overlap_30_50" else 0.0,
            "dino_overlap_50_80": 1.0 if bucket == "overlap_50_80" else 0.0,
            "dino_overlap_80_plus": 1.0 if bucket == "overlap_80_plus" else 0.0,
            "dino_overlap_below_30": 1.0 if bucket == "overlap_below_30" else 0.0,
            "dino_overlap_y_px": float(fr.overlap_y_px),
            "phrase_splash": 1.0 if phrase == "splash" else 0.0,
            "phrase_upward_splash": 1.0 if phrase == "upward splash" else 0.0,
            "phrase_vertical_water_jet": 1.0 if phrase == "vertical water jet" else 0.0,
            "phrase_tall_water_splash": 1.0 if phrase == "tall water splash" else 0.0,
            "phrase_splash_plume": 1.0 if phrase == "splash plume" else 0.0,
            "fusion_mode_anchor_only": 1.0 if phrase == "splash" else 0.0,
            "fusion_mode_expanded_by_candidate": 1.0
            if phrase in {"upward splash", "vertical water jet", "tall water splash", "splash plume"}
            else 0.0,
            "fusion_mode_candidate_rescue_no_anchor": 0.0,
        }
    )
    return base


def _window(values: list[float], index: int, *, mode: str, radius: int) -> list[float]:
    if mode == "causal":
        return values[max(0, index - (radius * 2)) : index + 1]
    return values[max(0, index - radius) : min(len(values), index + radius + 1)]


def _rank_desc(values: list[float], current: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values, reverse=True)
    for idx, value in enumerate(ordered, start=1):
        if current >= value:
            return float(idx)
    return float(len(values))


def add_dino_temporal_features(rows: list[dict[str, Any]], *, mode: str) -> list[dict[str, Any]]:
    if mode not in {"causal", "centered"}:
        raise ValueError(f"unknown temporal mode: {mode}")
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(str(row["group_id"]), []).append(dict(row))

    out: list[dict[str, Any]] = []
    for _group_id, group_rows in sorted(groups.items()):
        group_rows = sorted(group_rows, key=lambda item: int(item["frame_id"]))
        h_values = [float(row.get("dino_h_norm", 0.0)) for row in group_rows]
        area_values = [float(row.get("dino_area_norm", 0.0)) for row in group_rows]
        top_values = [float(row.get("dino_box_top_norm", 0.0)) for row in group_rows]
        overlap_values = [float(row.get("dino_overlap_gt_ratio", 0.0)) for row in group_rows]
        for i, row in enumerate(group_rows):
            prev_i = max(0, i - 1)
            next_i = min(len(group_rows) - 1, i + 1)
            h3 = _window(h_values, i, mode=mode, radius=1)
            h5 = _window(h_values, i, mode=mode, radius=2)
            a3 = _window(area_values, i, mode=mode, radius=1)
            a5 = _window(area_values, i, mode=mode, radius=2)
            o3 = _window(overlap_values, i, mode=mode, radius=1)
            o5 = _window(overlap_values, i, mode=mode, radius=2)
            next_h = h_values[next_i] if mode == "centered" and i + 1 < len(group_rows) else h_values[i]
            next_area = area_values[next_i] if mode == "centered" and i + 1 < len(group_rows) else area_values[i]
            next_top = top_values[next_i] if mode == "centered" and i + 1 < len(group_rows) else top_values[i]
            next_overlap = overlap_values[next_i] if mode == "centered" and i + 1 < len(group_rows) else overlap_values[i]
            row.update(
                {
                    "dino_h_delta_prev": h_values[i] - h_values[prev_i] if i >= 1 else 0.0,
                    "dino_h_delta_next": next_h - h_values[i],
                    "dino_area_delta_prev": area_values[i] - area_values[prev_i] if i >= 1 else 0.0,
                    "dino_area_delta_next": next_area - area_values[i],
                    "dino_top_delta_prev": top_values[i] - top_values[prev_i] if i >= 1 else 0.0,
                    "dino_top_delta_next": next_top - top_values[i],
                    "dino_overlap_delta_prev": overlap_values[i] - overlap_values[prev_i] if i >= 1 else 0.0,
                    "dino_overlap_delta_next": next_overlap - overlap_values[i],
                    "dino_h_roll_mean_3": float(mean(h3)) if h3 else 0.0,
                    "dino_h_roll_max_5": float(max(h5)) if h5 else 0.0,
                    "dino_area_roll_mean_3": float(mean(a3)) if a3 else 0.0,
                    "dino_area_roll_max_5": float(max(a5)) if a5 else 0.0,
                    "dino_overlap_roll_mean_3": float(mean(o3)) if o3 else 0.0,
                    "dino_overlap_roll_max_5": float(max(o5)) if o5 else 0.0,
                    "dino_h_local_rank_5": _rank_desc(h5, h_values[i]),
                    "dino_area_local_rank_5": _rank_desc(a5, area_values[i]),
                    "dino_overlap_local_rank_5": _rank_desc(o5, overlap_values[i]),
                    "dino_h_is_local_max_5": 1.0 if h5 and h_values[i] > 0 and h_values[i] >= max(h5) else 0.0,
                    "dino_area_is_local_max_5": 1.0 if a5 and area_values[i] > 0 and area_values[i] >= max(a5) else 0.0,
                    "dino_overlap_is_local_max_5": 1.0 if o5 and overlap_values[i] > 0 and overlap_values[i] >= max(o5) else 0.0,
                }
            )
            out.append(row)
    return out


def feature_columns_for_set(feature_set: str) -> tuple[str, ...]:
    if feature_set == "055_base":
        cols = list(BASE_055_COLUMNS)
    elif feature_set == "060b_dino_quality":
        cols = list(BASE_055_COLUMNS) + list(DINO_GEOMETRY_COLUMNS) + list(DINO_QUALITY_COLUMNS)
    elif feature_set == "060b_dino_temporal_causal":
        cols = list(BASE_055_COLUMNS) + list(DINO_GEOMETRY_COLUMNS) + list(DINO_QUALITY_COLUMNS) + list(DINO_TEMPORAL_COLUMNS)
    else:
        raise ValueError(f"unsupported height-annotate XGBoost feature set: {feature_set}")
    banned = sorted(set(cols).intersection(BANNED_FEATURE_COLUMNS))
    if banned:
        raise ValueError(f"banned feature columns present in {feature_set}: {banned}")
    return tuple(cols)


def temporal_mode_for_set(feature_set: str) -> str:
    if feature_set == "060b_dino_temporal_causal":
        return "causal"
    return "none"


def _empty_result(status: str, *, model_dir: Path | None = None, diagnostics: dict[str, Any] | None = None) -> XgbPeakResult:
    return XgbPeakResult(
        available=False,
        feature_status=status,
        model_name=DEFAULT_MODEL_NAME,
        feature_set=DEFAULT_MODEL_NAME,
        peak_frame_id=None,
        peak_score=None,
        topk_frame_ids=[],
        topk_scores=[],
        diagnostics={
            "model_dir": str(model_dir) if model_dir is not None else None,
            **(diagnostics or {}),
        },
    )


def load_dino_info_for_sidecar(sidecar_path: Path, *, video_width: int, video_height: int) -> DinoSidecarInfo:
    payload = json.loads(sidecar_path.read_text(encoding="utf-8"))
    doc = validate_sidecar(payload, allow_unknown_schema_version=True)
    frames_by_id: dict[int, DinoFrame] = {}
    dino_count = 0
    quality_count = 0
    bucket_counts: Counter[str] = Counter()
    for fr in doc.frames:
        box = _box_tuple(fr.dino_box_xyxy)
        quality = fr.dino_box_quality or {}
        bucket = str(quality.get("overlap_bucket") or ("missing" if box is None else "no_box"))
        if box is not None:
            dino_count += 1
            bucket_counts[bucket] += 1
        if quality.get("overlap_bucket") or quality.get("overlap_gt_ratio") is not None:
            quality_count += 1
        frames_by_id[int(fr.frame_id)] = DinoFrame(
            frame_id=int(fr.frame_id),
            water_y=float(fr.water_y) if fr.water_y is not None else None,
            box_xyxy=box,
            phrase=str(fr.dino_box_phrase or ""),
            source=str(fr.dino_box_source or ""),
            score=_safe_float(fr.dino_box_score),
            overlap_gt_ratio=_safe_float(quality.get("overlap_gt_ratio")),
            overlap_y_px=_safe_float(quality.get("overlap_y_px")),
            overlap_bucket=bucket,
        )
    return DinoSidecarInfo(
        video_width=int(doc.video_width or video_width),
        video_height=int(doc.video_height or video_height),
        default_water_y=float(doc.default_water_y) if doc.default_water_y is not None else None,
        frames_by_id=frames_by_id,
        annotated_frame_count=len(doc.frames),
        dino_frame_count=dino_count,
        bucket_counts={**dict(bucket_counts), "_quality_frames": quality_count},
    )


def _load_model(model_dir: Path) -> tuple[Any, tuple[str, ...], dict[str, Any]]:
    model_dir = model_dir.resolve()
    cols_path = model_dir / "feature_columns.json"
    if not cols_path.is_file():
        raise FileNotFoundError(f"missing feature_columns.json in {model_dir}")
    columns_payload = json.loads(cols_path.read_text(encoding="utf-8"))
    columns = tuple(str(c) for c in columns_payload["feature_columns"])
    banned = sorted(set(columns).intersection(BANNED_FEATURE_COLUMNS))
    if banned:
        raise ValueError(f"banned feature columns in model contract: {banned}")
    model_path = model_dir / "model.ubj"
    if not model_path.is_file():
        model_path = model_dir / "model.json"
    if not model_path.is_file():
        raise FileNotFoundError(f"no model.ubj or model.json in {model_dir}")
    import xgboost as xgb

    model = xgb.Booster()
    model.load_model(str(model_path))
    train_cfg_path = model_dir / "train_config.json"
    train_cfg = json.loads(train_cfg_path.read_text(encoding="utf-8")) if train_cfg_path.is_file() else {}
    return model, columns, {"model_path": str(model_path), "train_config": train_cfg}


def _predict_model_scores(model: Any, x: np.ndarray) -> list[float]:
    import xgboost as xgb

    if isinstance(model, xgb.Booster):
        pred = model.predict(xgb.DMatrix(x))
    else:
        pred = model.predict(x)
    return [float(v) for v in pred]


def _build_rows(
    *,
    frames_by_id: dict[int, Any],
    sampled_frame_ids: list[int],
    dino_info: DinoSidecarInfo | None,
    feature_set: str,
) -> list[dict[str, Any]]:
    frame_images = [FrameImage(frame_id=int(fid), bgr=frames_by_id[int(fid)]) for fid in sampled_frame_ids if int(fid) in frames_by_id]
    water_y = dino_info.default_water_y if dino_info is not None else None
    rows = [dict(row) for row in extract_light_features(frame_images, water_y_px=water_y)]
    for row in rows:
        row["group_id"] = "height_annot"
        if dino_info is not None:
            row.update(dino_features_for_frame(dino_info, int(row["frame_id"])))
    mode = temporal_mode_for_set(feature_set)
    if mode != "none":
        rows = add_dino_temporal_features(rows, mode=mode)
    return rows


def predict_xgb_peak_060b(
    *,
    video_path: Path,
    frames_by_id: dict[int, Any],
    sampled_frame_ids: list[int],
    video_width: int,
    video_height: int,
    model_dir: Path | None = None,
    feature_set: str = DEFAULT_MODEL_NAME,
    top_k: int = DEFAULT_TOP_K,
) -> XgbPeakResult:
    run_model_dir = model_dir or model_dir_from_env()
    if not run_model_dir.is_dir():
        return _empty_result("missing_model", model_dir=run_model_dir)
    has_model_file = (run_model_dir / "model.ubj").is_file() or (run_model_dir / "model.json").is_file()
    required_files = {
        "feature_columns.json": (run_model_dir / "feature_columns.json").is_file(),
        "train_config.json": (run_model_dir / "train_config.json").is_file(),
        "model.ubj_or_model.json": has_model_file,
    }
    missing_model_files = [name for name, exists in required_files.items() if not exists]
    if missing_model_files:
        return _empty_result(
            "missing_model",
            model_dir=run_model_dir,
            diagnostics={"missing_files": missing_model_files},
        )
    try:
        model, columns, model_diag = _load_model(run_model_dir)
    except Exception as exc:
        return _empty_result("feature_error", model_dir=run_model_dir, diagnostics={"error": f"{type(exc).__name__}: {exc}"})

    coverage_den = max(1, len(sampled_frame_ids))
    sidecar_path = annotation_path_for(video_path)
    diagnostics: dict[str, Any] = {
        "model_dir": str(run_model_dir),
        "sidecar_path": str(sidecar_path),
        "sidecar_status": "not_required",
    }
    needs_dino = any(col in DINO_FEATURE_COLUMNS for col in columns)
    dino_info: DinoSidecarInfo | None = None
    dino_on_sampled = 0
    quality_on_sampled = 0
    if sidecar_path.is_file():
        try:
            dino_info = load_dino_info_for_sidecar(sidecar_path, video_width=video_width, video_height=video_height)
            dino_on_sampled = sum(
                1
                for fid in sampled_frame_ids
                if int(fid) in dino_info.frames_by_id and dino_info.frames_by_id[int(fid)].box_xyxy is not None
            )
            quality_on_sampled = sum(
                1
                for fid in sampled_frame_ids
                if int(fid) in dino_info.frames_by_id
                and dino_info.frames_by_id[int(fid)].overlap_bucket not in {"", "missing", "no_box"}
            )
            diagnostics.update(
                {
                    "sidecar_status": "loaded",
                    "dino_coverage": float(dino_on_sampled / coverage_den),
                    "dino_quality_coverage": float(quality_on_sampled / coverage_den),
                    "bucket_counts": dict(dino_info.bucket_counts),
                }
            )
        except Exception as exc:
            if needs_dino:
                return _empty_result(
                    "feature_error",
                    model_dir=run_model_dir,
                    diagnostics={**diagnostics, "error": f"{type(exc).__name__}: {exc}"},
                )
            diagnostics.update({"sidecar_status": "ignored_error", "sidecar_error": f"{type(exc).__name__}: {exc}"})
    elif needs_dino:
        return _empty_result("missing_dino", model_dir=run_model_dir, diagnostics=diagnostics)

    if needs_dino and dino_info is not None:
        if dino_on_sampled <= 0:
            return _empty_result("missing_dino", model_dir=run_model_dir, diagnostics=diagnostics)
        if any(col in set(columns) for col in DINO_QUALITY_COLUMNS) and quality_on_sampled <= 0:
            return _empty_result("missing_dino_quality", model_dir=run_model_dir, diagnostics=diagnostics)

    try:
        rows = _build_rows(
            frames_by_id=frames_by_id,
            sampled_frame_ids=sampled_frame_ids,
            dino_info=dino_info,
            feature_set=feature_set,
        )
        if not rows:
            return _empty_result("feature_error", model_dir=run_model_dir, diagnostics={**diagnostics, "error": "no feature rows"})
        missing = sorted(col for col in columns if col not in rows[0])
        if missing:
            return _empty_result("feature_error", model_dir=run_model_dir, diagnostics={**diagnostics, "missing_columns": missing})
        x = np.array([[float(row.get(col, 0.0)) for col in columns] for row in rows], dtype=np.float32)
        scores = _predict_model_scores(model, x)
    except Exception as exc:
        return _empty_result("feature_error", model_dir=run_model_dir, diagnostics={**diagnostics, "error": f"{type(exc).__name__}: {exc}"})

    ranked = sorted(zip(rows, scores), key=lambda item: (-item[1], int(item[0]["frame_id"])))[: int(top_k)]
    if not ranked:
        return _empty_result("feature_error", model_dir=run_model_dir, diagnostics={**diagnostics, "error": "empty ranking"})
    top_row, top_score = ranked[0]
    pred_bucket = str(top_row.get("dino_overlap_bucket_label") or "missing")
    return XgbPeakResult(
        available=True,
        feature_status="ok",
        model_name=DEFAULT_MODEL_NAME,
        feature_set=feature_set,
        peak_frame_id=int(top_row["frame_id"]),
        peak_score=float(top_score),
        topk_frame_ids=[int(row["frame_id"]) for row, _score in ranked],
        topk_scores=[float(score) for _row, score in ranked],
        diagnostics={**diagnostics, **model_diag, "feature_columns": list(columns), "predicted_bucket": pred_bucket},
    )


def agreement_bucket(xgb: XgbPeakResult, legacy_peak_frame_id: int) -> tuple[int | None, str]:
    if not xgb.available or xgb.peak_frame_id is None:
        return None, "xgb_unavailable"
    gap = abs(int(xgb.peak_frame_id) - int(legacy_peak_frame_id))
    if gap <= 10:
        return gap, "same_or_near"
    if gap <= 30:
        return gap, "medium_gap"
    return gap, "far_gap"


def arbitrate_final_peak(xgb: XgbPeakResult, *, legacy_peak_frame_id: int) -> FinalPeakDecision:
    legacy_id = int(legacy_peak_frame_id)
    gap, bucket = agreement_bucket(xgb, legacy_id)
    if not xgb.available or xgb.peak_frame_id is None:
        reason = "xgb_unavailable"
        if xgb.feature_status in {"missing_dino", "missing_dino_quality"}:
            reason = "fallback_legacy_missing_dino"
        elif xgb.feature_status in {"feature_error", "missing_model"}:
            reason = "fallback_legacy_feature_error" if xgb.feature_status == "feature_error" else "xgb_unavailable"
        return FinalPeakDecision(legacy_id, "legacy", reason, gap, bucket)
    xgb_id = int(xgb.peak_frame_id)
    if bucket == "same_or_near":
        return FinalPeakDecision(xgb_id, "xgb", "xgb_agrees_with_legacy", gap, bucket)
    if bucket == "medium_gap":
        return FinalPeakDecision(xgb_id, "xgb", "xgb_medium_gap", gap, bucket)
    if any(abs(int(fid) - legacy_id) <= 3 for fid in xgb.topk_frame_ids[:10]):
        return FinalPeakDecision(xgb_id, "xgb", "xgb_topk_contains_legacy", gap, bucket)

    diag = xgb.diagnostics or {}
    dino_coverage = float(diag.get("dino_coverage") or 0.0)
    pred_bucket = str(diag.get("predicted_bucket") or "")
    if not pred_bucket:
        pred_bucket = ""
    if dino_coverage >= 0.5 and pred_bucket in {"overlap_50_80", "overlap_80_plus"}:
        return FinalPeakDecision(xgb_id, "xgb", "xgb_high_quality_far_from_legacy", gap, bucket)
    return FinalPeakDecision(legacy_id, "legacy", "fallback_legacy_far_disagreement", gap, bucket)


def xgb_payload_fields(xgb: XgbPeakResult, decision: FinalPeakDecision, *, legacy_peak_frame_id: int, legacy_mode: str) -> dict[str, Any]:
    return {
        "xgb_peak_frame_id": xgb.peak_frame_id,
        "xgb_peak_score": xgb.peak_score,
        "xgb_topk_frame_ids": xgb.topk_frame_ids,
        "xgb_topk_scores": xgb.topk_scores,
        "xgb_model_name": xgb.model_name,
        "xgb_feature_set": xgb.feature_set,
        "xgb_feature_status": xgb.feature_status,
        "xgb_available": bool(xgb.available),
        "xgb_diagnostics": xgb.diagnostics,
        "legacy_peak_frame_id": int(legacy_peak_frame_id),
        "legacy_peak_selection_mode": str(legacy_mode),
        "final_peak_frame_id": int(decision.final_peak_frame_id),
        "final_peak_source": decision.final_peak_source,
        "final_peak_reason": decision.final_peak_reason,
        "peak_agreement_frames": decision.peak_agreement_frames,
        "peak_agreement_bucket": decision.peak_agreement_bucket,
    }


def decision_to_dict(decision: FinalPeakDecision) -> dict[str, Any]:
    return asdict(decision)
