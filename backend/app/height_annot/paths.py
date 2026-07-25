"""ManuTechRes path safety and browse helpers (037)."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from .video_validity import generate_video_validity

LEGACY_EXCLUDED_DIR_NAMES: frozenset[str] = frozenset(f"20260314-{i:03d}" for i in range(1, 21))
EXTRACT_ONLY_FOLDER = "others"
VIDEO_VALIDITY_FILENAME = "video_validity.json"

_ROOT_OVERRIDE: Path | None = None


class PathSecurityError(ValueError):
    """Relative path escapes MANUTECH_RES_ROOT."""


class LegacyFolderExcluded(ValueError):
    """Path enters a legacy batch directory excluded from annotation."""


class VideoNotValid(ValueError):
    """Video missing from video_validity.json or marked invalid."""


def manutech_res_root() -> Path:
    if _ROOT_OVERRIDE is not None:
        return _ROOT_OVERRIDE
    return Path(os.environ.get("MANUTECH_RES_ROOT", "/mnt/c/ziggear/ManuTechRes"))


def _root_for_dataset(dataset_id: str | None = None) -> Path:
    if dataset_id is None:
        return manutech_res_root()
    from .datasets import dataset_root

    return dataset_root(dataset_id)


def assert_not_legacy_rel(rel: str) -> None:
    rel_norm = rel.strip().strip("/")
    if not rel_norm:
        return
    for part in rel_norm.split("/"):
        if part in LEGACY_EXCLUDED_DIR_NAMES:
            raise LegacyFolderExcluded(f"Legacy folder excluded: {part}")


def assert_under_root(path: Path, root: Path | None = None) -> Path:
    base = (root or manutech_res_root()).resolve()
    resolved = path.resolve()
    try:
        resolved.relative_to(base)
    except ValueError as exc:
        raise PathSecurityError(f"path outside data root: {path}") from exc
    return resolved


def _normalize_rel(rel: str) -> str:
    rel = rel.strip().replace("\\", "/")
    if ".." in rel.split("/"):
        raise PathSecurityError("parent traversal not allowed")
    return rel.strip("/")


def is_extract_only_video_rel(rel: str) -> bool:
    """True for videos under MANUTECH_RES_ROOT/others (prep: decode only, no peak)."""
    rel_norm = _normalize_rel(rel)
    if not rel_norm:
        return False
    return rel_norm.split("/", 1)[0] == EXTRACT_ONLY_FOLDER


def load_video_validity_index(folder: Path) -> dict[str, dict] | None:
    """Return video_id → row map, or None when ``video_validity.json`` is absent."""
    report_path = folder / VIDEO_VALIDITY_FILENAME
    if not report_path.is_file():
        return None
    try:
        data = json.loads(report_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    rows = data.get("videos") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return {}
    return {str(r.get("video_id") or ""): r for r in rows if r.get("video_id")}


def is_video_valid_for_browse(mp4: Path) -> bool:
    """True only when folder manifest lists this video with ``valid: true``."""
    index = load_video_validity_index(mp4.parent)
    if index is None:
        return False
    row = index.get(mp4.stem)
    if row is None:
        return False
    return bool(row.get("valid"))


def assert_video_valid(mp4: Path) -> None:
    index = load_video_validity_index(mp4.parent)
    if index is None:
        raise VideoNotValid(f"{VIDEO_VALIDITY_FILENAME} missing in {mp4.parent}")
    row = index.get(mp4.stem)
    if row is None:
        raise VideoNotValid(f"video not listed in {VIDEO_VALIDITY_FILENAME}: {mp4.name}")
    if not bool(row.get("valid")):
        msg = str(row.get("message") or "invalid")
        raise VideoNotValid(f"video marked invalid: {mp4.name} ({msg})")


def resolve_video_path(rel: str, dataset_id: str | None = None) -> Path:
    """Resolve a video relative path under MANUTECH_RES_ROOT."""
    rel_raw = rel.strip().replace("\\", "/")
    if ".." in rel_raw.split("/"):
        raise PathSecurityError("parent traversal not allowed")
    root = _root_for_dataset(dataset_id)
    if rel_raw.startswith("/"):
        assert_not_legacy_rel(rel_raw.lstrip("/"))
        resolved = assert_under_root(Path(rel_raw), root)
    else:
        rel_norm = rel_raw.lstrip("/")
        assert_not_legacy_rel(rel_norm)
        resolved = assert_under_root((root / rel_norm).resolve(), root)
    assert_video_valid(resolved)
    return resolved


def resolve_folder_rel(rel: str, dataset_id: str | None = None) -> Path:
    rel_norm = _normalize_rel(rel)
    assert_not_legacy_rel(rel_norm)
    root = _root_for_dataset(dataset_id)
    folder = (root / rel_norm).resolve() if rel_norm else root.resolve()
    return assert_under_root(folder, root)


def annotation_path_for(video_path: Path) -> Path:
    return video_path.with_suffix(".json")


def has_annotation(video_path: Path) -> bool:
    return annotation_path_for(video_path).is_file()


def list_mp4_videos(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    out: list[Path] = []
    for entry in sorted(folder.iterdir()):
        if entry.is_file() and entry.suffix.lower() == ".mp4":
            out.append(entry)
    return out


def list_browseable_mp4_videos(folder: Path) -> list[Path]:
    """Mp4 files passing ``video_validity.json`` (valid-only manifest gate)."""
    return [p for p in list_mp4_videos(folder) if is_video_valid_for_browse(p)]


def list_subdirs(folder: Path) -> list[str]:
    if not folder.is_dir():
        return []
    names: list[str] = []
    for entry in sorted(folder.iterdir()):
        if not entry.is_dir():
            continue
        if entry.name in LEGACY_EXCLUDED_DIR_NAMES:
            continue
        names.append(entry.name)
    return names


@dataclass
class BrowseVideoEntry:
    name: str
    rel_path: str
    has_annotation: bool
    duration_s: float
    size_bytes: int


@dataclass
class BrowseResult:
    rel: str
    subdirs: list[str]
    videos: list[BrowseVideoEntry]


def _probe_duration_s(video_path: Path) -> float:
    try:
        import cv2

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            return 0.0
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
        if fps <= 0:
            fps = 30.0
        frames = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
        cap.release()
        if frames > 0:
            return round(frames / fps, 2)
    except Exception:
        pass
    try:
        return round(video_path.stat().st_size / 1_000_000, 2)
    except OSError:
        return 0.0


def browse_folder(rel: str = "", dataset_id: str | None = None) -> BrowseResult:
    folder = resolve_folder_rel(rel, dataset_id=dataset_id)
    rel_norm = _normalize_rel(rel)
    generate_video_validity(folder)
    subdirs = list_subdirs(folder)
    videos: list[BrowseVideoEntry] = []
    for mp4 in list_browseable_mp4_videos(folder):
        video_rel = f"{rel_norm}/{mp4.name}" if rel_norm else mp4.name
        videos.append(
            BrowseVideoEntry(
                name=mp4.name,
                rel_path=video_rel.replace("\\", "/"),
                has_annotation=has_annotation(mp4),
                duration_s=_probe_duration_s(mp4),
                size_bytes=mp4.stat().st_size,
            )
        )
    return BrowseResult(rel=rel_norm, subdirs=subdirs, videos=videos)


def probe_video_meta(video_path: Path) -> dict:
    import cv2

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    if fps <= 0:
        fps = 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    if width <= 0 or height <= 0:
        raise ValueError(f"Invalid video dimensions: {video_path}")
    if total <= 0:
        total = 1
    return {
        "video_width": width,
        "video_height": height,
        "fps": fps,
        "total_source_frames": total,
        "duration_s": round(total / fps, 3),
    }
