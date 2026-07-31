mod actions;
mod diagnostics;
mod disk;
mod optimizer;
mod remote;
mod sensors;
mod types;
mod updates;
mod windows;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

pub fn run() {
    let current_version = env!("CARGO_PKG_VERSION");
    if updates::redirect_to_active_install(current_version) {
        return;
    }
    updates::register_current_install(current_version);
    updates::repair_stale_launchers(current_version);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = windows::reveal_main_window(app, false);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window missing");
            windows::position_popup(&window);

            let popup = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = popup.hide();
                }
            });

            let open_item = MenuItem::with_id(app, "open", "Abrir NEXO", true, None::<&str>)?;
            let update_item = MenuItem::with_id(
                app,
                "check-update",
                "Buscar actualización",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Salir de NEXO", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &update_item, &quit_item])?;

            TrayIconBuilder::with_id("nexo-support")
                .icon(
                    app.default_window_icon()
                        .expect("default app icon missing")
                        .clone(),
                )
                .tooltip("NEXO Support")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = windows::reveal_main_window(app, false);
                    }
                    "check-update" => {
                        let _ = windows::reveal_main_window(app, true);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
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
            disk::read_disk_health,
            sensors::read_hardware_sensors,
            optimizer::optimize_temp_files,
            actions::create_remote_session,
            actions::agent_status,
            actions::run_agent_action,
            remote::managed_remote_tool_status,
            remote::managed_install_remote_tool,
            remote::managed_open_remote_tool,
            remote::managed_connect_remote_tool,
            updates::check_app_update,
            updates::install_app_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running NEXO Support");
}
