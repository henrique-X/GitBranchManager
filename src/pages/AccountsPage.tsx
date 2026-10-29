import { useState } from "react";
import { api } from "../api";
import { PLATFORM_LABELS, type Account, type Platform } from "../types";

const emptyForm = {
  platform: "github" as Platform,
  label: "",
  baseUrl: "",
  pat: "",
};

/* ---- 图标（内联 SVG，无第三方依赖） ---- */
function IconSwitch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}
function IconTest() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
function IconEdit() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/* ---- 头像：优先加载平台头像，加载失败时降级为首字母头像 ---- */
const AVATAR_STYLES: Record<Platform, string> = {
  github: "bg-slate-800 text-white",
  gitee: "bg-[#FF3B30] text-white",
  gitlab: "bg-orange-500 text-white",
};

function Avatar({ acc, size = "w-9 h-9 text-sm" }: { acc: Account; size?: string }) {
  const [failed, setFailed] = useState(false);
  const name = acc.api_username || acc.label || "?";

  if (!acc.avatar_url || failed) {
    return (
      <div
        className={`${size} ${AVATAR_STYLES[acc.platform]} rounded-full flex items-center justify-center font-bold shrink-0 select-none`}
        title={name}
      >
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={acc.avatar_url}
      alt={name}
      title={name}
      className={`${size} rounded-full shrink-0 object-cover bg-slate-200`}
      onError={() => setFailed(true)}
    />
  );
}
const iconBtn =
  "rounded border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-transparent";

export default function AccountsPage({
  accounts,
  activeId,
  onChanged,
}: {
  accounts: Account[];
  activeId: number | null;
  onChanged: () => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [editForm, setEditForm] = useState({ label: "", baseUrl: "", pat: "" });

  async function handleAdd() {
    setError(null);
    setMessage(null);
    if (!form.pat.trim()) {
      setError("请填写 PAT（私人令牌）");
      return;
    }
    if (form.platform === "gitlab" && !form.baseUrl.trim()) {
      setError("自建 GitLab 需要填写服务器地址，例如 https://gitlab.example.com");
      return;
    }
    setAdding(true);
    try {
      const acc = await api.addAccount({
        platform: form.platform,
        label: form.label.trim(),
        baseUrl: form.baseUrl.trim(),
        pat: form.pat.trim(),
      });
      setMessage(`账号添加成功：${acc.api_username ?? acc.label}`);
      setForm(emptyForm);
      setAddFormOpen(false);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(acc: Account) {
    const ok = window.confirm(
      `确定删除账号「${acc.label}」吗？\n将同时清除本地保存的 PAT。`
    );
    if (!ok) return;
    setError(null);
    setMessage(null);
    try {
      await api.deleteAccount(acc.id);
      setMessage("账号已删除");
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSetActive(acc: Account) {
    setError(null);
    setMessage(null);
    try {
      await api.setActiveAccount(acc.id);
      setMessage(`当前账号已切换为「${acc.label}」`);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleTest(acc: Account) {
    setError(null);
    setMessage(null);
    setTestingId(acc.id);
    try {
      const username = await api.testAccount(acc.id);
      setMessage(`连接成功：${username}`);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setTestingId(null);
    }
  }

  function startEdit(acc: Account) {
    setEditingId(acc.id);
    setEditForm({ label: acc.label, baseUrl: acc.base_url ?? "", pat: "" });
  }

  async function handleSaveEdit() {
    if (editingId == null) return;
    setError(null);
    setMessage(null);
    setAdding(true);
    try {
      await api.updateAccount(
        editingId,
        editForm.label.trim(),
        editForm.baseUrl.trim(),
        editForm.pat.trim()
      );
      setEditingId(null);
      setMessage("账号已更新");
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      {addFormOpen ? (
        <div className="flex items-center gap-3">
          <button
            className="text-sm text-blue-600 hover:underline"
            onClick={() => setAddFormOpen(false)}
          >
            ← 返回账号列表
          </button>
          <h1 className="text-2xl font-bold">添加账号</h1>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">账号管理</h1>
          <button
            className="rounded-xl bg-[#007AFF] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0071E3]"
            onClick={() => setAddFormOpen(true)}
          >
            ✚ 添加账号
          </button>
        </div>
      )}

      {addFormOpen && (
      <section className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">添加账号</h2>

        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            平台
            <select
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
              value={form.platform}
              onChange={(e) =>
                setForm({ ...form, platform: e.target.value as Platform })
              }
            >
              <option value="github">GitHub</option>
              <option value="gitee">Gitee</option>
              <option value="gitlab">GitLab（自建/公网）</option>
            </select>
          </label>
          <label className="text-sm">
            别名（选填，默认用平台用户名）
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="例如：公司 GitLab"
            />
          </label>
        </div>
        {form.platform === "gitlab" && (
          <label className="text-sm block">
            GitLab 服务器地址
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://gitlab.example.com"
            />
          </label>
        )}
        <label className="text-sm block">
          PAT（私人令牌，仅保存在 Windows 凭据管理器）
          <input
            type="password"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            value={form.pat}
            onChange={(e) => setForm({ ...form, pat: e.target.value })}
            placeholder="粘贴 PAT"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            className="rounded bg-blue-600 px-4 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={handleAdd}
            disabled={adding}
          >
            {adding ? "验证中…" : "添加账号"}
          </button>
          <span className="text-xs text-slate-500">
            添加时会自动验证 PAT 并回显用户名
          </span>
        </div>
      </section>
      )}

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

{!addFormOpen && (
      <section className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
        <h2 className="font-semibold text-lg">
          已保存账号（{accounts.length}）
        </h2>
        {accounts.length === 0 && (
          <p className="text-sm text-slate-500">还没有账号，先在上方添加。</p>
        )}
        {accounts.map((acc) => (
          <div
            key={acc.id}
            className="flex items-center justify-between rounded border border-slate-200 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <Avatar acc={acc} />
              <div>
                <div className="font-medium">
                  {acc.label}
                  {acc.id === activeId && (
                    <span className="ml-2 rounded bg-blue-100 text-blue-700 text-xs px-2 py-0.5">
                      当前账号
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {PLATFORM_LABELS[acc.platform]}
                  {acc.api_username ? ` · ${acc.api_username}` : ""}
                  {acc.base_url ? ` · ${acc.base_url}` : ""}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                className={iconBtn}
                title="设为当前账号"
                onClick={() => handleSetActive(acc)}
                disabled={acc.id === activeId}
              >
                <IconSwitch />
              </button>
              <button
                className={iconBtn}
                title={testingId === acc.id ? "测试中…" : "测试连接"}
                onClick={() => handleTest(acc)}
                disabled={testingId != null}
              >
                {testingId === acc.id ? (
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8" />
                  </svg>
                ) : (
                  <IconTest />
                )}
              </button>
              <button className={iconBtn} title="编辑" onClick={() => startEdit(acc)}>
                <IconEdit />
              </button>
              <button
                className="rounded border border-[#FF3B30]/30 p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700"
                title="删除"
                onClick={() => handleDelete(acc)}
              >
                <IconTrash />
              </button>
            </div>
          </div>
        ))}
      </section>
      )}

      {editingId != null && !addFormOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-sm-xl p-6 w-[420px] space-y-4">
            <h3 className="font-semibold text-lg">编辑账号</h3>
            <label className="text-sm block">
              别名
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
                value={editForm.label}
                onChange={(e) =>
                  setEditForm({ ...editForm, label: e.target.value })
                }
              />
            </label>
            {accounts.find((a) => a.id === editingId)?.platform === "gitlab" && (
              <label className="text-sm block">
                GitLab 服务器地址
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
                  value={editForm.baseUrl}
                  onChange={(e) =>
                    setEditForm({ ...editForm, baseUrl: e.target.value })
                  }
                />
              </label>
            )}
            <label className="text-sm block">
              新 PAT（留空表示不修改）
              <input
                type="password"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
                value={editForm.pat}
                onChange={(e) =>
                  setEditForm({ ...editForm, pat: e.target.value })
                }
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                className="rounded border border-slate-300 px-4 py-1.5"
                onClick={() => setEditingId(null)}
              >
                取消
              </button>
              <button
                className="rounded bg-blue-600 px-4 py-1.5 text-white hover:bg-blue-700"
                onClick={handleSaveEdit}
                disabled={adding}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
