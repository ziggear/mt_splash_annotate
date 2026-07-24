use serde::Serialize;
use std::{
    net::TcpStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager};

const BACKEND_PORT: u16 = 37864;

#[derive(Default)]
pub struct BackendInner {
    pub port: u16,
    pub child: Option<Child>,
    pub log_dir: Option<PathBuf>,
    pub last_error: Option<String>,
}

pub type BackendState = Arc<Mutex<BackendInner>>;

#[derive(Serialize)]
pub struct BackendStatus {
    pub port: u16,
    pub url: String,
    pub running: bool,
    pub log_dir: Option<String>,
    pub last_error: Option<String>,
}

pub fn manage_backend_state() -> BackendState {
    Arc::new(Mutex::new(BackendInner {
        port: BACKEND_PORT,
        child: None,
        log_dir: None,
        last_error: None,
    }))
}

fn port_open(port: u16) -> bool {
    TcpStream::connect(format!("127.0.0.1:{port}")).is_ok()
}

fn wait_for_port(port: u16, retries: u32, delay_ms: u64) -> bool {
    for _ in 0..retries {
        if port_open(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(delay_ms));
    }
    false
}

fn app_local_data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("ManuTechHeightAnnotator"))
}

fn resource_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok()
}

fn find_backend_binary(app: &AppHandle) -> Option<PathBuf> {
    let names = if cfg!(windows) {
        vec![
            "manutech-height-backend.exe",
            "manutech-height-backend-x86_64-pc-windows-msvc.exe",
        ]
    } else {
        vec!["manutech-height-backend"]
    };

    if let Some(res) = resource_dir(app) {
        for name in &names {
            let candidates = [
                res.join("binaries").join(name),
                res.join("backend_dist").join(name),
                res.join(name),
            ];
            for candidate in candidates {
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn find_dev_backend_script() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    let candidates = [
        cwd.join("../backend/annotation_backend_main.py"),
        cwd.join("../../backend/annotation_backend_main.py"),
        cwd.join("src/annotation/backend/annotation_backend_main.py"),
    ];
    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate.canonicalize().unwrap_or(candidate));
        }
    }
    None
}

fn find_frontend_dist(app: &AppHandle) -> Option<PathBuf> {
    if let Some(res) = resource_dir(app) {
        let candidate = res.join("frontend").join("dist");
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    let cwd = std::env::current_dir().ok()?;
    let candidates = [
        cwd.join("../frontend/dist"),
        cwd.join("../../frontend/dist"),
        cwd.join("src/annotation/frontend/dist"),
    ];
    candidates.into_iter().find(|p| p.is_dir())
}

fn find_python() -> String {
    for name in ["python", "python3", "py"] {
        if Command::new(name).arg("--version").output().is_ok() {
            return name.to_string();
        }
    }
    "python".to_string()
}

pub fn start_backend_sync(state: BackendState, app: &AppHandle) -> Result<(), String> {
    let port = state.lock().unwrap().port;
    if port_open(port) {
        return Ok(());
    }

    let data_dir = app_local_data_dir(app);
    let log_dir = data_dir.join("logs");
    let cache_dir = data_dir.join("frame_cache");
    std::fs::create_dir_all(&log_dir).map_err(|e| format!("create log dir failed: {e}"))?;
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("create cache dir failed: {e}"))?;
    let datasets_config = data_dir.join("height_annot_datasets.json");
    let frontend_dist = find_frontend_dist(app).ok_or("frontend dist not found")?;

    let mut command = if let Some(binary) = find_backend_binary(app) {
        Command::new(binary)
    } else if let Some(script) = find_dev_backend_script() {
        let mut cmd = Command::new(find_python());
        cmd.arg(script);
        cmd
    } else {
        return Err("annotation backend executable not found".to_string());
    };

    command
        .arg("--port")
        .arg(port.to_string())
        .arg("--log-dir")
        .arg(&log_dir)
        .arg("--frontend-dist")
        .arg(&frontend_dist)
        .arg("--frame-cache")
        .arg(&cache_dir)
        .arg("--datasets-config")
        .arg(&datasets_config)
        .env("ANNOTATION_BACKEND_PORT", port.to_string())
        .env("ANNOTATION_LOG_DIR", &log_dir)
        .env("ANNOTATION_FRONTEND_DIST", &frontend_dist)
        .env("HEIGHT_ANNOT_FRAME_CACHE", &cache_dir)
        .env("HEIGHT_ANNOT_DATASETS_CONFIG", &datasets_config)
        .env(
            "HEIGHT_ANNOT_XGB_060B_MODEL_DIR",
            resource_dir(app)
                .unwrap_or_else(|| PathBuf::from("."))
                .join("models")
                .join("xgb_peak")
                .join("060b_dino_quality"),
        )
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command.spawn().map_err(|e| format!("spawn backend failed: {e}"))?;
    {
        let mut inner = state.lock().unwrap();
        inner.child = Some(child);
        inner.log_dir = Some(log_dir);
        inner.last_error = None;
    }

    if wait_for_port(port, 40, 250) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.navigate(format!("http://127.0.0.1:{port}/").parse().unwrap());
        }
        Ok(())
    } else {
        let err = "backend did not start within 10 seconds".to_string();
        state.lock().unwrap().last_error = Some(err.clone());
        Err(err)
    }
}

pub fn stop_backend(state: &BackendState) {
    let mut inner = state.lock().unwrap();
    if let Some(mut child) = inner.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn status_snapshot(state: &BackendState) -> BackendStatus {
    let inner = state.lock().unwrap();
    BackendStatus {
        port: inner.port,
        url: format!("http://127.0.0.1:{}/", inner.port),
        running: port_open(inner.port),
        log_dir: inner.log_dir.as_ref().map(|p| p.to_string_lossy().into_owned()),
        last_error: inner.last_error.clone(),
    }
}

#[tauri::command]
pub fn annotation_backend_status(state: tauri::State<BackendState>) -> BackendStatus {
    status_snapshot(&state)
}

#[tauri::command]
pub async fn annotation_backend_start(
    state: tauri::State<'_, BackendState>,
    app: AppHandle,
) -> Result<BackendStatus, String> {
    let state_clone = Arc::clone(&state);
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || start_backend_sync(state_clone, &app_clone))
        .await
        .map_err(|e| e.to_string())??;
    Ok(status_snapshot(&state))
}

#[tauri::command]
pub fn annotation_backend_stop(state: tauri::State<BackendState>) -> BackendStatus {
    stop_backend(&state);
    status_snapshot(&state)
}

#[tauri::command]
pub fn annotation_select_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}
