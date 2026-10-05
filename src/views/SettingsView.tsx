import { useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type Rule, type Settings } from "../api";
import { Icon, type IconName } from "../ui/Icon";
import { Badge, PageHeader, Segmented, Toggle } from "../ui/primitives";

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

type SectionId = "appearance" | "cleaning" | "safety" | "scanning" | "protection" | "rules" | "trash";

const META: Record<SectionId, { title: string; icon: IconName; description: string }> = {
  appearance: { title: "Appearance", icon: "eye", description: "How the app looks." },
  cleaning: { title: "Cleaning", icon: "sliders", description: "What happens when you reclaim space." },
  safety: { title: "Safety", icon: "shield", description: "The protections that are always on." },
  scanning: { title: "Scanning", icon: "search", description: "Where and how deep to look." },
  protection: { title: "Protection", icon: "lock", description: "Folders that can be seen but never removed." },
  rules: { title: "Rules", icon: "layers", description: "Which kinds of folders are recognised." },
  trash: { title: "Trash", icon: "trash", description: "When removed folders are cleared for good." },
};
const ORDER: SectionId[] = ["appearance", "cleaning", "safety", "scanning", "protection", "rules", "trash"];

const SAFETY_POINTS = [
  ["Source code is never selected.", "A folder is offered only when it matches a rule and its project file sits next to it."],
  ["You always see what will happen.", "Risky folders ask for an extra confirmation, even if you turned confirmations off."],
  ["Tracked files are flagged.", "Folders Git tracks are marked May be required."],
  ["System and view-only locations are never deleted.", "Dev Cleaner can show them but does not remove them."],
  ["Protected paths cannot be selected.", "Add your own in Protection."],
];

export function SettingsView(props: { settings: Settings; onChange: (s: Settings) => void; onAbout: () => void }) {
  const s = props.settings;
  const [section, setSection] = useState<SectionId | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState({ name: "", dirs: "", markers: "", description: "" });
  const [details, setDetails] = useState<Set<string>>(new Set());
  useEffect(() => { api.listRules().then(setRules); }, [s.custom_rules, s.rule_enabled]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => props.onChange({ ...s, [k]: v });
  const split = (t: string) => t.split(",").map((x) => x.trim()).filter(Boolean);

  function addCustom() {
    const dirs = split(draft.dirs);
    if (!draft.name.trim() || !dirs.length) return;
    const rule: Rule = {
      id: `custom-${Date.now()}`, name: draft.name.trim(), ecosystem: "Custom", dir_names: dirs,
      parent_markers: split(draft.markers), self_markers: [],
      regenerates_with: "user-defined", description: draft.description.trim() || "Custom rule you added.", split: false, risk: "medium", enabled: true, custom: true,
    };
    set("custom_rules", [...s.custom_rules, rule]);
    setDraft({ name: "", dirs: "", markers: "", description: "" });
  }

  const activeRules = rules.filter((r) => r.enabled).length;
  const summary: Record<SectionId, string> = {
    appearance: s.theme === "system" ? "System" : s.theme === "dark" ? "Dark" : "Light",
    cleaning: `${s.dry_run ? "Dry run · " : ""}${s.delete_mode === "trash" ? "Move to Trash" : "Delete permanently"}`,
    safety: "Always on",
    scanning: `${s.scan_roots.length} folder${s.scan_roots.length === 1 ? "" : "s"} · ${s.max_depth} levels`,
    protection: `${s.protected_paths.length} protected path${s.protected_paths.length === 1 ? "" : "s"}`,
    rules: `${activeRules} active · ${s.custom_rules.length} custom`,
    trash: s.trash_retention_days > 0 ? `Clear after ${s.trash_retention_days} days` : "Never clear automatically",
  };

  if (section === null) {
    return (
      <div className="h-full overflow-auto pb-6">
        <PageHeader title="Settings" subtitle="Changes are saved automatically." />
        <div className="card overflow-hidden">
          {ORDER.map((id) => (
            <button key={id} onClick={() => setSection(id)} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left outline-none divider transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-800/50">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"><Icon name={META[id].icon} /></div>
              <div className="min-w-0 flex-1"><div className="font-medium">{META[id].title}</div><div className="muted text-[13px]">{META[id].description}</div></div>
              <span className="muted shrink-0 text-[13px]">{summary[id]}</span>
              <Icon name="chevron-right" className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          ))}
          <button onClick={props.onAbout} className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-800/50">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"><Icon name="info" /></div>
            <div className="min-w-0 flex-1"><div className="font-medium">About</div><div className="muted text-[13px]">Version, what Dev Cleaner does and where your data lives.</div></div>
            <span className="muted shrink-0 text-[13px]">v{__APP_VERSION__}</span>
            <Icon name="chevron-right" className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
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
          </Group>
        )}

        {section === "cleaning" && (
          <Group>
            <Field label="When removing" hint="Trash lets you put things back. Permanent frees the space at once.">
              <Segmented value={s.delete_mode} onChange={(v) => set("delete_mode", v)} options={[{ value: "trash", label: "Move to Trash" }, { value: "permanent", label: "Delete permanently" }]} />
            </Field>
            <Toggle checked={s.dry_run} onChange={(v) => set("dry_run", v)} label="Dry run" description="Pretend to clean and report what would be freed. Nothing is touched. Good for trying the app." />
            <Toggle checked={s.confirm_before_delete} onChange={(v) => set("confirm_before_delete", v)} label="Ask before removing" description="Show a summary first. Folders marked as risky always ask, even with this off." />
          </Group>
        )}

        {section === "safety" && (
          <Group>
            <ul className="space-y-3">
              {SAFETY_POINTS.map(([t, b]) => (
                <li key={t} className="flex gap-2.5 text-[13px]">
                  <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span><span className="font-medium">{t}</span> <span className="muted">{b}</span></span>
                </li>
              ))}
            </ul>
            <p className="muted text-xs">These protections cannot be turned off. See docs/SAFETY.md for the full list.</p>
          </Group>
        )}

        {section === "scanning" && (
          <Group>
            <PathList title="Scan folders" hint="Folders that contain your projects. Only these are searched." values={s.scan_roots} onChange={(v) => set("scan_roots", v)} pick placeholder="C:\development or ~/code" />
            <PathList title="Skipped folder names" hint="Never entered while scanning, wherever they appear." values={s.exclude_names} onChange={(v) => set("exclude_names", v)} placeholder="folder name, e.g. archive" />
            <Field label="Search depth" hint="How many levels below a scan folder to look. Deeper finds more but takes longer."><Num value={s.max_depth} min={1} max={30} suffix="levels" onChange={(n) => set("max_depth", n)} /></Field>
            <Field label="Default minimum size" hint="Hide folders smaller than this. Can be changed in the list too."><Num value={s.min_size_mb} min={0} suffix="MB" onChange={(n) => set("min_size_mb", n)} /></Field>
            <Field label="Default minimum idle time" hint="Hide projects used more recently than this."><Num value={s.min_age_days} min={0} suffix="days" onChange={(n) => set("min_age_days", n)} /></Field>
            <Toggle checked={s.scan_on_launch} onChange={(v) => set("scan_on_launch", v)} label="Scan when the app opens" description="Start scanning automatically. Off by default so the app opens instantly." />
          </Group>
        )}

        {section === "protection" && (
          <Group>
            <PathList title="Protected paths" hint="Anything inside these is listed but cannot be selected. Use it for projects you work on daily." values={s.protected_paths} onChange={(v) => set("protected_paths", v)} pick placeholder="path to protect" />
          </Group>
        )}

        {section === "trash" && (
          <Group>
            <Field label="Clear automatically after" hint="Folders Dev Cleaner moved to the Trash are deleted for good after this many days. Restored items are not affected.">
              <div className="flex flex-col items-end gap-2">
                <Segmented value={String(RETENTION_PRESETS.includes(s.trash_retention_days) ? s.trash_retention_days : "custom")} onChange={(v) => v !== "custom" && set("trash_retention_days", Number(v))}
                  options={[{ value: "0", label: "Never" }, { value: "7", label: "7 days" }, { value: "14", label: "14 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "custom", label: "Custom" }]} />
                <Num value={s.trash_retention_days} min={0} max={3650} suffix="days (0 = never)" onChange={(n) => set("trash_retention_days", Math.max(0, Math.round(n)))} />
              </div>
            </Field>
            <p className="muted text-xs">Checked when the app opens and every hour while it runs. Open Trash in the sidebar to restore items or delete them now. Not available on macOS, where you manage the Trash in Finder.</p>
          </Group>
        )}

        {section === "rules" && (
          <>
            <Group>
              <div className="flex items-center gap-3">
                <input className="input flex-1" placeholder="Search rules" aria-label="Search rules" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <span className="muted shrink-0 text-xs">{activeRules} active · {s.custom_rules.length} custom</span>
              </div>
              <p className="muted -mt-2 text-xs">Each rule only matches when its project file is present, so a plain folder named build is left alone.</p>
              <div className="space-y-4">
                {[...byEco.entries()].map(([eco, list]) => (
                  <div key={eco}>
                    <div className="muted mb-1 text-[11px] font-semibold uppercase tracking-wide">{eco}</div>
                    <div className="overflow-hidden rounded-[10px] border divider">
                      {list.map((r) => (
                        <div key={r.id} className="flex items-start gap-3 border-b px-3 py-2.5 last:border-0 divider">
                          <div className="min-w-0 flex-1">
                            <Toggle checked={r.enabled} onChange={(v) => set("rule_enabled", { ...s.rule_enabled, [r.id]: v })} label={r.name} description={r.description} />
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {r.split && <Badge icon="layers">Removable in parts</Badge>}
                              {r.custom && <Badge tone="brand">Custom</Badge>}
                              <button className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300" aria-expanded={details.has(r.id)} onClick={() => flipDetail(r.id)}>{details.has(r.id) ? "Hide details" : "Details"}</button>
                            </div>
                            {details.has(r.id) && (
                              <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
                                <dt className="muted">Folder names</dt><dd className="mono">{r.dir_names.join(", ")}</dd>
                                <dt className="muted">Next to</dt><dd className="mono">{r.parent_markers.length ? r.parent_markers.join(" or ") : r.self_markers.length ? `contains ${r.self_markers.join(" or ")}` : "any project"}</dd>
                                <dt className="muted">Comes back with</dt><dd className="mono">{r.regenerates_with}</dd>
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
            <Group>
              <div>
                <div className="font-medium">Add your own rule</div>
                <p className="muted text-xs">Match a folder name, optionally only when a project file sits beside it.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="muted mb-1 block text-xs">Name</span><input className="input w-full" placeholder="Build output" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                <label className="block"><span className="muted mb-1 block text-xs">Folder names (comma separated)</span><input className="input w-full" placeholder="out, .cache" value={draft.dirs} onChange={(e) => setDraft({ ...draft, dirs: e.target.value })} /></label>
                <label className="block"><span className="muted mb-1 block text-xs">Marker files (optional)</span><input className="input w-full" placeholder="package.json" value={draft.markers} onChange={(e) => setDraft({ ...draft, markers: e.target.value })} /></label>
                <label className="block"><span className="muted mb-1 block text-xs">Description (optional)</span><input className="input w-full" placeholder="Generated by my build" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
              </div>
              <button className="btn btn-primary" onClick={addCustom} disabled={!draft.name.trim() || !draft.dirs.trim()}><Icon name="plus" />Add rule</button>
            </Group>
          </>
        )}
      </div>
    </div>
  );
}
