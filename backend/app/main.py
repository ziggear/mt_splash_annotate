"""FastAPI entry point for the Windows height annotation app."""
from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import height_annotate as height_annotate_api

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_FRONTEND_DIST_ENV = os.environ.get("ANNOTATION_FRONTEND_DIST", "").strip()
_FRONTEND_DIST = Path(_FRONTEND_DIST_ENV).expanduser() if _FRONTEND_DIST_ENV else _BACKEND_DIR.parent / "frontend" / "dist"

app = FastAPI(
    title="ManuTech Height Annotator",
    version="0.64.0",
    docs_url="/api/docs",
    redoc_url=None,
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.64.0"}


app.include_router(height_annotate_api.router)

if _FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str, request: Request):
        candidate = _FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(_FRONTEND_DIST / "index.html"))
else:
    logger.warning("Frontend dist not found at %s", _FRONTEND_DIST)

    @app.get("/", include_in_schema=False)
    def no_frontend() -> dict[str, str]:
        return {
            "message": "Frontend not built. Run: cd src/annotation/frontend && npm install && npm run build",
            "api_docs": "/api/docs",
        }
