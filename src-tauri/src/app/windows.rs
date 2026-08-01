use tauri::{
    AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const ADMIN_INIT_SCRIPT: &str = r#"
window.__NEXO_VIEW__ = 'admin';

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  if (!root || root.hasChildNodes()) return;

  root.dataset.nexoNativeShell = 'admin';
  root.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;background:#f5f6f8;font-family:Inter,Segoe UI,sans-serif;color:#20222a">
      <section style="display:grid;place-items:center;gap:14px">
        <span style="width:46px;height:46px;border:3px solid #dedbf8;border-top-color:#654cff;border-radius:50%;animation:nexoAdminSpin .8s linear infinite"></span>
        <strong style="font-size:13px">Abriendo NEXO Control</strong>
      </section>
      <style>@keyframes nexoAdminSpin{to{transform:rotate(360deg)}}</style>
    </main>`;

  window.setTimeout(() => {
    if (root.dataset.nexoNativeShell !== 'admin') return;
    root.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;background:#f5f6f8;font-family:Inter,Segoe UI,sans-serif;color:#20222a">
        <section style="width:360px;padding:26px;border:1px solid #dfe1e7;border-radius:18px;display:grid;gap:14px;background:#fff;box-shadow:0 22px 60px rgba(25,28,40,.12)">
          <strong style="font-size:18px">NEXO Control no pudo cargar</strong>
          <span style="color:#747985;font-size:12px">Cerrá esta ventana y volvé a abrir Administración.</span>
          <button id="nexo-native-admin-close" style="height:40px;border:0;border-radius:10px;color:#fff;background:#5a51c7;cursor:pointer">Cerrar</button>
        </section>
      </main>`;
    document.getElementById('nexo-native-admin-close')?.addEventListener('click', () => window.close());
  }, 8000);
});
"#;

fn dispatch_manual_update_check(window: &WebviewWindow) {
    let _ = window.eval("window.dispatchEvent(new Event('nexo:check-update')); ");
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
    // Never reuse a failed WebView. The admin view now boots from the same
    // packaged index document as the working support window, and an early
    // native initialization script selects the admin application before React.
    if let Some(window) = app.get_webview_window("admin") {
        window.close().map_err(|error| error.to_string())?;
    }

    let window = WebviewWindowBuilder::new(
        &app,
        "admin",
        WebviewUrl::App("index.html".into()),
    )
    .initialization_script(ADMIN_INIT_SCRIPT)
    .title("NEXO Control")
    .inner_size(1100.0, 720.0)
    .min_inner_size(860.0, 560.0)
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
    .map_err(|error| format!("No se pudo crear NEXO Control: {error}"))?;

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
