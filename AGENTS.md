# ManuTech Height Annotator Agent Rules

This directory is the standalone Windows annotation delivery repository for
`mt_splash_annotate`. Changes here can affect non-technical Windows operators
who install or reinstall with a one-line PowerShell command.

Also follow the root project rules in `../../AGENTS.md`. When rules overlap,
this file is stricter for Windows annotation delivery, reinstall behavior, and
operator-facing PowerShell guidance.

## Release And Install Discipline

- `src/annotation` is published separately to `github.com:ziggear/mt_splash_annotate.git`.
- If a fix is intended to affect the Windows one-line install, commit and push it to the `mt_splash_annotate` `main` branch before telling the operator to reinstall.
- After pushing, verify the remote content with a fixed commit SHA raw URL, not only `raw.githubusercontent.com/.../main/...`, because `main` raw URLs can be cached.
- When giving an operator command, prefer a single `iwr <script.ps1> ...` command. Put backup, delete, reinstall, process cleanup, and install details inside the script.
- Do not give non-technical operators commands that require editing paths, setting environment variables, manually deleting folders, or composing multi-step PowerShell.
- Do not include developer command transcripts such as test, build, commit, or push commands in operator-facing summaries. Report the user update entry point, commit SHA, produced artifact, and verification result instead.

## XGBoost Model Rules

- The default bundled annotation model is `055_base`.
- The default Windows annotation flow must not require DINO sidecar fields such as `dino_box_xyxy` or `dino_box_quality`.
- Keep `060b_dino_quality` only as an explicit compatibility or research feature set; do not make it the default for new-video annotation.
- When changing the default model path or environment variable, check and update all runtime entry points:
  - `Start.ps1`
  - `install.ps1`
  - `scripts/package-win.ps1`
  - `src-tauri/src/annotation_backend.rs`
  - `scripts/check_annotation_backend.py`
  - `README.md`
- Use `HEIGHT_ANNOT_XGB_055_MODEL_DIR` for the default model path. Treat `HEIGHT_ANNOT_XGB_060B_MODEL_DIR` only as legacy compatibility.

## XGBoost Runtime Dependencies

- Do not use the sklearn wrapper `xgboost.XGBRegressor()` for runtime inference in the Windows annotation package.
- Load XGBoost models with `xgboost.Booster()` and predict with `xgboost.DMatrix`.
- Avoid adding `scikit-learn` as a runtime dependency just to load or run an XGBoost model.

## PowerShell Script Rules

- Keep operator-facing PowerShell commands short and copy-paste safe.
- Avoid wrapping commands containing `$variables` in outer double quotes; PowerShell can expand variables before the nested command runs.
- Prefer maintaining reusable scripts such as `install.ps1` and `reinstall.ps1` over embedding complex logic in README one-liners.
- Before publishing PowerShell changes, validate syntax and behavior on a Windows PowerShell-compatible environment when possible.
