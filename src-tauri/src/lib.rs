mod annotation_backend;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = annotation_backend::manage_backend_state();
            let app_handle = app.handle().clone();
            app.manage(state.clone());
            std::thread::spawn(move || {
                let _ = annotation_backend::start_backend_sync(state, &app_handle);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let state = window.state::<annotation_backend::BackendState>();
                annotation_backend::stop_backend(&state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            annotation_backend::annotation_backend_status,
            annotation_backend::annotation_backend_start,
            annotation_backend::annotation_backend_stop,
            annotation_backend::annotation_select_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ManuTech Height Annotator");
}
