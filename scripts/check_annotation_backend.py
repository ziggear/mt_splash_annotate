#!/usr/bin/env python3
"""Check the annotation-only backend boundary for iteration 064."""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import sys
from pathlib import Path

REQUIRED_MODULES = (
    "app.main",
    "app.api.height_annotate",
    "app.height_annot.datasets",
    "app.height_annot.frame_cache",
    "app.height_annot.paths",
    "app.height_annot.prep",
    "app.height_annot.roi_export",
    "app.height_annot.schema",
    "app.height_annot.xgb_peak_060b",
    "tools.light_xgb_peak_055",
)

FORBIDDEN_PATH_PARTS = (
    "height_regress",
    "inference",
    "store",
    "training",
    "splash_frame_clf",
    "pipeline/combo",
)

FORBIDDEN_API_ROUTES = (
    "/api/runs",
    "/api/models",
    "/api/training",
    "/api/tier12",
    "/api/scene",
    "/ws",
)

REQUIRED_MODEL_FILES = ("model.ubj", "feature_columns.json", "train_config.json")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def check_forbidden_files(root: Path) -> list[str]:
    problems: list[str] = []
    for path in (root / "app").rglob("*.py"):
        rel = path.relative_to(root).as_posix()
        if any(part in rel for part in FORBIDDEN_PATH_PARTS):
            problems.append(f"forbidden backend module copied: {rel}")
    return problems


def check_imports() -> list[str]:
    problems: list[str] = []
    for module in REQUIRED_MODULES:
        try:
            importlib.import_module(module)
        except Exception as exc:
            problems.append(f"cannot import {module}: {type(exc).__name__}: {exc}")
    return problems


def check_routes() -> list[str]:
    from app.main import app

    paths = {getattr(route, "path", "") for route in app.routes}
    problems = []
    for forbidden in FORBIDDEN_API_ROUTES:
        if any(path == forbidden or path.startswith(f"{forbidden}/") for path in paths):
            problems.append(f"forbidden API route mounted: {forbidden}")
    if "/api/health" not in paths:
        problems.append("missing /api/health")
    if not any(path.startswith("/api/height-annotate") for path in paths):
        problems.append("missing /api/height-annotate routes")
    return problems


def check_model(model_dir: Path) -> tuple[list[str], dict[str, str]]:
    problems: list[str] = []
    hashes: dict[str, str] = {}
    for name in REQUIRED_MODEL_FILES:
        path = model_dir / name
        if not path.is_file():
            problems.append(f"missing model file: {path}")
            continue
        hashes[name] = sha256(path)
    return problems, hashes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model-dir",
        default=str(Path(__file__).resolve().parents[1] / "models" / "xgb_peak" / "055_base"),
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    backend_root = Path(__file__).resolve().parents[1] / "backend"
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))
    model_dir = Path(args.model_dir)
    problems = []
    problems.extend(check_forbidden_files(backend_root))
    problems.extend(check_imports())
    problems.extend(check_routes())
    model_problems, hashes = check_model(model_dir)
    problems.extend(model_problems)

    payload = {
        "ok": not problems,
        "backend_root": str(backend_root),
        "model_dir": str(model_dir),
        "required_modules": list(REQUIRED_MODULES),
        "model_sha256": hashes,
        "problems": problems,
    }
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print("OK" if payload["ok"] else "FAILED")
        for problem in problems:
            print(f"- {problem}")
        if hashes:
            print("Model sha256:")
            for name, digest in hashes.items():
                print(f"- {name}: {digest}")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
