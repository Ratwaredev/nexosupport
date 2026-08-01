use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, Size, WebviewWindow};

fn dispatch_manual_update_check(window: &WebviewWindow) {
    let _ = window.eval("window.dispatchEvent(new Event('nexo:check-update')); ");
}

fn dispatch_view(window: &WebviewWindow, view: &str) -> Result<(), String> {
    window
        .eval(&format!(
            "window.dispatchEvent(new CustomEvent('nexo:set-view', {{ detail: '{}' }}));",
            view
        ))
        .map_err(|error| error.to_string())
}

pub fn reveal_main_window(app: &AppHandle, manual_update_check: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("No encontré la ventana principal.")?;

    window.unminimize().map_err(|error| error.to_string())?;
    position_popup(&window);
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    if manual_update_check {
        dispatch_manual_update_check(&window);
    }
    Ok(())
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("No encontré la ventana principal.")?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    reveal_main_window(&app, false)
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
    // Administration deliberately reuses the already working main WebView.
    // Some Windows installations were rendering every secondary WebView blank.
    let window = app
        .get_webview_window("main")
        .ok_or("No encontré la ventana principal.")?;

    window.unminimize().map_err(|error| error.to_string())?;
    window.set_title("NEXO Control").map_err(|error| error.to_string())?;
    window.set_decorations(true).map_err(|error| error.to_string())?;
    window.set_resizable(true).map_err(|error| error.to_string())?;
    window.set_maximizable(true).map_err(|error| error.to_string())?;
    window
        .set_min_size(Some(Size::Logical(LogicalSize::new(860.0, 560.0))))
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(None::<Size>)
        .map_err(|error| error.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize::new(1100.0, 720.0)))
        .map_err(|error| error.to_string())?;
    window.center().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    dispatch_view(&window, "admin")?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn close_admin_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("No encontré la ventana principal.")?;

    dispatch_view(&window, "support")?;
    window.set_title("NEXO Support").map_err(|error| error.to_string())?;
    window.set_decorations(false).map_err(|error| error.to_string())?;
    window.set_maximizable(false).map_err(|error| error.to_string())?;
    window
        .set_min_size(Some(Size::Logical(LogicalSize::new(400.0, 560.0))))
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(Some(Size::Logical(LogicalSize::new(620.0, 900.0))))
        .map_err(|error| error.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize::new(460.0, 680.0)))
        .map_err(|error| error.to_string())?;
    position_popup(&window);
    window.set_focus().map_err(|error| error.to_string())
}

pub fn position_popup(window: &WebviewWindow) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };

    let work_area = monitor.work_area();
    let origin = work_area.position;
    let work_size = work_area.size;
    let margin = 12;
    let x = origin.x + work_size.width as i32 - size.width as i32 - margin;
    let y = origin.y + work_size.height as i32 - size.height as i32 - margin;
    let _ = window.set_position(PhysicalPosition::new(x.max(origin.x), y.max(origin.y)));
}

pub fn toggle_popup(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if visible && !minimized {
        let _ = window.hide();
    } else {
        let _ = reveal_main_window(app, false);
    }
}
