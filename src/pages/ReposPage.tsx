import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { PLATFORM_LABELS, type Repo } from "../types";

export default function ReposPage({
  accountId,
  platform,
  onOpenRepo,
}: {
  accountId: number | null;
  platform: import("../types").Platform | null;
  onOpenRepo: (repo: Repo) => void;
}) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "personal" | "org">("all");
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const keyRef = useRef<string>("");
  const pathReadyRef = useRef(false);

  const fetchAll = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      let all: Repo[] = [];
      let page = 1;
      let more = true;
      while (more && page <= 50) {
        const res = await api.listRepos(page);
        all = all.concat(res.repos);
        more = res.has_more;
        setProgress(`已加载 ${page} 页…`);
        page += 1;
      }
      setRepos(all);
      const now = new Date().toLocaleString("zh-CN", { hour12: false });
      setCachedAt(now);
      if (accountId && platform) {
        await api.repoCachePut(accountId, platform, all, now);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, [accountId, platform]);

  // 进入页面：优先读缓存，缓存不存在时才自动拉取一次
  useEffect(() => {
    const key = `${accountId}/${platform}`;
    if (key === keyRef.current) return;
    keyRef.current = key;
    setRepos([]);
    setCachedAt(null);
    setPath([]);
    setError(null);
    if (!accountId || !platform) return;
    (async () => {
      try {
        const cached = await api.repoCacheGet(accountId, platform);
        if (cached) {
          setRepos(cached.repos);
          setCachedAt(cached.updated_at);
        } else {
          await fetchAll();
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [accountId, platform, fetchAll]);

  // 应用来源过滤
  const sourceFiltered = useMemo(() => {
    let list = repos;
    if (sourceFilter === "personal") list = list.filter((r) => !r.is_org);
    if (sourceFilter === "org") list = list.filter((r) => r.is_org);
    return list;
  }, [repos, sourceFilter]);

  // 仅当前层级：先限定路径前缀，再按当前层级名称过滤
  const levelFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const prefix = path.join("/");
    return sourceFiltered.filter((r) => {
      const segs = r.full_name.split("/");
      if (path.length > 0 && segs.slice(0, path.length).join("/") !== prefix) {
        return false;
      }
      if (!q) return true;
      const seg = segs[path.length];
      return seg ? seg.toLowerCase().includes(q) : false;
    });
  }, [sourceFiltered, search, path]);

  // 分层模式：当前路径下的分组与直属项目
  const { folders, direct } = useMemo(() => {
    const folderMap = new Map<string, number>();
    const directList: Repo[] = [];
    const prefix = path.join("/");
    for (const r of levelFiltered) {
      const segs = r.full_name.split("/");
      // 必须位于当前路径前缀之下，否则会串层显示
      if (path.length > 0 && segs.slice(0, path.length).join("/") !== prefix) {
        continue;
      }
      if (segs.length > path.length + 1) {
        const f = segs[path.length];
        folderMap.set(f, (folderMap.get(f) ?? 0) + 1);
      } else if (segs.length === path.length + 1) {
        directList.push(r);
      }
    }
    const folderList = [...folderMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
    return { folders: folderList, direct: directList };
  }, [levelFiltered, path]);

  // 恢复上次打开的层级
  useEffect(() => {
    pathReadyRef.current = false;
    if (!accountId || !platform) return;
    (async () => {
      try {
        const raw = await api.kvGet(`repos_path:${accountId}:${platform}`);
        if (raw) {
          const saved = JSON.parse(raw);
          if (Array.isArray(saved)) setPath(saved);
        }
      } catch {
        /* 忽略恢复失败 */
      }
      pathReadyRef.current = true;
    })();
  }, [accountId, platform]);

  // 保存当前层级
  useEffect(() => {
    if (!accountId || !platform || !pathReadyRef.current) return;
    api
      .kvSet(`repos_path:${accountId}:${platform}`, JSON.stringify(path))
      .catch(() => {});
  }, [path, accountId, platform]);

  // 层级失效校验：分组/项目不存在时回到根目录
  useEffect(() => {
    if (repos.length === 0 || path.length === 0) return;
    const ok = repos.some(
      (r) =>
        r.full_name.split("/").slice(0, path.length).join("/") === path.join("/")
    );
    if (!ok) setPath([]);
  }, [repos, path]);

  function fmtDate(s: string | null) {
    if (!s) return "-";
    return s.slice(0, 10);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          仓库列表
          {platform && (
            <span className="ml-3 text-sm font-normal text-slate-500">
              当前账号平台：{PLATFORM_LABELS[platform]}
            </span>
          )}
        </h1>
        <button
          className="flex items-center justify-center rounded-full bg-[#007AFF] p-2 text-white hover:bg-[#0071E3] disabled:opacity-50"
          onClick={fetchAll}
          disabled={loading || !accountId}
          title="从平台重新拉取全部仓库并更新缓存"
        >
          {loading ? (
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          )}
          {loading ? "拉取中…" : "拉取最新"}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <input
          className="w-72 rounded border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="搜索仓库（跨层级搜索全部仓库）…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
        >
          <option value="all">全部来源</option>
          <option value="personal">个人</option>
          <option value="org">组织 / 群组</option>
        </select>
        <span className="text-xs text-slate-500">
          {loading
            ? progress || "加载中…"
            : `当前层级：${folders.length} 个分组 · ${direct.length} 个项目`}
        </span>
        {cachedAt && !loading && (
          <span className="text-xs text-slate-400">（数据时间：{cachedAt}）</span>
        )}

      </div>

      {!accountId && (
        <div className="rounded bg-amber-50 border border-amber-200 text-amber-700 px-4 py-2 text-sm">
          请先在左下角选择当前账号，再查看仓库列表。
        </div>
      )}

      {error && (
        <div className="rounded bg-red-50 border border-[#FF3B30]/30 text-red-700 px-4 py-2 text-sm whitespace-pre-wrap">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {path.length > 0 && (
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 text-sm flex items-center gap-1 flex-wrap">
            <button
              className="text-blue-600 hover:underline"
              onClick={() => setPath([])}
            >
              全部仓库
            </button>
            {path.map((seg, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-slate-400">/</span>
                {i === path.length - 1 ? (
                  <span className="font-medium text-slate-700">{seg}</span>
                ) : (
                  <button
                    className="text-blue-600 hover:underline"
                    onClick={() => setPath(path.slice(0, i + 1))}
                  >
                    {seg}
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {loading && (
          <div className="p-8 text-center text-slate-500 text-sm">{progress || "加载中…"}</div>
        )}

        {/* 分层模式 */}
        {!loading && (
          <>
            {folders.length === 0 && direct.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-sm">
                当前层级没有匹配的分组或项目（首次使用请点右上角「拉取最新」）
              </div>
            )}
            {folders.map((f) => (
              <button
                key={`folder-${f.name}`}
                className="w-full flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 text-left"
                onClick={() => setPath([...path, f.name])}
              >
                <div className="flex items-center gap-2.5">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="font-medium">{f.name}</span>
                  <span className="rounded bg-slate-100 text-slate-600 text-xs px-1.5 py-0.5">
                    {f.count} 个项目
                  </span>
                </div>
                <span className="text-slate-400">›</span>
              </button>
            ))}
            {direct.map((repo) => (
              <div
                key={repo.id}
                className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium" title={repo.full_name}>
                      {repo.name}
                    </span>
                    {repo.visibility === "private" && (
                      <span className="rounded bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5">私有</span>
                    )}
                    <span
                      className={`rounded text-xs px-1.5 py-0.5 ${
                        repo.is_org
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {repo.source_label}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    默认分支：{repo.default_branch ?? "-"} · 更新：{fmtDate(repo.updated_at)}
                  </div>
                </div>
                <button
                  className="group flex items-center justify-center rounded-full bg-[#007AFF]/10 p-2 text-[#007AFF] transition-colors hover:bg-[#007AFF] hover:text-white"
                  title="管理分支"
                  onClick={() => onOpenRepo(repo)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
