"""Local dataset registry for height annotation (066)."""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATASETS_CONFIG_FILENAME = "height_annot_datasets.json"
DEFAULT_DATASET_ID = "auckland_default"
DEFAULT_DATASET_LABEL = "Auckland"


class DatasetError(ValueError):
    """Dataset registry operation failed."""


@dataclass(frozen=True)
class HeightAnnotDataset:
    dataset_id: str
    label: str
    root: str
    enabled: bool
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "dataset_id": self.dataset_id,
            "label": self.label,
            "root": self.root,
            "enabled": self.enabled,
            "created_at": self.created_at,
        }


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def datasets_config_path() -> Path:
    env = os.environ.get("HEIGHT_ANNOT_DATASETS_CONFIG", "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "data" / DATASETS_CONFIG_FILENAME


def _default_root() -> Path:
    try:
        from . import paths

        override = getattr(paths, "_ROOT_OVERRIDE", None)
        if override is not None:
            return Path(override)
    except Exception:
        pass
    return Path(os.environ.get("MANUTECH_RES_ROOT", "/mnt/c/ziggear/ManuTechRes"))


def _default_dataset() -> HeightAnnotDataset:
    return HeightAnnotDataset(
        dataset_id=DEFAULT_DATASET_ID,
        label=DEFAULT_DATASET_LABEL,
        root=str(_default_root()),
        enabled=True,
        created_at=_now_iso(),
    )


def _write_config(payload: dict[str, Any]) -> None:
    path = datasets_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _read_config() -> dict[str, Any]:
    path = datasets_config_path()
    if not path.is_file():
        payload = {
            "schema_version": 1,
            "active_dataset_id": DEFAULT_DATASET_ID,
            "datasets": [_default_dataset().to_dict()],
        }
        _write_config(payload)
        return payload
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise DatasetError("Invalid dataset config") from exc
    if not isinstance(payload, dict):
        raise DatasetError("Invalid dataset config")
    if not isinstance(payload.get("datasets"), list):
        payload["datasets"] = []
    if not payload["datasets"]:
        payload["datasets"] = [_default_dataset().to_dict()]
    if not payload.get("active_dataset_id"):
        payload["active_dataset_id"] = payload["datasets"][0]["dataset_id"]
    return payload


def list_datasets() -> dict[str, Any]:
    payload = _read_config()
    return {
        "schema_version": int(payload.get("schema_version", 1)),
        "active_dataset_id": str(payload.get("active_dataset_id") or DEFAULT_DATASET_ID),
        "datasets": payload.get("datasets", []),
    }


def active_dataset_id() -> str:
    return str(list_datasets()["active_dataset_id"])


def _dataset_rows() -> list[dict[str, Any]]:
    return list(_read_config().get("datasets", []))


def get_dataset(dataset_id: str | None = None) -> HeightAnnotDataset:
    wanted = dataset_id or active_dataset_id()
    for row in _dataset_rows():
        if str(row.get("dataset_id")) == wanted:
            return HeightAnnotDataset(
                dataset_id=str(row.get("dataset_id")),
                label=str(row.get("label") or row.get("dataset_id")),
                root=str(row.get("root")),
                enabled=bool(row.get("enabled", True)),
                created_at=str(row.get("created_at") or ""),
            )
    raise DatasetError("Dataset not found")


def dataset_root(dataset_id: str | None = None) -> Path:
    ds = get_dataset(dataset_id)
    if not ds.enabled:
        raise DatasetError("Dataset disabled")
    return Path(ds.root)


def _has_videos_or_validity(root: Path) -> bool:
    if (root / "video_validity.json").is_file():
        return True
    for child in root.rglob("*"):
        if child.is_file() and child.suffix.lower() == ".mp4":
            return True
        if child.is_file() and child.name == "video_validity.json":
            return True
    return False


def validate_dataset_root(root: Path) -> Path:
    resolved = root.expanduser().resolve()
    if not resolved.exists() or not resolved.is_dir():
        raise DatasetError("Folder not found")
    if not _has_videos_or_validity(resolved):
        raise DatasetError("No videos found")
    return resolved


def _slug(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return slug or "dataset"


def add_dataset(*, label: str, root: str) -> HeightAnnotDataset:
    if not label.strip():
        raise DatasetError("Label required")
    resolved_root = validate_dataset_root(Path(root))
    payload = _read_config()
    rows = list(payload.get("datasets", []))
    root_text = str(resolved_root)
    for row in rows:
        try:
            if Path(str(row.get("root"))).expanduser().resolve() == resolved_root:
                return get_dataset(str(row.get("dataset_id")))
        except OSError:
            continue

    existing_ids = {str(row.get("dataset_id")) for row in rows}
    base_id = _slug(label)
    dataset_id = base_id
    n = 2
    while dataset_id in existing_ids:
        dataset_id = f"{base_id}_{n}"
        n += 1
    row = HeightAnnotDataset(
        dataset_id=dataset_id,
        label=label.strip(),
        root=root_text,
        enabled=True,
        created_at=_now_iso(),
    ).to_dict()
    rows.append(row)
    payload["datasets"] = rows
    payload["active_dataset_id"] = dataset_id
    _write_config(payload)
    return get_dataset(dataset_id)


def set_active_dataset(dataset_id: str) -> HeightAnnotDataset:
    ds = get_dataset(dataset_id)
    payload = _read_config()
    payload["active_dataset_id"] = ds.dataset_id
    _write_config(payload)
    return ds
