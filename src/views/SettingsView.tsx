import { Fragment, useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, CONFIDENCE_LABEL, COST_LABEL, fmtAge, fmtBytes, fmtDuration, fmtUntil, RISK_LABEL, type Confidence, type Diagnostics, type Risk, type Rule, type RuleTestResult, type ScheduleStatus, type Settings } from "../api";
import { Icon, type IconName } from "../ui/Icon";
import { Badge, Disclosure, PageHeader, Segmented, Spinner, Toggle } from "../ui/primitives";

function Group(props: { children: ReactNode }) {
  return <section className="card space-y-5 p-5">{props.children}</section>;
}

function Field(props: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0"><div className="text-sm font-medium">{props.label}</div><div className="muted text-xs">{props.hint}</div></div>
      <div className="shrink-0">{props.children}</div>
    </div>
  );
}

function PathList(props: { title: string; hint: string; values: string[]; onChange: (v: string[]) => void; pick?: boolean; placeholder: string }) {
  const [text, setText] = useState("");
  const add = (v: string) => { const t = v.trim(); if (t && !props.values.includes(t)) props.onChange([...props.values, t]); setText(""); };
  return (
    <div>
      <div className="text-sm font-medium">{props.title}</div>
      <p className="muted mb-2 text-xs">{props.hint}</p>
      {props.values.length === 0 && <div className="muted mb-2 rounded-lg border border-dashed px-3 py-2 text-xs divider">Nothing added yet.</div>}
      <ul className="mb-2 space-y-1">
        {props.values.map((v) => (
          <li key={v} className="flex items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm dark:bg-slate-800">
            <span className="break-all font-mono text-xs">{v}</span>
            <button className="btn btn-ghost btn-sm" aria-label={`Remove ${v}`} onClick={() => props.onChange(props.values.filter((x) => x !== v))}><Icon name="x" /></button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className="input flex-1" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add(text)} placeholder={props.placeholder} />
        <button className="btn" onClick={() => add(text)}><Icon name="plus" />Add</button>
        {props.pick && <button className="btn" onClick={async () => { const p = await open({ directory: true, multiple: false }); if (typeof p === "string") add(p); }}><Icon name="folder-plus" />Browse</button>}
      </div>
    </div>
  );
}

const RETENTION_PRESETS = [0, 7, 14, 30, 90];

function Num(props: { value: number; min: number; max?: number; suffix: string; onChange: (n: number) => void }) {
  return <div className="flex items-center gap-2"><input className="input w-20 text-right" type="number" min={props.min} max={props.max} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} /><span className="muted text-sm">{props.suffix}</span></div>;
}

export type SectionId = "appearance" | "cleaning" | "safety" | "scanning" | "protection" | "rules" | "trash" | "about";

const META: Record<SectionId, { title: string; icon: IconName; description: string }> = {
  appearance: { title: "Appearance", icon: "eye", description: "Theme and what the lists show." },
  cleaning: { title: "Cleaning", icon: "sliders", description: "What happens when you reclaim space, recommendations and scheduled cleanup." },
  safety: { title: "Safety", icon: "shield", description: "How Dev Cleaner keeps important files out of reach." },
  scanning: { title: "Scanning", icon: "search", description: "Where and how deep to look." },
  protection: { title: "Protection", icon: "lock", description: "Folders that can be scanned but never selected." },
  rules: { title: "Rules", icon: "layers", description: "Which generated folders are cleanup candidates." },
  trash: { title: "Trash", icon: "trash", description: "When removed folders are cleared for good." },
  about: { title: "About", icon: "info", description: "Version, your data and diagnostics." },
};
const ORDER: SectionId[] = ["appearance", "cleaning", "safety", "scanning", "protection", "rules", "trash", "about"];

const PROTECTS = [
  ["Only deleting paths returned by a scan.", "Each one is checked again right before it is removed; if it moved, changed or became a link, it is skipped."],
  ["Never selecting source files.", "A folder is offered only when it matches a rule and its project file sits next to it."],
  ["Protecting configured paths.", "Anything inside a protected path is listed but cannot be selected."],
  ["Using Trash by default.", "Removed folders can be restored until they are cleared."],
  ["Warning about risky folders.", "Folders Git tracks, signing keys, system and personal folders are blocked; links and mount points are never followed."],
  ["Requiring extra confirmation for dangerous items.", "Even with confirmations off. Permanent deletion of data that cannot be recreated asks you to type DELETE."],
];

const CONFIDENCE_OPTIONS: Confidence[] = ["medium", "high", "very_high"];

function DiagnosticsPanel() {
  const [d, setD] = useState<Diagnostics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.getDiagnostics().then(setD, (e) => setErr(String(e))); }, []);
  if (err) return <Group><p className="text-sm text-red-600">{err}</p></Group>;
  if (!d) return <Group><p className="muted text-sm">Loading…</p></Group>;
  const row = (k: string, v: ReactNode) => <Fragment key={k}><dt className="muted">{k}</dt><dd className="break-all">{v}</dd></Fragment>;
  const scanBlock = (title: string, sc: Diagnostics["project_scan"]) => (
    <Group>
      <div className="font-medium">{title}</div>
      {!sc ? <p className="muted text-xs">No scan yet in this session.</p> : (
        <dl className="grid grid-cols-[11rem_1fr] gap-y-1 text-xs">
          {row("Scan id", <code>{sc.scan_id}</code>)}
          {row("Finished", sc.completed_at ? new Date(sc.completed_at * 1000).toLocaleString() : "running")}
          {row("Complete", sc.complete ? "Yes" : sc.cancelled ? "No, stopped" : "No")}
          {row("Found", sc.found.toLocaleString())}
          {row("Folders / files visited", `${sc.dirs_visited.toLocaleString()} / ${sc.files_visited.toLocaleString()}`)}
          {row("Time", `${fmtDuration(sc.elapsed_ms)} (finding ${fmtDuration(sc.discovery_ms)}, measuring ${fmtDuration(sc.measure_ms)})`)}
          {row("Data examined", fmtBytes(sc.bytes_examined))}
          {row("Unreadable entries", sc.measure_errors.toLocaleString())}
          {row("Rules", `${sc.rules_active} active, rules version ${sc.rules_version}`)}
          {sc.missing_roots.length > 0 && row("Missing folders", sc.missing_roots.join(", "))}
          {sc.skipped.map((k) => row(`Skipped: ${k.reason}`, <span title={k.examples.join("\n")}>{k.count.toLocaleString()}</span>))}
        </dl>
      )}
    </Group>
  );
  return (
    <>
      {scanBlock("Last project scan", d.project_scan)}
      {scanBlock("Last tools & SDKs scan", d.global_scan)}
      <Group>
        <div className="font-medium">Rules</div>
        <dl className="grid grid-cols-[11rem_1fr] gap-y-1 text-xs">
          {row("Active", `${d.rules_enabled} of ${d.rules_total} (${d.custom_rules} custom)`)}
          {row("Turned off", d.rules_disabled.join(", ") || "none")}
          {row("Scan folders", d.scan_roots.join(", ") || "none")}
          {row("Skipped names", d.exclude_names.join(", ") || "none")}
          {row("Protected", d.protected_paths.join(", ") || "none")}
          {row("Data folder", <code>{d.data_folder}</code>)}
        </dl>
      </Group>
      <Group>
        <div className="font-medium">Recent cleanups</div>
        {!d.recent_operations.length ? <p className="muted text-xs">None yet.</p> : (
          <ul className="space-y-1 text-xs">
            {[...d.recent_operations].reverse().map((o) => (
              <li key={o.timestamp} className="flex justify-between gap-3">
                <span>{new Date(o.timestamp * 1000).toLocaleString()}{o.report.dry_run ? " (dry run)" : ""}</span>
                <span className="muted">{o.report.removed} removed · {o.report.failed} failed · {o.report.blocked} blocked · {fmtBytes(o.report.estimated_bytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </>
  );
}

const REPO_URL = "https://github.com/TheHaseebAbbas/dev-cleaner-app";

function Sub(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Group>
      <div><div className="font-semibold">{props.title}</div>{props.hint && <p className="muted text-xs">{props.hint}</p>}</div>
      {props.children}
    </Group>
  );
}

function ScheduleSection({ s, set }: { s: Settings; set: <K extends keyof Settings>(k: K, v: Settings[K]) => void }) {
  const [st, setSt] = useState<ScheduleStatus | null>(null);
  const [running, setRunning] = useState(false);
  const refresh = () => api.getScheduleStatus().then(setSt).catch(() => {});
  useEffect(() => { refresh(); }, [s.schedule]);
  const sc = s.schedule;
  const put = (patch: Partial<Settings["schedule"]>) => set("schedule", { ...sc, ...patch });
  const last = st?.last_result;
  return (
    <Sub title="Scheduled cleanup" hint="Off by default. Runs only while Dev Cleaner is open.">
      <Toggle checked={sc.enabled} onChange={(v) => put({ enabled: v })} label="Check my projects regularly" description="Scans your project folders on a schedule and tells you what can be cleaned." />
      {sc.enabled && (
        <>
          <Field label="How often" hint="Counted from the last run.">
            <Segmented value={String(sc.every_days)} onChange={(v) => put({ every_days: Number(v) })} options={[{ value: "1", label: "Daily" }, { value: "7", label: "Weekly" }, { value: "14", label: "Every 2 weeks" }, { value: "30", label: "Monthly" }]} />
          </Field>
          <Field label="What to look for" hint="Safe: build output and caches that rebuild without downloads. Recommended: everything marked Recommended.">
            <Segmented value={sc.profile} onChange={(v) => put({ profile: v })} options={[{ value: "safe", label: "Safe" }, { value: "recommended", label: "Recommended" }]} />
          </Field>
          <Field label="Then" hint="Moving to Trash never deletes permanently and skips anything with a warning, in use, protected or needing confirmation.">
            <Segmented value={sc.action} onChange={(v) => put({ action: v })} options={[{ value: "remind", label: "Just tell me" }, { value: "clean", label: "Move to Trash" }]} />
          </Field>
        </>
      )}
      <div className="flex items-center justify-between gap-3 border-t pt-3 text-xs divider">
        <span className="muted">
          {last ? <>Last run {fmtAge(last.timestamp)}: {last.error ? last.error : last.action === "clean" ? `${last.removed} moved to Trash (${fmtBytes(last.removed_bytes)})${last.dry_run ? ", dry run" : ""}` : `${last.matched} could be cleaned (${fmtBytes(last.matched_bytes)})`}.</> : "Never run."}
          {sc.enabled && st?.next_run ? ` Next run ${fmtUntil(st.next_run)}.` : ""}
        </span>
        <button className="btn btn-sm" disabled={running} onClick={async () => { setRunning(true); try { await api.runScheduleNow(); } catch { /* a scan is running */ } finally { setRunning(false); setTimeout(refresh, 1500); } }}>{running ? <Spinner className="h-3 w-3" /> : <Icon name="refresh" className="h-3 w-3" />}Run now</button>
      </div>
    </Sub>
  );
}

function RuleTest({ result, busy }: { result: RuleTestResult | null; busy: boolean }) {
  if (busy) return <div className="muted flex items-center gap-2 text-xs"><Spinner className="h-3.5 w-3.5" />Looking through your scan folders…</div>;
  if (!result) return null;
  const claimed = result.matches - result.effective;
  return (
    <div className="rounded-lg border p-3 text-xs divider" role="status">
      <div className="text-[13px] font-medium">
        {result.matches === 0 ? "No folders match this rule in your scan folders." : `Matches ${result.effective} folder${result.effective === 1 ? "" : "s"} · ${fmtBytes(result.total_bytes)}${result.partial_size ? "+" : ""}`}
      </div>
      <div className="muted">Checked {result.dirs_visited.toLocaleString()} folders in {fmtDuration(result.elapsed_ms)}.{claimed > 0 ? ` ${claimed} more ${claimed === 1 ? "is" : "are"} already covered by another rule.` : ""} Nothing was selected or removed.</div>
      {result.samples.length > 0 && (
        <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
          {result.samples.map((m) => (
            <li key={m.path} className="flex justify-between gap-3">
              <span className="min-w-0"><span className="mono break-all">{m.path}</span>{(m.claimed_by || m.blocked) && <span className="muted block">{m.claimed_by ? `Covered by ${m.claimed_by}` : m.blocked}</span>}</span>
              <span className="shrink-0 tabular-nums">{fmtBytes(m.disk_bytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AboutSection() {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(REPO_URL).then(() => setCopied(true), () => {}); };
  return (
    <>
      <Group>
        <div className="flex items-center gap-4">
          <img src="/icon.svg" alt="" className="h-12 w-12" />
          <div>
            <div className="text-lg font-semibold tracking-tight">Dev Cleaner</div>
            <div className="muted text-[13px]">Version {__APP_VERSION__} · Windows, macOS and Linux</div>
          </div>
        </div>
        <p className="text-[13px]">Finds the files developer tools leave behind, such as <code>node_modules</code>, build output, package caches, SDK downloads and simulators, explains them, and helps you remove them safely. Works offline, with no account and no telemetry.</p>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-[13px]">
          <dt className="muted">Built with</dt><dd>Tauri 2, Rust, React and TypeScript</dd>
          <dt className="muted">Your data</dt><dd>Settings, history and logs stay in the app's config folder on this computer</dd>
          <dt className="muted">Shortcuts</dt><dd>Ctrl/Cmd+K search · Ctrl/Cmd+Shift+P commands · Ctrl/Cmd+, settings</dd>
          <dt className="muted">License</dt><dd>GNU GPL v3.0</dd>
          <dt className="muted">Source</dt>
          <dd className="flex min-w-0 items-center gap-2"><span className="mono truncate text-xs">{REPO_URL}</span><button className="btn btn-sm shrink-0" onClick={copy}>{copied ? "Copied" : "Copy link"}</button></dd>
        </dl>
      </Group>
      <Disclosure title="Diagnostics: what the last scans and cleanups did">
        <div className="space-y-4"><DiagnosticsPanel /></div>
      </Disclosure>
    </>
  );
}

export function SettingsView(props: { settings: Settings; onChange: (s: Settings) => void; section?: SectionId | null; onSection?: (s: SectionId | null) => void }) {
  const s = props.settings;
  const [own, setOwn] = useState<SectionId | null>(null);
  const section = props.section !== undefined ? props.section : own;
  const setSection = props.onSection ?? setOwn;
  const [rules, setRules] = useState<Rule[]>([]);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<{ name: string; dirs: string; markers: string; description: string; risk: Risk }>({ name: "", dirs: "", markers: "", description: "", risk: "caution" });
  const [details, setDetails] = useState<Set<string>>(new Set());
  const [test, setTest] = useState<{ key: string; busy: boolean; result: RuleTestResult | null; error?: string } | null>(null);
  useEffect(() => { api.listRules().then(setRules); }, [s.custom_rules, s.rule_enabled]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => props.onChange({ ...s, [k]: v });
  const split = (t: string) => t.split(",").map((x) => x.trim()).filter(Boolean);

  const draftRule = (): Rule | null => {
    const dirs = split(draft.dirs);
    if (!draft.name.trim() || !dirs.length) return null;
    return {
      id: `custom-${Date.now()}`, name: draft.name.trim(), ecosystem: "Custom", dir_names: dirs,
      parent_markers: split(draft.markers), self_markers: [],
      regenerates_with: "user-defined", description: draft.description.trim() || "Custom rule you added.", split: false, risk: draft.risk, enabled: true, custom: true, confirmed: false,
    };
  };
  async function runTest(key: string, rule: Rule | null) {
    if (!rule) return;
    setTest({ key, busy: true, result: null });
    try { setTest({ key, busy: false, result: await api.testRule(rule) }); }
    catch (e) { setTest({ key, busy: false, result: null, error: String(e) }); }
  }
  function addCustom() {
    const rule = draftRule();
    if (!rule) return;
    set("custom_rules", [...s.custom_rules, rule]);
    setDraft({ name: "", dirs: "", markers: "", description: "", risk: "caution" });
    setTest(null);
  }

  const activeRules = rules.filter((r) => r.enabled).length;
  const summary: Record<SectionId, string> = {
    appearance: `${s.theme === "system" ? "System" : s.theme === "dark" ? "Dark" : "Light"} theme`,
    cleaning: `${s.dry_run ? "Dry run · " : ""}${s.delete_mode === "trash" ? "Move to Trash" : "Delete permanently"}${s.schedule.enabled ? " · scheduled" : ""}`,
    safety: s.confirm_before_delete ? "Ask before removing" : "Asks only for risky items",
    scanning: `${s.scan_roots.length} folder${s.scan_roots.length === 1 ? "" : "s"} · depth ${s.max_depth}`,
    protection: `${s.protected_paths.length} protected path${s.protected_paths.length === 1 ? "" : "s"}`,
    rules: `${activeRules} active · ${s.custom_rules.length} custom`,
    trash: s.trash_retention_days > 0 ? `Automatic cleanup after ${s.trash_retention_days} days` : "Never cleared automatically",
    about: `Version ${__APP_VERSION__}`,
  };

  if (section === null) {
    return (
      <div className="h-full overflow-auto pb-6">
        <PageHeader title="Settings" subtitle="Changes are saved automatically." />
        <div className="max-w-3xl overflow-hidden rounded-[10px] border bg-white divider dark:bg-slate-900">
          {ORDER.map((id) => (
            <button key={id} onClick={() => setSection(id)} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left outline-none last:border-0 divider transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-800/50">
              <Icon name={META[id].icon} className="h-[18px] w-[18px] text-slate-500 dark:text-slate-400" />
              <div className="min-w-0 flex-1"><div className="font-medium">{META[id].title}</div><div className="muted truncate text-[13px]">{summary[id]}</div></div>
              <Icon name="chevron-right" className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const meta = META[section];
  const shown = rules.filter((r) => !filter || `${r.name} ${r.ecosystem} ${r.dir_names.join(" ")}`.toLowerCase().includes(filter.toLowerCase()));
  const byEco = new Map<string, Rule[]>();
  for (const r of shown) byEco.set(r.ecosystem, [...(byEco.get(r.ecosystem) ?? []), r]);
  const flipDetail = (id: string) => setDetails((d) => { const n = new Set(d); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="h-full overflow-auto pb-6">
      <button className="btn btn-ghost btn-sm -ml-2 mb-2" onClick={() => setSection(null)}><Icon name="chevron-left" className="h-4 w-4" />Settings</button>
      <PageHeader title={meta.title} subtitle={meta.description} />
      <div className="max-w-3xl space-y-4">
        {section === "appearance" && (
          <Group>
            <Field label="Theme" hint="System follows your operating system.">
              <Segmented value={s.theme} onChange={(v) => set("theme", v)} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
            </Field>
            <Toggle checked={s.show_reclaim_estimate} onChange={(v) => set("show_reclaim_estimate", v)} label="Show estimated reclaimable space" description="Counts what really comes back: files hard-linked from elsewhere stay on disk. Off shows the plain size on disk." />
            <Toggle checked={s.show_network_recovery_cost} onChange={(v) => set("show_network_recovery_cost", v)} label="Show download cost" description="Say how much may have to be downloaded again to get a folder back." />
          </Group>
        )}

        {section === "cleaning" && (
          <>
            <Group>
              <Field label="When removing" hint="Trash lets you put things back. Permanent frees the space at once.">
                <Segmented value={s.delete_mode} onChange={(v) => set("delete_mode", v)} options={[{ value: "trash", label: "Move to Trash" }, { value: "permanent", label: "Delete permanently" }]} />
              </Field>
              <Toggle checked={s.dry_run} onChange={(v) => set("dry_run", v)} label="Dry run" description="Pretend to clean and report what would be freed. Nothing is touched." />
              <Toggle checked={s.confirm_before_delete} onChange={(v) => set("confirm_before_delete", v)} label="Ask before removing" description="Show a summary first. Risky items, permanent deletion and programs in use always ask." />
            </Group>
            <Sub title="Recommendations" hint="How Dev Cleaner suggests what to remove. Takes effect on the next scan.">
              <Toggle checked={s.recommendations_enabled} onChange={(v) => set("recommendations_enabled", v)} label="Show recommendations" description="Mark each folder Recommended, Review or Keep, with the reasons, and offer Quick select." />
              <Field label="Quick select default" hint="Safe picks build output and caches that rebuild without downloads. Deep also picks Review items, never Keep.">
                <Segmented value={s.default_cleanup_profile} onChange={(v) => set("default_cleanup_profile", v)} options={[{ value: "safe", label: "Safe" }, { value: "recommended", label: "Recommended" }, { value: "deep", label: "Deep" }]} />
              </Field>
              <Field label="Minimum confidence" hint="Only detections at least this certain are marked Recommended.">
                <Segmented value={s.minimum_recommendation_confidence} onChange={(v) => set("minimum_recommendation_confidence", v)} options={CONFIDENCE_OPTIONS.map((c) => ({ value: c, label: CONFIDENCE_LABEL[c] }))} />
              </Field>
              <Field label="Project activity" hint="Fast looks at a project's top-level files. Accurate finds the newest file anywhere in it, which takes longer.">
                <Segmented value={s.activity_mode} onChange={(v) => set("activity_mode", v)} options={[{ value: "fast", label: "Fast" }, { value: "accurate", label: "Accurate" }]} />
              </Field>
            </Sub>
            <ScheduleSection s={s} set={set} />
          </>
        )}

        {section === "safety" && (
          <>
            <Group>
              <div className="font-semibold">Dev Cleaner protects you by</div>
              <ul className="space-y-2.5">
                {PROTECTS.map(([t, b]) => (
                  <li key={t} className="flex gap-2.5 text-[13px]">
                    <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span><span className="font-medium">{t}</span> <span className="muted">{b}</span></span>
                  </li>
                ))}
              </ul>
              <p className="muted text-xs">These are always on.</p>
            </Group>
            <Group>
              <Toggle checked={s.detect_active_usage} onChange={(v) => set("detect_active_usage", v)} label="Check for programs using a folder" description="Before recommending or removing a folder, look for running programs (dev servers, Gradle daemons, emulators) that use it, and for locked files on Windows. When this cannot be checked, Dev Cleaner says so rather than calling it unused." />
              <Toggle checked={s.protect_git_tracked} onChange={(v) => set("protect_git_tracked", v)} label="Block folders Git tracks" description="Recommended. Off shows a red warning instead and asks for confirmation." />
              <Toggle checked={s.detect_sensitive_files} onChange={(v) => set("detect_sensitive_files", v)} label="Look for keys and secrets" description="Checks file names (never contents). Signing keys block a folder; .env files and certificates add a warning." />
              <Field label="Warn when a scan is older than" hint="Cleaning an old scan still checks each item again first."><Num value={s.stale_scan_minutes} min={1} max={1440} suffix="minutes" onChange={(n) => set("stale_scan_minutes", Math.max(1, Math.round(n)))} /></Field>
              <Toggle checked={s.require_rescan_before_cleanup} onChange={(v) => set("require_rescan_before_cleanup", v)} label="Require a fresh scan" description="Turn cleaning off until you scan again once the scan is older than the time above." />
            </Group>
          </>
        )}

        {section === "scanning" && (
          <Group>
            <PathList title="Scan folders" hint="Folders that contain your projects. Only these are searched." values={s.scan_roots} onChange={(v) => set("scan_roots", v)} pick placeholder="C:\development or ~/code" />
            <Field label="Search depth" hint="How many levels below a scan folder to look. Deeper finds more but takes longer."><Num value={s.max_depth} min={1} max={30} suffix="levels" onChange={(n) => set("max_depth", n)} /></Field>
            <Field label="Minimum size" hint="Hide folders smaller than this. Can be changed in Filters too."><Num value={s.min_size_mb} min={0} suffix="MB" onChange={(n) => set("min_size_mb", n)} /></Field>
            <Field label="Minimum idle time" hint="Hide projects used more recently than this."><Num value={s.min_age_days} min={0} suffix="days" onChange={(n) => set("min_age_days", n)} /></Field>
            <Toggle checked={s.scan_on_launch} onChange={(v) => set("scan_on_launch", v)} label="Scan when the app opens" description="Off by default so the app opens instantly." />
            <Disclosure title="Skipped folder names">
              <PathList title="" hint="Never entered while scanning, wherever they appear." values={s.exclude_names} onChange={(v) => set("exclude_names", v)} placeholder="folder name, e.g. archive" />
            </Disclosure>
          </Group>
        )}

        {section === "protection" && (
          <Group>
            <PathList title="Protected paths" hint="These folders can be scanned but never selected. Use it for projects you work on daily." values={s.protected_paths} onChange={(v) => set("protected_paths", v)} pick placeholder="path to protect" />
          </Group>
        )}

        {section === "about" && <AboutSection />}

        {section === "trash" && (
          <Group>
            <Field label="Clear automatically after" hint="Folders Dev Cleaner moved to the Trash are deleted for good after this many days. You can keep single folders longer from the Trash screen.">
              <div className="flex flex-col items-end gap-2">
                <Segmented value={String(RETENTION_PRESETS.includes(s.trash_retention_days) ? s.trash_retention_days : "custom")} onChange={(v) => v !== "custom" && set("trash_retention_days", Number(v))}
                  options={[{ value: "0", label: "Never" }, { value: "7", label: "7 days" }, { value: "14", label: "14 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "custom", label: "Custom" }]} />
                <Num value={s.trash_retention_days} min={0} max={3650} suffix="days (0 = never)" onChange={(n) => set("trash_retention_days", Math.max(0, Math.round(n)))} />
              </div>
            </Field>
            <p className="muted text-xs">Checked when the app opens and every hour while it runs. Only folders Dev Cleaner removed are touched. Not available on macOS, where you manage the Trash in Finder.</p>
          </Group>
        )}

        {section === "rules" && (
          <>
            <Group>
              <p className="text-[13px]">These rules tell Dev Cleaner which generated folders are candidates for cleanup. A rule only matches when its project file is present, so a plain folder named build is left alone.</p>
              <div className="flex items-center gap-3">
                <input className="input flex-1" placeholder="Search rules..." aria-label="Search rules" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <span className="muted shrink-0 text-xs">{activeRules} active · {s.custom_rules.length} custom</span>
              </div>
              <div className="space-y-4">
                {[...byEco.entries()].map(([eco, list]) => (
                  <div key={eco}>
                    <div className="muted mb-1 text-xs font-medium">{eco}</div>
                    <div className="overflow-hidden rounded-[10px] border divider">
                      {list.map((r) => (
                        <div key={r.id} className="flex items-start gap-3 border-b px-3 py-2 last:border-0 divider">
                          <div className="min-w-0 flex-1">
                            <Toggle checked={r.enabled} onChange={(v) => set("rule_enabled", { ...s.rule_enabled, [r.id]: v })} label={r.name} description={r.description} />
                            <div className="flex flex-wrap items-center gap-1.5">
                              {r.split && <Badge icon="layers">Removable in parts</Badge>}
                              {r.custom && <Badge tone="brand">Custom</Badge>}
                              {r.custom && !r.confirmed && <Badge tone="amber" title="The first cleanup with this rule asks you to confirm.">Not used yet</Badge>}
                              <button className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300" aria-expanded={details.has(r.id)} onClick={() => flipDetail(r.id)}>{details.has(r.id) ? "Hide details" : "Details"}</button>
                              {r.custom && <button className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => runTest(r.id, s.custom_rules.find((c) => c.id === r.id) ?? r)}>Test</button>}
                            </div>
                            {test?.key === r.id && <div className="mt-2"><RuleTest result={test.result} busy={test.busy} />{test.error && <p className="text-xs text-red-600">{test.error}</p>}</div>}
                            {details.has(r.id) && (
                              <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
                                <dt className="muted">Folder names</dt><dd className="mono">{r.dir_names.join(", ")}</dd>
                                <dt className="muted">Marker</dt><dd className="mono">{r.parent_markers.length ? `beside ${r.parent_markers.join(" or ")}` : r.self_markers.length ? `contains ${r.self_markers.join(" or ")}` : "any project"}</dd>
                                <dt className="muted">Rebuilt with</dt><dd className="mono">{r.regenerates_with}</dd>
                                <dt className="muted">Risk</dt><dd>{RISK_LABEL[r.risk]}</dd>
                                {r.rebuild_cost && <><dt className="muted">Rebuild / download</dt><dd>{COST_LABEL[r.rebuild_cost]} / {COST_LABEL[r.network_cost ?? "unknown"]}</dd></>}
                                {r.base_confidence && <><dt className="muted">Confidence</dt><dd>{CONFIDENCE_LABEL[r.base_confidence]}{r.confidence_markers?.length ? `, higher beside ${r.confidence_markers.join(", ")}` : ""}</dd></>}
                                {r.consequence && <><dt className="muted">If removed</dt><dd>{r.consequence}</dd></>}
                              </dl>
                            )}
                          </div>
                          {r.custom && <button className="btn btn-ghost btn-sm" aria-label={`Delete rule ${r.name}`} onClick={() => set("custom_rules", s.custom_rules.filter((c) => c.id !== r.id))}><Icon name="trash" /></button>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!shown.length && <div className="muted text-sm">No rules match.</div>}
              </div>
            </Group>
            <Sub title="Add your own rule" hint="Match a folder name, optionally only when a project file sits beside it. Test it first to see what it would match.">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="muted mb-1 block text-xs">Name</span><input className="input w-full" placeholder="Build output" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                <label className="block"><span className="muted mb-1 block text-xs">Folder names (comma separated)</span><input className="input w-full" placeholder="out, .cache" value={draft.dirs} onChange={(e) => setDraft({ ...draft, dirs: e.target.value })} /></label>
                <label className="block"><span className="muted mb-1 block text-xs">Marker files (optional)</span><input className="input w-full" placeholder="package.json" value={draft.markers} onChange={(e) => setDraft({ ...draft, markers: e.target.value })} /></label>
                <label className="block"><span className="muted mb-1 block text-xs">Description (optional)</span><input className="input w-full" placeholder="Generated by my build" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
                <label className="block"><span className="muted mb-1 block text-xs">Risk</span>
                  <select className="input w-full" value={draft.risk} onChange={(e) => setDraft({ ...draft, risk: e.target.value as Risk })}>
                    <option value="safe">Safe: rebuilds by itself</option><option value="caution">Caution: needs downloads or a long rebuild</option>
                    {s.allow_danger_custom_rules && <option value="danger">Danger: may lose local state</option>}
                  </select></label>
              </div>
              {test?.key === "draft" && <><RuleTest result={test.result} busy={test.busy} />{test.error && <p className="text-xs text-red-600">{test.error}</p>}</>}
              <p className="muted text-xs">Custom rules are never marked more than medium confidence, so their matches are offered for review rather than recommended. The first cleanup with a new rule asks you to confirm.</p>
              <div className="flex gap-2">
                <button className="btn" onClick={() => runTest("draft", draftRule())} disabled={!draft.name.trim() || !draft.dirs.trim() || !!test?.busy}><Icon name="search" />Test rule</button>
                <button className="btn btn-primary" onClick={addCustom} disabled={!draft.name.trim() || !draft.dirs.trim()}><Icon name="plus" />Add rule</button>
              </div>
              <Disclosure title="Advanced">
                <Toggle checked={s.allow_danger_custom_rules} onChange={(v) => set("allow_danger_custom_rules", v)} label="Allow dangerous custom rules" description="Lets a custom rule be marked Danger, which always asks for confirmation." />
              </Disclosure>
            </Sub>
          </>
        )}
      </div>
    </div>
  );
}
