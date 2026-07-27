mod actions;
mod diagnostics;
mod sensors;
mod types;
mod updates;
mod windows;

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window missing");
            windows::position_popup(&window);
            let close_window = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = close_window.hide();
                }
            });

            TrayIconBuilder::with_id("nexo-support")
                .icon(
                    app.default_window_icon()
                        .expect("default app icon missing")
                        .clone(),
                )
                .tooltip("NEXO Support")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => windows::toggle_popup(tray.app_handle()),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            windows::hide_main_window,
            windows::show_main_window,
            windows::minimize_main_window,
            windows::exit_app,
            windows::open_admin_window,
            windows::close_admin_window,
            diagnostics::run_quick_diagnostic,
            sensors::read_hardware_sensors,
            actions::create_remote_session,
            actions::agent_status,
            actions::run_agent_action,
            actions::open_remote_tool,
            updates::check_app_update,
            updates::install_app_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running NEXO Support");
}
