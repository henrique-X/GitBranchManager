import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ProxyConfig, ProxyMode } from "../types";

const radioLabel =
  "flex items-center gap-2 text-sm cursor-pointer select-none py-1";

export default function SettingsPage() {
  const [cfg, setCfg] = useState<ProxyConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detectResult, setDetectResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCfg(await api.getProxySettings());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!cfg) {
    return <div className="p-6 text-slate-500 text-sm">加载设置中…</div>;
  }

  function set<K extends keyof ProxyConfig>(key: K, value: ProxyConfig[K]) {
    setCfg((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!cfg) return;
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      await api.saveProxySettings(cfg);
      setMessage("代理设置已保存，立即生效");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setError(null);
    setMessage(null);
    try {
      setCfg(await api.resetProxySettings());
      setMessage("已恢复默认代理设置");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDetect() {
    setError(null);
    setDetectResult(null);
    try {
      const res = await api.detectSystemProxy();
      const sp = res.system;
      const lines: string[] = [];
      lines.push(sp.enabled ? "系统已启用手动代理：" : "系统未启用手动代理");
      if (sp.http) lines.push(`  HTTP → ${sp.http}`);
      if (sp.https) lines.push(`  HTTPS → ${sp.https}`);
      if (sp.socks) lines.push(`  SOCKS → ${sp.socks}`);
      if (sp.pac_url) lines.push(`  PAC 脚本 → ${sp.pac_url}（应用暂不支持解析 PAC）`);
      if (res.note) lines.push(res.note);
      setDetectResult(lines.join("\n"));
    } catch (e) {
      setError(String(e));
    }
  }

  const mode = cfg.mode;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">网络</h1>

      <section className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
        <h2 className="font-semibold text-lg">网络代理</h2>

        <label className={radioLabel}>
          <input
            type="radio"
            name="proxy-mode"
            checked={mode === "none"}
            onChange={() => set("mode", "none" as ProxyMode)}
          />
          不使用代理服务器
        </label>
        <label className={radioLabel}>
          <input
            type="radio"
            name="proxy-mode"
            checked={mode === "system"}
            onChange={() => set("mode", "system" as ProxyMode)}
          />
          使用系统代理设置
        </label>
        <label className={radioLabel}>
          <input
            type="radio"
            name="proxy-mode"
            checked={mode === "manual"}
            onChange={() => set("mode", "manual" as ProxyMode)}
          />
          手动配置代理
        </label>
        <label className={radioLabel}>
          <input
            type="radio"
            name="proxy-mode"
            checked={mode === "pac"}
            onChange={() => set("mode", "pac" as ProxyMode)}
          />
          自动配置的 URL（PAC）
        </label>

        {mode === "system" && (
          <div className="ml-6 p-3 rounded bg-slate-50 border border-slate-200 text-sm space-y-2">
            <p className="text-slate-600">
              读取 Windows「Internet 选项」中的代理配置（含按协议分设的 http/https/socks）。
            </p>
            <button
              className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-white"
              onClick={handleDetect}
            >
              检测系统代理设置
            </button>
            {detectResult && (
              <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans">
                {detectResult}
              </pre>
            )}
          </div>
        )}

        {mode === "manual" && (
          <div className="ml-6 space-y-3 p-3 rounded bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-3">
              <label className="text-sm w-28 shrink-0">HTTP 代理</label>
              <input
                className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="代理主机，如 192.168.0.79"
                value={cfg.http_host ?? ""}
                onChange={(e) => set("http_host", e.target.value || null)}
              />
              <span className="text-sm text-slate-500">端口</span>
              <input
                type="number"
                className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={cfg.http_port ?? ""}
                onChange={(e) =>
                  set("http_port", e.target.value ? Number(e.target.value) : null)
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm ml-28">
              <input
                type="checkbox"
                checked={cfg.use_http_for_https}
                onChange={(e) => set("use_http_for_https", e.target.checked)}
              />
              也将此代理用于 HTTPS
            </label>
            <div className="flex items-center gap-3">
              <label className="text-sm w-28 shrink-0">HTTPS 代理</label>
              <input
                className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                placeholder="不填且未勾选上项则不单独配置"
                disabled={cfg.use_http_for_https}
                value={cfg.https_host ?? ""}
                onChange={(e) => set("https_host", e.target.value || null)}
              />
              <span className="text-sm text-slate-500">端口</span>
              <input
                type="number"
                className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                disabled={cfg.use_http_for_https}
                value={cfg.https_port ?? ""}
                onChange={(e) =>
                  set("https_port", e.target.value ? Number(e.target.value) : null)
                }
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm w-28 shrink-0">SOCKS 主机</label>
              <input
                className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="选填"
                value={cfg.socks_host ?? ""}
                onChange={(e) => set("socks_host", e.target.value || null)}
              />
              <span className="text-sm text-slate-500">端口</span>
              <input
                type="number"
                className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={cfg.socks_port ?? ""}
                onChange={(e) =>
                  set("socks_port", e.target.value ? Number(e.target.value) : null)
                }
              />
            </div>
            <div className="flex items-center gap-4 ml-28 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="socks-version"
                  checked={cfg.socks_version === 4}
                  onChange={() => set("socks_version", 4)}
                />
                SOCKS v4
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="socks-version"
                  checked={cfg.socks_version === 5}
                  onChange={() => set("socks_version", 5)}
                />
                SOCKS v5
              </label>
            </div>
          </div>
        )}

        {mode === "pac" && (
          <div className="ml-6 space-y-2 p-3 rounded bg-slate-50 border border-slate-200">
            <label className="text-sm block">
              PAC URL
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="http://proxy.example.com/proxy.pac"
                value={cfg.pac_url ?? ""}
                onChange={(e) => set("pac_url", e.target.value || null)}
              />
            </label>
            <p className="text-xs text-amber-600">
              注意：当前版本暂不支持解析 PAC 脚本（需要内置 JS 引擎）。保存后网络请求将不走代理；如需走代理请改用手动配置。
            </p>
          </div>
        )}

        <label className="text-sm block pt-2">
          不使用代理（例外列表，分号分隔；支持域名 / IP / CIDR）
          <textarea
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
            rows={3}
            placeholder="例如：.mozilla.org, .net.nz, 192.168.1.0/24；localhost、127.0.0.1/8 和 ::1 永远不走代理"
            value={cfg.exceptions ?? ""}
            onChange={(e) => set("exceptions", e.target.value || null)}
          />
        </label>

        <div className="flex gap-3 pt-1">
          <button
            className="rounded-xl bg-[#007AFF] px-5 py-1.5 text-sm font-medium text-white hover:bg-[#0071E3] disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "保存中…" : "保存设置"}
          </button>
          <button
            className="rounded border border-slate-300 px-5 py-1.5 text-sm hover:bg-slate-50"
            onClick={handleReset}
            disabled={saving}
          >
            恢复默认
          </button>
        </div>
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


    </div>
  );
}
