import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { GeneralSettings } from "../types";

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative w-[51px] h-[31px] rounded-full transition-colors shrink-0 disabled:opacity-50 ${
        checked ? "bg-[#34C759]" : "bg-[rgba(120,120,128,0.32)]"
      }`}
    >
      <span
        className={`absolute top-[2px] left-[2px] w-[27px] h-[27px] bg-white rounded-full shadow-md transition-transform ${
          checked ? "translate-x-[20px]" : ""
        }`}
      />
    </button>
  );
}
function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-[9px] bg-[rgba(118,118,128,0.12)] p-[2px] overflow-hidden text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          className={`px-3 py-1 transition-colors ${
            value === o.value
              ? "bg-blue-600 text-white"
              : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const empty: GeneralSettings = {
  launch_at_startup: false,
  close_to_tray: true,
  tray_style: "panel",
};

export default function GeneralPage() {
  const [cfg, setCfg] = useState<GeneralSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setCfg(await api.getGeneralSettings());
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

  function set<K extends keyof GeneralSettings>(key: K, v: GeneralSettings[K]) {
    setCfg((prev) => (prev ? { ...prev, [key]: v } : prev));
  }

  async function handleSave() {
    if (!cfg) return;
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      await api.saveGeneralSettings(cfg);
      setMessage("通用设置已保存，立即生效");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const row =
    "flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-b-0";

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">通用</h1>

      <section className="bg-white rounded-2xl shadow-sm">
        <div className={row}>
          <div>
            <div className="text-sm font-medium">开机自启</div>
            <div className="text-xs text-slate-500 mt-0.5">
              登录 Windows 后自动启动应用
            </div>
          </div>
          <Toggle
            checked={cfg.launch_at_startup}
            onChange={(v) => set("launch_at_startup", v)}
          />
        </div>
        <div className={row}>
          <div>
            <div className="text-sm font-medium flex items-center gap-1">
              关闭时最小化到托盘
              <span
                className="text-slate-400 cursor-help"
                title="开启后：点击窗口关闭按钮将隐藏到系统托盘（托盘右键菜单可选「退出」真正关闭）；关闭后：点关闭直接退出应用"
              >
                ⓘ
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              当前状态：{cfg.close_to_tray ? "关闭窗口 = 隐藏到托盘" : "关闭窗口 = 退出应用"}
            </div>
          </div>
          <Toggle checked={cfg.close_to_tray} onChange={(v) => set("close_to_tray", v)} />
        </div>
        <div className={row}>
          <div>
            <div className="text-sm font-medium flex items-center gap-1">
              托盘样式
              <span
                className="text-slate-400 cursor-help"
                title="面板：左键点击托盘图标显示/隐藏主窗口；菜单：左键无动作，右键打开菜单"
              >
                ⓘ
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">托盘图标的左键行为</div>
          </div>
          <Segmented
            value={cfg.tray_style}
            options={[
              { value: "panel", label: "面板" },
              { value: "menu", label: "菜单" },
            ]}
            onChange={(v) => set("tray_style", v as GeneralSettings["tray_style"])}
          />
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

      <button
        className="rounded-xl bg-[#007AFF] px-5 py-1.5 text-sm font-medium text-white hover:bg-[#0071E3] disabled:opacity-50"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "保存中…" : "保存设置"}
      </button>
    </div>
  );
}
