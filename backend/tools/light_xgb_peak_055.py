"""Small feature extractor used by the 060b height-annotation XGBoost model."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

FEATURE_RESIZE_WIDTH = 480
FEATURE_COLUMNS: tuple[str, ...] = (
    "t_norm",
    "t_offset_from_mark",
    "t_offset_from_prior_center",
    "gray_mean",
    "gray_std",
    "gray_p95",
    "gray_p99",
    "hsv_v_mean",
    "hsv_v_std",
    "hsv_v_p95",
    "hsv_v_p99",
    "white_area_ratio",
    "white_top_y",
    "white_top_y_quantile_05",
    "white_centroid_y",
    "prev_gray_absdiff_mean",
    "prev_gray_absdiff_p95",
    "prev_v_absdiff_mean",
    "prev_v_absdiff_p95",
    "prev_diff_area_ratio_t20",
    "prev_diff_top_y_t20",
    "white_area_roll_mean_3",
    "white_area_roll_max_5",
    "white_top_y_roll_min_5",
    "white_top_y_velocity",
    "white_top_y_accel",
    "diff_area_roll_mean_3",
    "diff_area_roll_max_5",
    "water_y_px",
    "white_top_above_water_px",
    "diff_top_above_water_px",
)


@dataclass(frozen=True)
class FrameImage:
    frame_id: int
    bgr: np.ndarray


def _percentile(arr: np.ndarray, q: float) -> float:
    return float(np.percentile(arr, q)) if arr.size else 0.0


def _top_stats(mask: np.ndarray, height: int) -> tuple[float, float, float, float]:
    ys = np.where(mask > 0)[0]
    if ys.size == 0:
        return 0.0, float(height), float(height), float(height)
    return (
        float(ys.size) / float(mask.size),
        float(np.min(ys)),
        float(np.quantile(ys, 0.05)),
        float(np.mean(ys)),
    )


def resize_for_features(
    bgr: np.ndarray,
    *,
    feature_width: int = FEATURE_RESIZE_WIDTH,
) -> tuple[np.ndarray, float]:
    if feature_width <= 0:
        return bgr, 1.0
    h, w = bgr.shape[:2]
    if w <= feature_width:
        return bgr, 1.0
    scale = float(feature_width) / float(w)
    resized = cv2.resize(
        bgr,
        (int(feature_width), max(1, int(round(h * scale)))),
        interpolation=cv2.INTER_AREA,
    )
    return resized, scale


def extract_light_features(
    frames: list[FrameImage],
    *,
    t_mark_frame: int | None = None,
    water_y_px: float | None = None,
    feature_width: int = FEATURE_RESIZE_WIDTH,
) -> list[dict[str, float | int]]:
    if not frames:
        return []
    max_frame = max(int(f.frame_id) for f in frames)
    min_frame = min(int(f.frame_id) for f in frames)
    mark = int(t_mark_frame if t_mark_frame is not None else max_frame)
    prior_center = mark - 30
    base_rows: list[dict[str, float | int]] = []
    prev_gray: np.ndarray | None = None
    prev_v: np.ndarray | None = None
    for frame in frames:
        bgr, scale = resize_for_features(frame.bgr, feature_width=feature_width)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
        s = hsv[:, :, 1]
        v = hsv[:, :, 2]
        h, _w = gray.shape[:2]
        white_mask = (((v >= 200) & (s <= 90)) | (gray >= 230)).astype(np.uint8)
        white_area, white_top, white_top_q05, white_cy = _top_stats(white_mask, h)
        if prev_gray is None:
            gray_diff = np.zeros_like(gray)
            v_diff = np.zeros_like(v)
        else:
            gray_diff = cv2.absdiff(gray, prev_gray)
            v_diff = cv2.absdiff(v, prev_v)
        diff_mask = (gray_diff >= 20).astype(np.uint8)
        diff_area, diff_top, _diff_top_q05, _diff_cy = _top_stats(diff_mask, h)
        water = float(water_y_px) * float(scale) if water_y_px is not None else 0.0
        row: dict[str, float | int] = {
            "frame_id": int(frame.frame_id),
            "t_norm": float((int(frame.frame_id) - min_frame) / max(1, max_frame - min_frame)),
            "t_offset_from_mark": float(int(frame.frame_id) - mark),
            "t_offset_from_prior_center": float(int(frame.frame_id) - prior_center),
            "gray_mean": float(np.mean(gray)),
            "gray_std": float(np.std(gray)),
            "gray_p95": _percentile(gray, 95),
            "gray_p99": _percentile(gray, 99),
            "hsv_v_mean": float(np.mean(v)),
            "hsv_v_std": float(np.std(v)),
            "hsv_v_p95": _percentile(v, 95),
            "hsv_v_p99": _percentile(v, 99),
            "white_area_ratio": white_area,
            "white_top_y": white_top,
            "white_top_y_quantile_05": white_top_q05,
            "white_centroid_y": white_cy,
            "prev_gray_absdiff_mean": float(np.mean(gray_diff)),
            "prev_gray_absdiff_p95": _percentile(gray_diff, 95),
            "prev_v_absdiff_mean": float(np.mean(v_diff)),
            "prev_v_absdiff_p95": _percentile(v_diff, 95),
            "prev_diff_area_ratio_t20": diff_area,
            "prev_diff_top_y_t20": diff_top,
            "water_y_px": water,
            "white_top_above_water_px": max(0.0, water - white_top) if water > 0 else 0.0,
            "diff_top_above_water_px": max(0.0, water - diff_top) if water > 0 else 0.0,
        }
        base_rows.append(row)
        prev_gray = gray
        prev_v = v

    white_areas = [float(r["white_area_ratio"]) for r in base_rows]
    white_tops = [float(r["white_top_y"]) for r in base_rows]
    diff_areas = [float(r["prev_diff_area_ratio_t20"]) for r in base_rows]
    for i, row in enumerate(base_rows):
        w3 = white_areas[max(0, i - 2) : i + 1]
        w5 = white_areas[max(0, i - 4) : i + 1]
        t5 = white_tops[max(0, i - 4) : i + 1]
        d3 = diff_areas[max(0, i - 2) : i + 1]
        d5 = diff_areas[max(0, i - 4) : i + 1]
        velocity = white_tops[i] - white_tops[i - 1] if i >= 1 else 0.0
        prev_velocity = white_tops[i - 1] - white_tops[i - 2] if i >= 2 else 0.0
        row.update(
            {
                "white_area_roll_mean_3": float(sum(w3) / len(w3)),
                "white_area_roll_max_5": float(max(w5)),
                "white_top_y_roll_min_5": float(min(t5)),
                "white_top_y_velocity": float(velocity),
                "white_top_y_accel": float(velocity - prev_velocity),
                "diff_area_roll_mean_3": float(sum(d3) / len(d3)),
                "diff_area_roll_max_5": float(max(d5)),
            }
        )
    return base_rows
