export type Platform = "github" | "gitee" | "gitlab";

export interface Account {
  id: number;
  platform: Platform;
  label: string;
  base_url: string | null;
  api_username: string | null;
  avatar_url: string | null;
  credential_key: string;
  created_at: string | null;
  last_used_at: string | null;
}

export interface Repo {
  id: string;
  name: string;
  full_name: string;
  platform: Platform;
  is_org: boolean;
  source_label: string;
  visibility: string;
  default_branch: string | null;
  web_url: string | null;
  updated_at: string | null;
}

export interface RepoPage {
  repos: Repo[];
  has_more: boolean;
}

export interface Branch {
  name: string;
  sha: string | null;
  message: string | null;
  author: string | null;
  date: string | null;
  /** null = 无法识别保护状态（视为保护分支处理） */
  protected: boolean | null;
}

export interface CachedRepos {
  repos: Repo[];
  updated_at: string;
}

export interface CachedBranches {
  branches: Branch[];
  updated_at: string;
}

export interface Workspace {
  id: number;
  root_path: string;
  scan_depth: number;
  created_at: string | null;
  last_scan_at: string | null;
}

export interface LocalProject {
  id: number;
  workspace_id: number;
  name: string;
  local_path: string;
  remote_url: string | null;
  repo_platform: string | null;
  repo_id: string | null;
  repo_name: string | null;
}

export type ProxyMode = "none" | "system" | "manual" | "pac";

export interface ProxyConfig {
  mode: ProxyMode;
  http_host: string | null;
  http_port: number | null;
  use_http_for_https: boolean;
  https_host: string | null;
  https_port: number | null;
  socks_host: string | null;
  socks_port: number | null;
  socks_version: number;
  pac_url: string | null;
  exceptions: string | null;
}

export interface SystemProxy {
  enabled: boolean;
  http: string | null;
  https: string | null;
  socks: string | null;
  pac_url: string | null;
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  github: "GitHub",
  gitee: "Gitee",
  gitlab: "GitLab",
};

/** 归一化远程地址：git@/https 统一为 host/path，便于匹配 */
export function normalizeGitUrl(u: string): string {
  let s = u.trim().replace(/\.git$/i, "");
  const ssh = s.match(/^git@([^:]+):(.+)$/);
  if (ssh) {
    return (ssh[1] + "/" + ssh[2]).replace(/\/+$/, "").toLowerCase();
  }
  try {
    const url = new URL(s);
    return (url.host + url.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

export interface DeleteResult {
  branch: string;
  success: boolean;
  message: string;
}
export interface NamingTemplate {
  id: number;
  name: string;
  pattern: string;
  variables: string[];
  created_at: string | null;
  updated_at: string | null;
}

export interface RepoDefaults {
  repo_platform: string;
  repo_id: string;
  template_id: number;
  values: Record<string, string>;
}

export interface PreflightInfo {
  linked: boolean;
  local_path: string | null;
  repo_exists: boolean;
  dirty: boolean;
  current_branch: string | null;
  message: string | null;
}

export interface TargetCheck {
  target: string;
  valid: boolean;
  local_exists: boolean;
  message: string | null;
}

export interface CreateItem {
  source: string;
  target: string;
}

export interface CreateResult {
  source: string;
  target: string;
  success: boolean;
  message: string;
}
export interface GeneralSettings {
  launch_at_startup: boolean;
  close_to_tray: boolean;
  tray_style: "panel" | "menu";
}