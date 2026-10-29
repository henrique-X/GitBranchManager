use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::accounts::active_credential;
use crate::commands::templates::RepoDefaults;
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct PreflightInfo {
    pub linked: bool,
    pub local_path: Option<String>,
    pub repo_exists: bool,
    pub dirty: bool,
    pub current_branch: Option<String>,
    pub message: Option<String>,
}

fn find_local_path(db: &crate::db::Db, repo_platform: &str, repo_id: &str) -> Option<String> {
    let conn = db.conn.lock().ok()?;
    conn.query_row(
        "SELECT local_path FROM local_project WHERE repo_platform=?1 AND repo_id=?2 LIMIT 1",
        rusqlite::params![repo_platform, repo_id],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

async fn git(dir: &std::path::Path, args: &[&str], timeout: u64) -> Result<String, String> {
    crate::git_service::run_git(dir, args, timeout).await
}

#[tauri::command]
pub async fn preflight_create(
    state: State<'_, AppState>,
    repo_platform: String,
    repo_id: String,
) -> Result<PreflightInfo, String> {
    let mut info = PreflightInfo {
        linked: false,
        local_path: None,
        repo_exists: false,
        dirty: false,
        current_branch: None,
        message: None,
    };
    let Some(path) = find_local_path(&state.db, &repo_platform, &repo_id) else {
        info.message = Some("请先配置本地路径：在「本地项目」页添加工作区、扫描并关联该仓库".into());
        return Ok(info);
    };
    info.linked = true;
    info.local_path = Some(path.clone());
    let dir = std::path::Path::new(&path);
    if !dir.join(".git").exists() {
        info.message = Some(format!("本地路径不是 Git 仓库（缺少 .git）：{path}"));
        return Ok(info);
    }
    info.repo_exists = true;
    let status = git(dir, &["status", "--porcelain"], 30).await?;
    info.dirty = !status.is_empty();
    if info.dirty {
        info.message = Some(format!(
            "本地存在未提交改动（{} 个文件），请先 commit 或 stash 后再创建分支",
            status.lines().count()
        ));
        return Ok(info);
    }
    info.current_branch = git(dir, &["rev-parse", "--abbrev-ref", "HEAD"], 30)
        .await
        .ok();
    Ok(info)
}

#[derive(Debug, Serialize)]
pub struct TargetCheck {
    pub target: String,
    pub valid: bool,
    pub local_exists: bool,
    pub message: Option<String>,
}

#[tauri::command]
pub async fn check_branch_targets(
    state: State<'_, AppState>,
    repo_platform: String,
    repo_id: String,
    targets: Vec<String>,
) -> Result<Vec<TargetCheck>, String> {
    let Some(path) = find_local_path(&state.db, &repo_platform, &repo_id) else {
        return Ok(targets
            .into_iter()
            .map(|t| TargetCheck {
                target: t,
                valid: false,
                local_exists: false,
                message: Some("未关联本地路径".into()),
            })
            .collect());
    };
    let dir = std::path::Path::new(&path);
    let mut out = Vec::new();
    for t in targets {
        let valid = crate::git_service::validate_branch_name(&t).is_ok();
        let local_exists = valid
            && git(dir, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{t}")], 30)
                .await
                .is_ok();
        out.push(TargetCheck {
            target: t,
            valid,
            local_exists,
            message: None,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateItem {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct CreateResult {
    pub source: String,
    pub target: String,
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub async fn git_create_branches(
    state: State<'_, AppState>,
    repo_platform: String,
    repo_id: String,
    items: Vec<CreateItem>,
) -> Result<Vec<CreateResult>, String> {
    let Some(path) = find_local_path(&state.db, &repo_platform, &repo_id) else {
        return Err("请先配置本地路径（本地项目页关联仓库后重试）".into());
    };
    let dir = std::path::Path::new(&path);

    // 1) 前置检查：仓库有效 + 无未提交改动
    if !dir.join(".git").exists() {
        return Err(format!("本地路径不是 Git 仓库：{path}"));
    }
    let status = git(dir, &["status", "--porcelain"], 30).await?;
    if !status.is_empty() {
        return Err(format!(
            "本地存在未提交改动（{} 个文件），请先 commit 或 stash 后重试",
            status.lines().count()
        ));
    }

    // 2) 自动 fetch 更新远程分支（冻结需求：自动 fetch/pull）
    if let Err(e) = git(dir, &["fetch", "--prune", "origin"], 300).await {
        return Err(format!("git fetch 失败，请检查网络/凭据后重试：{e}"));
    }

    // 3) 逐条创建（同一工作目录需顺序执行）
    let mut results = Vec::new();
    for item in &items {
        if let Err(e) = crate::git_service::validate_branch_name(&item.target) {
            results.push(CreateResult {
                source: item.source.clone(),
                target: item.target.clone(),
                success: false,
                message: e,
            });
            continue;
        }
        // 本地同名冲突拦截（冻结需求：标红阻止）
        if git(dir, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{}", item.target)], 30)
            .await
            .is_ok()
        {
            results.push(CreateResult {
                source: item.source.clone(),
                target: item.target.clone(),
                success: false,
                message: "本地已存在同名分支".into(),
            });
            continue;
        }
        // 冻结需求：基于本地源分支创建；创建前尝试把本地源分支快进到远程
        let remote_ref = format!("refs/remotes/origin/{}", item.source);
        let local_ref = format!("refs/heads/{}", item.source);
        let local_src_exists =
            git(dir, &["rev-parse", "--verify", "--quiet", &local_ref], 30)
                .await
                .is_ok();
        let base;
        let mut note = String::from("已在本地创建（未 push，请自行推送）");
        if local_src_exists {
            // 等价于不切换分支的 pull：仅允许快进；分叉时保留本地状态并提示
            if let Err(e) = git(
                dir,
                &["fetch", "origin", &format!("{}:{}", item.source, item.source)],
                300,
            )
            .await
            {
                note = format!(
                    "已在本地创建（注意：本地源分支与远程有分叉，未自动合并远程，已按本地源分支创建。原因：{e}）"
                );
            }
            base = local_ref;
        } else if git(dir, &["rev-parse", "--verify", "--quiet", &remote_ref], 30)
            .await
            .is_ok()
        {
            // 本地没有源分支：只能基于远程源分支
            note = format!(
                "已在本地创建（本地不存在源分支 {}，已基于远程源分支创建）",
                item.source
            );
            base = remote_ref;
        } else {
            results.push(CreateResult {
                source: item.source.clone(),
                target: item.target.clone(),
                success: false,
                message: format!("源分支 {} 不存在（本地与远程均未找到）", item.source),
            });
            continue;
        }
        match git(dir, &["branch", &item.target, &base], 30).await {
            Ok(_) => results.push(CreateResult {
                source: item.source.clone(),
                target: item.target.clone(),
                success: true,
                message: note,
            }),
            Err(e) => results.push(CreateResult {
                source: item.source.clone(),
                target: item.target.clone(),
                success: false,
                message: e,
            }),
        }
    }
    Ok(results)
}
