use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

pub struct Db {
    pub conn: Mutex<Connection>,
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace (
  id INTEGER PRIMARY KEY,
  root_path TEXT NOT NULL UNIQUE,
  scan_depth INTEGER NOT NULL DEFAULT 3,
  created_at TEXT,
  last_scan_at TEXT
);

CREATE TABLE IF NOT EXISTS local_project (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id),
  name TEXT NOT NULL,
  local_path TEXT NOT NULL UNIQUE,
  remote_url TEXT,
  repo_platform TEXT,
  repo_id TEXT,
  matched_at TEXT,
  UNIQUE(workspace_id, local_path)
);

CREATE TABLE IF NOT EXISTS account (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,
  label TEXT NOT NULL,
  base_url TEXT,
  api_username TEXT,
  avatar_url TEXT,
  credential_key TEXT NOT NULL,
  created_at TEXT,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS naming_template (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  variables TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS repo_variable_default (
  id INTEGER PRIMARY KEY,
  repo_platform TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  template_id INTEGER NOT NULL,
  values_json TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(repo_platform, repo_id, template_id)
);

CREATE TABLE IF NOT EXISTS repo_cache (
  account_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  repos_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, platform)
);

CREATE TABLE IF NOT EXISTS branch_cache (
  account_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  repo_key TEXT NOT NULL,
  branches_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, platform, repo_key)
);

CREATE TABLE IF NOT EXISTS app_setting (
  key TEXT PRIMARY KEY,
  value TEXT
);
"#;

impl Db {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("打开数据库失败: {e}"))?;
        conn.execute_batch(SCHEMA)
            .map_err(|e| format!("初始化数据库失败: {e}"))?;
        // 兼容旧库：补充 last_scan_at 列（已存在则忽略报错）
        let _ = conn.execute("ALTER TABLE workspace ADD COLUMN last_scan_at TEXT", []);
        let _ = conn.execute("ALTER TABLE local_project ADD COLUMN repo_name TEXT", []);
        Ok(Db {
            conn: Mutex::new(conn),
        })
    }
}
