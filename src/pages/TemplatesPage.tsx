import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { NamingTemplate } from "../types";

function extractVars(pattern: string): string[] {
  const out: string[] = [];
  const re = /\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pattern)) !== null) {
    const name = m[1].trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

const emptyForm = { open: false, id: null as number | null, name: "", pattern: "" };

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<NamingTemplate[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await api.listTemplates());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const formVars = useMemo(() => extractVars(form.pattern), [form.pattern]);
  const missingSource = form.open && !formVars.includes("sourceBranch");

  async function handleSave() {
    setError(null);
    setMessage(null);
    try {
      await api.saveTemplate(form.id, form.name, form.pattern);
      setMessage("模板已保存");
      setForm(emptyForm);
      load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(t: NamingTemplate) {
    if (!window.confirm(`确定删除模板「${t.name}」？\n使用该模板的仓库默认值也会一并删除。`)) return;
    setError(null);
    setMessage(null);
    try {
      await api.deleteTemplate(t.id);
      setMessage("模板已删除");
      load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">命名模板管理</h1>
        <button
          className="rounded-xl bg-[#007AFF] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0071E3]"
          onClick={() => setForm({ open: true, id: null, name: "", pattern: "{userName}/{projectName}_TG-{TG_ID}/{sourceBranch}" })}
        >
          ✚ 新建模板
        </button>
      </div>

      <p className="text-sm text-slate-500">
        模板用于批量创建分支时自动生成目标分支名。必须包含 {"{sourceBranch}"}（自动替换为每个源分支名），其余变量在创建时手动填写。
      </p>

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

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">加载中…</div>
        ) : templates.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            还没有模板，点击右上角「新建模板」创建。
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2.5 w-[16%] min-w-[140px]">模板名称</th>
                <th className="px-4 py-2.5">命名模式</th>
                <th className="px-4 py-2.5">变量</th>
                <th className="px-4 py-2.5 w-32">操作</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">{t.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{t.pattern}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {t.variables.map((v) => (
                        <span key={v} className="rounded bg-slate-100 text-slate-600 text-xs px-1.5 py-0.5 font-mono">
                          {`{${v}}`}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2">
                      <button
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                        onClick={() => setForm({ open: true, id: t.id, name: t.name, pattern: t.pattern })}
                      >
                        编辑
                      </button>
                      <button
                        className="rounded border border-[#FF3B30]/30 text-[#FF3B30] px-2 py-1 text-xs hover:bg-red-50"
                        onClick={() => handleDelete(t)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-sm-xl p-6 w-[520px] space-y-4">
            <h3 className="font-semibold text-lg">{form.id ? "编辑模板" : "新建模板"}</h3>
            <label className="text-sm block">
              模板名称
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：测试环境分支"
              />
            </label>
            <label className="text-sm block">
              命名模式
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                value={form.pattern}
                onChange={(e) => setForm({ ...form, pattern: e.target.value })}
                placeholder="{userName}/{projectName}_TG-{TG_ID}/{sourceBranch}"
              />
            </label>
            <div className="text-sm">
              变量预览：
              {formVars.length === 0 ? (
                <span className="text-slate-400">（无）</span>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1">
                  {formVars.map((v) => (
                    <span
                      key={v}
                      className={`rounded px-1.5 py-0.5 text-xs font-mono ${
                        v === "sourceBranch"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {`{${v}}`}
                    </span>
                  ))}
                </div>
              )}
              {missingSource && (
                <p className="mt-1 text-xs text-red-500">
                  ⚠ 必须包含 {"{sourceBranch}"}，否则无法基于多个源分支批量创建
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="rounded border border-slate-300 px-4 py-1.5 text-sm"
                onClick={() => setForm(emptyForm)}
              >
                取消
              </button>
              <button
                className="rounded-xl bg-[#007AFF] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0071E3] disabled:opacity-50"
                disabled={!form.name.trim() || !form.pattern.trim() || missingSource}
                onClick={handleSave}
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
