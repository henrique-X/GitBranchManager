use super::{
    client, connect_err, ensure_success, jbool, json_array_or_error, jstr, jstr_at, parse_user,
    UserInfo,
};
use crate::models::{Branch, Repo, RepoPage};
use serde_json::Value;

pub async fn current_user(pat: &str) -> Result<UserInfo, String> {
    let c = client()?;
    let resp = c
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| connect_err("连接 GitHub 失败", e))?;
    parse_user(resp).await
}

fn repo_from_value(v: &Value) -> Option<Repo> {
    // id / full_name / owner 缺失时跳过该条，保证整体不失败
    if v.get("id").and_then(|x| x.as_i64()).is_none() {
        return None;
    }
    let name = jstr(v, "name")?;
    let full_name = jstr(v, "full_name").unwrap_or_else(|| name.clone());
    let owner_login = jstr_at(v, &["owner", "login"]).unwrap_or_default();
    let owner_type = jstr_at(v, &["owner", "type"]).unwrap_or_default();
    let is_org = owner_type == "Organization";
    Some(Repo {
        id: full_name.clone(),
        name,
        full_name: full_name.clone(),
        platform: "github".into(),
        is_org,
        source_label: if is_org {
            owner_login
        } else {
            "个人".into()
        },
        visibility: if jbool(v, "private").unwrap_or(false) {
            "private".into()
        } else {
            "public".into()
        },
        default_branch: jstr(v, "default_branch"),
        web_url: jstr(v, "html_url"),
        updated_at: jstr(v, "updated_at"),
    })
    .map(|mut r| {
        r.id = full_name;
        r
    })
}

pub async fn list_repos(pat: &str, page: u32) -> Result<RepoPage, String> {
    let c = client()?;
    let resp = c
        .get("https://api.github.com/user/repos")
        .query(&[
            ("per_page", "100"),
            ("page", &page.to_string()),
            ("affiliation", "owner,collaborator,organization_member"),
            ("sort", "updated"),
        ])
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| connect_err(&format!("连接 GitHub 失败（第 {page} 页）"), e))?;
    let has_more = resp
        .headers()
        .get(reqwest::header::LINK)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.contains(r#"rel="next""#))
        .unwrap_or(false);
    let resp = ensure_success(resp).await?;
    let raw = json_array_or_error(resp, &format!("GitHub 仓库列表（第 {page} 页）")).await?;
    let repos: Vec<Repo> = raw.iter().filter_map(repo_from_value).collect();
    Ok(RepoPage { repos, has_more })
}

async fn fetch_commit_detail(
    c: &reqwest::Client,
    pat: &str,
    owner: &str,
    repo: &str,
    sha: String,
) -> Option<(Option<String>, Option<String>, Option<String>)> {
    let resp = c
        .get(&format!("https://api.github.com/repos/{owner}/{repo}/commits/{sha}"))
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .ok()?;
    let v: Value = resp.json().await.ok()?;
    let message = jstr(&v.clone(), "message").map(|m| {
        let first = m.lines().next().unwrap_or("").trim().to_string();
        if first.len() > 80 { format!("{}…", &first[..80]) } else { first }
    });
    Some((
        message,
        jstr_at(&v, &["commit", "author", "name"]),
        jstr_at(&v, &["commit", "author", "date"]),
    ))
}

pub async fn list_branches(pat: &str, repo_key: &str) -> Result<Vec<Branch>, String> {
    let parts: Vec<&str> = repo_key.splitn(2, '/').collect();
    if parts.len() != 2 {
        return Err(format!("无效的仓库标识: {repo_key}（应为 owner/name）"));
    }
    let (owner, repo) = (parts[0], parts[1]);
    let c = client()?;
    let resp = c
        .get(&format!("https://api.github.com/repos/{owner}/{repo}/branches"))
        .query(&[("per_page", "100")])
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| connect_err("连接 GitHub 失败", e))?;
    let resp = ensure_success(resp).await?;
    let raw = json_array_or_error(resp, "GitHub 分支列表").await?;

    let mut branches = Vec::new();
    for chunk in raw.chunks(10) {
        let mut futs = Vec::new();
        for b in chunk {
            let sha = jstr_at(b, &["commit", "sha"]).unwrap_or_default();
            futs.push(fetch_commit_detail(&c, pat, owner, repo, sha));
        }
        let details = futures::future::join_all(futs).await;
        for (b, detail) in chunk.iter().zip(details) {
            let name = match jstr(b, "name") {
                Some(n) => n,
                None => continue,
            };
            let (message, author, date) = detail.unwrap_or((None, None, None));
            branches.push(Branch {
                name,
                sha: jstr_at(b, &["commit", "sha"]),
                message,
                author,
                date,
                protected: jbool(b, "protected"),
            });
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
            "https://api.github.com/repos/{owner}/{repo}/git/refs/heads/{}",
            encode_path(branch)
        ))
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| connect_err("连接 GitHub 失败", e))?;
    ensure_success(resp).await?;
    Ok(())
}