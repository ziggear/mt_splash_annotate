"""Zip export for height annotation sidecar data (075)."""
from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from .datasets import HeightAnnotDataset

VIDEO_VALIDITY_FILENAME = "video_validity.json"


@dataclass(frozen=True)
class DataExportResult:
    zip_path: Path
    filename: str
    manifest: dict[str, Any]


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _timestamp_for_filename(exported_at: str) -> str:
    return exported_at.replace("-", "").replace(":", "").replace("+00:00", "Z")


def _sanitize_archive_component(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "-", name).strip(" .")
    return cleaned or "dataset"


def _slug_for_filename(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-")
    return slug or "dataset"


def _safe_archive_path(archive_root: str, rel_path: Path) -> str:
    parts = [archive_root, *rel_path.parts]
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"unsafe archive path: {rel_path}")
    archive_path = PurePosixPath(*parts)
    if archive_path.is_absolute() or ".." in archive_path.parts:
        raise ValueError(f"unsafe archive path: {rel_path}")
    return archive_path.as_posix()


def _is_sidecar_json(path: Path) -> bool:
    if path.name.startswith("._"):
        return False
    if path.name == VIDEO_VALIDITY_FILENAME:
        return False
    if path.suffix != ".json":
        return False
    return path.with_suffix(".mp4").is_file()


def _is_video_validity_json(path: Path) -> bool:
    return path.name == VIDEO_VALIDITY_FILENAME


def _iter_export_files(root: Path) -> list[tuple[str, Path]]:
    files: list[tuple[str, Path]] = []
    for path in sorted(root.rglob("*.json")):
        if path.name.startswith("._"):
            continue
        if _is_video_validity_json(path):
            files.append(("video_validity", path))
        elif _is_sidecar_json(path):
            files.append(("sidecar", path))
    return files


def build_height_annot_data_export_zip(
    dataset: HeightAnnotDataset,
    zip_path: Path,
    *,
    exported_at: str | None = None,
) -> DataExportResult:
    root = Path(dataset.root)
    if not root.is_dir():
        raise FileNotFoundError(f"Dataset root not found: {root}")

    exported = exported_at or _now_iso()
    source_root_name = root.name or "dataset"
    archive_root = _sanitize_archive_component(source_root_name)
    files_meta: list[dict[str, Any]] = []
    export_files = _iter_export_files(root)

    for kind, path in export_files:
        rel_path = path.relative_to(root)
        archive_path = _safe_archive_path(archive_root, rel_path)
        row: dict[str, Any] = {
            "kind": kind,
            "archive_path": archive_path,
            "source_rel_path": rel_path.as_posix(),
            "size_bytes": path.stat().st_size,
        }
        if kind == "sidecar":
            row["video_rel_path"] = rel_path.with_suffix(".mp4").as_posix()
        else:
            folder_rel = rel_path.parent.as_posix()
            row["folder_rel_path"] = "" if folder_rel == "." else folder_rel
        files_meta.append(row)

    manifest: dict[str, Any] = {
        "schema_version": 1,
        "export_type": "height_annotate_data",
        "exported_at": exported,
        "dataset_id": dataset.dataset_id,
        "dataset_label": dataset.label,
        "source_root_path": str(root),
        "source_root_name": source_root_name,
        "archive_root": archive_root,
        "sidecar_count": sum(1 for row in files_meta if row["kind"] == "sidecar"),
        "video_validity_count": sum(1 for row in files_meta if row["kind"] == "video_validity"),
        "files": files_meta,
    }

    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        for row, (_kind, path) in zip(files_meta, export_files):
            zf.write(path, row["archive_path"])

    filename = (
        f"height-annot-data-{_slug_for_filename(archive_root)}-"
        f"{_timestamp_for_filename(exported)}.zip"
    )
    return DataExportResult(zip_path=zip_path, filename=filename, manifest=manifest)
