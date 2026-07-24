"""Executable entry point for the packaged annotation backend."""
from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("ANNOTATION_BACKEND_PORT", "37864")))
    parser.add_argument("--log-dir", default=os.environ.get("ANNOTATION_LOG_DIR", ""))
    parser.add_argument("--frontend-dist", default=os.environ.get("ANNOTATION_FRONTEND_DIST", ""))
    parser.add_argument("--frame-cache", default=os.environ.get("HEIGHT_ANNOT_FRAME_CACHE", ""))
    parser.add_argument("--datasets-config", default=os.environ.get("HEIGHT_ANNOT_DATASETS_CONFIG", ""))
    args = parser.parse_args()

    if args.log_dir:
        log_dir = Path(args.log_dir)
        log_dir.mkdir(parents=True, exist_ok=True)
        os.environ["ANNOTATION_LOG_DIR"] = str(log_dir)
    if args.frontend_dist:
        os.environ["ANNOTATION_FRONTEND_DIST"] = args.frontend_dist
    if args.frame_cache:
        os.environ["HEIGHT_ANNOT_FRAME_CACHE"] = args.frame_cache
    if args.datasets_config:
        os.environ["HEIGHT_ANNOT_DATASETS_CONFIG"] = args.datasets_config

    uvicorn.run("app.main:app", host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
