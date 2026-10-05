import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { api, fmtBytes, type DeleteReport, type Settings } from "./api";
import { AboutDialog } from "./components/dialogs";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { emitCmd } from "./hooks/commands";
import { useGlobalScan, useScan } from "./hooks/useScans";
import { Icon, type IconName } from "./ui/Icon";
import { Spinner, Toast } from "./ui/primitives";
import { GlobalView } from "./views/GlobalView";
import { History } from "./views/History";
import { TrashView } from "./views/TrashView";
import { Projects } from "./views/Projects";
import { SettingsView } from "./views/SettingsView";

type Tab = "projects" | "global" | "trash" | "history" | "settings";
const GROUPS: { label: string; tabs: { id: Tab; label: string; icon: IconName }[] }[] = [
  { label: "Clean", tabs: [{ id: "projects", label: "Projects", icon: "folder" }, { id: "global", label: "Tools & SDKs", icon: "database" }] },
  { label: "Manage", tabs: [{ id: "trash", label: "Trash", icon: "trash" }, { id: "history", label: "History", icon: "clock" }] },
  { label: "Configure", tabs: [{ id: "settings", label: "Settings", icon: "sliders" }] },
];

const ONBOARDED = "dc.onboarded";
const wasOnboarded = () => { try { return localStorage.getItem(ONBOARDED) === "1"; } catch { return false; } };
const markOnboarded = () => { try { localStorage.setItem(ONBOARDED, "1"); } catch { /* storage unavailable */ } };

function Onboarding(props: { onChoose: () => void; onSkip: () => void }) {
  const point = (icon: IconName, title: string, body: string) => (
    <li className="flex gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"><Icon name={icon} /></div>
      <div><div className="font-medium">{title}</div><div className="muted text-[13px]">{body}</div></div>
    </li>
  );
  return (
    <div className="flex h-screen items-center justify-center overflow-auto p-6">
      <div className="card w-full max-w-md p-8 text-center">
        <img src="/icon.svg" alt="" className="mx-auto h-16 w-16" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Welcome to Dev Cleaner</h1>
        <p className="muted mt-1 text-[13px]">Reclaim disk space from files your developer tools can rebuild.</p>
        <ul className="mt-6 space-y-4 text-left">
          {point("shield", "Nothing is removed without your say", "You choose and confirm every folder.")}
          {point("trash", "Easy to undo", "Removed folders go to the Trash, where you can restore them.")}
          {point("folder", "Source code stays untouched", "Only rebuildable folders such as node_modules are offered.")}
        </ul>
        <div className="mt-7 flex flex-col gap-2">
          <button className="btn btn-primary justify-center" onClick={props.onChoose}><Icon name="folder-plus" className="h-[18px] w-[18px]" />Choose project folders</button>
          <button className="btn btn-ghost justify-center" onClick={props.onSkip}>Skip for now</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("projects");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [disk, setDisk] = useState<[number, number] | null>(null);
  const [onboarded, setOnboarded] = useState(wasOnboarded);
  const [palette, setPalette] = useState(false);
  const [about, setAbout] = useState(false);
  const [toast, setToast] = useState<{ tone: "info" | "error"; text: ReactNode } | null>(null);
  const saveTimer = useRef<number>(0);
  const scan = useScan();
  const globalScan = useGlobalScan();
  const launched = useRef(false);
  const refreshDisk = useCallback(() => { api.diskSpace().then(setDisk).catch(() => {}); }, []);

  useEffect(() => { api.getSettings().then(setSettings); refreshDisk(); }, [refreshDisk]);
  useEffect(() => {
    if (settings && !launched.current) {
      launched.current = true;
      if (settings.scan_roots.length) { markOnboarded(); setOnboarded(true); }
      if (settings.scan_on_launch && settings.scan_roots.length) scan.start();
    }
  }, [settings, scan]);
  useEffect(() => { if (scan.status === "done" || globalScan.status === "done") refreshDisk(); }, [scan.status, globalScan.status, refreshDisk]);
  useEffect(() => {
    const un = listen("trash-changed", () => { refreshDisk(); setToast({ tone: "info", text: "Trash auto-clear removed items that were older than your retention period." }); });
    return () => { un.then((f) => f()).catch(() => {}); };
  }, [refreshDisk]);

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
    saveTimer.current = window.setTimeout(() => {
      api.saveSettings(s).catch((e) => setToast({ tone: "error", text: `Settings could not be saved. ${String(e)}` }));
    }, 300);
  }, []);

  const onDeleted = useCallback((r: DeleteReport) => {
    if (r.dry_run) return;
    scan.refresh();
    refreshDisk();
  }, [scan, refreshDisk]);

  const goScan = useCallback((t: Tab) => { setTab(t); emitCmd("scan"); }, []);
  const toggleTheme = () => settings && updateSettings({ ...settings, theme: document.documentElement.classList.contains("dark") ? "light" : "dark" });

  const commands: PaletteCommand[] = useMemo(() => !settings ? [] : [
    { id: "scan-projects", label: "Scan projects", hint: "Ctrl/Cmd+R", icon: "search", run: () => goScan("projects") },
    { id: "scan-tools", label: "Scan tools & SDKs", icon: "database", run: () => goScan("global") },
    { id: "map", label: "Open storage map", icon: "map", run: () => { setTab("projects"); emitCmd("storage-map"); } },
    { id: "trash", label: "Open Trash", icon: "trash", run: () => setTab("trash") },
    { id: "history", label: "Open History", icon: "clock", run: () => setTab("history") },
    { id: "settings", label: "Open Settings", hint: "Ctrl/Cmd+,", icon: "sliders", run: () => setTab("settings") },
    { id: "theme", label: "Toggle dark mode", icon: "eye", run: toggleTheme },
    { id: "dry", label: settings.dry_run ? "Turn dry run off" : "Turn dry run on", icon: "shield", run: () => updateSettings({ ...settings, dry_run: !settings.dry_run }) },
    { id: "about", label: "About Dev Cleaner", icon: "info", run: () => setAbout(true) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [settings, goScan, updateSettings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = (e.target as HTMLElement | null)?.matches?.("input, textarea, select, [contenteditable]");
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      else if (mod && e.key === ",") { e.preventDefault(); setTab("settings"); }
      else if (mod && e.key.toLowerCase() === "r") { e.preventDefault(); if (tab === "projects" || tab === "global") emitCmd("scan"); }
      else if (mod && e.key.toLowerCase() === "a" && !typing) { if (tab === "projects" || tab === "global") { e.preventDefault(); emitCmd("select-all"); } }
      else if (mod && e.key.toLowerCase() === "f") { if (tab === "projects") { e.preventDefault(); emitCmd("focus-search"); } }
      else if (e.key === "Escape" && !palette) emitCmd("escape");
      else if (e.key === "Delete" && !typing && !document.querySelector('[role="dialog"]')) emitCmd("delete");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, palette]);

  if (!settings) return <div className="flex h-screen items-center justify-center"><Spinner className="h-6 w-6" /></div>;

  async function chooseFolders() {
    const p = await open({ directory: true, multiple: true });
    const picked = Array.isArray(p) ? p : typeof p === "string" ? [p] : [];
    if (picked.length) updateSettings({ ...settings!, scan_roots: [...new Set([...settings!.scan_roots, ...picked])] });
    markOnboarded(); setOnboarded(true);
    if (picked.length) setTimeout(() => emitCmd("scan"), 0);
  }
  if (!onboarded) return <Onboarding onChoose={chooseFolders} onSkip={() => { markOnboarded(); setOnboarded(true); }} />;

  const busy = (id: Tab) => (id === "projects" && scan.status === "scanning") || (id === "global" && globalScan.status === "scanning");
  const usedFrac = disk ? 1 - disk[1] / disk[0] : 0;
  const openSettings = () => setTab("settings");
  return (
    <div className="flex h-screen">
      <nav aria-label="Main" className="flex w-[232px] shrink-0 flex-col border-r bg-white px-3 py-4 divider dark:bg-slate-900">
        <div className="mb-5 flex items-center gap-2.5 px-2">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <div className="text-[15px] font-semibold leading-tight tracking-tight">Dev Cleaner</div>
        </div>
        <div className="flex-1 space-y-4 overflow-auto">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <div className="muted mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider">{g.label}</div>
              {g.tabs.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 ${tab === t.id ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
                  <Icon name={t.icon} className="h-4 w-4" />{t.label}
                  {busy(t.id) && <Spinner className="ml-auto h-3.5 w-3.5" />}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="space-y-3 px-1 pt-3 text-xs">
          {settings.dry_run && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              <Icon name="shield" className="mt-0.5 h-3.5 w-3.5" /><span><b className="font-semibold">Dry run</b><br />Nothing will be deleted</span>
            </div>
          )}
          {disk && (
            <div>
              <div className="muted mb-1">{fmtBytes(disk[1])} free of {fmtBytes(disk[0])}</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className={`h-full rounded-full ${usedFrac > 0.9 ? "bg-red-500" : "bg-indigo-500"}`} style={{ width: `${Math.round(usedFrac * 100)}%` }} /></div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <button className="muted flex items-center gap-1.5 rounded px-1 py-0.5 hover:text-slate-900 dark:hover:text-white" onClick={() => setAbout(true)}><Icon name="info" className="h-3.5 w-3.5" />About · v{__APP_VERSION__}</button>
            <button className="muted rounded px-1 py-0.5 hover:text-slate-900 dark:hover:text-white" onClick={() => setPalette(true)} aria-label="Open command palette" title="Command palette (Ctrl/Cmd+K)"><Icon name="command" className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-hidden px-6 py-5">
        {tab === "projects" && <Projects scan={scan} settings={settings} onChangeSettings={updateSettings} onOpenSettings={openSettings} onDeleted={onDeleted} />}
        {tab === "global" && <GlobalView scan={globalScan} settings={settings} onOpenSettings={openSettings} onDeleted={onDeleted} />}
        {tab === "trash" && <TrashView settings={settings} onOpenSettings={openSettings} onChanged={refreshDisk} />}
        {tab === "history" && <History />}
        {tab === "settings" && <SettingsView settings={settings} onChange={updateSettings} onAbout={() => setAbout(true)} />}
      </main>
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.text}</Toast>}
    </div>
  );
}
