"""Ground-truth peak frame from ManuTechRes height-annotation sidecars (037/039)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .paths import LEGACY_EXCLUDED_DIR_NAMES, manutech_res_root
from .schema import FrameAnnotation, HeightAnnotSidecar, validate_sidecar


@dataclass(frozen=True)
class GtCase:
    video_path: Path
    sidecar_path: Path
    video_rel: str
    gt_peak_frame_id: int
    total_source_frames: int
    sample_fps: float


def _effective_splash_height(fr: FrameAnnotation) -> int | None:
    if fr.splash_height_px is not None:
        return int(fr.splash_height_px)
    if fr.water_y is not None and fr.splash_top_y is not None and fr.splash_top_y < fr.water_y:
        return int(fr.water_y - fr.splash_top_y)
    return None


def gt_peak_frame_id(doc: HeightAnnotSidecar) -> int:
    """GT peak = argmax(splash_height_px) among annotated frames; tie-break earlier frame_id."""
    annotated: list[tuple[int, int]] = []
    for fr in doc.frames:
        if not fr.annotated:
            continue
        height = _effective_splash_height(fr)
        if height is None or height < 0:
            continue
        annotated.append((int(fr.frame_id), int(height)))
    if not annotated:
        raise ValueError("no annotated frames with splash_height_px")
    best = max(annotated, key=lambda item: (item[1], -item[0]))
    return int(best[0])


def _is_excluded_sidecar(path: Path) -> bool:
    name = path.name.lower()
    if name == "video_validity.json":
        return True
    if "summary" in name:
        return True
    for part in path.parts:
        if part in LEGACY_EXCLUDED_DIR_NAMES:
            return True
    return False


def load_gt_case(sidecar_path: Path, *, root: Path | None = None) -> GtCase:
    base = (root or manutech_res_root()).resolve()
    resolved = sidecar_path.resolve()
    payload = json.loads(resolved.read_text(encoding="utf-8"))
    doc = validate_sidecar(payload, allow_unknown_schema_version=True)
    if doc.schema_version != 1:
        raise ValueError(f"unsupported schema_version: {doc.schema_version}")

    video_path = Path(doc.video_path)
    if not video_path.is_file():
        stem = resolved.stem
        candidates = [
            resolved.with_suffix(".mp4"),
            resolved.parent / f"{stem}.mp4",
        ]
        video_path = next((p for p in candidates if p.is_file()), video_path)
    if not video_path.is_file():
        raise FileNotFoundError(f"video missing for sidecar: {resolved}")

    gt_id = gt_peak_frame_id(doc)
    try:
        video_rel = str(video_path.resolve().relative_to(base))
    except ValueError:
        video_rel = video_path.name

    return GtCase(
        video_path=video_path,
        sidecar_path=resolved,
        video_rel=video_rel.replace("\\", "/"),
        gt_peak_frame_id=gt_id,
        total_source_frames=int(doc.total_source_frames),
        sample_fps=float(doc.sample_fps),
    )


def discover_gt_cases(root: Path | None = None) -> list[GtCase]:
    """Glob schema_version=1 sidecars with annotated GT peaks under MANUTECH_RES_ROOT."""
    base = (root or manutech_res_root()).resolve()
    if not base.is_dir():
        return []

    cases: list[GtCase] = []
    for json_path in sorted(base.rglob("*.json")):
        if _is_excluded_sidecar(json_path):
            continue
        try:
            cases.append(load_gt_case(json_path, root=base))
        except (ValueError, FileNotFoundError, json.JSONDecodeError, OSError):
            continue
    return cases
