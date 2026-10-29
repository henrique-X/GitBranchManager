use serde::Serialize;
use tauri::State;

use crate::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct Workspace {
    pub id: i64,
    pub root_path: String,
    pub scan_depth: i64,
    pub created_at: Option<String>,
    pub last_scan_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalProjectRow {
    pub id: i64,
    pub workspace_id: i64,
    pub name: String,
    pub local_path: String,
    pub remote_url: Option<String>,
    pub repo_platform: Option<String>,
    pub repo_id: Option<String>,
    pub repo_name: Option<String>,
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub async fn add_workspace(
    state: State<'_, AppState>,
    root_path: String,
) -> Result<Workspace, String> {
    let root = root_path.trim().to_string();
    if root.is_empty() {
        return Err("请填写工作区根目录".into());
    }
    let path = std::path::Path::new(&root);
    if !path.is_dir() {
        return Err(format!("目录不存在或不是文件夹: {root}"));
    }
    let now = now_rfc3339();
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    conn.execute(
        "INSERT INTO workspace(root_path, scan_depth, created_at) VALUES(?1, 3, ?2)",
        rusqlite::params![root, now],
    )
    .map_err(|e| format!("保存工作区失败: {e}"))?;
    let id = conn.last_insert_rowid();
    Ok(Workspace {
        id,
        root_path: root,
        scan_depth: 3,
        created_at: Some(now),
        last_scan_at: None,
    })
}

#[tauri::command]
pub async fn remove_workspace(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    conn.execute("DELETE FROM local_project WHERE workspace_id = ?1", [id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM workspace WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, root_path, scan_depth, created_at, last_scan_at FROM workspace ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Workspace {
                id: r.get(0)?,
                root_path: r.get(1)?,
                scan_depth: r.get(2)?,
                created_at: r.get(3)?,
                last_scan_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn scan_workspace(
    state: State<'_, AppState>,
    workspace_id: i64,
) -> Result<Vec<LocalProjectRow>, String> {
    let (root, depth) = {
        let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        conn.query_row(
            "SELECT root_path, scan_depth FROM workspace WHERE id = ?1",
            [workspace_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )
        .map_err(|_| format!("工作区不存在: {workspace_id}"))?
    };
    let found = tokio::task::spawn_blocking(move || {
        crate::git_service::scan_dir(std::path::Path::new(&root), depth as u32)
    })
    .await
    .map_err(|e| format!("扫描任务失败: {e}"))?;

    // 事务式替换该项目下的本地项目记录
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    conn.execute("DELETE FROM local_project WHERE workspace_id = ?1", [workspace_id])
        .map_err(|e| e.to_string())?;
    for item in &found {
        conn.execute(
            "INSERT INTO local_project(workspace_id, name, local_path, remote_url) VALUES(?1, ?2, ?3, ?4)",
            rusqlite::params![workspace_id, item.0, item.1, item.2],
        )
        .map_err(|e| format!("保存扫描结果失败: {e}"))?;
    }
    conn.execute(
        "UPDATE workspace SET last_scan_at = ?1 WHERE id = ?2",
        rusqlite::params![chrono::Utc::now().to_rfc3339(), workspace_id],
    )
    .map_err(|e| e.to_string())?;
    drop(conn);
    list_local_projects_impl(&state.db, Some(workspace_id))
}

#[tauri::command]
pub async fn list_local_projects(
    state: State<'_, AppState>,
    workspace_id: Option<i64>,
) -> Result<Vec<LocalProjectRow>, String> {
    list_local_projects_impl(&state.db, workspace_id)
}

fn list_local_projects_impl(
    db: &crate::db::Db,
    workspace_id: Option<i64>,
) -> Result<Vec<LocalProjectRow>, String> {
    let conn = db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    let sql = match workspace_id {
        Some(_) => "SELECT id, workspace_id, name, local_path, remote_url, repo_platform, repo_id, repo_name FROM local_project WHERE workspace_id = ?1 ORDER BY name",
        None => "SELECT id, workspace_id, name, local_path, remote_url, repo_platform, repo_id, repo_name FROM local_project ORDER BY workspace_id, name",
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let map_row = |r: &rusqlite::Row| -> rusqlite::Result<LocalProjectRow> {
        Ok(LocalProjectRow {
            id: r.get(0)?,
            workspace_id: r.get(1)?,
            name: r.get(2)?,
            local_path: r.get(3)?,
            remote_url: r.get(4)?,
            repo_platform: r.get(5)?,
            repo_id: r.get(6)?,
            repo_name: r.get(7)?,
        })
    };
    let rows = if workspace_id.is_some() {
        stmt.query_map([workspace_id.unwrap()], map_row)
            .map_err(|e| e.to_string())?
    } else {
        stmt.query_map([], map_row).map_err(|e| e.to_string())?
    };
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn link_local_project(
    state: State<'_, AppState>,
    local_id: i64,
    repo_platform: String,
    repo_id: String,
    repo_name: String,
) -> Result<(), String> {
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    conn.execute(
        "UPDATE local_project SET repo_platform = ?1, repo_id = ?2, repo_name = ?3, matched_at = ?4 WHERE id = ?5",
        rusqlite::params![repo_platform, repo_id, repo_name, now_rfc3339(), local_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn unlink_local_project(state: State<'_, AppState>, local_id: i64) -> Result<(), String> {
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    conn.execute(
        "UPDATE local_project SET repo_platform = NULL, repo_id = NULL, matched_at = NULL WHERE id = ?1",
        [local_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
