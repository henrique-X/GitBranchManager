mod commands;
mod credentials;
mod db;
mod general;
mod git_service;
mod models;
mod platform;
mod proxy;

use db::Db;
use tauri::Manager;

pub struct AppState {
    pub db: Db,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if crate::general::current().close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = Db::open(&dir.join("gitbranchmanager.db"))?;
            proxy::load_from_db(&*db.conn.lock().map_err(|e| format!("数据库忙: {e}"))?);
            general::load_from_db(&*db.conn.lock().map_err(|e| format!("数据库忙: {e}"))?);
            app.manage(AppState { db });

            // 系统托盘
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Git Branch Manager")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if crate::general::current().tray_style == "panel" {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                if w.is_visible().unwrap_or(false) {
                                    let _ = w.hide();
                                } else {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::accounts::add_account,
            commands::accounts::list_accounts,
            commands::accounts::update_account,
            commands::accounts::delete_account,
            commands::accounts::set_active_account,
            commands::accounts::get_active_account,
            commands::accounts::test_account,
            commands::repos::list_repos,
            commands::repos::list_branches,
            commands::repos::repo_cache_get,
            commands::repos::repo_cache_put,
            commands::repos::branch_cache_get,
            commands::repos::branch_cache_put,
            commands::repos::batch_delete_branches,
            commands::repos::cancel_batch_delete,
            commands::local_projects::add_workspace,
            commands::local_projects::remove_workspace,
            commands::local_projects::list_workspaces,
            commands::local_projects::scan_workspace,
            commands::local_projects::list_local_projects,
            commands::local_projects::link_local_project,
            commands::local_projects::unlink_local_project,
            commands::settings::get_proxy_settings,
            commands::settings::save_proxy_settings,
            commands::settings::reset_proxy_settings,
            commands::settings::detect_system_proxy,
            commands::settings::kv_get,
            commands::settings::kv_set,
            commands::templates::list_templates,
            commands::templates::save_template,
            commands::templates::delete_template,
            commands::templates::get_repo_defaults,
            commands::templates::save_repo_defaults,
            commands::templates::render_template_preview,
            commands::general::get_general_settings,
            commands::general::save_general_settings,
            commands::create_branch::preflight_create,
            commands::create_branch::check_branch_targets,
            commands::create_branch::git_create_branches,
            git_service::git_check
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
