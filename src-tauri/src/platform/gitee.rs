use super::{client, connect_err, ensure_success, parse_user, UserInfo};
use crate::models::{Branch, Repo, RepoPage};
use serde_json::Value;
use std::collections::HashSet;

pub async fn current_user(pat: &str) -> Result<UserInfo, String> {
    let c = client()?;
    let resp = c
        .get("https://gitee.com/api/v5/user")
        .query(&[("access_token", pat)])
        .send()
        .await
        .map_err(|e| connect_err("连接 Gitee 失败", e))?;
    parse_user(resp).await
}

async fn get_pages(
    c: &reqwest::Client,
    pat: &str,
    url: &str,
    extra_query: &[(&str, &str)],
    max_pages: u32,
) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    let mut page = 1u32;
    loop {
        let mut q: Vec<(&str, &str)> = vec![("access_token", pat), ("per_page", "100")];
        let page_str = page.to_string();
        q.push(("page", &page_str));
        for kv in extra_query {
            q.push(*kv);
        }
        let resp = c
            .get(url)
            .query(&q)
            .send()
            .await
            .map_err(|e| connect_err("连接 Gitee 失败", e))?;
        let resp = ensure_success(resp).await?;
        let items: Vec<Value> = resp.json().await.map_err(|e| format!("解析列表失败: {e}"))?;
        let count = items.len();
        out.extend(items);
        if count < 100 || page >= max_pages {
            break;
        }
        page += 1;
    }
    Ok(out)
}

fn repo_from_value(v: Value, force_org: Option<&str>) -> Option<Repo> {
    let id = v.get("id")?.as_i64()?;
    let name = v.get("name").and_then(|x| x.as_str())?.to_string();
    let full_name = v
        .get("full_name")
        .and_then(|x| x.as_str())
        .unwrap_or(&name)
        .to_string();
    let private = v.get("private").and_then(|x| x.as_bool()).unwrap_or(false);
    let ns_type = v
        .pointer("/namespace/type")
        .and_then(|x| x.as_str())
        .unwrap_or("owner");
    let ns_name = v
        .pointer("/namespace/name")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let is_org = force_org.is_some() || ns_type != "owner";
    let source_label = if let Some(org) = force_org {
        org.to_string()
    } else if is_org && !ns_name.is_empty() {
        ns_name.to_string()
    } else {
        "个人".to_string()
    };
    Some(Repo {
        id: id.to_string(),
        name,
        full_name,
        platform: "gitee".into(),
        is_org,
        source_label,
        visibility: if private { "private".into() } else { "public".into() },
        default_branch: v
            .get("default_branch")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        web_url: v
            .get("html_url")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        updated_at: v
            .get("updated_at")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
    })
}

pub async fn list_repos(pat: &str) -> Result<RepoPage, String> {
    let c = client()?;
    let mut seen = HashSet::new();
    let mut repos = Vec::new();

    // 1) 个人及参与仓库
    let raw = get_pages(&c, pat, "https://gitee.com/api/v5/user/repos", &[], 50).await?;
    for v in raw {
        if let Some(r) = repo_from_value(v, None) {
            if seen.insert(r.full_name.clone()) {
                repos.push(r);
            }
        }
    }

    // 2) 所属组织的仓库
    let orgs_raw = get_pages(&c, pat, "https://gitee.com/api/v5/user/orgs", &[], 20).await?;
    for ov in orgs_raw {
        let path = ov
            .get("path")
            .or_else(|| ov.get("login"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let name = ov
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or(&path)
            .to_string();
        if path.is_empty() {
            continue;
        }
        let url = format!("https://gitee.com/api/v5/orgs/{path}/repos");
        let org_repos = get_pages(&c, pat, &url, &[], 50).await?;
        for v in org_repos {
            if let Some(r) = repo_from_value(v, Some(&name)) {
                if seen.insert(r.full_name.clone()) {
                    repos.push(r);
                }
            }
        }
    }

    Ok(RepoPage { repos, has_more: false })
}

async fn fetch_branch_detail(
    c: &reqwest::Client,
    pat: &str,
    owner: &str,
    repo: &str,
    name: String,
) -> Option<(Option<String>, Option<String>, Option<String>)> {
    let resp = c
        .get(&format!(
            "https://gitee.com/api/v5/repos/{owner}/{repo}/branches/{name}"
        ))
        .query(&[("access_token", pat)])
        .send()
        .await
        .ok()?;
    let v: Value = resp.json().await.ok()?;
    let commit = v.get("commit")?;
    let message = commit
        .get("message")
        .and_then(|x| x.as_str())
        .map(|m| {
            let first = m.lines().next().unwrap_or("");
            let first = first.trim();
            if first.len() > 80 { format!("{}…", &first[..80]) } else { first.to_string() }
        });
    let author = commit
        .pointer("/author/name")
        .or_else(|| commit.get("author_name"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let date = commit
        .pointer("/author/time")
        .or_else(|| commit.get("commit_date"))
        .or_else(|| commit.get("created_at"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    Some((message, author, date))
}

pub async fn list_branches(pat: &str, repo_key: &str) -> Result<Vec<Branch>, String> {
    let parts: Vec<&str> = repo_key.splitn(2, '/').collect();
    if parts.len() != 2 {
        return Err(format!("无效的仓库标识: {repo_key}（应为 owner/name）"));
    }
    let (owner, repo) = (parts[0], parts[1]);
    let c = client()?;

    // 分支列表（分页取全）
    let url = format!("https://gitee.com/api/v5/repos/{owner}/{repo}/branches");
    let raw = get_pages(&c, pat, &url, &[], 50).await?;

    // 保护分支列表：Gitee 公开文档不稳定，尽力识别，失败按"未知"处理（冻结需求：未知视为保护）
    let mut protected_set: HashSet<String> = HashSet::new();
    let mut protected_known = false;
    let resp = c
        .get(&format!(
            "https://gitee.com/api/v5/repos/{owner}/{repo}/protected_branches"
        ))
        .query(&[("access_token", pat)])
        .send()
        .await;
    if let Ok(resp) = resp {
        if resp.status().is_success() {
            if let Ok(items) = resp.json::<Vec<Value>>().await {
                protected_known = true;
                for it in items {
                    if let Some(n) = it
                        .get("name")
                        .or_else(|| it.get("branch_name"))
                        .and_then(|x| x.as_str())
                    {
                        protected_set.insert(n.to_string());
                    }
                }
            }
        }
    }

    // 并发补齐提交详情（每批 10 个）
    let mut branches = Vec::new();
    for chunk in raw.chunks(10) {
        let mut futs = Vec::new();
        for b in chunk {
            let name = b.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
            futs.push(fetch_branch_detail(&c, pat, owner, repo, name.clone()));
        }
        let details = futures::future::join_all(futs).await;
        for (b, detail) in chunk.iter().zip(details) {
            let name = b.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
            if name.is_empty() {
                continue;
            }
            let (message, author, date) = detail.unwrap_or((None, None, None));
            let sha = b
                .pointer("/commit/sha")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            let protected = if protected_known {
                Some(protected_set.contains(&name))
            } else {
                None
            };
            branches.push(Branch { name, sha, message, author, date, protected });
        }
    }
    Ok(branches)
}

use super::encode_path;

pub async fn delete_branch(pat: &str, repo_key: &str, branch: &str) -> Result<(), String> {
    let parts: Vec<&str> = repo_key.splitn(2, '/').collect();
    if parts.len() != 2 {
        return Err(format!("无效的仓库标识: {repo_key}"));
    }
    let (owner, repo) = (parts[0], parts[1]);
    let c = client()?;
    let resp = c
        .delete(&format!(
            "https://gitee.com/api/v5/repos/{owner}/{repo}/branches/{}",
            encode_path(branch)
        ))
        .query(&[("access_token", pat)])
        .send()
        .await
        .map_err(|e| connect_err("连接 Gitee 失败", e))?;
    ensure_success(resp).await?;
    Ok(())
}