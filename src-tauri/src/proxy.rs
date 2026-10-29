use serde::{Deserialize, Serialize};
use std::sync::{OnceLock, RwLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    /// none | system | manual | pac
    pub mode: String,
    pub http_host: Option<String>,
    pub http_port: Option<u16>,
    /// 勾选后 HTTPS 也走 HTTP 代理
    pub use_http_for_https: bool,
    pub https_host: Option<String>,
    pub https_port: Option<u16>,
    pub socks_host: Option<String>,
    pub socks_port: Option<u16>,
    pub socks_version: u8, // 4 或 5
    pub pac_url: Option<String>,
    /// 不使用代理的例外列表（逗号分隔，支持域名/IP/CIDR）
    pub exceptions: Option<String>,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        ProxyConfig {
            mode: "system".to_string(),
            http_host: None,
            http_port: None,
            use_http_for_https: true,
            https_host: None,
            https_port: None,
            socks_host: None,
            socks_port: None,
            socks_version: 5,
            pac_url: None,
            exceptions: Some("127.0.0.1;::1;localhost".to_string()),
        }
    }
}

impl ProxyConfig {
    pub fn validate(&self) -> Result<(), String> {
        match self.mode.as_str() {
            "none" | "system" | "pac" => Ok(()),
            "manual" => {
                let any = self.http_host.is_some()
                    || self.https_host.is_some()
                    || self.socks_host.is_some();
                if !any {
                    return Err("手动配置代理时，至少填写 HTTP / HTTPS / SOCKS 中一组主机和端口".into());
                }
                if self.http_host.is_some() != self.http_port.is_some() {
                    return Err("HTTP 代理需要同时填写主机和端口".into());
                }
                if self.https_host.is_some() != self.https_port.is_some() {
                    return Err("HTTPS 代理需要同时填写主机和端口".into());
                }
                if self.socks_host.is_some() != self.socks_port.is_some() {
                    return Err("SOCKS 代理需要同时填写主机和端口".into());
                }
                if !matches!(self.socks_version, 4 | 5) {
                    return Err("SOCKS 版本只能是 4 或 5".into());
                }
                Ok(())
            }
            other => Err(format!("未知代理模式: {other}")),
        }
    }

    pub fn from_json(v: &str) -> ProxyConfig {
        serde_json::from_str(v).unwrap_or_default()
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

static PROXY: OnceLock<RwLock<ProxyConfig>> = OnceLock::new();

fn cell() -> &'static RwLock<ProxyConfig> {
    PROXY.get_or_init(|| RwLock::new(ProxyConfig::default()))
}

pub fn current() -> ProxyConfig {
    cell().read().map(|g| g.clone()).unwrap_or_default()
}

pub fn store(cfg: ProxyConfig) {
    if let Ok(mut g) = cell().write() {
        *g = cfg;
    }
}

/// 系统代理检测结果（供设置页展示）
#[derive(Debug, Clone, serde::Serialize)]
pub struct SystemProxy {
    pub enabled: bool,
    pub http: Option<String>,
    pub https: Option<String>,
    pub socks: Option<String>,
    pub pac_url: Option<String>,
}

pub fn read_system_proxy() -> SystemProxy {
    let mut out = SystemProxy {
        enabled: false,
        http: None,
        https: None,
        socks: None,
        pac_url: None,
    };
    let key = match windows_registry::CURRENT_USER
        .open("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
    {
        Ok(k) => k,
        Err(_) => return out,
    };
    let enable = key.get_u32("ProxyEnable").unwrap_or(0);
    let pac = key.get_string("AutoConfigURL").ok();
    if enable != 1 {
        out.pac_url = pac;
        return out;
    }
    out.enabled = true;
    out.pac_url = pac;
    if let Ok(server) = key.get_string("ProxyServer") {
        let server = server.trim().to_string();
        if server.contains(';') || server.contains('=') {
            for part in server.split(';') {
                let Some((proto, addr)) = part.split_once('=') else { continue };
                let addr = addr.trim().to_string();
                match proto.to_lowercase().as_str() {
                    "http" => out.http = Some(addr),
                    "https" => out.https = Some(addr),
                    "socks" => out.socks = Some(addr),
                    _ => {}
                }
            }
        } else if !server.is_empty() {
            // 单一 "host:port" 同时用于 http/https
            out.http = Some(server.clone());
            out.https = Some(server);
        }
    }
    out
}

/// 从数据库加载（app_setting.proxy_settings）
pub fn load_from_db(conn: &rusqlite::Connection) {
    if let Ok(v) = conn.query_row(
        "SELECT value FROM app_setting WHERE key = 'proxy_settings'",
        [],
        |r| r.get::<_, String>(0),
    ) {
        store(ProxyConfig::from_json(&v));
    }
}
