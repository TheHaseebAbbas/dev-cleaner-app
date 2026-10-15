import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { api, fmtAge, fmtBytes, type DeleteReport, type RunSummary, type Settings } from "./api";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { emitCmd } from "./hooks/commands";
import { useGlobalScan, useScan } from "./hooks/useScans";
import { Icon, type IconName } from "./ui/Icon";
import { Popover, Spinner, Toast } from "./ui/primitives";
import { GlobalView } from "./views/GlobalView";
import { CleanView } from "./views/CleanView";
import { ActivityView } from "./views/ActivityView";
import { Projects } from "./views/Projects";
import { SettingsView, type SectionId } from "./views/SettingsView";

type Tab = "clean" | "projects" | "global" | "activity" | "settings";
type NavTab = { id: Tab; label: string; icon: IconName };
const CLEAN: NavTab = { id: "clean", label: "Clean", icon: "check-circle" };
const PROJECTS: NavTab = { id: "projects", label: "Projects", icon: "folder" };
const TOOLS: NavTab = { id: "global", label: "Tools & SDKs", icon: "database" };
const ACTIVITY: NavTab = { id: "activity", label: "Activity", icon: "clock" };
const SETTINGS: NavTab = { id: "settings", label: "Settings", icon: "sliders" };
/** Advanced shows every page; otherwise three, with the rest one click away under More. */
const navGroups = (advanced: boolean): { label?: string; tabs: NavTab[] }[] => advanced
  ? [{ label: "Clean", tabs: [CLEAN, PROJECTS, TOOLS] }, { label: "Manage", tabs: [ACTIVITY] }, { label: "Configure", tabs: [SETTINGS] }]
  : [{ tabs: [CLEAN, ACTIVITY, SETTINGS] }];

const ONBOARDED = "dc.onboarded";
const wasOnboarded = () => { try { return localStorage.getItem(ONBOARDED) === "1"; } catch { return false; } };
const markOnboarded = () => { try { localStorage.setItem(ONBOARDED, "1"); } catch { /* storage unavailable */ } };

/** First launch: one light screen to confirm where projects live, then straight into the app. */
function Setup(props: { roots: string[]; onChange: (roots: string[]) => void; onDone: () => void }) {
  async function add() {
    const p = await open({ directory: true, multiple: true });
    const picked = Array.isArray(p) ? p : typeof p === "string" ? [p] : [];
    if (picked.length) props.onChange([...new Set([...props.roots, ...picked])]);
  }
  const point = (t: string) => <li className="flex items-center gap-2"><Icon name="check" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />{t}</li>;
  return (
    <div className="flex h-screen items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-md">
        <img src="/icon.svg" alt="" className="h-10 w-10" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Dev Cleaner</h1>
        <p className="muted mt-1 text-[15px]">Reclaim space from your development projects.</p>
        <div className="mt-6 text-[13px] font-medium">Where do your projects live?</div>
        <ul className="mt-2 overflow-hidden rounded-[10px] border bg-white divider dark:bg-slate-900">
          {props.roots.map((r) => (
            <li key={r} className="flex items-center gap-2 border-b px-3 py-2 divider">
              <Icon name="folder" className="h-4 w-4 text-slate-400" /><span className="mono min-w-0 flex-1 truncate text-xs" title={r}>{r}</span>
              <button className="btn btn-ghost btn-sm" aria-label={`Remove ${r}`} onClick={() => props.onChange(props.roots.filter((x) => x !== r))}><Icon name="x" /></button>
            </li>
          ))}
          <li><button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-indigo-600 hover:bg-slate-50 dark:text-indigo-300 dark:hover:bg-slate-800/50" onClick={add}><Icon name="plus" className="h-4 w-4" />{props.roots.length ? "Add another folder" : "Add a folder"}</button></li>
        </ul>
        <ul className="mt-5 space-y-1.5 text-[13px]">
          {point("Source code is never selected")}
          {point("Nothing is deleted automatically")}
          {point("Removed folders can go to Trash")}
        </ul>
        <button className="btn btn-primary mt-6 w-full py-2" onClick={props.onDone} disabled={!props.roots.length}>Get started</button>
        <button className="btn btn-ghost mt-1 w-full" onClick={props.onDone}>Skip for now</button>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("clean");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [disk, setDisk] = useState<[number, number] | null>(null);
  const [onboarded, setOnboarded] = useState(wasOnboarded);
  const [palette, setPalette] = useState(false);
  const [section, setSection] = useState<SectionId | null>(null);
  const [toast, setToast] = useState<{ tone: "info" | "error"; text: ReactNode } | null>(null);
  const saveTimer = useRef<number>(0);
  const scan = useScan();
  const globalScan = useGlobalScan();
  const launched = useRef(false);
  const refreshDisk = useCallback(() => { api.diskSpace().then(setDisk).catch(() => {}); }, []);
  const [lastClean, setLastClean] = useState<number | null>(null);
  const refreshLast = useCallback(() => {
    api.getHistory().then((h) => setLastClean(h.filter((e) => e.result === "removed").reduce<number | null>((m, e) => Math.max(m ?? 0, e.timestamp), null))).catch(() => {});
  }, []);
  useEffect(() => { refreshLast(); }, [refreshLast]);

  useEffect(() => { api.getSettings().then(setSettings); refreshDisk(); }, [refreshDisk]);
  useEffect(() => {
    if (settings && !launched.current) {
      launched.current = true;
      if (settings.scan_on_launch && settings.scan_roots.length && wasOnboarded()) { scan.start(); globalScan.start(); }
    }
  }, [settings, scan, globalScan]);
  useEffect(() => { if (scan.status === "done" || globalScan.status === "done") refreshDisk(); }, [scan.status, globalScan.status, refreshDisk]);
  useEffect(() => {
    const subs = [
      listen("trash-changed", () => { refreshDisk(); setToast({ tone: "info", text: "Trash auto-clear removed folders whose time was up." }); }),
      listen<RunSummary>("schedule-done", (e) => {
        const r = e.payload;
        if (r.error) setToast({ tone: "error", text: `Scheduled check could not finish. ${r.error}` });
        else if (r.action === "clean" && r.removed) { refreshDisk(); setToast({ tone: "info", text: `Scheduled cleanup ${r.dry_run ? "would move" : "moved"} ${r.removed} folder${r.removed === 1 ? "" : "s"} to Trash (${fmtBytes(r.removed_bytes)}).` }); }
        else if (r.matched) setToast({ tone: "info", text: <>Scheduled check: {r.matched} folder{r.matched === 1 ? "" : "s"} ({fmtBytes(r.matched_bytes)}) can be cleaned. <button className="font-medium text-indigo-600 underline dark:text-indigo-300" onClick={() => setTab("clean")}>Review</button></> });
      }),
    ];
    return () => { subs.forEach((u) => u.then((f) => f()).catch(() => {})); };
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
    refreshLast();
  }, [scan, refreshDisk, refreshLast]);

  const goScan = useCallback((t: Tab) => { setTab(t); emitCmd("scan"); }, []);
  const toggleTheme = () => settings && updateSettings({ ...settings, theme: document.documentElement.classList.contains("dark") ? "light" : "dark" });

  const commands: PaletteCommand[] = useMemo(() => !settings ? [] : [
    { id: "search", label: "Search projects and folders", hint: "Ctrl/Cmd+K", icon: "search", run: () => { setTab("projects"); emitCmd("focus-search"); } },
    { id: "scan-all", label: "Scan everything", hint: "Ctrl/Cmd+R", icon: "refresh", run: () => goScan("clean") },
    { id: "scan-projects", label: "Scan projects", icon: "folder", run: () => goScan("projects") },
    { id: "scan-tools", label: "Scan tools & SDKs", icon: "database", run: () => goScan("global") },
    { id: "map", label: "Open storage map", icon: "map", run: () => { setTab("projects"); setTimeout(() => emitCmd("storage-map"), 0); } },
    { id: "activity", label: "Open Activity (Trash and History)", icon: "clock", run: () => setTab("activity") },
    { id: "deps", label: "Open dependency map", icon: "layers", run: () => { setTab("global"); setTimeout(() => emitCmd("dependency-map"), 0); } },
    { id: "advanced", label: settings.show_advanced ? "Hide advanced tools" : "Show advanced tools", icon: "sliders", run: () => updateSettings({ ...settings, show_advanced: !settings.show_advanced }) },
    { id: "settings", label: "Open Settings", hint: "Ctrl/Cmd+,", icon: "sliders", run: () => { setSection(null); setTab("settings"); } },
    { id: "rules", label: "Cleanup rules", icon: "layers", run: () => { setSection("rules"); setTab("settings"); } },
    { id: "theme", label: "Toggle dark mode", icon: "eye", run: toggleTheme },
    { id: "dry", label: settings.dry_run ? "Turn dry run off" : "Turn dry run on", icon: "shield", run: () => updateSettings({ ...settings, dry_run: !settings.dry_run }) },
    { id: "about", label: "About Dev Cleaner", icon: "info", run: () => { setSection("about"); setTab("settings"); } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [settings, goScan, updateSettings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = (e.target as HTMLElement | null)?.matches?.("input, textarea, select, [contenteditable]");
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(false); setTab("projects"); emitCmd("focus-search"); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "p") { e.preventDefault(); setPalette((p) => !p); }
      else if (mod && e.key === ",") { e.preventDefault(); setSection(null); setTab("settings"); }
      else if (mod && e.key.toLowerCase() === "r") { e.preventDefault(); if (tab === "clean" || tab === "projects" || tab === "global") emitCmd("scan"); }
      else if (mod && e.key.toLowerCase() === "a" && !typing) { if (tab === "projects" || tab === "global") { e.preventDefault(); emitCmd("select-all"); } }
      else if (mod && e.key.toLowerCase() === "f") { if (tab === "projects") { e.preventDefault(); emitCmd("focus-search"); } }
      else if (e.key === "/" && !typing && tab === "projects") { e.preventDefault(); emitCmd("focus-search"); }
      else if (e.key === "Escape" && !palette) emitCmd("escape");
      else if (e.key === "Delete" && !typing && !document.querySelector('[role="dialog"]')) emitCmd("delete");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, palette]);

  if (!settings) return <div className="flex h-screen items-center justify-center"><Spinner className="h-6 w-6" /></div>;

  if (!onboarded) {
    return <Setup roots={settings.scan_roots} onChange={(r) => updateSettings({ ...settings, scan_roots: r })}
      onDone={() => { markOnboarded(); setOnboarded(true); if (settings.scan_roots.length) setTimeout(() => emitCmd("scan"), 0); }} />;
  }

  const advanced = settings.show_advanced;
  const groups = navGroups(advanced);
  const navClass = (on: boolean) => `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 ${on ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`;
  const navButton = (t: NavTab) => (
    <button key={t.id} onClick={() => { if (t.id === "settings") setSection(null); setTab(t.id); }} aria-current={tab === t.id ? "page" : undefined} className={navClass(tab === t.id)}>
      <Icon name={t.icon} className="h-4 w-4" />{t.label}
      {busy(t.id) && <span className="ml-auto flex items-center" title="Scanning…" aria-label="Scanning"><Spinner className="h-3.5 w-3.5" /></span>}
    </button>
  );
  const MORE: { label: string; hint: string; icon: IconName; run: () => void }[] = [
    { label: "Projects", hint: "Every folder found, with filters", icon: "folder", run: () => setTab("projects") },
    { label: "Tools & SDKs", hint: "Caches and SDKs by ecosystem", icon: "database", run: () => setTab("global") },
    { label: "Storage map", hint: "What takes the most space", icon: "map", run: () => { setTab("projects"); setTimeout(() => emitCmd("storage-map"), 0); } },
    { label: "Dependency map", hint: "Which projects use which SDK versions", icon: "layers", run: () => { setTab("global"); setTimeout(() => emitCmd("dependency-map"), 0); } },
    { label: "Cleanup rules", hint: "Turn rules on or off, add your own", icon: "sliders", run: () => { setSection("rules"); setTab("settings"); } },
  ];
  const busy = (id: Tab) => (id === "clean" && (scan.status === "scanning" || globalScan.status === "scanning")) || (id === "projects" && scan.status === "scanning") || (id === "global" && globalScan.status === "scanning");
  const usedFrac = disk ? 1 - disk[1] / disk[0] : 0;
  const openSettings = () => { setSection(null); setTab("settings"); };
  return (
    <div className="flex h-screen">
      <nav aria-label="Main" className="flex w-[232px] shrink-0 flex-col border-r bg-white px-3 py-4 divider dark:bg-slate-900">
        <div className="mb-5 flex items-center gap-2.5 px-2">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <div className="text-[15px] font-semibold leading-tight tracking-tight">Dev Cleaner</div>
        </div>
        <div className="flex-1 space-y-4 overflow-auto">
          {groups.map((g, gi) => (
            <div key={g.label ?? gi}>
              {g.label && <div className="muted mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider">{g.label}</div>}
              {g.tabs.map(navButton)}
            </div>
          ))}
          {!advanced && (
            <div>
              {/* An advanced page opened from More stays in the sidebar while it is open. */}
              {[PROJECTS, TOOLS].filter((t) => t.id === tab).map(navButton)}
              <Popover label="More" icon="more" width="w-64" triggerClass={`${navClass(false)} [&>svg]:h-4 [&>svg]:w-4`}>
                {(close) => (
                  <div className="-m-2 text-[13px]">
                    {MORE.map((m) => (
                      <button key={m.label} className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700/60" onClick={() => { close(); m.run(); }}>
                        <Icon name={m.icon} className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                        <span><span className="block font-medium">{m.label}</span><span className="muted block text-xs">{m.hint}</span></span>
                      </button>
                    ))}
                    <div className="mt-1 border-t px-2 pb-1 pt-2 text-xs divider">
                      <button className="font-medium text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => { close(); updateSettings({ ...settings, show_advanced: true }); }}>Show advanced tools</button>
                      <span className="muted"> keeps these in the sidebar.</span>
                    </div>
                  </div>
                )}
              </Popover>
            </div>
          )}
        </div>
        <div className="space-y-3 px-1 pt-3 text-xs">
          {settings.dry_run && (
            <button onClick={() => { setSection("cleaning"); setTab("settings"); }} className="flex w-full items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-left text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" title="Change in Settings, Cleaning">
              <Icon name="shield" className="mt-0.5 h-3.5 w-3.5" /><span><b className="font-semibold">Dry run</b><br />Nothing will be deleted</span>
            </button>
          )}
          {lastClean && (
            <button className="muted flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:text-slate-900 dark:hover:text-white" onClick={() => setTab("activity")} title="Open Activity">
              <Icon name="clock" className="h-3.5 w-3.5" />Last cleaned {fmtAge(lastClean)}
            </button>
          )}
          {disk && (
            <div className="px-1" title={`${fmtBytes(disk[0] - disk[1])} used`}>
              <div className="mb-1 flex justify-between"><span className="muted">Storage</span><span className="tabular-nums">{fmtBytes(disk[1])} free</span></div>
              <div className="h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="meter" aria-label="Disk used" aria-valuenow={Math.round(usedFrac * 100)} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full ${usedFrac > 0.9 ? "bg-red-500" : "bg-slate-500 dark:bg-slate-400"}`} style={{ width: `${Math.round(usedFrac * 100)}%` }} /></div>
              <div className="muted mt-1">of {fmtBytes(disk[0])}</div>
            </div>
          )}
          <button className="muted flex w-full items-center gap-1.5 rounded px-1 py-0.5 hover:text-slate-900 dark:hover:text-white" onClick={() => setPalette(true)} title="Command palette (Ctrl/Cmd+Shift+P)"><Icon name="command" className="h-3.5 w-3.5" />Commands</button>
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-hidden px-6 py-5">
        {tab === "clean" && <CleanView scan={scan} globalScan={globalScan} settings={settings} onOpenSettings={openSettings} onDeleted={onDeleted} />}
        {tab === "projects" && <Projects scan={scan} settings={settings} onChangeSettings={updateSettings} onOpenSettings={openSettings} onDeleted={onDeleted} />}
        {tab === "global" && <GlobalView scan={globalScan} settings={settings} onOpenSettings={openSettings} onDeleted={onDeleted} />}
        {tab === "activity" && <ActivityView settings={settings} onOpenSettings={() => { setSection(advanced ? "trash" : null); setTab("settings"); }} onChanged={() => { refreshDisk(); refreshLast(); }} />}
        {tab === "settings" && <SettingsView settings={settings} onChange={updateSettings} section={section} onSection={setSection} />}
      </main>
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.text}</Toast>}
    </div>
  );
}
