"""Sidecar JSON schema and validation for height annotation (037)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class FrameAnnotation(BaseModel):
    frame_id: int = Field(ge=1)
    timestamp_ms: int = Field(ge=0)
    water_y: Optional[int] = Field(default=None, ge=0)
    splash_top_y: Optional[int] = Field(default=None, ge=0)
    splash_height_px: Optional[int] = Field(default=None, ge=0)
    annotated: bool = False
    dino_box_xyxy: Optional[list[float]] = None
    dino_box_source: Optional[str] = None
    dino_box_phrase: Optional[str] = None
    dino_box_score: Optional[float] = None
    dino_box_anchor_xyxy: Optional[list[float]] = None
    dino_box_quality: Optional[dict[str, Any]] = None
    dino_box_updated_at: Optional[str] = None
    splash_roi_xyxy: Optional[list[int]] = None
    splash_roi_source: Optional[str] = None
    splash_roi_quality: Optional[dict[str, Any]] = None
    has_splash: Optional[bool] = None
    has_athlete: Optional[bool] = None

    @model_validator(mode="after")
    def _validate_geometry(self) -> "FrameAnnotation":
        if self.water_y is not None and self.splash_top_y is not None:
            if self.splash_top_y >= self.water_y:
                raise ValueError("splash_top_y must be above water_y (smaller y value)")
        if self.splash_roi_xyxy is not None:
            if len(self.splash_roi_xyxy) != 4:
                raise ValueError("splash_roi_xyxy must be [x1, y1, x2, y2]")
            x1, y1, x2, y2 = self.splash_roi_xyxy
            if x1 < 0 or y1 < 0:
                raise ValueError("splash_roi_xyxy values must be non-negative")
            if x1 >= x2 or y1 >= y2:
                raise ValueError("splash_roi_xyxy must satisfy x1 < x2 and y1 < y2")
        return self


class HeightAnnotSidecar(BaseModel):
    schema_version: int = 1
    dataset_id: Optional[str] = None
    dataset_label: Optional[str] = None
    annotation_modes: list[str] = Field(default_factory=list)
    video_path: str
    video_width: int = Field(ge=1)
    video_height: int = Field(ge=1)
    fps: float = Field(gt=0)
    total_source_frames: int = Field(ge=1)
    sample_fps: float = Field(gt=0)
    annotation_created_at: str
    annotation_updated_at: str
    tier1_search_mode: str = "full_frame"
    peak_selection_mode: str = "mog2_plus_ref_diff"
    tier1_peak_frame_id: Optional[int] = Field(default=None, ge=1)
    selected_frame_ids: list[int] = Field(default_factory=list)
    default_water_y: Optional[int] = Field(default=None, ge=0)
    frames: list[FrameAnnotation] = Field(default_factory=list)
    schema_version_unknown: bool = False

    @field_validator("selected_frame_ids")
    @classmethod
    def _selected_monotonic_unique(cls, v: list[int]) -> list[int]:
        if len(v) != len(set(v)):
            raise ValueError("selected_frame_ids must be unique")
        return v

    @model_validator(mode="after")
    def _validate_frames(self) -> "HeightAnnotSidecar":
        seen: set[int] = set()
        for fr in self.frames:
            if fr.frame_id in seen:
                raise ValueError(f"duplicate frame_id: {fr.frame_id}")
            seen.add(fr.frame_id)
            if fr.water_y is not None and fr.water_y >= self.video_height:
                raise ValueError(f"water_y out of range for frame {fr.frame_id}")
            if fr.splash_top_y is not None and fr.splash_top_y >= self.video_height:
                raise ValueError(f"splash_top_y out of range for frame {fr.frame_id}")
            if fr.splash_roi_xyxy is not None:
                x1, y1, x2, y2 = fr.splash_roi_xyxy
                if x2 > self.video_width or y2 > self.video_height:
                    raise ValueError(f"splash_roi_xyxy out of range for frame {fr.frame_id}")
        return self


def validate_sidecar(
    payload: dict[str, Any],
    *,
    allow_unknown_schema_version: bool = False,
) -> HeightAnnotSidecar:
    """Parse and validate a sidecar payload."""
    version = int(payload.get("schema_version", 1))
    doc = HeightAnnotSidecar.model_validate(payload)
    if version not in (1, 2, 3):
        if not allow_unknown_schema_version:
            raise ValueError(f"unsupported schema_version: {version}")
        doc.schema_version_unknown = True
    return doc


def _splash_roi_quality(fr: FrameAnnotation, *, tolerance_px: int = 8) -> Optional[dict[str, Any]]:
    if fr.splash_roi_xyxy is None:
        return None
    _x1, y1, _x2, y2 = fr.splash_roi_xyxy
    warnings: list[str] = []
    top_contains = True
    bottom_contains = True
    if fr.splash_top_y is not None:
        top_contains = y1 <= fr.splash_top_y + tolerance_px
        if not top_contains:
            warnings.append("roi_top_below_splash_top_y")
    if fr.water_y is not None:
        bottom_contains = y2 >= fr.water_y - tolerance_px
        if not bottom_contains:
            warnings.append("roi_bottom_above_water_y")
    return {
        "top_contains_splash_top": top_contains,
        "bottom_contains_water_y": bottom_contains,
        "warnings": warnings,
    }


def _frame_is_annotated(fr: FrameAnnotation) -> bool:
    if fr.water_y is None or fr.splash_top_y is None:
        return False
    return fr.splash_top_y < fr.water_y


def normalize_sidecar_for_save(
    doc: HeightAnnotSidecar,
    *,
    now: Optional[datetime] = None,
    preserve_created_at: bool = True,
) -> HeightAnnotSidecar:
    """Compute derived fields before writing to disk."""
    ts = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    created = doc.annotation_created_at if preserve_created_at and doc.annotation_created_at else ts
    frames_out: list[FrameAnnotation] = []
    for fr in doc.frames:
        water_y = fr.water_y
        splash_top_y = fr.splash_top_y
        splash_height_px: Optional[int] = None
        annotated = False
        has_splash = fr.has_splash
        if water_y is not None and splash_top_y is not None and splash_top_y < water_y:
            splash_height_px = max(0, water_y - splash_top_y)
            annotated = True
            has_splash = True
        frames_out.append(
            FrameAnnotation(
                frame_id=fr.frame_id,
                timestamp_ms=fr.timestamp_ms,
                water_y=water_y,
                splash_top_y=splash_top_y,
                splash_height_px=splash_height_px,
                annotated=annotated,
                dino_box_xyxy=fr.dino_box_xyxy,
                dino_box_source=fr.dino_box_source,
                dino_box_phrase=fr.dino_box_phrase,
                dino_box_score=fr.dino_box_score,
                dino_box_anchor_xyxy=fr.dino_box_anchor_xyxy,
                dino_box_quality=fr.dino_box_quality,
                dino_box_updated_at=fr.dino_box_updated_at,
                splash_roi_xyxy=fr.splash_roi_xyxy,
                splash_roi_source=fr.splash_roi_source,
                splash_roi_quality=_splash_roi_quality(fr),
                has_splash=has_splash,
                has_athlete=fr.has_athlete,
            )
        )
    return doc.model_copy(
        update={
            "annotation_created_at": created,
            "annotation_updated_at": ts,
            "frames": frames_out,
        }
    )


def sidecar_to_dict(doc: HeightAnnotSidecar) -> dict[str, Any]:
    """Serialize for JSON write (drop internal flags)."""
    data = doc.model_dump(mode="json")
    data.pop("schema_version_unknown", None)
    return data
