use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralSettings {
    pub launch_at_startup: bool,
    pub close_to_tray: bool,
    /// panel | menu
    pub tray_style: String,
}

#[tauri::command]
pub async fn get_general_settings(app: AppHandle) -> Result<GeneralSettings, String> {
    let launch = app.autolaunch().is_enabled().unwrap_or(false);
    let g = crate::general::current();
    Ok(GeneralSettings {
        launch_at_startup: launch,
        close_to_tray: g.close_to_tray,
        tray_style: g.tray_style,
    })
}

#[tauri::command]
pub async fn save_general_settings(
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
    config: GeneralSettings,
) -> Result<(), String> {
    // 1) 开机自启
    let autolaunch = app.autolaunch();
    let currently = autolaunch.is_enabled().unwrap_or(false);
    if config.launch_at_startup != currently {
        if config.launch_at_startup {
            autolaunch.enable().map_err(|e| format!("设置开机自启失败: {e}"))?;
        } else {
            autolaunch.disable().map_err(|e| format!("关闭开机自启失败: {e}"))?;
        }
    }
    // 2) 持久化其他配置
    {
        let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        for (k, v) in [
            ("general_close_to_tray", if config.close_to_tray { "1" } else { "0" }),
            ("general_tray_style", config.tray_style.as_str()),
        ] {
            conn.execute(
                "INSERT INTO app_setting(key, value) VALUES(?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [k, v],
            )
            .map_err(|e| format!("保存通用设置失败: {e}"))?;
        }
    }
    // 3) 内存生效（关闭行为/托盘点击行为立即切换）
    crate::general::store(crate::general::GeneralConfig {
        close_to_tray: config.close_to_tray,
        tray_style: config.tray_style,
    });
    Ok(())
}
