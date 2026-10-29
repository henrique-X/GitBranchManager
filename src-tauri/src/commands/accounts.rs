use serde::Serialize;
use tauri::State;

use crate::credentials;
use crate::db::Db;
use crate::platform::{self, Platform};
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct Account {
    pub id: i64,
    pub platform: String,
    pub label: String,
    pub base_url: Option<String>,
    pub api_username: Option<String>,
    pub avatar_url: Option<String>,
    pub credential_key: String,
    pub created_at: Option<String>,
    pub last_used_at: Option<String>,
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn row_to_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get("id")?,
        platform: row.get("platform")?,
        label: row.get("label")?,
        base_url: row.get("base_url")?,
        api_username: row.get("api_username")?,
        avatar_url: row.get("avatar_url")?,
        credential_key: row.get("credential_key")?,
        created_at: row.get("created_at")?,
        last_used_at: row.get("last_used_at")?,
    })
}

fn get_account(db: &Db, id: i64) -> Result<Option<Account>, String> {
    let conn = db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM account WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query([id])
        .map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        Some(row) => Ok(Some(row_to_account(row).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

fn set_active_id(conn: &rusqlite::Connection, id: Option<i64>) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_setting(key, value) VALUES('active_account_id', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [id.map(|v| v.to_string())],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn touch_last_used(db: &Db, id: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    conn.execute(
        "UPDATE account SET last_used_at = ?1 WHERE id = ?2",
        rusqlite::params![now_rfc3339(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn add_account(
    state: State<'_, AppState>,
    platform: String,
    label: String,
    base_url: String,
    pat: String,
) -> Result<Account, String> {
    let p = Platform::parse(&platform)?;
    let pat = pat.trim().to_string();
    if pat.is_empty() {
        return Err("PAT 不能为空".into());
    }
    let base_url_trimmed = base_url.trim().to_string();
    if p == Platform::GitLab && base_url_trimmed.is_empty() {
        return Err("自建 GitLab 需要填写服务器地址".into());
    }

    // 先验证 PAT，再入库
    let info = platform::current_user(
        p,
        if base_url_trimmed.is_empty() {
            None
        } else {
            Some(&base_url_trimmed)
        },
        &pat,
    )
    .await?;

    let display_label = if label.trim().is_empty() {
        info.username.clone()
    } else {
        label.trim().to_string()
    };
    let now = now_rfc3339();

    let id = {
        let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        conn.execute(
            "INSERT INTO account(platform, label, base_url, api_username, avatar_url, credential_key, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, '', ?6)",
            rusqlite::params![
                p.as_str(),
                display_label,
                if base_url_trimmed.is_empty() { None } else { Some(base_url_trimmed.clone()) },
                info.username,
                info.avatar_url,
                now
            ],
        )
        .map_err(|e| format!("保存账号失败: {e}"))?;
        conn.last_insert_rowid()
    };

    let key = credentials::credential_key(p.as_str(), id);
    credentials::set_pat(&key, &pat)?;

    {
        let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        conn.execute(
            "UPDATE account SET credential_key = ?1 WHERE id = ?2",
            rusqlite::params![key, id],
        )
        .map_err(|e| e.to_string())?;
        set_active_id(&conn, Some(id))?;
    }

    get_account(&state.db, id)?.ok_or_else(|| "保存账号后读取失败".to_string())
}

#[tauri::command]
pub async fn list_accounts(state: State<'_, AppState>) -> Result<Vec<Account>, String> {
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM account ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_account)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn update_account(
    state: State<'_, AppState>,
    id: i64,
    label: String,
    base_url: String,
    pat: String,
) -> Result<Account, String> {
    let acc = get_account(&state.db, id)?
        .ok_or_else(|| format!("账号不存在: {id}"))?;
    let p = Platform::parse(&acc.platform)?;
    let label = {
        let l = label.trim().to_string();
        if l.is_empty() {
            acc.api_username.clone().unwrap_or_else(|| acc.label.clone())
        } else {
            l
        }
    };
    let base_url_trimmed = base_url.trim().to_string();
    if p == Platform::GitLab && base_url_trimmed.is_empty() {
        return Err("自建 GitLab 需要填写服务器地址".into());
    }

    // PAT 非空则替换并验证；留空则保持不变
    let new_pat = {
        let p2 = pat.trim().to_string();
        if p2.is_empty() {
            None
        } else {
            let base = if base_url_trimmed.is_empty() {
                acc.base_url.clone()
            } else {
                Some(base_url_trimmed.clone())
            };
            platform::current_user(p, base.as_deref(), &p2).await?;
            Some(p2)
        }
    };
    if let Some(pat) = &new_pat {
        credentials::set_pat(&acc.credential_key, pat)?;
    }

    {
        let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        conn.execute(
            "UPDATE account SET label = ?1, base_url = ?2 WHERE id = ?3",
            rusqlite::params![
                label,
                if base_url_trimmed.is_empty() { acc.base_url.clone() } else { Some(base_url_trimmed) },
                id
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    get_account(&state.db, id)?.ok_or_else(|| "更新后读取失败".to_string())
}

#[tauri::command]
pub async fn delete_account(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let acc = get_account(&state.db, id)?
        .ok_or_else(|| format!("账号不存在: {id}"))?;
    credentials::delete_pat(&acc.credential_key)?;
    {
        let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        conn.execute("DELETE FROM account WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        // 如果删除的是当前账号，清空当前选择
        let is_active: Option<String> = conn
            .query_row(
                "SELECT value FROM app_setting WHERE key = 'active_account_id'",
                [],
                |r| r.get(0),
            )
            .ok();
        if is_active.as_deref() == Some(id.to_string().as_str()) {
            set_active_id(&conn, None)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn set_active_account(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    get_account(&state.db, id)?.ok_or_else(|| format!("账号不存在: {id}"))?;
    {
        let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        set_active_id(&conn, Some(id))?;
    }
    touch_last_used(&state.db, id)?;
    Ok(())
}

#[tauri::command]
pub async fn get_active_account(state: State<'_, AppState>) -> Result<Option<Account>, String> {
    let id: Option<i64> = {
        let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        conn.query_row(
            "SELECT value FROM app_setting WHERE key = 'active_account_id'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
    };
    match id {
        Some(id) => get_account(&state.db, id),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn test_account(state: State<'_, AppState>, id: i64) -> Result<String, String> {
    let acc = get_account(&state.db, id)?
        .ok_or_else(|| format!("账号不存在: {id}"))?;
    let p = Platform::parse(&acc.platform)?;
    let pat = credentials::get_pat(&acc.credential_key)?;
    let info = platform::current_user(p, acc.base_url.as_deref(), &pat).await?;
    // 回填最新用户名/头像
    {
        let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        conn.execute(
            "UPDATE account SET api_username = ?1, avatar_url = ?2 WHERE id = ?3",
            rusqlite::params![info.username, info.avatar_url, id],
        )
        .map_err(|e| e.to_string())?;
    }
    touch_last_used(&state.db, id)?;
    Ok(info.username)
}

pub(crate) struct ActiveCred {
    pub platform: Platform,
    pub base_url: Option<String>,
    pub pat: String,
}

pub(crate) fn active_credential(db: &Db) -> Result<ActiveCred, String> {
    let acc = {
        let conn = db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        let id: Option<String> = conn
            .query_row(
                "SELECT value FROM app_setting WHERE key = 'active_account_id'",
                [],
                |r| r.get(0),
            )
            .ok();
        let id = id
            .and_then(|v| v.parse::<i64>().ok())
            .ok_or_else(|| "请先在账号管理中选择当前账号".to_string())?;
        let mut stmt = conn
            .prepare("SELECT * FROM account WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([id]).map_err(|e| e.to_string())?;
        match rows.next().map_err(|e| e.to_string())? {
            Some(row) => row_to_account(row).map_err(|e| e.to_string())?,
            None => return Err("当前账号已被删除，请重新选择".to_string()),
        }
    };
    let pat = credentials::get_pat(&acc.credential_key)?;
    Ok(ActiveCred {
        platform: Platform::parse(&acc.platform)?,
        base_url: acc.base_url,
        pat,
    })
}