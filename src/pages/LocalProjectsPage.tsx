import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { normalizeGitUrl, type LocalProject, type Repo, type Workspace } from "../types";

export default function LocalProjectsPage({
  active,
}: {
  active: import("../types").Account | null;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState("");
  const [scanningId, setScanningId] = useState<number | null>(null);
  const [matching, setMatching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [ws, lp] = await Promise.all([api.listWorkspaces(), api.listLocalProjects()]);
      setWorkspaces(ws);
      setProjects(lp);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleAdd() {
    setError(null);
    setMessage(null);
    let dir = manualPath.trim();
    if (!dir) {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") dir = picked;
    }
    if (!dir) return;
    try {
      await api.addWorkspace(dir);
      setManualPath("");
      setMessage(`工作区已添加：${dir}`);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRemove(ws: Workspace) {
    if (!window.confirm(`移除工作区「${ws.root_path}」？\n（只移除记录，不影响磁盘文件）`)) return;
    setError(null);
    setMessage(null);
    try {
      await api.removeWorkspace(ws.id);
      setMessage("工作区已移除");
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleScan(ws: Workspace) {
    setError(null);
    setMessage(null);
    setScanningId(ws.id);
    try {
      const found = await api.scanWorkspace(ws.id);
      setMessage(`扫描完成：发现 ${found.length} 个 Git 项目`);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setScanningId(null);
    }
  }

  async function handleAutoMatch() {
    setError(null);
    setMessage(null);
    setMatching(true);
    try {
      // 优先使用仓库缓存，无缓存再拉取
      let all: Repo[] = [];
      if (active) {
        try {
          const cached = await api.repoCacheGet(active.id, active.platform);
          if (cached) all = cached.repos;
        } catch {
          /* 缓存读取失败则继续在线拉取 */
        }
      }
      if (all.length === 0) {
        let page = 1;
        for (;;) {
          const res = await api.listRepos(page);
          all = all.concat(res.repos);
          if (!res.has_more) break;
          page += 1;
          if (page > 50) break;
        }
      }
      const repoMap = new Map<string, Repo>();
      for (const r of all) {
        if (r.web_url) repoMap.set(normalizeGitUrl(r.web_url), r);
      }
      let matched = 0;
      for (const p of projects) {
        if (!p.remote_url) continue;
        const hit = repoMap.get(normalizeGitUrl(p.remote_url));
        if (hit) {
          await api.linkLocalProject(p.id, hit.platform, hit.id, hit.full_name);
          matched += 1;
        }
      }
      setMessage(`自动匹配完成：${matched} / ${projects.length} 个本地项目已关联远程仓库`);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setMatching(false);
    }
  }

  async function handleUnlink(p: LocalProject) {
    setError(null);
    setMessage(null);
    try {
      await api.unlinkLocalProject(p.id);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">本地项目管理</h1>

      <section className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
        <h2 className="font-semibold text-lg">工作区</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
            placeholder="输入工作区根目录（如 D:\work\fe），或点右侧选择文件夹"
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
          />
          <button
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            onClick={async () => {
              const picked = await open({ directory: true, multiple: false });
              if (typeof picked === "string") setManualPath(picked);
            }}
          >
            选择文件夹
          </button>
          <button
            className="rounded-xl bg-[#007AFF] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0071E3]"
            onClick={handleAdd}
          >
            添加工作区
          </button>
        </div>
        {workspaces.length === 0 && (
          <p className="text-sm text-slate-500">
            还没有工作区。添加一个父目录（如存放多个前端项目的 fe 文件夹），即可自动识别其中的 Git 项目。
          </p>
        )}
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className="flex items-center justify-between rounded border border-slate-200 px-4 py-2.5 text-sm"
          >
            <div>
              <div className="font-medium">{ws.root_path}</div>
              <div className="text-xs text-slate-500">
                扫描深度 {ws.scan_depth} 层 · 数据时间：
                {ws.last_scan_at ? ws.last_scan_at.replace("T", " ").slice(0, 16) : "未扫描"}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-50"
                onClick={() => handleScan(ws)}
                disabled={scanningId != null}
              >
                {scanningId === ws.id ? "扫描中…" : "扫描项目"}
              </button>
              <button
                className="rounded border border-[#FF3B30]/30 text-[#FF3B30] px-3 py-1 hover:bg-red-50"
                onClick={() => handleRemove(ws)}
              >
                移除
              </button>
            </div>
          </div>
        ))}
      </section>

      {error && (
        <div className="rounded bg-red-50 border border-[#FF3B30]/30 text-red-700 px-4 py-2 text-sm whitespace-pre-wrap">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded bg-green-50 border border-[#34C759]/30 text-[#34C759] px-4 py-2 text-sm">
          {message}
        </div>
      )}

      <section className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">
            本地项目（{projects.length}）
          </h2>
          <button
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            onClick={handleAutoMatch}
            disabled={matching || projects.length === 0}
          >
            {matching ? "匹配中…" : "按远程地址自动匹配"}
          </button>
        </div>
        {projects.length === 0 ? (
          <p className="text-sm text-slate-500">
            没有扫描结果。添加工作区后点「扫描项目」。
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-slate-500">
                  <th className="px-3 py-2">项目名</th>
                  <th className="px-3 py-2">本地路径</th>
                  <th className="px-3 py-2">远程地址</th>
                  <th className="px-3 py-2">匹配状态</th>
                  <th className="px-3 py-2 w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{p.local_path}</td>
                    <td className="px-3 py-2 text-slate-600 text-xs max-w-[280px] truncate" title={p.remote_url ?? ""}>
                      {p.remote_url ?? "-"}
                    </td>
                    <td className="px-3 py-2">
                      {p.repo_id ? (
                        <span className="rounded bg-green-100 text-[#34C759] text-xs px-1.5 py-0.5">
                          已关联 · {p.repo_name ?? p.repo_id}
                        </span>
                      ) : (
                        <span className="rounded bg-slate-100 text-slate-600 text-xs px-1.5 py-0.5">
                          未关联
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {p.repo_id && (
                        <button
                          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                          onClick={() => handleUnlink(p)}
                        >
                          取消关联
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-400">
          匹配规则：本地仓库的 origin 远程地址与平台仓库地址归一化后一致即自动关联。创建分支前，仓库必须先关联本地路径（M4 使用）。
        </p>
      </section>
    </div>
  );
}
