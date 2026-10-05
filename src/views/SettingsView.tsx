import { useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type Rule, type Settings } from "../api";
import { Icon } from "../ui/Icon";
import { Badge, Segmented, Toggle } from "../ui/primitives";

function Section(props: { icon: "sliders" | "search" | "shield" | "layers" | "eye"; title: string; description: string; children: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"><Icon name={props.icon} /></div>
        <div><h2 className="font-semibold">{props.title}</h2><p className="muted text-sm">{props.description}</p></div>
      </div>
      <div className="space-y-4">{props.children}</div>
    </section>
  );
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

function Num(props: { value: number; min: number; max?: number; suffix: string; onChange: (n: number) => void }) {
  return <div className="flex items-center gap-2"><input className="input w-20 text-right" type="number" min={props.min} max={props.max} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} /><span className="muted text-sm">{props.suffix}</span></div>;
}

export function SettingsView(props: { settings: Settings; onChange: (s: Settings) => void }) {
  const s = props.settings;
  const [rules, setRules] = useState<Rule[]>([]);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState({ name: "", dirs: "", markers: "" });
  useEffect(() => { api.listRules().then(setRules); }, [s.custom_rules, s.rule_enabled]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => props.onChange({ ...s, [k]: v });

  function addCustom() {
    const dirs = draft.dirs.split(",").map((x) => x.trim()).filter(Boolean);
    if (!draft.name.trim() || !dirs.length) return;
    const rule: Rule = {
      id: `custom-${Date.now()}`, name: draft.name.trim(), ecosystem: "Custom", dir_names: dirs,
      parent_markers: draft.markers.split(",").map((x) => x.trim()).filter(Boolean), self_markers: [],
      regenerates_with: "user-defined", description: "Custom rule you added.", split: false, risk: "medium", enabled: true, custom: true,
    };
    set("custom_rules", [...s.custom_rules, rule]);
    setDraft({ name: "", dirs: "", markers: "" });
  }
  const shown = rules.filter((r) => !filter || `${r.name} ${r.ecosystem} ${r.dir_names.join(" ")}`.toLowerCase().includes(filter.toLowerCase()));
  const byEco = new Map<string, Rule[]>();
  for (const r of shown) byEco.set(r.ecosystem, [...(byEco.get(r.ecosystem) ?? []), r]);

  return (
    <div className="mx-auto h-full max-w-3xl space-y-4 overflow-auto pb-6">
      <Section icon="eye" title="Appearance" description="How the app looks.">
        <Field label="Theme" hint="System follows your operating system.">
          <Segmented value={s.theme} onChange={(v) => set("theme", v)} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </Field>
      </Section>

      <Section icon="sliders" title="Cleaning" description="What happens when you press Clean.">
        <Field label="When removing" hint="Trash lets you put things back. Permanent frees the space at once.">
          <Segmented value={s.delete_mode} onChange={(v) => set("delete_mode", v)} options={[{ value: "trash", label: "Move to Trash" }, { value: "permanent", label: "Delete permanently" }]} />
        </Field>
        <Toggle checked={s.dry_run} onChange={(v) => set("dry_run", v)} label="Dry run" description="Pretend to clean and report what would be freed. Nothing is touched. Good for trying the app." />
        <Toggle checked={s.confirm_before_delete} onChange={(v) => set("confirm_before_delete", v)} label="Ask before removing" description="Show a summary first. Folders marked as risky always ask, even with this off." />
      </Section>

      <Section icon="search" title="Scanning" description="Where and how deep to look.">
        <PathList title="Scan folders" hint="Folders that contain your projects. Only these are searched." values={s.scan_roots} onChange={(v) => set("scan_roots", v)} pick placeholder="C:\development or ~/code" />
        <PathList title="Skipped folder names" hint="Never entered while scanning, wherever they appear." values={s.exclude_names} onChange={(v) => set("exclude_names", v)} placeholder="folder name, e.g. archive" />
        <Field label="Search depth" hint="How many levels below a scan folder to look. Deeper finds more but takes longer."><Num value={s.max_depth} min={1} max={30} suffix="levels" onChange={(n) => set("max_depth", n)} /></Field>
        <Field label="Default minimum size" hint="Hide folders smaller than this. Can be changed in the list too."><Num value={s.min_size_mb} min={0} suffix="MB" onChange={(n) => set("min_size_mb", n)} /></Field>
        <Field label="Default minimum idle time" hint="Hide projects used more recently than this."><Num value={s.min_age_days} min={0} suffix="days" onChange={(n) => set("min_age_days", n)} /></Field>
        <Toggle checked={s.scan_on_launch} onChange={(v) => set("scan_on_launch", v)} label="Scan when the app opens" description="Start scanning automatically. Off by default so the app opens instantly." />
      </Section>

      <Section icon="shield" title="Protection" description="Things that can be seen but never removed.">
        <PathList title="Protected paths" hint="Anything inside these is listed but cannot be selected. Use it for projects you work on daily." values={s.protected_paths} onChange={(v) => set("protected_paths", v)} pick placeholder="path to protect" />
      </Section>

      <Section icon="layers" title="Cleanup rules" description="Which kinds of folders are recognised. Each rule only matches when its marker file is present, so a plain folder named build is left alone.">
        <input className="input w-full" placeholder="Filter rules" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="space-y-3">
          {[...byEco.entries()].map(([eco, list]) => (
            <div key={eco}>
              <div className="muted mb-1 text-[11px] font-semibold uppercase tracking-wide">{eco}</div>
              <div className="overflow-hidden rounded-lg border divider">
                {list.map((r) => (
                  <div key={r.id} className="flex items-start gap-3 border-b px-3 py-2 last:border-0 divider">
                    <div className="flex-1">
                      <Toggle checked={r.enabled} onChange={(v) => set("rule_enabled", { ...s.rule_enabled, [r.id]: v })} label={r.name}
                        description={`${r.dir_names.join(", ")}${r.parent_markers.length ? ` next to ${r.parent_markers.join(" or ")}` : ""}. ${r.description}`} />
                      <div className="mt-1 flex gap-1">{r.split && <Badge icon="layers">removable in parts</Badge>}{r.custom && <Badge tone="blue">custom</Badge>}</div>
                    </div>
                    {r.custom && <button className="btn btn-ghost btn-sm" aria-label="Delete rule" onClick={() => set("custom_rules", s.custom_rules.filter((c) => c.id !== r.id))}><Icon name="trash" /></button>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!shown.length && <div className="muted text-sm">No rules match.</div>}
        </div>
        <div>
          <div className="text-sm font-medium">Add your own rule</div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <input className="input" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className="input" placeholder="Folder names, comma separated" value={draft.dirs} onChange={(e) => setDraft({ ...draft, dirs: e.target.value })} />
            <input className="input" placeholder="Marker files (optional)" value={draft.markers} onChange={(e) => setDraft({ ...draft, markers: e.target.value })} />
          </div>
          <button className="btn mt-2" onClick={addCustom} disabled={!draft.name.trim() || !draft.dirs.trim()}><Icon name="plus" />Add rule</button>
        </div>
      </Section>
    </div>
  );
}
