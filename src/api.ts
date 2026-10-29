import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  Branch,
  CachedBranches,
  CreateItem,
  CreateResult,
  DeleteResult,
  GeneralSettings,
  NamingTemplate,
  PreflightInfo,
  RepoDefaults,
  TargetCheck,
  CachedRepos,
  LocalProject,
  Platform,
  ProxyConfig,
  Repo,
  RepoPage,
  SystemProxy,
  Workspace,
} from "./types";

export interface AddAccountArgs {
  platform: Platform;
  label: string;
  baseUrl: string;
  pat: string;
}

export const api = {
  // ---- 账号 ----
  addAccount: (args: AddAccountArgs) =>
    invoke<Account>("add_account", {
      platform: args.platform,
      label: args.label,
      baseUrl: args.baseUrl,
      pat: args.pat,
    }),
  listAccounts: () => invoke<Account[]>("list_accounts"),
  updateAccount: (id: number, label: string, baseUrl: string, pat: string) =>
    invoke<Account>("update_account", { id, label, baseUrl, pat }),
  deleteAccount: (id: number) => invoke<void>("delete_account", { id }),
  setActiveAccount: (id: number) => invoke<void>("set_active_account", { id }),
  getActiveAccount: () => invoke<Account | null>("get_active_account"),
  testAccount: (id: number) => invoke<string>("test_account", { id }),
  gitCheck: () => invoke<string>("git_check"),

  // ---- 仓库 / 分支 ----
  listRepos: (page: number) => invoke<RepoPage>("list_repos", { page }),
  // ---- 命名模板 / 批量创建 ----
  listTemplates: () => invoke<NamingTemplate[]>("list_templates"),
  saveTemplate: (id: number | null, name: string, pattern: string) =>
    invoke<NamingTemplate>("save_template", { id, name, pattern }),
  deleteTemplate: (id: number) => invoke<void>("delete_template", { id }),
  getRepoDefaults: (repoPlatform: Platform, repoId: string, templateId: number) =>
    invoke<RepoDefaults | null>("get_repo_defaults", { repoPlatform, repoId, templateId }),
  saveRepoDefaults: (defaults: RepoDefaults) => invoke<void>("save_repo_defaults", { defaults }),
  renderTemplatePreview: (pattern: string, values: Record<string, string>, sourceBranch: string) =>
    invoke<string>("render_template_preview", { pattern, values, sourceBranch }),
  preflightCreate: (repoPlatform: Platform, repoId: string) =>
    invoke<PreflightInfo>("preflight_create", { repoPlatform, repoId }),
  checkBranchTargets: (repoPlatform: Platform, repoId: string, targets: string[]) =>
    invoke<TargetCheck[]>("check_branch_targets", { repoPlatform, repoId, targets }),
  gitCreateBranches: (repoPlatform: Platform, repoId: string, items: CreateItem[]) =>
    invoke<CreateResult[]>("git_create_branches", { repoPlatform, repoId, items }),
  batchDeleteBranches: (repoPlatform: Platform, repoKey: string, branches: string[]) =>
    invoke<DeleteResult[]>("batch_delete_branches", { repoPlatform, repoKey, branches }),
  cancelBatchDelete: () => invoke<void>("cancel_batch_delete"),
  listBranches: (repoPlatform: Platform, repoKey: string) =>
    invoke<Branch[]>("list_branches", { repoPlatform, repoKey }),

  // ---- 缓存 ----
  repoCacheGet: (accountId: number, platform: Platform) =>
    invoke<CachedRepos | null>("repo_cache_get", { accountId, platform }),
  repoCachePut: (accountId: number, platform: Platform, repos: Repo[], updatedAt: string) =>
    invoke<void>("repo_cache_put", { accountId, platform, repos, updatedAt }),
  branchCacheGet: (accountId: number, platform: Platform, repoKey: string) =>
    invoke<CachedBranches | null>("branch_cache_get", { accountId, platform, repoKey }),
  branchCachePut: (
    accountId: number,
    platform: Platform,
    repoKey: string,
    branches: Branch[],
    updatedAt: string
  ) =>
    invoke<void>("branch_cache_put", {
      accountId,
      platform,
      repoKey,
      branches,
      updatedAt,
    }),

  // ---- 本地项目 ----
  addWorkspace: (rootPath: string) => invoke<Workspace>("add_workspace", { rootPath }),
  removeWorkspace: (id: number) => invoke<void>("remove_workspace", { id }),
  listWorkspaces: () => invoke<Workspace[]>("list_workspaces"),
  scanWorkspace: (workspaceId: number) =>
    invoke<LocalProject[]>("scan_workspace", { workspaceId }),
  listLocalProjects: (workspaceId?: number) =>
    invoke<LocalProject[]>("list_local_projects", { workspaceId: workspaceId ?? null }),
  linkLocalProject: (localId: number, repoPlatform: Platform, repoId: string, repoName: string) =>
    invoke<void>("link_local_project", { localId, repoPlatform, repoId, repoName }),
  unlinkLocalProject: (localId: number) => invoke<void>("unlink_local_project", { localId }),

  // ---- 代理设置 ----
  getProxySettings: () => invoke<ProxyConfig>("get_proxy_settings"),
  saveProxySettings: (config: ProxyConfig) =>
    invoke<void>("save_proxy_settings", { config }),
  resetProxySettings: () => invoke<ProxyConfig>("reset_proxy_settings"),
  getGeneralSettings: () => invoke<GeneralSettings>("get_general_settings"),
  saveGeneralSettings: (config: GeneralSettings) =>
    invoke<void>("save_general_settings", { config }),
  kvGet: (key: string) => invoke<string | null>("kv_get", { key }),
  kvSet: (key: string, value: string) => invoke<void>("kv_set", { key, value }),
  detectSystemProxy: () =>
    invoke<{ system: SystemProxy; note: string | null }>("detect_system_proxy"),
};
