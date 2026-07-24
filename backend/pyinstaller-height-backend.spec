# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

root = Path.cwd()
backend = root / "backend"

a = Analysis(
    [str(backend / "annotation_backend_main.py")],
    pathex=[str(backend)],
    binaries=[],
    datas=[],
    hiddenimports=[
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
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.websockets_impl",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "torch",
        "torchvision",
        "transformers",
        "ultralytics",
        "sklearn",
        "onnxruntime",
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="manutech-height-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
