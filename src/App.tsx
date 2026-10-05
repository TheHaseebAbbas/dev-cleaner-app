import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtBytes, type DeleteOutcome, type Settings } from "./api";
import { useGlobalScan, useScan } from "./hooks/useScans";
import { Icon, type IconName } from "./ui/Icon";
import { Spinner } from "./ui/primitives";
import { GlobalView } from "./views/GlobalView";
import { History } from "./views/History";
import { Projects } from "./views/Projects";
import { SettingsView } from "./views/SettingsView";

type Tab = "projects" | "global" | "history" | "settings";
const TABS: { id: Tab; label: string; title: string; icon: IconName }[] = [
  { id: "projects", label: "Projects", title: "Project clean-up", icon: "folder" },
  { id: "global", label: "Tool caches", title: "Global caches and SDKs", icon: "database" },
  { id: "history", label: "History", title: "Clean-up history", icon: "clock" },
  { id: "settings", label: "Settings", title: "Settings", icon: "sliders" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("projects");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [disk, setDisk] = useState<[number, number] | null>(null);
  const saveTimer = useRef<number>(0);
  const scan = useScan();
  const globalScan = useGlobalScan();
  const launched = useRef(false);

  useEffect(() => { api.getSettings().then(setSettings); api.diskSpace().then(setDisk).catch(() => {}); }, []);
  useEffect(() => {
    if (settings && !launched.current) {
      launched.current = true;
      if (settings.scan_on_launch && settings.scan_roots.length) scan.start();
    }
  }, [settings, scan]);
  useEffect(() => { if (scan.status === "done" || globalScan.status === "done") api.diskSpace().then(setDisk).catch(() => {}); }, [scan.status, globalScan.status]);

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

  const onDeleted = useCallback((out: DeleteOutcome[]) => {
    if (out[0]?.dry_run) return;
    scan.refresh();
    api.diskSpace().then(setDisk).catch(() => {});
  }, [scan]);

  if (!settings) return <div className="flex h-screen items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  const current = TABS.find((t) => t.id === tab)!;
  const busy = (id: Tab) => (id === "projects" && scan.status === "scanning") || (id === "global" && globalScan.status === "scanning");
  const usedFrac = disk ? 1 - disk[1] / disk[0] : 0;
  return (
    <div className="flex h-screen">
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r bg-white p-3 divider dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-2 px-2 pt-1">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <div className="text-base font-bold leading-tight">Dev Cleaner</div>
        </div>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${tab === t.id ? "bg-emerald-600 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
            <Icon name={t.icon} className="h-4 w-4" />{t.label}
            {busy(t.id) && <Spinner className="ml-auto h-3.5 w-3.5" />}
          </button>
        ))}
        <div className="mt-auto space-y-2 px-1 text-xs">
          {settings.dry_run && <div className="rounded-lg bg-amber-100 px-2 py-1.5 font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">Dry run is on. Nothing is deleted.</div>}
          {disk && (
            <div>
              <div className="muted mb-1">Disk free <b className="text-slate-700 dark:text-slate-200">{fmtBytes(disk[1])}</b> of {fmtBytes(disk[0])}</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className={`h-full rounded-full ${usedFrac > 0.9 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.round(usedFrac * 100)}%` }} /></div>
            </div>
          )}
        </div>
      </nav>
      <main className="flex min-w-0 flex-1 flex-col p-4">
        <h1 className="mb-3 text-xl font-semibold">{current.title}</h1>
        <div className="min-h-0 flex-1">
          {tab === "projects" && <Projects scan={scan} settings={settings} onOpenSettings={() => setTab("settings")} onDeleted={onDeleted} />}
          {tab === "global" && <GlobalView scan={globalScan} settings={settings} onOpenSettings={() => setTab("settings")} onDeleted={onDeleted} />}
          {tab === "history" && <History />}
          {tab === "settings" && <SettingsView settings={settings} onChange={updateSettings} />}
        </div>
      </main>
    </div>
  );
}
