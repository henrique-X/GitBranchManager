use std::process::Command;

/// 检查本机 Git 是否可用（M1 环境自检）
#[tauri::command]
pub fn git_check() -> Result<String, String> {
    let out = Command::new("git")
        .arg("--version")
        .output()
        .map_err(|e| format!("无法启动 git（请确认已安装 Git for Windows）: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(format!(
            "git --version 返回失败: {}",
            String::from_utf8_lossy(&out.stderr)
        ))
    }
}

/// 工作区扫描结果: (项目名, 本地绝对路径, origin 远程地址)
pub type ScanItem = (String, String, Option<String>);

const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", "build", ".next", ".nuxt", ".cache",
    "vendor", "out", ".venv", "__pycache__",
];

fn is_git_repo(dir: &std::path::Path) -> bool {
    dir.join(".git").exists()
}

/// 解析 .git/config 中 origin 的远程地址（直接读文件，不启动子进程）
fn read_origin_url(repo_dir: &std::path::Path) -> Option<String> {
    let cfg_path = repo_dir.join(".git").join("config");
    let content = std::fs::read_to_string(cfg_path).ok()?;
    let mut in_origin = false;
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_origin = t.replace(' ', "").to_lowercase().contains("[remote\"origin\"");
            continue;
        }
        if in_origin {
            if let Some(rest) = t.strip_prefix("url") {
                let rest = rest.trim_start().trim_start_matches('=').trim();
                if !rest.is_empty() {
                    return Some(rest.to_string());
                }
            }
        }
    }
    None
}

pub fn scan_dir(root: &std::path::Path, max_depth: u32) -> Vec<ScanItem> {
    let mut out = Vec::new();
    walk(root, 0, max_depth, &mut out);
    out.sort_by(|a, b| a.1.to_lowercase().cmp(&b.1.to_lowercase()));
    out
}

fn walk(dir: &std::path::Path, depth: u32, max_depth: u32, out: &mut Vec<ScanItem>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        if is_git_repo(&p) {
            let url = read_origin_url(&p);
            out.push((name, p.to_string_lossy().to_string(), url));
            // 仓库目录内不再向下找嵌套仓库
            continue;
        }
        if depth + 1 < max_depth {
            walk(&p, depth + 1, max_depth, out);
        }
    }
}
/// 在指定目录执行 git 命令（带超时），成功返回 stdout
pub async fn run_git(dir: &std::path::Path, args: &[&str], timeout_secs: u64) -> Result<String, String> {
    let out = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        tokio::process::Command::new("git")
            .current_dir(dir)
            .args(args)
            .output(),
    )
    .await
    .map_err(|_| format!("git {} 超时（{}秒）", args.join(" "), timeout_secs))?
    .map_err(|e| format!("无法启动 git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

/// 平台分支名合法性校验（GitHub / Gitee / GitLab 规则基本一致的子集）
pub fn validate_branch_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("分支名不能为空".into());
    }
    if name.len() > 200 {
        return Err("分支名过长（>200 字符）".into());
    }
    if name.starts_with('.') || name.starts_with('/') || name.ends_with('/') || name.ends_with('.') {
        return Err("分支名不能以 . 或 / 开头或结尾".into());
    }
    if name.contains("..") || name.contains("//") || name.contains("@{") {
        return Err("分支名不能包含 .. // 或 @{".into());
    }
    for seg in name.split('/') {
        if seg.is_empty() {
            return Err("分支名不能包含空路径段".into());
        }
        if seg.ends_with(".lock") {
            return Err("分支名路径段不能以 .lock 结尾".into());
        }
    }
    let bad: Vec<char> = name
        .chars()
        .filter(|ch| {
            matches!(*ch, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\' | '<' | '>' | '|' | '"' | '\u{7f}')
                || (*ch as u32) < 0x20
        })
        .collect();
    if !bad.is_empty() {
        return Err(format!("分支名包含非法字符: {}", bad.iter().collect::<String>()));
    }
    Ok(())
}