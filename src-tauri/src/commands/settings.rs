use serde::Serialize;
use tauri::State;

use crate::proxy::{self, ProxyConfig, SystemProxy};
use crate::AppState;

#[tauri::command]
pub async fn get_proxy_settings() -> Result<ProxyConfig, String> {
    Ok(proxy::current())
}

#[tauri::command]
pub async fn save_proxy_settings(
    state: State<'_, AppState>,
    config: ProxyConfig,
) -> Result<(), String> {
    config.validate()?;
    {
        let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        conn.execute(
            "INSERT INTO app_setting(key, value) VALUES('proxy_settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [&config.to_json()],
        )
        .map_err(|e| format!("保存代理设置失败: {e}"))?;
    }
    proxy::store(config);
    Ok(())
}

#[tauri::command]
pub async fn reset_proxy_settings(state: State<'_, AppState>) -> Result<ProxyConfig, String> {
    let cfg = ProxyConfig::default();
    {
        let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        conn.execute(
            "INSERT INTO app_setting(key, value) VALUES('proxy_settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [&cfg.to_json()],
        )
        .map_err(|e| e.to_string())?;
    }
    proxy::store(cfg.clone());
    Ok(cfg)
}

#[derive(Serialize)]
pub struct DetectedProxy {
    pub system: SystemProxy,
    pub note: Option<String>,
}

#[tauri::command]
pub async fn detect_system_proxy() -> Result<DetectedProxy, String> {
    let sp = proxy::read_system_proxy();
    let mut note: Option<String> = None;
    if !sp.enabled && sp.pac_url.is_some() {
        note = Some("系统当前仅配置了 PAC 自动配置脚本，未启用手动代理。".into());
    } else if sp.pac_url.is_some() {
        note = Some("系统同时配置了 PAC 脚本；应用暂不支持解析 PAC，将按手动代理地址连接。".into());
    }
    Ok(DetectedProxy { system: sp, note })
}

#[tauri::command]
pub async fn kv_get(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    let v = conn
        .query_row(
            "SELECT value FROM app_setting WHERE key = ?1",
            [&key],
            |r| r.get::<_, String>(0),
        )
        .ok();
    Ok(v)
}

#[tauri::command]
pub async fn kv_set(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    conn.execute(
        "INSERT INTO app_setting(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [&key, &value],
    )
    .map_err(|e| format!("写入失败: {e}"))?;
    Ok(())
}