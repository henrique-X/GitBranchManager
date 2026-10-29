use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct GeneralConfig {
    /// 关闭窗口时最小化到托盘（true=隐藏到托盘，false=直接退出）
    pub close_to_tray: bool,
    /// 托盘左键行为：panel=切换主窗口显示，menu=仅右键菜单
    pub tray_style: String,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        GeneralConfig {
            close_to_tray: true,
            tray_style: "panel".to_string(),
        }
    }
}

static GENERAL: OnceLock<RwLock<GeneralConfig>> = OnceLock::new();

use std::sync::{OnceLock, RwLock};

fn cell() -> &'static RwLock<GeneralConfig> {
    GENERAL.get_or_init(|| RwLock::new(GeneralConfig::default()))
}

pub fn current() -> GeneralConfig {
    cell().read().map(|g| g.clone()).unwrap_or_default()
}

pub fn store(cfg: GeneralConfig) {
    if let Ok(mut g) = cell().write() {
        *g = cfg;
    }
}

pub fn load_from_db(conn: &rusqlite::Connection) {
    let mut cfg = GeneralConfig::default();
    if let Ok(v) = conn.query_row(
        "SELECT value FROM app_setting WHERE key = 'general_close_to_tray'",
        [],
        |r| r.get::<_, String>(0),
    ) {
        cfg.close_to_tray = v == "1";
    }
    if let Ok(v) = conn.query_row(
        "SELECT value FROM app_setting WHERE key = 'general_tray_style'",
        [],
        |r| r.get::<_, String>(0),
    ) {
        if v == "panel" || v == "menu" {
            cfg.tray_style = v;
        }
    }
    store(cfg);
}
