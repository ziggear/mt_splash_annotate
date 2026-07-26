"""Height annotation API (037)."""
from __future__ import annotations

import json
import logging
import tempfile
import threading
import time
import uuid
from dataclasses import asdict
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from ..height_annot.paths import (
    LegacyFolderExcluded,
    PathSecurityError,
    VideoNotValid,
    annotation_path_for,
    browse_folder,
    manutech_res_root,
    probe_video_meta,
    resolve_video_path,
)
from ..height_annot.datasets import (
    DatasetError,
    active_dataset_id,
    add_dataset,
    get_dataset,
    list_datasets,
    set_active_dataset,
)
from ..height_annot.frame_cache import (
    cache_dir_for_video,
    cache_key_for_video,
    is_cache_stale,
    read_prep_cache,
)
from ..height_annot.prep import (
    LEGACY_PEAK_SELECTION_MODE_XGB_060B,
    PEAK_SELECTION_MODE_XGB,
    frame_jpeg_path,
    frame_jpeg_path_for_video_rel,
    load_prep_result,
    run_prep,
)
from ..height_annot.schema import (
    HeightAnnotSidecar,
    normalize_sidecar_for_save,
    sidecar_to_dict,
    validate_sidecar,
)
from ..height_annot.data_export import build_height_annot_data_export_zip
from ..height_annot.roi_export import export_roi_csv

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/height-annotate", tags=["height-annotate"])


class PrepJobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class PrepJobState:
    __slots__ = ("job_id", "status", "error", "result")

    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        self.status = PrepJobStatus.QUEUED
        self.error: Optional[str] = None
        self.result: Optional[dict[str, Any]] = None


_prep_jobs: dict[str, PrepJobState] = {}
_prep_lock = threading.Lock()


class PrepRequest(BaseModel):
    video_rel_path: str
    dataset_id: Optional[str] = None
    sample_fps: float = Field(default=10.0, gt=0)
    peak_selection_mode: str = PEAK_SELECTION_MODE_XGB
    tier1_search_mode: str = "full_frame"


class PrepCreateResponse(BaseModel):
    job_id: str


class AddDatasetRequest(BaseModel):
    label: str
    root: str


class SelectFolderResponse(BaseModel):
    path: Optional[str] = None


class UpdateDatasetRequest(BaseModel):
    label: Optional[str] = None
    root: Optional[str] = None
    enabled: Optional[bool] = None


def _http_from_path_error(exc: Exception) -> HTTPException:
    if isinstance(exc, LegacyFolderExcluded):
        return HTTPException(status_code=404, detail="Legacy folder excluded")
    if isinstance(exc, VideoNotValid):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, PathSecurityError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, DatasetError):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


def _request_dataset_id(dataset_id: Optional[str]) -> str:
    return dataset_id or active_dataset_id()


@router.get("/config")
def get_config() -> dict[str, Any]:
    root = manutech_res_root()
    return {"root": str(root), "root_exists": root.is_dir()}


@router.get("/datasets")
def get_datasets() -> dict[str, Any]:
    return list_datasets()


@router.post("/datasets")
def create_dataset(body: AddDatasetRequest) -> dict[str, Any]:
    try:
        dataset = add_dataset(label=body.label, root=body.root)
    except DatasetError as exc:
        raise _http_from_path_error(exc) from exc
    return {"dataset": dataset.to_dict(), **list_datasets()}


@router.post("/select-folder")
def select_folder() -> SelectFolderResponse:
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(title="Select ManuTech video folder")
        root.destroy()
        return SelectFolderResponse(path=selected or None)
    except Exception as exc:
        raise HTTPException(status_code=501, detail=f"folder picker unavailable: {exc}") from exc


@router.put("/datasets/{dataset_id}/active")
def activate_dataset(dataset_id: str) -> dict[str, Any]:
    try:
        dataset = set_active_dataset(dataset_id)
    except DatasetError as exc:
        raise _http_from_path_error(exc) from exc
    return {"dataset": dataset.to_dict(), **list_datasets()}


@router.put("/datasets/{dataset_id}")
def update_dataset(dataset_id: str, body: UpdateDatasetRequest) -> dict[str, Any]:
    # P0 exposes the route for clients; root editing remains intentionally strict.
    try:
        dataset = get_dataset(dataset_id)
    except DatasetError as exc:
        raise _http_from_path_error(exc) from exc
    return {"dataset": dataset.to_dict(), **list_datasets()}


@router.get("/roi-export.csv")
def export_roi_annotations(dataset_id: Optional[str] = Query(default=None)) -> Response:
    dsid = _request_dataset_id(dataset_id)
    try:
        dataset = get_dataset(dsid)
        csv_text = export_roi_csv(dataset)
    except DatasetError as exc:
        raise _http_from_path_error(exc) from exc
    headers = {"Content-Disposition": f'attachment; filename="height_annot_roi_{dsid}.csv"'}
    return Response(content=csv_text, media_type="text/csv", headers=headers)


@router.get("/data-export.zip")
def export_height_annot_data(dataset_id: Optional[str] = Query(default=None)) -> FileResponse:
    dsid = _request_dataset_id(dataset_id)
    tmp = tempfile.NamedTemporaryFile(prefix="height_annot_data_", suffix=".zip", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    try:
        dataset = get_dataset(dsid)
        result = build_height_annot_data_export_zip(dataset, tmp_path)
    except (DatasetError, FileNotFoundError) as exc:
        tmp_path.unlink(missing_ok=True)
        raise _http_from_path_error(exc) from exc
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    return FileResponse(
        result.zip_path,
        media_type="application/zip",
        filename=result.filename,
        background=BackgroundTask(lambda path: Path(path).unlink(missing_ok=True), str(result.zip_path)),
    )


@router.get("/browse")
def browse(
    rel: str = Query(default=""),
    dataset_id: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    dsid = _request_dataset_id(dataset_id)
    try:
        result = browse_folder(rel, dataset_id=dsid)
    except (PathSecurityError, LegacyFolderExcluded, VideoNotValid, DatasetError) as exc:
        raise _http_from_path_error(exc) from exc
    return {
        "dataset_id": dsid,
        "rel": result.rel,
        "subdirs": result.subdirs,
        "videos": [asdict(v) for v in result.videos],
    }


@router.get("/videos/{video_rel_path:path}")
def get_video_meta(
    video_rel_path: str,
    dataset_id: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    dsid = _request_dataset_id(dataset_id)
    try:
        video_path = resolve_video_path(video_rel_path, dataset_id=dsid)
    except (PathSecurityError, LegacyFolderExcluded, VideoNotValid, DatasetError) as exc:
        raise _http_from_path_error(exc) from exc
    if not video_path.is_file():
        raise HTTPException(status_code=404, detail="video not found")
    meta = probe_video_meta(video_path)
    ann_path = annotation_path_for(video_path)
    existing: Optional[dict[str, Any]] = None
    if ann_path.is_file():
        try:
            existing = json.loads(ann_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing = None
    return {
        "rel_path": video_rel_path.replace("\\", "/"),
        "dataset_id": dsid,
        "video_path": str(video_path),
        "has_annotation": ann_path.is_file(),
        "existing_annotation": existing,
        **_prep_cache_flags(video_rel_path.replace("\\", "/"), dataset_id=dsid),
        **meta,
    }


def _prep_cache_flags(video_rel: str, dataset_id: str | None = None) -> dict[str, Any]:
    cached = read_prep_cache(video_rel, dataset_id=dataset_id)
    if not cached:
        return {
            "has_prep_cache": False,
            "prep_cache_stale": False,
            "prep_cache_sample_fps": None,
            "prep_cache_peak_selection_mode": None,
        }
    return {
        "has_prep_cache": True,
        "prep_cache_stale": is_cache_stale(video_rel, cached, dataset_id=dataset_id),
        "prep_cache_sample_fps": cached.get("sample_fps"),
        "prep_cache_peak_selection_mode": cached.get("peak_selection_mode"),
    }


@router.get("/prep-cache")
def get_prep_cache(
    video_rel: str = Query(...),
    dataset_id: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    dsid = _request_dataset_id(dataset_id)
    rel_norm = video_rel.replace("\\", "/")
    try:
        resolve_video_path(rel_norm, dataset_id=dsid)
    except (PathSecurityError, LegacyFolderExcluded, VideoNotValid, DatasetError) as exc:
        raise _http_from_path_error(exc) from exc

    cache_key = cache_key_for_video(rel_norm, dataset_id=dsid)
    cached = read_prep_cache(rel_norm, dataset_id=dsid)
    if not cached:
        return {"hit": False, "cache_key": cache_key}

    stale = is_cache_stale(rel_norm, cached, dataset_id=dsid)
    return {
        "hit": True,
        "cache_key": cache_key,
        "cache_dir": str(cache_dir_for_video(rel_norm, dataset_id=dsid)),
        "stale": stale,
        **{k: cached[k] for k in cached if k not in ("status", "peak_selection", "job_id")},
    }


def _run_prep_job(job_id: str, body: PrepRequest) -> None:
    st = _prep_jobs[job_id]
    st.status = PrepJobStatus.RUNNING
    rel = body.video_rel_path.replace("\\", "/")
    t0 = time.perf_counter()
    logger.info(
        "height_annot prep job start job_id=%s video_rel=%s sample_fps=%s",
        job_id,
        rel,
        body.sample_fps,
    )
    try:
        result = run_prep(
            body.video_rel_path,
            dataset_id=body.dataset_id,
            sample_fps=body.sample_fps,
            peak_selection_mode=body.peak_selection_mode,
            tier1_search_mode=body.tier1_search_mode,
            job_id=job_id,
        )
        payload = load_prep_result(job_id)
        st.result = payload
        st.status = PrepJobStatus.DONE
        logger.info(
            "height_annot prep job done job_id=%s video_rel=%s wall_ms=%.1f peak_frame_id=%s",
            job_id,
            rel,
            (time.perf_counter() - t0) * 1000.0,
            result.peak_frame_id,
        )
    except Exception as exc:
        logger.exception(
            "height_annot prep job failed job_id=%s video_rel=%s wall_ms=%.1f",
            job_id,
            rel,
            (time.perf_counter() - t0) * 1000.0,
        )
        st.error = str(exc)
        st.status = PrepJobStatus.FAILED


@router.post("/prep")
def start_prep(body: PrepRequest) -> PrepCreateResponse:
    dsid = _request_dataset_id(body.dataset_id)
    rel_norm = body.video_rel_path.replace("\\", "/")
    extract_only = rel_norm.split("/", 1)[0] == "others"
    allowed_modes = {"extract_only"} if extract_only else {PEAK_SELECTION_MODE_XGB, LEGACY_PEAK_SELECTION_MODE_XGB_060B}
    if body.peak_selection_mode not in allowed_modes:
        raise HTTPException(
            status_code=422,
            detail=f"annotation app only supports peak_selection_mode={PEAK_SELECTION_MODE_XGB if not extract_only else 'extract_only'}",
        )
    try:
        resolve_video_path(body.video_rel_path, dataset_id=dsid)
    except (PathSecurityError, LegacyFolderExcluded, VideoNotValid, DatasetError) as exc:
        raise _http_from_path_error(exc) from exc
    normalized_mode = "extract_only" if extract_only else PEAK_SELECTION_MODE_XGB
    body = body.model_copy(update={"dataset_id": dsid, "peak_selection_mode": normalized_mode})

    job_id = uuid.uuid4().hex
    st = PrepJobState(job_id)
    with _prep_lock:
        _prep_jobs[job_id] = st
    thread = threading.Thread(target=_run_prep_job, args=(job_id, body), daemon=True)
    thread.start()
    return PrepCreateResponse(job_id=job_id)


@router.get("/prep/{job_id}")
def get_prep_status(job_id: str) -> dict[str, Any]:
    with _prep_lock:
        st = _prep_jobs.get(job_id)
    if st is None:
        try:
            payload = load_prep_result(job_id)
            return {"status": "done", **payload}
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="prep job not found") from exc

    out: dict[str, Any] = {"job_id": job_id, "status": st.status.value}
    if st.error:
        out["error"] = st.error
    if st.status == PrepJobStatus.DONE and st.result:
        out.update(st.result)
    return out


@router.get("/frame")
def get_frame(
    job_id: Optional[str] = Query(default=None),
    video_rel: Optional[str] = Query(default=None),
    dataset_id: Optional[str] = Query(default=None),
    frame_id: int = Query(..., ge=1),
) -> Response:
    if video_rel:
        dsid = _request_dataset_id(dataset_id)
        rel_norm = video_rel.replace("\\", "/")
        try:
            resolve_video_path(rel_norm, dataset_id=dsid)
        except (PathSecurityError, LegacyFolderExcluded, VideoNotValid, DatasetError) as exc:
            raise _http_from_path_error(exc) from exc
        jpeg = frame_jpeg_path_for_video_rel(rel_norm, frame_id, dataset_id=dsid)
    elif job_id:
        jpeg = frame_jpeg_path(job_id, frame_id)
    else:
        raise HTTPException(status_code=422, detail="video_rel or job_id required")
    if not jpeg.is_file():
        raise HTTPException(status_code=404, detail="frame not found")
    return FileResponse(str(jpeg), media_type="image/jpeg")


@router.get("/annotations")
def get_annotation(
    video_rel: str = Query(...),
    dataset_id: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    dsid = _request_dataset_id(dataset_id)
    try:
        video_path = resolve_video_path(video_rel, dataset_id=dsid)
    except (PathSecurityError, LegacyFolderExcluded, VideoNotValid, DatasetError) as exc:
        raise _http_from_path_error(exc) from exc
    ann_path = annotation_path_for(video_path)
    if not ann_path.is_file():
        raise HTTPException(status_code=404, detail="annotation not found")
    try:
        payload = json.loads(ann_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=500, detail="invalid annotation file") from exc
    return payload


@router.put("/annotations")
def put_annotation(
    body: dict[str, Any],
    dataset_id: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    dsid = _request_dataset_id(dataset_id or body.get("dataset_id"))
    video_rel = str(body.get("video_path") or body.get("video_rel_path") or "")
    if not video_rel:
        raise HTTPException(status_code=422, detail="video_path required")
    try:
        if video_rel.startswith("/"):
            video_path = resolve_video_path(video_rel, dataset_id=dsid)
        else:
            video_path = resolve_video_path(video_rel, dataset_id=dsid)
    except (PathSecurityError, LegacyFolderExcluded, VideoNotValid, DatasetError) as exc:
        raise _http_from_path_error(exc) from exc

    if not video_path.is_file():
        raise HTTPException(status_code=404, detail="video not found")

    ann_path = annotation_path_for(video_path)
    preserve_created = ann_path.is_file()
    created_at = None
    if preserve_created:
        try:
            existing = json.loads(ann_path.read_text(encoding="utf-8"))
            created_at = existing.get("annotation_created_at")
        except (json.JSONDecodeError, OSError):
            created_at = None

    body = dict(body)
    body["video_path"] = str(video_path)
    body["dataset_id"] = dsid
    try:
        doc = validate_sidecar(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if created_at:
        doc = doc.model_copy(update={"annotation_created_at": created_at})
    saved = normalize_sidecar_for_save(doc, preserve_created_at=bool(created_at))
    ann_path.write_text(json.dumps(sidecar_to_dict(saved), indent=2), encoding="utf-8")
    return {
        "saved_path": str(ann_path),
        "annotation_updated_at": saved.annotation_updated_at,
    }


@router.delete("/annotations")
def delete_annotation(
    video_rel: str = Query(...),
    dataset_id: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    dsid = _request_dataset_id(dataset_id)
    try:
        video_path = resolve_video_path(video_rel, dataset_id=dsid)
    except (PathSecurityError, LegacyFolderExcluded, VideoNotValid, DatasetError) as exc:
        raise _http_from_path_error(exc) from exc
    ann_path = annotation_path_for(video_path)
    if not ann_path.is_file():
        raise HTTPException(status_code=404, detail="annotation not found")
    try:
        ann_path.unlink()
    except OSError as exc:
        raise HTTPException(status_code=500, detail="failed to delete annotation") from exc
    return {"deleted_path": str(ann_path)}
