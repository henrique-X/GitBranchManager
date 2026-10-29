import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import {
  Branch,
  CreateResult,
  NamingTemplate,
  PreflightInfo,
  Repo,
  TargetCheck,
} from "../types";

type WizardStage = "config" | "preview" | "creating" | "results";

export default function BranchesPage({
  repo,
  accountId,
  onSwitchRepo,
}: {
  repo: Repo;
  accountId: number | null;
  onSwitchRepo: (repo: Repo) => void;
}) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dateSort, setDateSort] = useState<"none" | "desc" | "asc">("none");
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  // 项目切换下拉框
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [allRepos, setAllRepos] = useState<Repo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);

  // 批量删除状态
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteResults, setDeleteResults] = useState<
    import("../types").DeleteResult[] | null
  >(null);

  // 批量创建向导状态
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStage, setWizardStage] = useState<WizardStage>("config");
  const [templates, setTemplates] = useState<NamingTemplate[]>([]);
  const [selTemplateId, setSelTemplateId] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [preflight, setPreflight] = useState<PreflightInfo | null>(null);
  const [tplForm, setTplForm] = useState<{ open: boolean; id: number | null; name: string; pattern: string }>({
    open: false,
    id: null,
    name: "",
    pattern: "",
  });
  const [targetChecks, setTargetChecks] = useState<TargetCheck[]>([]);
  const [createResults, setCreateResults] = useState<CreateResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [wizardRows, setWizardRows] = useState<
    { source: string; target: string; check: TargetCheck; remoteExists: boolean }[]
  >([]);

  async function openSwitcher() {
    setSwitcherOpen((o) => !o);
    if (allRepos || loadingRepos) return;
    setLoadingRepos(true);
    try {
      let list: Repo[] | null = null;
      if (accountId) {
        const cached = await api.repoCacheGet(accountId, repo.platform);
        if (cached) list = cached.repos;
      }
      if (!list) {
        list = [];
        let p = 1;
        let more = true;
        while (more && p <= 50) {
          const res = await api.listRepos(p);
          list = list.concat(res.repos);
          more = res.has_more;
          p += 1;
        }
      }
      setAllRepos(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingRepos(false);
    }
  }

  const switcherFiltered = useMemo(() => {
    if (!allRepos) return [];
    const q = repoSearch.trim().toLowerCase();
    const list = q
      ? allRepos.filter((r) => r.full_name.toLowerCase().includes(q))
      : allRepos;
    return [...list].sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [allRepos, repoSearch]);

  const fetchAll = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await api.listBranches(repo.platform, repo.id);
      setBranches(list);
      setSelected(new Set());
      const now = new Date().toLocaleString("zh-CN", { hour12: false });
      setCachedAt(now);
      if (accountId) {
        await api.branchCachePut(accountId, repo.platform, repo.id, list, now);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [repo, accountId]);

  useEffect(() => {
    setBranches([]);
    setSelected(new Set());
    setCachedAt(null);
    setError(null);
    if (!accountId) return;
    (async () => {
      try {
        const cached = await api.branchCacheGet(accountId, repo.platform, repo.id);
        if (cached) {
          setBranches(cached.branches);
          setCachedAt(cached.updated_at);
          setLoading(false);
        } else {
          await fetchAll();
        }
      } catch (e) {
        setError(String(e));
        setLoading(false);
      }
    })();
  }, [repo, accountId, fetchAll]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, search]);

  const sorted = useMemo(() => {
    if (dateSort === "none") return filtered;
    const list = [...filtered];
    const ts = (b: Branch): number => {
      const t = b.date ? Date.parse(b.date) : NaN;
      return Number.isNaN(t) ? -1 : t;
    };
    list.sort((a, b) => {
      const ta = ts(a);
      const tb = ts(b);
      if (ta === -1 && tb === -1) return 0;
      if (ta === -1) return 1;
      if (tb === -1) return -1;
      return dateSort === "desc" ? tb - ta : ta - tb;
    });
    return list;
  }, [filtered, dateSort]);

  function cycleDateSort() {
    setDateSort((prev) => (prev === "none" ? "desc" : prev === "desc" ? "asc" : "none"));
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size > 0 && selected.size === sorted.length) setSelected(new Set());
    else setSelected(new Set(sorted.map((b) => b.name)));
  }

  async function handleConfirmDelete() {
    setConfirmOpen(false);
    setDeleting(true);
    setDeleteResults(null);
    try {
      const res = await api.batchDeleteBranches(repo.platform, repo.id, [...selected]);
      setDeleteResults(res);
      fetchAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  /* ---------- 创建向导 ---------- */
  const template = templates.find((t) => t.id === selTemplateId) ?? null;
  const inputVars = template?.variables.filter((v) => v !== "sourceBranch") ?? [];
  const branchNames = useMemo(() => new Set(branches.map((b) => b.name)), [branches]);

  function renderTarget(source: string): string {
    if (!template) return "";
    let s = template.pattern;
    for (const [k, v] of Object.entries(values)) {
      s = s.split(`{${k}}`).join(v.trim());
    }
    return s.split("{sourceBranch}").join(source);
  }

  const valuesFilled =
    template !== null && inputVars.every((v) => (values[v] ?? "").trim() !== "");

  async function openWizard() {
    setError(null);
    setWizardOpen(true);
    setWizardStage("config");
    setTargetChecks([]);
    setCreateResults(null);
    try {
      const tpls = await api.listTemplates();
      setTemplates(tpls);
      setSelTemplateId(tpls[0]?.id ?? null);
    } catch (e) {
      setError(String(e));
    }
    try {
      setPreflight(await api.preflightCreate(repo.platform, repo.id));
    } catch (e) {
      setPreflight(null);
      setError(String(e));
    }
  }

  // 切换模板时载入该仓库默认值
  useEffect(() => {
    if (!selTemplateId) return;
    (async () => {
      try {
        const d = await api.getRepoDefaults(repo.platform, repo.id, selTemplateId);
        setValues(d?.values ?? {});
      } catch {
        setValues({});
      }
    })();
  }, [selTemplateId, repo]);

  async function handleSaveDefaults() {
    if (!selTemplateId) return;
    try {
      await api.saveRepoDefaults({
        repo_platform: repo.platform,
        repo_id: repo.id,
        template_id: selTemplateId,
        values,
      });
      setMessage("已保存为当前仓库的默认值");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSaveTemplate() {
    setError(null);
    try {
      const saved = await api.saveTemplate(tplForm.id, tplForm.name, tplForm.pattern);
      const tpls = await api.listTemplates();
      setTemplates(tpls);
      setSelTemplateId(saved.id);
      setTplForm({ open: false, id: null, name: "", pattern: "" });
      setMessage("模板已保存");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDeleteTemplate() {
    if (!selTemplateId) return;
    if (!window.confirm("确定删除当前模板？其仓库默认值也会一并删除。")) return;
    try {
      await api.deleteTemplate(selTemplateId);
      const tpls = await api.listTemplates();
      setTemplates(tpls);
      setSelTemplateId(tpls[0]?.id ?? null);
      setMessage("模板已删除");
    } catch (e) {
      setError(String(e));
    }
  }

  const previewRows = useMemo(() => {
    if (!template || !valuesFilled) return [];
    return [...selected].map((source) => ({
      source,
      target: renderTarget(source),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, values, selected]);

  const dupTargets = useMemo(() => {
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const r of previewRows) {
      if (seen.has(r.target)) dups.add(r.target);
      seen.add(r.target);
    }
    return dups;
  }, [previewRows]);

  const blockedRows = wizardRows.filter(
    (r) => !r.check.valid || r.check.local_exists || dupTargets.has(r.target)
  );
  const warnRows = wizardRows.filter((r) => r.remoteExists && !blockedRows.includes(r));

  async function generatePreview() {
    setError(null);
    setMessage(null);
    try {
      const checks = await api.checkBranchTargets(
        repo.platform,
        repo.id,
        previewRows.map((r) => r.target)
      );
      const map = new Map(checks.map((c) => [c.target, c]));
      const ordered = [...selected]
        .map((s) => {
          const target = renderTarget(s);
          return {
            source: s,
            target,
            check:
              map.get(target) ??
              ({ target, valid: true, local_exists: false, message: null } as TargetCheck),
            remoteExists: branchNames.has(target),
          };
        })
        .sort(
          (a, b) =>
            sorted.findIndex((x) => x.name === a.source) -
            sorted.findIndex((x) => x.name === b.source)
        );
      setTargetChecks(checks);
      setWizardRows(ordered);
      setWizardStage("preview");
    } catch (e) {
      setError(String(e));
    }
  }

  async function executeCreate() {
    setWizardStage("creating");
    setError(null);
    try {
      const res = await api.gitCreateBranches(
        repo.platform,
        repo.id,
        wizardRows.map((r) => ({ source: r.source, target: r.target }))
      );
      setCreateResults(res);
      setWizardStage("results");
      fetchAll();
    } catch (e) {
      setError(String(e));
      setWizardStage("preview");
    }
  }

  function closeWizard() {
    setWizardOpen(false);
    setWizardStage("config");
    setCreateResults(null);
    setTargetChecks([]);
  }

  /* ---------- 列宽拖拽 ---------- */
  const wrapRef = useRef<HTMLDivElement>(null);
  const [colW, setColW] = useState<number[]>([200, 340, 100, 140, 120]);
  const colWRef = useRef(colW);
  colWRef.current = colW;
  const resizing = useRef<{ i: number; startX: number; startW: number } | null>(null);
  const [wrapW, setWrapW] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWrapW(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWrapW(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const mm = (e: MouseEvent) => {
      const rz = resizing.current;
      if (!rz) return;
      const dx = e.clientX - rz.startX;
      setColW((w) => {
        const nw = [...w];
        nw[rz.i] = Math.max(56, rz.startW + dx);
        return nw;
      });
    };
    const mu = () => {
      resizing.current = null;
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
    return () => {
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
    };
  }, []);

  function startResize(i: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { i, startX: e.clientX, startW: colWRef.current[i] };
  }

  const tableW = Math.max(wrapW, 40 + colW.reduce((a, b) => a + b, 0));

  function fmtDate(s: string | null) {
    if (!s) return "-";
    return s.replace("T", " ").slice(0, 16);
  }

  function protectionBadge(b: Branch) {
    if (b.protected === true)
      return <span className="rounded bg-red-100 text-red-700 text-xs px-1.5 py-0.5">🔒 保护</span>;
    if (b.protected === false)
      return <span className="rounded bg-green-100 text-[#34C759] text-xs px-1.5 py-0.5">可删</span>;
    return <span className="rounded bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5">⚠️ 未知（按保护处理）</span>;
  }

  const okCount = deleteResults?.filter((r) => r.success).length ?? 0;
  const failCount = deleteResults?.filter((r) => !r.success).length ?? 0;
  const createOk = createResults?.filter((r) => r.success).length ?? 0;
  const createFail = createResults?.filter((r) => !r.success).length ?? 0;

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div className="relative">
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[15px] font-bold hover:border-[#007AFF]"
            onClick={openSwitcher}
            title="点击切换项目（支持搜索全部项目）"
          >
            <span>{repo.full_name}</span>
            <span className="text-sm text-slate-400">▾</span>
          </button>
          {switcherOpen && (
            <div className="absolute left-0 top-full mt-1 w-[420px] rounded-lg bg-white shadow-xl border border-slate-200 z-50">
              <div className="p-2 border-b border-slate-100">
                <input
                  autoFocus
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  placeholder="搜索全部项目（跨层级）…"
                  value={repoSearch}
                  onChange={(e) => setRepoSearch(e.target.value)}
                />
              </div>
              <div className="max-h-72 overflow-auto py-1">
                {loadingRepos && (
                  <div className="px-3 py-2 text-sm text-slate-500">加载项目列表中…</div>
                )}
                {!loadingRepos && switcherFiltered.length === 0 && (
                  <div className="px-3 py-2 text-sm text-slate-500">没有匹配的项目</div>
                )}
                {switcherFiltered.map((r) => (
                  <button
                    key={r.id}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 ${
                      r.id === repo.id ? "bg-blue-50 text-blue-700" : ""
                    }`}
                    onClick={() => {
                      setSwitcherOpen(false);
                      setRepoSearch("");
                      if (r.id !== repo.id) onSwitchRepo(r);
                    }}
                  >
                    {r.full_name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {selected.size > 0 && !deleting && !wizardOpen && (
            <>
              <button
                className="rounded-xl bg-[#34C759] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#2FA84F]"
                onClick={openWizard}
              >
                ✚ 基于所选创建分支（{selected.size}）
              </button>
              <button
                className="rounded-xl bg-[#FF3B30] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#E0352B]"
                onClick={() => setConfirmOpen(true)}
              >
                🗑 删除所选（{selected.size}）
              </button>
            </>
          )}
          <button
            className="flex items-center justify-center rounded-full bg-[#007AFF] p-2 text-white hover:bg-[#0071E3] disabled:opacity-50"
            onClick={fetchAll}
            disabled={loading || !accountId || deleting}
            title="从平台重新拉取分支并更新缓存"
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
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          className="w-72 rounded border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="搜索分支名…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-xs text-slate-500">
          {loading ? "加载中…" : `共 ${sorted.length} 个分支 · 已选 ${selected.size} 个（可作源分支 / 待删分支）`}
        </span>
        {cachedAt && !loading && (
          <span className="text-xs text-slate-400">
            （数据时间：{cachedAt}）
          </span>
        )}
      </div>

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

      <div className="bg-white rounded-2xl shadow-sm overflow-auto flex-1 min-h-0" ref={wrapRef}>
        <table className="text-sm table-fixed" style={{ width: tableW }}>
          <thead className="bg-slate-50 sticky top-0">
            <tr className="text-left text-slate-500">
              <th className="px-3 py-2" style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === sorted.length}
                  onChange={toggleAll}
                />
              </th>
              {["分支名", "最新提交", "作者"].map((label, i) => (
                <th key={label} className="relative px-3 py-2" style={{ width: colW[i] }}>
                  {label}
                  <div
                    onMouseDown={(e) => startResize(i, e)}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-[#007AFF]/30"
                  />
                </th>
              ))}
              <th
                className="relative px-3 py-2 cursor-pointer select-none hover:text-slate-800"
                style={{ width: colW[3] }}
                onClick={cycleDateSort}
                title="点击切换：默认排序 → 最新在上 → 最旧在上"
              >
                时间
                {dateSort === "desc" && <span className="ml-1">↓</span>}
                {dateSort === "asc" && <span className="ml-1">↑</span>}
                <div
                  onMouseDown={(e) => startResize(3, e)}
                  className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-[#007AFF]/30"
                />
              </th>
              <th className="relative px-3 py-2" style={{ width: colW[4] }}>
                保护状态
                <div
                  onMouseDown={(e) => startResize(4, e)}
                  className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-[#007AFF]/30"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((b) => (
              <tr key={b.name} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(b.name)}
                    onChange={() => toggle(b.name)}
                    title="可作为创建分支的源分支；删除时保护分支会被自动拦截"
                  />
                </td>
                <td className="px-3 py-2 font-medium truncate" title={b.name}>
                  <span className="inline-block max-w-full truncate align-bottom" title={b.name}>
                  {b.name}
                  </span>
                  {b.name === repo.default_branch && (
                    <span className="ml-2 rounded bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5">默认</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-600 truncate" title={(b.sha ? b.sha.slice(0, 7) + " " : "") + (b.message ?? "")}>
                  {b.sha ? <code className="text-xs">{b.sha.slice(0, 7)}</code> : "-"}
                  {b.message ? ` ${b.message}` : ""}
                </td>
                <td className="px-3 py-2 text-slate-600">{b.author ?? "-"}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(b.date)}</td>
                <td className="px-3 py-2">{protectionBadge(b)}</td>
              </tr>
            ))}
            {!loading && sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  没有匹配的分支
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 批量删除确认 / 进度 / 结果 */}
      {(confirmOpen || deleting || deleteResults) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-sm-xl p-6 w-[520px] space-y-4">
            {confirmOpen && (
              <>
                <h3 className="font-semibold text-lg text-[#FF3B30]">确认删除分支</h3>
                <p className="text-sm text-slate-600">
                  即将从 <b>{repo.full_name}</b> 删除以下 <b>{selected.size}</b> 个远程分支。
                  <span className="text-red-500">此操作不可恢复！</span>
                  （保护分支 / 状态未知会在执行时被自动拦截）
                </p>
                <div className="max-h-56 overflow-auto rounded border border-slate-200 divide-y divide-slate-100">
                  {[...selected].map((n) => (
                    <div key={n} className="px-3 py-1.5 text-sm font-mono">
                      {n}
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded border border-slate-300 px-4 py-1.5 text-sm"
                    onClick={() => setConfirmOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    className="rounded-xl bg-[#FF3B30] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#E0352B]"
                    onClick={handleConfirmDelete}
                  >
                    确认删除
                  </button>
                </div>
              </>
            )}

            {deleting && (
              <div className="space-y-3 text-center py-2">
                <svg className="animate-spin mx-auto" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8" />
                </svg>
                <p className="text-sm text-slate-600">
                  正在批量删除 {selected.size} 个分支（并发 5，逐条校验保护状态）…
                </p>
                <button
                  className="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50"
                  onClick={() => api.cancelBatchDelete()}
                >
                  取消剩余删除
                </button>
              </div>
            )}

            {deleteResults && !deleting && (
              <>
                <h3 className="font-semibold text-lg">删除结果</h3>
                <p className="text-sm">
                  <span className="text-[#34C759] font-medium">成功 {okCount}</span>
                  {" · "}
                  <span className="text-[#FF3B30] font-medium">失败 {failCount}</span>
                </p>
                <div className="max-h-64 overflow-auto rounded border border-slate-200">
                  <table className="text-sm table-fixed" style={{ width: tableW }}>
                    <thead className="bg-slate-50 sticky top-0 text-left text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5">分支</th>
                        <th className="px-3 py-1.5">结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deleteResults.map((r) => (
                        <tr key={r.branch} className="border-t border-slate-100">
                          <td className="px-3 py-1.5 font-mono text-xs">{r.branch}</td>
                          <td className="px-3 py-1.5">
                            {r.success ? (
                              <span className="text-[#34C759]">✓ 成功</span>
                            ) : (
                              <span className="text-[#FF3B30]" title={r.message}>
                                ✗ {r.message.length > 40 ? r.message.slice(0, 40) + "…" : r.message}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <button
                    className="rounded-xl bg-[#007AFF] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0071E3]"
                    onClick={() => {
                      setDeleteResults(null);
                      setSelected(new Set());
                    }}
                  >
                    完成
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 批量创建向导 */}
      {wizardOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-sm-xl p-6 w-[640px] space-y-4 max-h-[85vh] overflow-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">批量创建本地分支（不自动 push）</h3>
              <button className="text-slate-400 hover:text-slate-600" onClick={closeWizard}>
                ✕
              </button>
            </div>

            <div className="rounded bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
              源分支（{selected.size}）：
              <span className="font-mono text-xs">{[...selected].join(", ")}</span>
            </div>

            {preflight && (
              <div
                className={`rounded px-3 py-2 text-sm ${
                  preflight.linked && preflight.repo_exists && !preflight.dirty
                    ? "bg-green-50 border border-[#34C759]/30 text-[#34C759]"
                    : "bg-amber-50 border border-amber-200 text-amber-700"
                }`}
              >
                {!preflight.linked && <div>⚠️ {preflight.message ?? "该仓库未关联本地路径"}</div>}
                {preflight.linked && !preflight.repo_exists && (
                  <div>⚠️ {preflight.message ?? "本地路径不是 Git 仓库"}</div>
                )}
                {preflight.linked && preflight.repo_exists && preflight.dirty && (
                  <div>⚠️ {preflight.message ?? "本地存在未提交改动"}</div>
                )}
                {preflight.linked && preflight.repo_exists && !preflight.dirty && (
                  <div>
                    ✓ 本地仓库就绪：{preflight.local_path}
                    {preflight.current_branch ? `（当前分支 ${preflight.current_branch}）` : ""}
                    ，创建时将自动 fetch 并基于本地源分支创建
                  </div>
                )}
              </div>
            )}

            {wizardStage === "config" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <label className="text-sm w-20 shrink-0">命名模板</label>
                  <select
                    className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                    value={selTemplateId ?? ""}
                    onChange={(e) => setSelTemplateId(Number(e.target.value) || null)}
                  >
                    <option value="">请选择模板…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}（{t.pattern}）
                      </option>
                    ))}
                  </select>
                  <button
                    className="rounded border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-50"
                    onClick={() =>
                      setTplForm({ open: true, id: null, name: "", pattern: "{userName}/{projectName}_TG-{TG_ID}/{sourceBranch}" })
                    }
                  >
                    新建
                  </button>
                  <button
                    className="rounded border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-40"
                    disabled={!selTemplateId}
                    onClick={() => {
                      if (template) setTplForm({ open: true, id: template.id, name: template.name, pattern: template.pattern });
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="rounded border border-[#FF3B30]/30 text-[#FF3B30] px-2 py-1.5 text-xs hover:bg-red-50 disabled:opacity-40"
                    disabled={!selTemplateId}
                    onClick={handleDeleteTemplate}
                  >
                    删除
                  </button>
                </div>

                {tplForm.open && (
                  <div className="rounded border border-slate-300 p-3 space-y-2 bg-slate-50">
                    <label className="text-sm block">
                      模板名称
                      <input
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        value={tplForm.name}
                        onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })}
                        placeholder="如：测试环境分支"
                      />
                    </label>
                    <label className="text-sm block">
                      命名模板（必须包含 {"{sourceBranch}"}；其他 {"{变量}"} 运行时填写）
                      <input
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                        value={tplForm.pattern}
                        onChange={(e) => setTplForm({ ...tplForm, pattern: e.target.value })}
                      />
                    </label>
                    <div className="flex justify-end gap-2">
                      <button
                        className="rounded border border-slate-300 px-3 py-1 text-xs"
                        onClick={() => setTplForm({ open: false, id: null, name: "", pattern: "" })}
                      >
                        取消
                      </button>
                      <button
                        className="rounded-lg bg-[#007AFF] px-3 py-1 text-xs font-medium text-white hover:bg-[#0071E3]"
                        onClick={handleSaveTemplate}
                      >
                        保存模板
                      </button>
                    </div>
                  </div>
                )}

                {template && inputVars.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">变量值（运行时手动填写）</label>
                      <button
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                        onClick={handleSaveDefaults}
                      >
                        保存为该仓库默认值
                      </button>
                    </div>
                    {inputVars.map((v) => (
                      <div key={v} className="flex items-center gap-2">
                        <label className="text-sm font-mono w-32 shrink-0">{"{" + v + "}"}</label>
                        <input
                          className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                          value={values[v] ?? ""}
                          onChange={(e) => setValues({ ...values, [v]: e.target.value })}
                          placeholder={`请输入 ${v} 的值`}
                        />
                      </div>
                    ))}
                    <p className="text-xs text-slate-400">
                      {"{sourceBranch}"} 将自动替换为每个选中的源分支名，无需填写。
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button className="rounded border border-slate-300 px-4 py-1.5 text-sm" onClick={closeWizard}>
                    取消
                  </button>
                  <button
                    className="rounded-xl bg-[#007AFF] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0071E3] disabled:opacity-50"
                    disabled={
                      !template ||
                      !valuesFilled ||
                      selected.size === 0 ||
                      !preflight?.linked ||
                      !preflight?.repo_exists ||
                      !!preflight?.dirty
                    }
                    onClick={generatePreview}
                    title={
                      !template
                        ? "请先选择命名模板"
                        : !valuesFilled
                          ? "请填写全部变量值"
                          : !preflight?.linked || !preflight?.repo_exists || preflight?.dirty
                            ? "本地仓库未就绪"
                            : "生成目标分支预览"
                    }
                  >
                    检查冲突并生成预览
                  </button>
                </div>
              </div>
            )}

            {wizardStage === "preview" && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  目标分支预览（{wizardRows.length} 条）：
                  <span className="text-[#FF3B30] ml-2">红=阻断</span>
                  <span className="text-amber-600 ml-2">黄=远程同名提示（不阻止）</span>
                </p>
                <div className="max-h-64 overflow-auto rounded border border-slate-200">
                  <table className="text-sm table-fixed" style={{ width: tableW }}>
                    <thead className="bg-slate-50 sticky top-0 text-left text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5">源分支</th>
                        <th className="px-3 py-1.5">目标分支（本地创建）</th>
                        <th className="px-3 py-1.5">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wizardRows.map((r) => {
                        const dup = dupTargets.has(r.target);
                        const blocked = !r.check.valid || r.check.local_exists || dup;
                        return (
                          <tr key={r.source} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 font-mono text-xs">{r.source}</td>
                            <td className="px-3 py-1.5 font-mono text-xs">{r.target}</td>
                            <td className="px-3 py-1.5 text-xs">
                              {!r.check.valid && (
                                <span className="text-[#FF3B30]">✗ 命名不合法</span>
                              )}
                              {r.check.valid && r.check.local_exists && (
                                <span className="text-[#FF3B30]">✗ 本地已存在同名分支</span>
                              )}
                              {r.check.valid && !r.check.local_exists && dup && (
                                <span className="text-[#FF3B30]">✗ 与其他目标重名</span>
                              )}
                              {r.check.valid && !r.check.local_exists && !dup && r.remoteExists && (
                                <span className="text-amber-600">⚠ 远程已存在同名分支（仍可创建本地）</span>
                              )}
                              {r.check.valid && !r.check.local_exists && !dup && !r.remoteExists && (
                                <span className="text-[#34C759]">✓ 可创建</span>
                              )}
                              {blocked && <span className="ml-1 text-[#FF3B30]">（将被跳过）</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {blockedRows.length > 0 && (
                  <p className="text-xs text-[#FF3B30]">
                    {blockedRows.length} 条被阻断（本地同名 / 命名不合法 / 重名），执行时将跳过这些条目。
                  </p>
                )}
                {warnRows.length > 0 && (
                  <p className="text-xs text-amber-600">
                    {warnRows.length} 条远程同名提示（不阻止，由你决定是否继续）。
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded border border-slate-300 px-4 py-1.5 text-sm"
                    onClick={() => setWizardStage("config")}
                  >
                    返回修改
                  </button>
                  <button
                    className="rounded-xl bg-[#34C759] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#2FA84F] disabled:opacity-50"
                    onClick={executeCreate}
                    disabled={wizardRows.length === 0}
                    title="自动 fetch 源分支后，在本地批量创建分支；不会执行 push"
                  >
                    确认创建（{wizardRows.length - blockedRows.length} 条）
                  </button>
                </div>
              </div>
            )}

            {wizardStage === "creating" && (
              <div className="space-y-3 text-center py-4">
                <svg className="animate-spin mx-auto" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8" />
                </svg>
                <p className="text-sm text-slate-600">
                  正在本地创建分支：fetch → 更新本地源分支 → 逐条创建（不 push）…
                </p>
              </div>
            )}

            {wizardStage === "results" && createResults && (
              <div className="space-y-3">
                <h4 className="font-semibold text-lg">创建结果</h4>
                <p className="text-sm">
                  <span className="text-[#34C759] font-medium">成功 {createOk}</span>
                  {" · "}
                  <span className="text-[#FF3B30] font-medium">失败 {createFail}</span>
                </p>
                <div className="rounded bg-blue-50 border border-blue-200 text-blue-700 px-3 py-2 text-sm">
                  分支仅在本地创建，<b>不会自动 push</b>。请自行执行 git push 推送到远程。
                </div>
                <div className="max-h-64 overflow-auto rounded border border-slate-200">
                  <table className="text-sm table-fixed" style={{ width: tableW }}>
                    <thead className="bg-slate-50 sticky top-0 text-left text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5">源分支</th>
                        <th className="px-3 py-1.5">本地新分支</th>
                        <th className="px-3 py-1.5">结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {createResults.map((r, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-3 py-1.5 font-mono text-xs">{r.source}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{r.target}</td>
                          <td className="px-3 py-1.5 text-xs">
                            {r.success ? (
                              <span className="text-[#34C759]">✓ {r.message}</span>
                            ) : (
                              <span className="text-[#FF3B30]" title={r.message}>
                                ✗ {r.message.length > 40 ? r.message.slice(0, 40) + "…" : r.message}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <button
                    className="rounded-xl bg-[#007AFF] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0071E3]"
                    onClick={() => {
                      closeWizard();
                      fetchAll();
                    }}
                  >
                    完成并刷新列表
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
