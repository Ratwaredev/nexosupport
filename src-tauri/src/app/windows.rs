use tauri::{
    AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

#[tauri::command]
pub fn hide_main_window(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("No encontré la ventana principal.")?;
    position_popup(&window);
    window.unminimize().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn minimize_main_window(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn open_admin_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("admin") {
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        "admin",
        WebviewUrl::App("admin.html".into()),
    )
    .title("NEXO Control")
    .inner_size(1180.0, 760.0)
    .min_inner_size(940.0, 640.0)
    .resizable(true)
    .maximizable(true)
    .minimizable(true)
    .closable(true)
    .decorations(true)
    .transparent(false)
    .skip_taskbar(false)
    .visible(true)
    .center()
    .build()
    .map_err(|error| format!("No pude crear NEXO Control: {error}"))?;

    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn close_admin_window(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("admin") else {
        return Ok(());
    };
    window.close().map_err(|error| error.to_string())
}

pub fn position_popup(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let monitor_size = monitor.size();
    let origin = monitor.position();
    let x = origin.x + monitor_size.width as i32 - size.width as i32 - 18;
    let y = origin.y + monitor_size.height as i32 - size.height as i32 - 66;
    let _ = window.set_position(PhysicalPosition::new(x.max(origin.x), y.max(origin.y)));
}

pub fn toggle_popup(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        position_popup(&window);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
