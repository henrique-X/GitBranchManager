pub mod gitee;
pub mod github;
pub mod gitlab;

use crate::models::{Branch, RepoPage};
use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    GitHub,
    Gitee,
    GitLab,
}

impl Platform {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "github" => Ok(Platform::GitHub),
            "gitee" => Ok(Platform::Gitee),
            "gitlab" => Ok(Platform::GitLab),
            other => Err(format!("不支持的平台: {other}")),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Platform::GitHub => "github",
            Platform::Gitee => "gitee",
            Platform::GitLab => "gitlab",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UserInfo {
    pub username: String,
    pub avatar_url: Option<String>,
}

/// 展开错误源链，输出根因（reqwest 顶层错误常常掩盖真实原因）
fn err_chain(e: &dyn std::error::Error) -> String {
    let mut msg = e.to_string();
    let mut src = e.source();
    while let Some(s) = src {
        msg.push_str(&format!("\n  ↳ {}", s));
        src = s.source();
    }
    msg
}

pub fn connect_err(context: &str, e: reqwest::Error) -> String {
    format!("{context}: {}", err_chain(&e))
}

fn apply_no_proxy(p: reqwest::Proxy, exceptions: &Option<String>) -> reqwest::Proxy {
    if let Some(exc) = exceptions {
        let exc = exc.trim();
        if !exc.is_empty() {
            return p.no_proxy(reqwest::NoProxy::from_string(exc));
        }
    }
    p
}

pub fn client() -> Result<reqwest::Client, String> {
    let cfg = crate::proxy::current();
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("GitBranchManager/0.1");
    let exceptions = cfg.exceptions.clone();

    match cfg.mode.as_str() {
        "none" => builder = builder.no_proxy(),
        "system" => {
            let sp = crate::proxy::read_system_proxy();
            let mut applied = false;
            if let Some(addr) = &sp.http {
                let mut p = reqwest::Proxy::http(&format!("http://{addr}"))
                    .map_err(|e| format!("系统 HTTP 代理无效: {e}"))?;
                p = apply_no_proxy(p, &exceptions);
                builder = builder.proxy(p);
                applied = true;
            }
            if let Some(addr) = &sp.https {
                let mut p = reqwest::Proxy::https(&format!("http://{addr}"))
                    .map_err(|e| format!("系统 HTTPS 代理无效: {e}"))?;
                p = apply_no_proxy(p, &exceptions);
                builder = builder.proxy(p);
                applied = true;
            }
            if let Some(addr) = &sp.socks {
                let mut p = reqwest::Proxy::all(&format!("socks5://{addr}"))
                    .map_err(|e| format!("系统 SOCKS 代理无效: {e}"))?;
                p = apply_no_proxy(p, &exceptions);
                builder = builder.proxy(p);
                applied = true;
            }
            // 系统未启用代理（或仅配置了应用无法解析的 PAC）时不走代理
            if !applied {
                builder = builder.no_proxy();
            }
        }
        "manual" => {
            let mut applied = false;
            let mut http_url: Option<String> = None;
            if let (Some(h), Some(port)) = (&cfg.http_host, cfg.http_port) {
                let url = format!("http://{h}:{port}");
                let mut p = reqwest::Proxy::http(&url)
                    .map_err(|e| format!("HTTP 代理地址无效: {e}"))?;
                p = apply_no_proxy(p, &exceptions);
                builder = builder.proxy(p);
                http_url = Some(url);
                applied = true;
            }
            if cfg.use_http_for_https {
                if let Some(url) = &http_url {
                    let mut p = reqwest::Proxy::https(url)
                        .map_err(|e| format!("HTTPS 代理地址无效: {e}"))?;
                    p = apply_no_proxy(p, &exceptions);
                    builder = builder.proxy(p);
                    applied = true;
                }
            } else if let (Some(h), Some(port)) = (&cfg.https_host, cfg.https_port) {
                let mut p = reqwest::Proxy::https(&format!("http://{h}:{port}"))
                    .map_err(|e| format!("HTTPS 代理地址无效: {e}"))?;
                p = apply_no_proxy(p, &exceptions);
                builder = builder.proxy(p);
                applied = true;
            }
            if let (Some(h), Some(port)) = (&cfg.socks_host, cfg.socks_port) {
                let scheme = if cfg.socks_version == 4 { "socks4" } else { "socks5" };
                let mut p = reqwest::Proxy::all(&format!("{scheme}://{h}:{port}"))
                    .map_err(|e| format!("SOCKS 代理地址无效: {e}"))?;
                p = apply_no_proxy(p, &exceptions);
                builder = builder.proxy(p);
                applied = true;
            }
            if !applied {
                builder = builder.no_proxy();
            }
        }
        // PAC 模式暂不支持脚本解析，按不走代理处理（设置页有提示）
        "pac" => builder = builder.no_proxy(),
        _ => {}
    }

    builder.build().map_err(|e| format!("创建 HTTP 客户端失败: {e}"))
}

pub async fn current_user(
    platform: Platform,
    base_url: Option<&str>,
    pat: &str,
) -> Result<UserInfo, String> {
    match platform {
        Platform::GitHub => github::current_user(pat).await,
        Platform::Gitee => gitee::current_user(pat).await,
        Platform::GitLab => gitlab::current_user(base_url, pat).await,
    }
}

pub async fn list_repos(
    platform: Platform,
    base_url: Option<&str>,
    pat: &str,
    page: u32,
) -> Result<RepoPage, String> {
    match platform {
        Platform::GitHub => github::list_repos(pat, page).await,
        Platform::Gitee => gitee::list_repos(pat).await,
        Platform::GitLab => gitlab::list_repos(base_url, pat).await,
    }
}

pub async fn list_branches(
    platform: Platform,
    base_url: Option<&str>,
    pat: &str,
    repo_key: &str,
) -> Result<Vec<Branch>, String> {
    match platform {
        Platform::GitHub => github::list_branches(pat, repo_key).await,
        Platform::Gitee => gitee::list_branches(pat, repo_key).await,
        Platform::GitLab => gitlab::list_branches(base_url, pat, repo_key).await,
    }
}

/// 把 HTTP 错误转换为带平台原始信息与原因提示的中文错误
pub async fn ensure_success(resp: reqwest::Response) -> Result<reqwest::Response, String> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let url = resp.url().to_string();
    let body = resp.text().await.unwrap_or_default();
    let hint = match status.as_u16() {
        401 => "\n可能原因: PAT 无效 / 过期，或权限范围不够",
        403 => "\n可能原因: 无访问权限，或触发了平台限流",
        404 => "\n可能原因: 接口 / 仓库不存在，或 PAT 权限不够",
        429 => "\n触发平台限流，请稍后再试",
        _ => "",
    };
    Err(format!(
        "请求失败（HTTP {status}）{hint}\n接口: {url}\n平台返回: {}",
        if body.len() > 500 { &body[..500] } else { &body }
    ))
}

#[derive(Deserialize)]
pub struct RawUser {
    #[serde(alias = "username")]
    pub login: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

pub async fn parse_user(resp: reqwest::Response) -> Result<UserInfo, String> {
    let resp = ensure_success(resp).await?;
    let raw: RawUser = resp.json().await.map_err(|e| format!("解析用户信息失败: {e}"))?;
    Ok(UserInfo {
        username: raw.login,
        avatar_url: raw.avatar_url,
    })
}

/// 宽容解析：把响应体读成文本再解析 JSON，失败时带上原始内容片段便于定位
pub async fn json_array_or_error(
    resp: reqwest::Response,
    ctx: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let text = resp
        .text()
        .await
        .map_err(|e| format!("{ctx}: 读取响应体失败: {e}"))?;
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Array(a)) => Ok(a),
        Ok(_) => Err(format!(
            "{ctx}: 响应不是预期的 JSON 数组，前 200 字符: {}",
            &text[..text.len().min(200)]
        )),
        Err(e) => Err(format!(
            "{ctx}: JSON 解析失败（{e}），响应前 200 字符: {}",
            &text[..text.len().min(200)]
        )),
    }
}

pub fn jstr(v: &serde_json::Value, key: &str) -> Option<String> {
    match v.get(key)? {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub fn jstr_at(v: &serde_json::Value, path: &[&str]) -> Option<String> {
    let mut cur = v;
    for k in path {
        cur = cur.get(k)?;
    }
    match cur {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub fn jbool(v: &serde_json::Value, key: &str) -> Option<bool> {
    v.get(key).and_then(|x| x.as_bool())
}
/// URL 路径段百分号编码（分支名可能包含 / 等，需要编码成 %2F）
pub fn encode_path(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub async fn delete_branch(
    platform: Platform,
    base_url: Option<&str>,
    pat: &str,
    repo_key: &str,
    branch: &str,
) -> Result<(), String> {
    match platform {
        Platform::GitHub => github::delete_branch(pat, repo_key, branch).await,
        Platform::Gitee => gitee::delete_branch(pat, repo_key, branch).await,
        Platform::GitLab => gitlab::delete_branch(base_url, pat, repo_key, branch).await,
    }
}