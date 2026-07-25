# ManuTech Height Annotator

Iteration 064 annotation-only workspace for part-time Windows height labeling.

## Scope

- Frontend: height annotation page only.
- Backend: FastAPI with `/api/height-annotate/*` and `/api/health` only.
- Prep: non-`others/` videos use the bundled 055 XGBoost model and do not require DINO sidecar fields.
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

The delivery artifact is the PowerShell install and reinstall flow. The scripts
clone or update this repository, create a local Python venv, install backend
dependencies, reuse the checked-in frontend build, then start the browser app at
`http://127.0.0.1:37864/`.

One-line install:

```powershell
iwr https://raw.githubusercontent.com/ziggear/mt_splash_annotate/main/install.ps1 -OutFile $env:TEMP\manutech-height-install.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\manutech-height-install.ps1
```

One-line reinstall/update:

```powershell
iwr https://raw.githubusercontent.com/ziggear/mt_splash_annotate/main/reinstall.ps1 -UseBasicParsing | iex
```

Force one-line reinstall if the existing install is broken:

```powershell
iwr https://raw.githubusercontent.com/ziggear/mt_splash_annotate/main/reinstall.ps1 -UseBasicParsing | iex
```

Daily start after install:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\ManuTechHeightAnnotator\Start.ps1"
```

If startup fails after an older install, rerun the one-line install command. Git
installs are updated automatically before the app starts.

This app currently requires Python 3.10-3.12. Python 3.12 is recommended.
Python 3.13 is intentionally skipped because the pinned NumPy dependency does
not provide a compatible Windows wheel for this app setup.

If Windows prints `py.exe: No suitable Python runtime found`, install Python
3.12 from python.org or rerun the one-line install command so the script can
try `winget` setup.

Or double-click:

```text
%LOCALAPPDATA%\ManuTechHeightAnnotator\Start.bat
```

The annotator machine does not need Node/npm as long as this repository includes
`frontend/dist`. If Python 3 is missing, `install.ps1` first tries to install
Python 3.12 with `winget`, then continues with the local venv setup.

The repository includes the 055 model files by default. To override them during
install, pass `-ModelDir E:\models\055_base`.

## Model Files

The 055 model files live here, or can be overridden with
`HEIGHT_ANNOT_XGB_055_MODEL_DIR`:

```text
src/annotation/models/xgb_peak/055_base/
  model.ubj
  feature_columns.json
  train_config.json
```

Run the boundary check:

```bash
cd src/annotation
python scripts/check_annotation_backend.py
```

## Delivery

Publish changes by committing and pushing this repository with `frontend/dist`
included. Operators install or update through the one-line PowerShell commands
above; no Tauri build or Windows installer artifact is required.
