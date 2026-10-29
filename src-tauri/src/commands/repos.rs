use tauri::State;

use crate::commands::accounts::active_credential;
use crate::models::{Branch, RepoPage};
use crate::platform;
use crate::AppState;

#[tauri::command]
pub async fn list_repos(state: State<'_, AppState>, page: u32) -> Result<RepoPage, String> {
    let cred = active_credential(&state.db)?;
    platform::list_repos(cred.platform, cred.base_url.as_deref(), &cred.pat, page).await
}

#[tauri::command]
pub async fn list_branches(
    state: State<'_, AppState>,
    repo_platform: String,
    repo_key: String,
) -> Result<Vec<Branch>, String> {
    let cred = active_credential(&state.db)?;
    if cred.platform.as_str() != repo_platform {
        return Err(format!(
            "仓库平台（{repo_platform}）与当前账号平台（{}）不一致",
            cred.platform.as_str()
        ));
    }
    platform::list_branches(cred.platform, cred.base_url.as_deref(), &cred.pat, &repo_key).await
}

#[derive(serde::Serialize)]
pub struct CachedRepos {
    pub repos: Vec<crate::models::Repo>,
    pub updated_at: String,
}

#[tauri::command]
pub async fn repo_cache_get(
    state: State<'_, AppState>,
    account_id: i64,
    platform: String,
) -> Result<Option<CachedRepos>, String> {
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    let result = conn.query_row(
        "SELECT repos_json, updated_at FROM repo_cache WHERE account_id = ?1 AND platform = ?2",
        rusqlite::params![account_id, platform],
        |row| {
            Ok(CachedRepos {
                repos: serde_json::from_str(&row.get::<_, String>(0)?)
                    .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?,
                updated_at: row.get(1)?,
            })
        },
    );
    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("读取仓库缓存失败: {e}")),
    }
}

#[tauri::command]
pub async fn repo_cache_put(
    state: State<'_, AppState>,
    account_id: i64,
    platform: String,
    repos: Vec<crate::models::Repo>,
    updated_at: String,
) -> Result<(), String> {
    let json = serde_json::to_string(&repos).map_err(|e| format!("序列化仓库缓存失败: {e}"))?;
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    conn.execute(
        "INSERT INTO repo_cache(account_id, platform, repos_json, updated_at) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(account_id, platform) DO UPDATE SET repos_json = excluded.repos_json, updated_at = excluded.updated_at",
        rusqlite::params![account_id, platform, json, updated_at],
    )
    .map_err(|e| format!("写入仓库缓存失败: {e}"))?;
    Ok(())
}
#[derive(serde::Serialize)]
pub struct CachedBranches {
    pub branches: Vec<crate::models::Branch>,
    pub updated_at: String,
}

#[tauri::command]
pub async fn branch_cache_get(
    state: State<'_, AppState>,
    account_id: i64,
    platform: String,
    repo_key: String,
) -> Result<Option<CachedBranches>, String> {
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    let result = conn.query_row(
        "SELECT branches_json, updated_at FROM branch_cache WHERE account_id = ?1 AND platform = ?2 AND repo_key = ?3",
        rusqlite::params![account_id, platform, repo_key],
        |row| {
            Ok(CachedBranches {
                branches: serde_json::from_str(&row.get::<_, String>(0)?)
                    .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?,
                updated_at: row.get(1)?,
            })
        },
    );
    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("读取分支缓存失败: {e}")),
    }
}

#[tauri::command]
pub async fn branch_cache_put(
    state: State<'_, AppState>,
    account_id: i64,
    platform: String,
    repo_key: String,
    branches: Vec<crate::models::Branch>,
    updated_at: String,
) -> Result<(), String> {
    let json = serde_json::to_string(&branches).map_err(|e| format!("序列化分支缓存失败: {e}"))?;
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    conn.execute(
        "INSERT INTO branch_cache(account_id, platform, repo_key, branches_json, updated_at) VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(account_id, platform, repo_key) DO UPDATE SET branches_json = excluded.branches_json, updated_at = excluded.updated_at",
        rusqlite::params![account_id, platform, repo_key, json, updated_at],
    )
    .map_err(|e| format!("写入分支缓存失败: {e}"))?;
    Ok(())
}
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

static DELETE_CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize, Clone)]
pub struct DeleteResult {
    pub branch: String,
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub async fn cancel_batch_delete() -> Result<(), String> {
    DELETE_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn batch_delete_branches(
    state: State<'_, AppState>,
    repo_platform: String,
    repo_key: String,
    branches: Vec<String>,
) -> Result<Vec<DeleteResult>, String> {
    DELETE_CANCEL.store(false, Ordering::SeqCst);
    let cred = active_credential(&state.db)?;
    if cred.platform.as_str() != repo_platform {
        return Err(format!(
            "仓库平台（{repo_platform}）与当前账号平台（{}）不一致",
            cred.platform.as_str()
        ));
    }

    // 删除前重新拉取分支做安全校验（保护分支 / 未知状态一律禁止）
    let current = platform::list_branches(
        cred.platform,
        cred.base_url.as_deref(),
        &cred.pat,
        &repo_key,
    )
    .await?;
    let mut current_map: HashMap<String, &crate::models::Branch> = HashMap::new();
    for b in &current {
        current_map.insert(b.name.clone(), b);
    }

    let mut results: Vec<DeleteResult> = Vec::new();
    let mut to_delete: Vec<String> = Vec::new();
    for name in &branches {
        match current_map.get(name) {
            None => results.push(DeleteResult {
                branch: name.clone(),
                success: false,
                message: "分支不存在（可能已被删除或缓存过期）".into(),
            }),
            Some(b) if b.protected != Some(false) => results.push(DeleteResult {
                branch: name.clone(),
                success: false,
                message: if b.protected == Some(true) {
                    "保护分支，禁止删除".into()
                } else {
                    "保护状态未知，按冻结需求禁止删除".into()
                },
            }),
            _ => to_delete.push(name.clone()),
        }
    }

    let total = to_delete.len();
    for (i, chunk) in to_delete.chunks(5).enumerate() {
        if DELETE_CANCEL.load(Ordering::SeqCst) {
            for name in to_delete[i * 5..].iter() {
                results.push(DeleteResult {
                    branch: name.clone(),
                    success: false,
                    message: "已取消".into(),
                });
            }
            break;
        }
        let futs = chunk
            .iter()
            .map(|name| {
                platform::delete_branch(
                    cred.platform,
                    cred.base_url.as_deref(),
                    &cred.pat,
                    &repo_key,
                    name,
                )
            })
            .collect::<Vec<_>>();
        let res = futures::future::join_all(futs).await;
        for (name, r) in chunk.iter().zip(res) {
            results.push(DeleteResult {
                branch: name.clone(),
                success: r.is_ok(),
                message: match r {
                    Ok(()) => "删除成功".into(),
                    Err(e) => e,
                },
            });
        }
        let _ = total;
    }

    Ok(results)
}