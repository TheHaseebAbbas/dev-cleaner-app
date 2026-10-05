import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, fmtBytes, type DeleteOutcome, type Item, type Settings } from "./api";
import { Artifacts } from "./views/Artifacts";
import { Global } from "./views/Global";
import { History } from "./views/History";
import { SettingsView } from "./views/SettingsView";

type Tab = "projects" | "global" | "history" | "settings";
const TABS: [Tab, string][] = [["projects", "Projects"], ["global", "Global caches"], ["history", "History"], ["settings", "Settings"]];

export default function App() {
  const [tab, setTab] = useState<Tab>("projects");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [scanning, setScanning] = useState(false);
  const [disk, setDisk] = useState<[number, number] | null>(null);
  const saveTimer = useRef<number>(0);

  useEffect(() => {
    api.getSettings().then(setSettings);
    api.diskSpace().then(setDisk);
    const unItem = listen<Item>("scan-item", (e) => setItems((prev) => (prev.some((i) => i.path === e.payload.path) ? prev : [...prev, e.payload])));
    const unDone = listen("scan-done", () => {
      setScanning(false);
      api.diskSpace().then(setDisk);
    });
    return () => { unItem.then((f) => f()); unDone.then((f) => f()); };
  }, []);

  useEffect(() => {
    if (!settings) return;
    const apply = () => {
      const dark = settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings]);

  const updateSettings = useCallback((s: Settings) => {
    setSettings(s);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => api.saveSettings(s), 300);
  }, []);

  const scan = useCallback(async () => {
    setItems([]);
    setScanning(true);
    try { await api.startScan(); } catch (e) { setScanning(false); alert(String(e)); }
  }, []);

  const onDeleted = useCallback((out: DeleteOutcome[]) => {
    if (out[0]?.dry_run) return;
    const gone = new Set(out.filter((o) => o.ok).map((o) => o.path));
    setItems((prev) => prev.filter((i) => !gone.has(i.path)));
    api.diskSpace().then(setDisk);
  }, []);

  if (!settings) return <div className="p-6">Loading…</div>;
  return (
    <div className="flex h-screen">
      <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 text-lg font-bold">🧹 Dev Cleaner</div>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`rounded-md px-3 py-2 text-left text-sm font-medium ${tab === id ? "bg-emerald-600 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
            {label}
          </button>
        ))}
        <div className="mt-auto text-xs text-slate-500">
          {disk && <>Disk free <b>{fmtBytes(disk[1])}</b> of {fmtBytes(disk[0])}</>}
          {settings.dry_run && <div className="mt-1 font-semibold text-amber-600">Dry-run mode on</div>}
        </div>
      </nav>
      <main className="min-w-0 flex-1 p-4">
        {tab === "projects" && <Artifacts items={items} scanning={scanning} settings={settings} onScan={scan} onCancel={() => api.cancelScan()} onDeleted={onDeleted} />}
        {tab === "global" && <Global settings={settings} />}
        {tab === "history" && <History />}
        {tab === "settings" && <SettingsView settings={settings} onChange={updateSettings} />}
      </main>
    </div>
  );
}
