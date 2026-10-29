use super::{
    client, connect_err, ensure_success, jbool, json_array_or_error, jstr, jstr_at, parse_user,
    UserInfo,
};
use crate::models::{Branch, Repo, RepoPage};
use serde_json::Value;
use std::collections::HashSet;

pub async fn current_user(base_url: Option<&str>, pat: &str) -> Result<UserInfo, String> {
    let base = normalize_base(base_url);
    let url = format!("{base}/api/v4/user");
    let c = client()?;
    let resp = c
        .get(&url)
        .header("PRIVATE-TOKEN", pat)
        .send()
        .await
        .map_err(|e| connect_err(&format!("连接 GitLab（{base}）失败"), e))?;
    parse_user(resp).await
}

fn normalize_base(base_url: Option<&str>) -> String {
    base_url
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://gitlab.com".to_string())
}

fn repo_from_value(v: &Value) -> Option<Repo> {
    let id = v.get("id")?.as_i64()?;
    let name = jstr(v, "name")?;
    let kind = jstr_at(v, &["namespace", "kind"]).unwrap_or_default();
    let ns_name = jstr_at(v, &["namespace", "name"]).unwrap_or_default();
    let is_org = kind == "group";
    let source_label = if is_org && !ns_name.is_empty() {
        ns_name
    } else {
        "个人".to_string()
    };
    Some(Repo {
        id: id.to_string(),
        name: name.clone(),
        full_name: jstr(v, "path_with_namespace").unwrap_or(name),
        platform: "gitlab".into(),
        is_org,
        source_label,
        visibility: jstr(v, "visibility").unwrap_or_else(|| "private".into()),
        default_branch: jstr(v, "default_branch"),
        web_url: jstr(v, "web_url"),
        updated_at: jstr(v, "last_activity_at"),
    })
}

pub async fn list_repos(base_url: Option<&str>, pat: &str) -> Result<RepoPage, String> {
    let base = normalize_base(base_url);
    let c = client()?;
    let mut repos = Vec::new();
    let mut page = 1u32;
    loop {
        let page_str = page.to_string();
        let resp = c
            .get(&format!("{base}/api/v4/projects"))
            .query(&[
                ("membership", "true"),
                ("per_page", "100"),
                ("page", &page_str),
                ("order_by", "last_activity_at"),
            ])
            .header("PRIVATE-TOKEN", pat)
            .send()
            .await
            .map_err(|e| connect_err(&format!("连接 GitLab（{base}）失败（第 {page} 页）"), e))?;
        let resp = ensure_success(resp).await?;
        let raw = json_array_or_error(resp, &format!("GitLab 仓库列表（第 {page} 页）")).await?;
        let count = raw.len();
        for v in &raw {
            if let Some(r) = repo_from_value(v) {
                repos.push(r);
            }
        }
        if count < 100 || page >= 50 {
            break;
        }
        page += 1;
    }
    Ok(RepoPage { repos, has_more: false })
}

pub async fn list_branches(
    base_url: Option<&str>,
    pat: &str,
    repo_key: &str,
) -> Result<Vec<Branch>, String> {
    let base = normalize_base(base_url);
    let c = client()?;

    // 分支列表（GitLab 接口自带提交详情）
    let mut branches = Vec::new();
    let mut page = 1u32;
    loop {
        let page_str = page.to_string();
        let resp = c
            .get(&format!(
                "{base}/api/v4/projects/{repo_key}/repository/branches"
            ))
            .query(&[("per_page", "100"), ("page", &page_str)])
            .header("PRIVATE-TOKEN", pat)
            .send()
            .await
            .map_err(|e| connect_err(&format!("连接 GitLab（{base}）失败（第 {page} 页）"), e))?;
        let resp = ensure_success(resp).await?;
        let raw = json_array_or_error(resp, &format!("GitLab 分支列表（第 {page} 页）")).await?;
        let count = raw.len();
        for b in &raw {
            let name = match jstr(b, "name") {
                Some(n) => n,
                None => continue,
            };
            let message = jstr_at(b, &["commit", "message"])
                .or_else(|| jstr_at(b, &["commit", "title"]))
                .map(|m| {
                    let first = m.lines().next().unwrap_or("").trim().to_string();
                    if first.len() > 80 { format!("{}…", &first[..80]) } else { first }
                });
            branches.push(Branch {
                name,
                sha: jstr_at(b, &["commit", "id"]),
                message,
                author: jstr_at(b, &["commit", "author_name"]),
                date: jstr_at(b, &["commit", "committed_date"]),
                protected: None, // 稍后用保护分支接口补齐
            });
        }
        if count < 100 || page >= 50 {
            break;
        }
        page += 1;
    }

    // 保护分支列表（需要 Maintainer 以上权限；失败则全部按"未知"处理）
    let resp = c
        .get(&format!("{base}/api/v4/projects/{repo_key}/protected_branches"))
        .query(&[("per_page", "100")])
        .header("PRIVATE-TOKEN", pat)
        .send()
        .await;
    if let Ok(resp) = resp {
        if resp.status().is_success() {
            if let Ok(items) = resp.json::<Vec<Value>>().await {
                let set: HashSet<String> = items
                    .iter()
                    .filter_map(|it| jstr(it, "name"))
                    .collect();
                for b in &mut branches {
                    b.protected = Some(set.contains(&b.name));
                }
            }
        }
    }
    let _ = jbool; // 保留辅助函数引用避免未使用告警
    Ok(branches)
}

use super::encode_path;

pub async fn delete_branch(
    base_url: Option<&str>,
    pat: &str,
    repo_key: &str,
    branch: &str,
) -> Result<(), String> {
    let base = normalize_base(base_url);
    let c = client()?;
    let resp = c
        .delete(&format!(
            "{base}/api/v4/projects/{repo_key}/repository/branches/{}",
            encode_path(branch)
        ))
        .header("PRIVATE-TOKEN", pat)
        .send()
        .await
        .map_err(|e| connect_err(&format!("连接 GitLab（{base}）失败"), e))?;
    ensure_success(resp).await?;
    Ok(())
}