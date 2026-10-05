import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type Rule, type Settings } from "../api";

function PathList(props: { title: string; hint: string; values: string[]; onChange: (v: string[]) => void; pick?: boolean }) {
  const [text, setText] = useState("");
  const add = (v: string) => v.trim() && !props.values.includes(v.trim()) && props.onChange([...props.values, v.trim()]);
  return (
    <div className="card">
      <h3 className="font-semibold">{props.title}</h3>
      <p className="mb-2 text-xs text-slate-500">{props.hint}</p>
      <ul className="mb-2 space-y-1">
        {props.values.map((v) => (
          <li key={v} className="flex items-center justify-between rounded bg-slate-100 px-2 py-1 text-sm dark:bg-slate-800">
            <span className="break-all">{v}</span>
            <button className="ml-2 text-red-600" onClick={() => props.onChange(props.values.filter((x) => x !== v))}>remove</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className="input flex-1" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (add(text), setText(""))} placeholder={props.pick ? "/path/to/folder" : "name"} />
        <button className="btn" onClick={() => { add(text); setText(""); }}>Add</button>
        {props.pick && (
          <button className="btn" onClick={async () => { const p = await open({ directory: true, multiple: false }); if (typeof p === "string") add(p); }}>Browse…</button>
        )}
      </div>
    </div>
  );
}

export function SettingsView(props: { settings: Settings; onChange: (s: Settings) => void }) {
  const s = props.settings;
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState({ name: "", dirs: "", markers: "" });
  useEffect(() => { api.listRules().then(setRules); }, [s.custom_rules, s.rule_enabled]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => props.onChange({ ...s, [k]: v });

  function addCustom() {
    const dirs = draft.dirs.split(",").map((x) => x.trim()).filter(Boolean);
    if (!draft.name.trim() || !dirs.length) return;
    const rule: Rule = {
      id: `custom-${Date.now()}`, name: draft.name.trim(), ecosystem: "Custom", dir_names: dirs,
      parent_markers: draft.markers.split(",").map((x) => x.trim()).filter(Boolean), self_markers: [],
      regenerates_with: "user-defined", risk: "medium", enabled: true, custom: true,
    };
    set("custom_rules", [...s.custom_rules, rule]);
    setDraft({ name: "", dirs: "", markers: "" });
  }

  return (
    <div className="h-full space-y-4 overflow-auto pb-6">
      <div className="card grid grid-cols-2 gap-4 text-sm">
        <label className="flex flex-col gap-1">Delete mode
          <select className="input" value={s.delete_mode} onChange={(e) => set("delete_mode", e.target.value as Settings["delete_mode"])}>
            <option value="trash">Move to Trash (recoverable)</option>
            <option value="permanent">Delete permanently</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">Theme
          <select className="input" value={s.theme} onChange={(e) => set("theme", e.target.value as Settings["theme"])}>
            <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">Max scan depth
          <input className="input" type="number" min={1} max={30} value={s.max_depth} onChange={(e) => set("max_depth", Number(e.target.value))} />
        </label>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.dry_run} onChange={(e) => set("dry_run", e.target.checked)} />Dry run (never delete, just report)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.confirm_before_delete} onChange={(e) => set("confirm_before_delete", e.target.checked)} />Confirm before deleting</label>
        </div>
        <label className="flex flex-col gap-1">Default minimum size (MB)
          <input className="input" type="number" min={0} value={s.min_size_mb} onChange={(e) => set("min_size_mb", Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">Default minimum idle days
          <input className="input" type="number" min={0} value={s.min_age_days} onChange={(e) => set("min_age_days", Number(e.target.value))} />
        </label>
      </div>

      <PathList title="Scan folders" hint="Where to look for projects." values={s.scan_roots} onChange={(v) => set("scan_roots", v)} pick />
      <PathList title="Protected paths" hint="Listed but never deletable (e.g. projects you work on daily)." values={s.protected_paths} onChange={(v) => set("protected_paths", v)} pick />
      <PathList title="Excluded folder names" hint="Never entered while scanning." values={s.exclude_names} onChange={(v) => set("exclude_names", v)} />

      <div className="card">
        <h3 className="mb-2 font-semibold">Cleanup rules</h3>
        <table className="w-full text-sm">
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="w-8 py-1.5"><input type="checkbox" checked={r.enabled} onChange={(e) => set("rule_enabled", { ...s.rule_enabled, [r.id]: e.target.checked })} /></td>
                <td className="py-1.5"><span className="font-medium">{r.name}</span> <span className="text-xs text-slate-500">{r.ecosystem} · {r.dir_names.join(", ")}{r.parent_markers.length ? ` (needs ${r.parent_markers.join(" or ")})` : ""}</span></td>
                <td className="py-1.5 text-right">
                  {r.custom && <button className="text-red-600" onClick={() => set("custom_rules", s.custom_rules.filter((c) => c.id !== r.id))}>delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4 className="mt-4 text-sm font-semibold">Add custom rule</h4>
        <div className="mt-1 flex flex-wrap gap-2">
          <input className="input" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="input" placeholder="Folder names, comma separated" value={draft.dirs} onChange={(e) => setDraft({ ...draft, dirs: e.target.value })} />
          <input className="input" placeholder="Parent marker files (optional)" value={draft.markers} onChange={(e) => setDraft({ ...draft, markers: e.target.value })} />
          <button className="btn" onClick={addCustom}>Add</button>
        </div>
      </div>
    </div>
  );
}
