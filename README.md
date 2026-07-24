# ManuTech Height Annotator

Iteration 064 annotation-only workspace for part-time Windows height labeling.

## Scope

- Frontend: height annotation page only.
- Backend: FastAPI with `/api/height-annotate/*` and `/api/health` only.
- Prep: non-`others/` videos must use `xgb_peak_060b`; missing model or missing DINO quality sidecar fields fail the prep request.
- Output: annotation sidecar JSON is written next to the video.

## Local Development

```bash
cd src/annotation/backend
python -m uvicorn app.main:app --reload
```

```bash
cd src/annotation/frontend
npm install
npm run dev
```

The frontend proxies `/api` to `http://localhost:8000`.

## GitHub One-Line Install

This app can be distributed without a Tauri installer. The Windows flow is a
PowerShell bootstrap that clones or downloads the repository, creates a local
Python venv, installs backend dependencies, reuses the checked-in frontend build,
then starts the browser app at `http://127.0.0.1:37864/`.

One-line install:

```powershell
powershell -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/ziggear/mt_splash_annotate/main/install.ps1 -OutFile $env:TEMP\manutech-height-install.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\manutech-height-install.ps1"
```

Daily start after install:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\ManuTechHeightAnnotator\Start.ps1"
```

Or double-click:

```text
%LOCALAPPDATA%\ManuTechHeightAnnotator\Start.bat
```

The annotator machine does not need Node/npm as long as this repository includes
`frontend/dist`. If Python 3 is missing, `install.ps1` first tries to install
Python 3.12 with `winget`, then continues with the local venv setup.

The repository includes the 060b model files by default. To override them during
install, pass `-ModelDir E:\models\060b_dino_quality`.

## Model Files

The 060b model files live here, or can be overridden with
`HEIGHT_ANNOT_XGB_060B_MODEL_DIR`:

```text
src/annotation/models/xgb_peak/060b_dino_quality/
  model.ubj
  feature_columns.json
  train_config.json
```

Run the boundary check:

```bash
cd src/annotation
python scripts/check_annotation_backend.py
```

## Windows Packaging

The Tauri shell starts the bundled local backend, navigates the window to the
local FastAPI frontend, supports folder selection, exposes backend status, and
stops the backend when the app exits.

Run from Windows PowerShell on a machine with Node.js, Rust, Visual Studio Build
Tools, WebView2 Runtime, and NSIS-compatible Tauri prerequisites:

```powershell
cd src\annotation
.\scripts\package-win.ps1 -ModelDir C:\path\to\060b_dino_quality
```

Expected output is under:

```text
src/annotation/src-tauri/target/release/bundle/
```

The 224 SSH environment is WSL2. It can validate the Python backend with the
existing `stage1pc/backend/.venv`, but it does not currently expose Windows-side
Node/Rust tools through the SSH session, so it cannot by itself produce the
Windows installer.
