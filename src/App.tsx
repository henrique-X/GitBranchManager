import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { PLATFORM_LABELS, Account, Platform, Repo } from "./types";
import AccountsPage from "./pages/AccountsPage";
import ReposPage from "./pages/ReposPage";
import BranchesPage from "./pages/BranchesPage";
import LocalProjectsPage from "./pages/LocalProjectsPage";
import SettingsPage from "./pages/SettingsPage";
import GeneralPage from "./pages/GeneralPage";
import TemplatesPage from "./pages/TemplatesPage";

type PageKey = "repos" | "local" | "branches" | "settings";
type SettingsSection = "general" | "accounts" | "templates" | "proxy" | "about";

const NAV_ITEMS: { key: PageKey; label: string }[] = [
  { key: "repos", label: "仓库列表" },
  { key: "local", label: "本地项目" },
  { key: "branches", label: "分支管理" },
  { key: "settings", label: "设置" },
];

const SETTINGS_SECTIONS: { key: SettingsSection; label: string }[] = [
  { key: "general", label: "通用" },
  { key: "accounts", label: "账号管理" },
  { key: "templates", label: "模板管理" },
  { key: "proxy", label: "网络" },
  { key: "about", label: "关于" },
];

export default function App() {
  const [page, setPage] = useState<PageKey>("repos");
  const [settingsMode, setSettingsMode] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("proxy");
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [active, setActive] = useState<Account | null>(null);
  const [gitVersion, setGitVersion] = useState<string>("");
  const [envError, setEnvError] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // 自动更新
  const [appVersion, setAppVersion] = useState("");
  const [updateState, setUpdateState] = useState<{
    status: "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "error";
    progress: number;
    error: string | null;
    version?: string;
  }>({ status: "idle", progress: 0, error: null });
  const updateRef = useRef<Update | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, act] = await Promise.all([
        api.listAccounts(),
        api.getActiveAccount(),
      ]);
      setAccounts(list);
      setActive(act);
    } catch (e) {
      setEnvError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    api
      .gitCheck()
      .then((v) => setGitVersion(v))
      .catch((e) => setEnvError(`本地 Git 不可用：${String(e)}`));
  }, [refresh]);

  const activeId = active?.id ?? null;

  const checkForUpdate = useCallback(async () => {
    setUpdateState((s) => ({ ...s, status: "checking", error: null }));
    try {
      const u = await check();
      if (u) {
        updateRef.current = u;
        setUpdateState((s) => ({ ...s, status: "available", version: u.version }));
      } else {
        setUpdateState((s) => ({ ...s, status: "latest" }));
      }
    } catch (e) {
      setUpdateState((s) => ({ ...s, status: "error", error: String(e) }));
    }
  }, []);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
    const t = setTimeout(() => {
      checkForUpdate();
    }, 3000);
    return () => clearTimeout(t);
  }, [checkForUpdate]);

  async function downloadAndInstall() {
    const u = updateRef.current;
    if (!u) return;
    setUpdateState((s) => ({ ...s, status: "downloading", progress: 0 }));
    try {
      let total = 0;
      let received = 0;
      await u.downloadAndInstall((event: import("@tauri-apps/plugin-updater").DownloadEvent) => {
        if (event.event === "Started") {
          total = (event.data as { contentLength?: number }).contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += (event.data as { chunkLength?: number }).chunkLength ?? 0;
          if (total > 0) {
            const pct = Math.min(99, Math.round((received / total) * 100));
            setUpdateState((s) => ({ ...s, progress: pct }));
          }
        } else if (event.event === "Finished") {
          setUpdateState((s) => ({ ...s, progress: 100 }));
        }
      });
      setUpdateState((s) => ({ ...s, status: "ready" }));
    } catch (e) {
      setUpdateState((s) => ({ ...s, status: "error", error: String(e) }));
    }
  }

  // 启动/进入时恢复上次打开的项目
  useEffect(() => {
    if (!active || selectedRepo) return;
    (async () => {
      try {
        const raw = await api.kvGet("last_repo");
        if (!raw) return;
        const saved = JSON.parse(raw) as Repo;
        if (saved && saved.platform === active.platform && saved.id) {
          setSelectedRepo(saved);
        }
      } catch {
        /* 忽略恢复失败 */
      }
    })();
  }, [active, selectedRepo]);

  // 切换账号后，平台不一致的已选仓库自动清空
  useEffect(() => {
    if (selectedRepo && active && selectedRepo.platform !== active.platform) {
      setSelectedRepo(null);
    }
  }, [active, selectedRepo]);

  function handleNav(key: PageKey) {
    if (key === "settings") {
      setSettingsMode(true);
      setSettingsSection((s) => s); // 保留上次所在设置页
    } else {
      setSettingsMode(false);
      setPage(key);
    }
  }

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 bg-[#F2F2F7] text-slate-800 flex flex-col border-r border-slate-200/80">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="font-semibold text-slate-900">Git Branch Manager</div>
          <div className="text-xs text-slate-500 mt-0.5">Git 分支管理工具</div>
        </div>

        {settingsMode ? (
          <>
            <div className="px-3 pt-3">
              <button
                className="w-full flex items-center gap-2 rounded px-2 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
                onClick={() => setSettingsMode(false)}
              >
                ← 返回
              </button>
            </div>
            <div className="px-5 pt-3 pb-1 text-xs font-medium text-slate-500">设置</div>
            <nav className="pb-3">
              {SETTINGS_SECTIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSettingsSection(s.key)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-200/70 transition-colors ${
                    settingsSection === s.key ? "bg-[#007AFF] text-white font-medium" : ""
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </nav>
          </>
        ) : (
          <nav className="flex-1 py-3 px-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                onClick={() => handleNav(item.key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-200/70 transition-colors ${
                  !settingsMode && page === item.key ? "bg-[#007AFF] text-white font-medium" : ""
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        )}

        <div className="flex-1" />

        <div className="relative px-5 py-4 border-t border-slate-200/80 text-xs space-y-1">
          {switcherOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-2 rounded-lg bg-white text-slate-800 shadow-xl border border-slate-200 py-1 z-50">
              {accounts.length === 0 && (
                <div className="px-3 py-2 text-slate-500">
                  还没有账号，请先在「设置 → 账号管理」添加
                </div>
              )}
              {accounts.map((a) => (
                <button
                  key={a.id}
                  className={`relative w-full text-left px-3 py-2 hover:bg-slate-100 ${
                    a.id === activeId ? "bg-blue-50 text-blue-700" : ""
                  }`}
                  onClick={async () => {
                    try {
                      await api.setActiveAccount(a.id);
                      await refresh();
                    } catch (e) {
                      setEnvError(String(e));
                    }
                    setSwitcherOpen(false);
                  }}
                >
                  <span className="block text-sm font-medium text-slate-800">{a.label}</span>
                  <span className="block text-xs text-slate-500">
                    {PLATFORM_LABELS[a.platform]}
                    {a.api_username ? ` · ${a.api_username}` : ""}
                  </span>
                  {a.id === activeId && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-600">✓</span>
                  )}
                </button>
              ))}
            </div>
          )}
          <button
            className="w-full text-left rounded hover:bg-slate-200/70 px-2 py-1.5 transition-colors rounded-lg"
            onClick={() => setSwitcherOpen(!switcherOpen)}
            title="点击切换账号"
          >
            {active ? (
              <>
                <div className="text-slate-400">当前账号 ▾</div>
                <div className="text-sm font-medium text-slate-800">{active.label}</div>
                <div className="text-[11px] text-slate-500">
                  {PLATFORM_LABELS[active.platform]}
                  {active.api_username ? ` · ${active.api_username}` : ""}
                </div>
              </>
            ) : (
              <div className="text-slate-500">未选择账号，点击选择 ▾</div>
            )}
          </button>
          {gitVersion && <div className="text-slate-500">{gitVersion}</div>}
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {envError && (
          <div className="mx-6 mt-6 rounded bg-red-50 border border-[#FF3B30]/30 text-red-700 px-4 py-2 text-sm">
            {envError}
          </div>
        )}

        {settingsMode ? (
          <>
            {settingsSection === "general" && <GeneralPage />}
            {settingsSection === "proxy" && <SettingsPage />}
            {settingsSection === "accounts" && (
              <AccountsPage
                accounts={accounts}
                activeId={activeId}
                onChanged={refresh}
              />
            )}
            {settingsSection === "templates" && <TemplatesPage />}
            {settingsSection === "about" && (
              <div className="p-6 space-y-6 max-w-2xl">
                <h1 className="text-2xl font-bold">关于</h1>
                <section className="bg-white rounded-2xl shadow-sm p-5 space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-slate-800">
                      软件更新
                      {appVersion && (
                        <span className="ml-2 text-xs text-slate-400">当前版本 v{appVersion}</span>
                      )}
                    </div>
                    <button
                      className="rounded-xl bg-[#007AFF] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0071E3] disabled:opacity-50"
                      onClick={checkForUpdate}
                      disabled={updateState.status === "checking" || updateState.status === "downloading"}
                    >
                      {updateState.status === "checking" ? "检查中…" : "检查更新"}
                    </button>
                  </div>
                  {updateState.status === "latest" && (
                    <p className="text-[#34C759]">✓ 当前已是最新版本</p>
                  )}
                  {updateState.status === "available" && (
                    <p className="text-[#FF9500]">
                      发现新版本 {updateState.version}，可下载安装（安装后自动重启）。
                    </p>
                  )}
                  {updateState.status === "downloading" && (
                    <div className="space-y-1">
                      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div className="h-full bg-[#007AFF] transition-all" style={{ width: `${updateState.progress}%` }} />
                      </div>
                      <p className="text-xs text-slate-500">下载中 {updateState.progress}%</p>
                    </div>
                  )}
                  {updateState.status === "ready" && (
                    <div className="flex items-center justify-between">
                      <p className="text-[#34C759]">✓ 更新已安装，重启后生效</p>
                      <button
                        className="rounded-xl bg-[#34C759] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#2FA84F]"
                        onClick={() => relaunch()}
                      >
                        重启应用
                      </button>
                    </div>
                  )}
                  {updateState.status === "error" && updateState.error && (
                    <p className="text-xs text-red-500 whitespace-pre-wrap">
                      检查/更新失败（未配置发布源或网络异常时会失败）：{updateState.error}
                    </p>
                  )}
                </section>
                <section className="bg-white rounded-2xl shadow-sm p-5 space-y-2 text-sm text-slate-600">
                  <h2 className="font-semibold text-lg text-slate-800">
                    Git Branch Manager
                  </h2>
                  <p>Git 分支管理工具 · Windows 桌面端</p>
                  <p className="text-xs text-slate-400">版本 0.1.0（开发中）</p>
                </section>
                <section className="bg-white rounded-2xl shadow-sm p-5 space-y-2 text-sm">
                  <h2 className="font-semibold text-lg text-slate-800">功能进度</h2>
                  <ul className="list-disc list-inside space-y-1 text-slate-600">
                    <li>✅ 账号管理（GitHub / Gitee / 自建 GitLab，PAT 加密）</li>
                    <li>✅ 仓库列表（层级分组 · 缓存 · 组织仓库）</li>
                    <li>✅ 分支管理（缓存 · 排序 · 批量删除）</li>
                    <li>✅ 本地项目（工作区多级扫描 · 远程匹配）</li>
                    <li>✅ 网络代理（系统 / 手动 / SOCKS）</li>
                    <li>✅ 批量创建分支（命名模板 · 本地创建不 push）</li>
                    <li>⏳ 自动更新 + 打包（M5/M6 开发中）</li>
                  </ul>
                </section>
                <section className="bg-white rounded-2xl shadow-sm p-5 space-y-2 text-sm">
                  <h2 className="font-semibold text-lg text-slate-800">技术栈</h2>
                  <p className="text-slate-600">
                    Tauri 2 · Rust · React 18 · TypeScript · Vite · Tailwind CSS
                  </p>
                  <p className="text-xs text-slate-400">
                    文档：docs/开发文档.md · docs/开发计划.md
                  </p>
                </section>
              </div>
            )}
          </>
        ) : (
          <>
            {page === "repos" && (
              <ReposPage
                accountId={activeId}
                platform={active?.platform ?? null}
                onOpenRepo={(repo) => {
                  setSelectedRepo(repo);
                  api.kvSet("last_repo", JSON.stringify(repo)).catch(() => {});
                  setPage("branches");
                }}
              />
            )}
            {page === "local" && <LocalProjectsPage active={active} />}
            {page === "branches" &&
              (selectedRepo ? (
                <BranchesPage
                  repo={selectedRepo}
                  accountId={activeId}
                  onSwitchRepo={(r) => {
                    setSelectedRepo(r);
                    api.kvSet("last_repo", JSON.stringify(r)).catch(() => {});
                  }}
                />
              ) : (
                <div className="p-6 space-y-4">
                  <h1 className="text-2xl font-bold">分支管理</h1>
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center space-y-3">
                    <p className="text-slate-600">
                      请先选择一个仓库，再管理其分支。
                    </p>
                    {!active && (
                      <p className="text-xs text-amber-600">
                        提示：当前未选择账号，请先在左下角选择账号。
                      </p>
                    )}
                    <button
                      className="rounded-xl bg-[#007AFF] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0071E3] disabled:opacity-50"
                      onClick={() => setPage("repos")}
                      disabled={!active}
                      title={!active ? "请先选择账号" : "前往仓库列表"}
                    >
                      前往仓库列表选择仓库 →
                    </button>
                  </div>
                </div>
              ))}
          </>
        )}
      </main>
    </div>
  );
}
