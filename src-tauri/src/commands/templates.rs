use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamingTemplate {
    pub id: i64,
    pub name: String,
    pub pattern: String,
    /// 变量名列表（JSON 数组，如 ["userName","projectName","TG_ID","sourceBranch"]）
    pub variables: Vec<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

fn row_to_template(row: &rusqlite::Row<'_>) -> rusqlite::Result<NamingTemplate> {
    let vars_raw: String = row.get("variables")?;
    let variables: Vec<String> = serde_json::from_str(&vars_raw).unwrap_or_default();
    Ok(NamingTemplate {
        id: row.get("id")?,
        name: row.get("name")?,
        pattern: row.get("pattern")?,
        variables,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub(crate) fn extract_variables(pattern: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = pattern.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '{' {
            let mut name = String::new();
            for inner in chars.by_ref() {
                if inner == '}' {
                    break;
                }
                name.push(inner);
            }
            let name = name.trim().to_string();
            if !name.is_empty() && !out.contains(&name) {
                out.push(name);
            }
        }
    }
    out
}

pub(crate) fn validate_pattern(pattern: &str) -> Result<Vec<String>, String> {
    let vars = extract_variables(pattern);
    if !vars.iter().any(|v| v == "sourceBranch") {
        return Err("命名模板必须包含 {sourceBranch} 变量（用于基于源分支生成目标名）".into());
    }
    Ok(vars)
}

fn save_template_impl(
    conn: &rusqlite::Connection,
    id: Option<i64>,
    name: &str,
    pattern: &str,
    variables: &[String],
) -> Result<i64, String> {
    let vars_json = serde_json::to_string(variables).map_err(|e| e.to_string())?;
    if let Some(id) = id {
        conn.execute(
            "UPDATE naming_template SET name=?1, pattern=?2, variables=?3, updated_at=?4 WHERE id=?5",
            rusqlite::params![name, pattern, vars_json, now(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(id)
    } else {
        conn.execute(
            "INSERT INTO naming_template(name, pattern, variables, created_at, updated_at) VALUES(?1,?2,?3,?4,?4)",
            rusqlite::params![name, pattern, vars_json, now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }
}

#[tauri::command]
pub async fn list_templates(state: State<'_, AppState>) -> Result<Vec<NamingTemplate>, String> {
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM naming_template ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_template)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn save_template(
    state: State<'_, AppState>,
    id: Option<i64>,
    name: String,
    pattern: String,
) -> Result<NamingTemplate, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("模板名称不能为空".into());
    }
    let pattern = pattern.trim().to_string();
    if pattern.is_empty() {
        return Err("命名模板不能为空".into());
    }
    let variables = validate_pattern(&pattern)?;
    let new_id = {
        let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
        save_template_impl(&conn, id, &name, &pattern, &variables)?
    };
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM naming_template WHERE id=?1")
        .map_err(|e| e.to_string())?;
    let t = stmt
        .query_row([new_id], row_to_template)
        .map_err(|e| e.to_string())?;
    Ok(t)
}

#[tauri::command]
pub async fn delete_template(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    conn.execute("DELETE FROM repo_variable_default WHERE template_id=?1", [id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM naming_template WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoDefaults {
    pub repo_platform: String,
    pub repo_id: String,
    pub template_id: i64,
    /// {变量名: 默认值}
    pub values: std::collections::HashMap<String, String>,
}

#[tauri::command]
pub async fn get_repo_defaults(
    state: State<'_, AppState>,
    repo_platform: String,
    repo_id: String,
    template_id: i64,
) -> Result<Option<RepoDefaults>, String> {
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    let result = conn.query_row(
        "SELECT values_json FROM repo_variable_default WHERE repo_platform=?1 AND repo_id=?2 AND template_id=?3",
        rusqlite::params![repo_platform, repo_id, template_id],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(raw) => {
            let values: std::collections::HashMap<String, String> =
                serde_json::from_str(&raw).unwrap_or_default();
            Ok(Some(RepoDefaults {
                repo_platform,
                repo_id,
                template_id,
                values,
            }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn save_repo_defaults(
    state: State<'_, AppState>,
    defaults: RepoDefaults,
) -> Result<(), String> {
    let json = serde_json::to_string(&defaults.values).map_err(|e| e.to_string())?;
    let conn = state.db.conn.lock().map_err(|_| "数据库忙".to_string())?;
    conn.execute(
        "INSERT INTO repo_variable_default(repo_platform, repo_id, template_id, values_json, updated_at)
         VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(repo_platform, repo_id, template_id)
         DO UPDATE SET values_json=excluded.values_json, updated_at=excluded.updated_at",
        rusqlite::params![
            defaults.repo_platform,
            defaults.repo_id,
            defaults.template_id,
            json,
            now()
        ],
    )
    .map_err(|e| format!("保存默认值失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn render_template_preview(
    pattern: String,
    values: std::collections::HashMap<String, String>,
    source_branch: String,
) -> Result<String, String> {
    let vars = validate_pattern(&pattern)?;
    for v in &vars {
        if v == "sourceBranch" {
            continue;
        }
        if !values.contains_key(v) || values[v].trim().is_empty() {
            return Err(format!("变量 {{{v}}} 未填写"));
        }
    }
    let mut out = pattern.to_string();
    for (k, v) in &values {
        out = out.replace(&format!("{{{k}}}"), v.trim());
    }
    out = out.replace("{sourceBranch}", &source_branch);
    Ok(out)
}
