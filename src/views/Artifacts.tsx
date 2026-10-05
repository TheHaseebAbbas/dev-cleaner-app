import { Fragment, useEffect, useMemo, useState } from "react";
import { api, ageDays, fmtBytes, fmtDate, type DeleteOutcome, type Item, type Part, type Rule, type Settings } from "../api";
import { Confirm } from "../components/Confirm";
import { Details } from "../components/Details";
import { LocationsDialog } from "../components/LocationsDialog";
import { HowItWorks } from "../components/HowItWorks";
import { needsAck, WarnBadge, WarningPanel, type WarnEntry } from "../components/Warnings";
import { Treemap } from "../components/Treemap";

type SortKey = "disk_bytes" | "project_name" | "ecosystem" | "file_count" | "project_last_modified";
type View = "project" | "flat" | "treemap";
interface PlanEntry extends WarnEntry { bytes: number }

export function Artifacts(props: {
  items: Item[];
  scanning: boolean;
  settings: Settings;
  onScan: () => void;
  onCancel: () => void;
  onDeleted: (outcomes: DeleteOutcome[]) => void;
  onOpenSettings: () => void;
}) {
  const { items, settings } = props;
  const [rules, setRules] = useState<Rule[]>([]);
  const [query, setQuery] = useState("");
  const [eco, setEco] = useState("all");
  const [minMb, setMinMb] = useState(settings.min_size_mb);
  const [minAge, setMinAge] = useState(settings.min_age_days);
  const [onlyIgnored, setOnlyIgnored] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "disk_bytes", desc: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<View>("project");
  const [confirming, setConfirming] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showWhere, setShowWhere] = useState(false);
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState<DeleteOutcome[] | null>(null);

  useEffect(() => { api.listRules().then(setRules); }, [settings.custom_rules, settings.rule_enabled]);

  const ecosystems = useMemo(() => [...new Set(items.map((i) => i.ecosystem))].sort(), [items]);
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const list = items.filter(
      (i) =>
        (eco === "all" || i.ecosystem === eco) &&
        i.disk_bytes >= minMb * 1024 * 1024 &&
        ageDays(i.project_last_modified) >= minAge &&
        (!onlyIgnored || i.git_ignored !== false) &&
        (!q || i.path.toLowerCase().includes(q) || i.rule_name.toLowerCase().includes(q)),
    );
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * dir;
    });
  }, [items, query, eco, minMb, minAge, onlyIgnored, sort]);

  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of filtered) m.set(i.project_path, [...(m.get(i.project_path) ?? []), i]);
    const arr = [...m.entries()].map(([path, its]) => ({ path, name: its[0].project_name, items: its, bytes: its.reduce((s, i) => s + i.disk_bytes, 0) }));
    return arr.sort((a, b) => (sort.key === "project_name" ? a.name.localeCompare(b.name) * (sort.desc ? -1 : 1) : b.bytes - a.bytes));
  }, [filtered, sort]);

  // What will really be removed: a selected folder covers its parts.
  const plan: PlanEntry[] = useMemo(() => {
    const out: PlanEntry[] = [];
    for (const i of items) {
      if (selected.has(i.path)) out.push({ path: i.path, label: i.path, bytes: i.disk_bytes, warnings: i.warnings });
      else for (const p of i.parts) if (selected.has(p.path)) out.push({ path: p.path, label: p.path, bytes: p.disk_bytes, warnings: i.warnings });
    }
    return out;
  }, [items, selected]);
  const planBytes = plan.reduce((s, e) => s + e.bytes, 0);
  const totalAll = items.reduce((s, i) => s + i.disk_bytes, 0);
  const focusItem = items.find((i) => i.path === focus) ?? null;

  const flip = (set: Set<string>, key: string) => {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  };
  const toggleItem = (i: Item) =>
    setSelected((s) => {
      const n = flip(s, i.path);
      if (n.has(i.path)) i.parts.forEach((p) => n.delete(p.path));
      return n;
    });
  const togglePart = (p: Part) => setSelected((s) => flip(s, p.path));
  const toggleGroup = (its: Item[]) =>
    setSelected((s) => {
      const free = its.filter((i) => !i.protected);
      const all = free.every((i) => s.has(i.path));
      const n = new Set(s);
      free.forEach((i) => {
        all ? n.delete(i.path) : n.add(i.path);
        i.parts.forEach((p) => n.delete(p.path));
      });
      return n;
    });
  const selectable = filtered.filter((i) => !i.protected);
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.path));
  const partsSelectedCount = (i: Item) => i.parts.filter((p) => selected.has(p.path)).length;

  const header = (key: SortKey, label: string, right = false) => (
    <th className={`cursor-pointer select-none px-3 py-2 ${right ? "text-right" : "text-left"}`} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}>
      {label} {sort.key === key ? (sort.desc ? "▼" : "▲") : ""}
    </th>
  );

  async function doDelete() {
    setConfirming(false);
    const out = await api.deleteItems(plan.map((e) => e.path));
    setResult(out);
    props.onDeleted(out);
    setSelected(new Set());
  }

  function itemRows(i: Item, showProject: boolean) {
    const open = expanded.has(i.path);
    const partial = !selected.has(i.path) && partsSelectedCount(i) > 0;
    return (
      <Fragment key={i.path}>
        <tr onClick={() => setFocus(i.path)} className={`cursor-pointer border-b border-slate-100 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-900 ${focus === i.path ? "bg-emerald-50 dark:bg-emerald-950/40" : ""}`}>
          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" disabled={i.protected} checked={selected.has(i.path)} ref={(el) => { if (el) el.indeterminate = partial; }} onChange={() => toggleItem(i)} />
          </td>
          <td className="px-3 py-2">
            <div className="flex items-start gap-1">
              {i.parts.length > 0 ? (
                <button className="w-4 text-slate-500" title={`${i.parts.length} independent parts`} onClick={(e) => { e.stopPropagation(); setExpanded((s) => flip(s, i.path)); }}>{open ? "▾" : "▸"}</button>
              ) : <span className="w-4" />}
              <div className="min-w-0">
                <div className="font-medium">{showProject ? i.project_name : i.rule_name}{showProject && <span className="font-normal text-slate-500"> / {i.rule_name}</span>}{i.parts.length > 0 && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-normal dark:bg-slate-700">{i.parts.length} parts</span>}</div>
                <div className="break-all text-xs text-slate-500">{i.path}</div>
              </div>
            </div>
          </td>
          <td className="px-3 py-2">{i.ecosystem}</td>
          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtBytes(i.disk_bytes)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{i.file_count.toLocaleString()}</td>
          <td className="whitespace-nowrap px-3 py-2 text-right">{fmtDate(i.project_last_modified)}</td>
          <td className="whitespace-nowrap px-3 py-2">{i.protected ? "🔒 protected" : i.risk}<WarnBadge warnings={i.warnings} /></td>
        </tr>
        {open && i.parts.map((p) => (
          <tr key={p.path} className="border-b border-slate-100 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
            <td className="px-3 py-1.5 text-right">
              <input type="checkbox" disabled={i.protected || selected.has(i.path)} checked={selected.has(i.path) || selected.has(p.path)} onChange={() => togglePart(p)} />
            </td>
            <td className="py-1.5 pl-8 pr-3"><span className="font-mono text-xs">{p.name}/</span> <span className="text-xs text-slate-500">optional part · removed on its own</span></td>
            <td />
            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{fmtBytes(p.disk_bytes)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{p.file_count.toLocaleString()}</td>
            <td className="whitespace-nowrap px-3 py-1.5 text-right">{fmtDate(p.last_modified)}</td>
            <td />
          </tr>
        ))}
      </Fragment>
    );
  }

  const rootsLabel = settings.scan_roots.length ? settings.scan_roots : [];
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="font-medium">Looks in:</span>
        {rootsLabel.length ? rootsLabel.slice(0, 3).map((r) => <code key={r} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{r}</code>) : <span className="text-amber-600">no folders set</span>}
        {rootsLabel.length > 3 && <span className="text-slate-500">+{rootsLabel.length - 3} more</span>}
        <span className="text-slate-500">· {rules.filter((r) => r.enabled).length} rule{rules.filter((r) => r.enabled).length === 1 ? "" : "s"} active · deletes only the matched folders, never your source code</span>
        <span className="ml-auto flex gap-2">
          <button className="btn !py-0.5" onClick={() => setShowWhere(true)}>Where it looks</button>
          <button className="btn !py-0.5" onClick={() => setShowHelp(true)}>How it works</button>
          <button className="btn !py-0.5" onClick={props.onOpenSettings}>Change folders</button>
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="card"><div className="text-xs text-slate-500">Reclaimable found</div><div className="text-2xl font-semibold">{fmtBytes(totalAll)}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Folders found</div><div className="text-2xl font-semibold">{items.length}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Shown after filters</div><div className="text-2xl font-semibold">{fmtBytes(filtered.reduce((s, i) => s + i.disk_bytes, 0))}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Selected to remove</div><div className="text-2xl font-semibold">{fmtBytes(planBytes)}</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {props.scanning ? <button className="btn" onClick={props.onCancel}>Stop scan</button> : <button className="btn btn-primary" onClick={props.onScan}>{items.length ? "Rescan" : "Scan"}</button>}
        {props.scanning && <span className="text-sm text-slate-500">Scanning… {items.length} found</span>}
        <input className="input w-56" placeholder="Search path or type" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input" value={eco} onChange={(e) => setEco(e.target.value)}>
          <option value="all">All ecosystems</option>
          {ecosystems.map((e) => <option key={e}>{e}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm">Min MB<input className="input w-20" type="number" min={0} value={minMb} onChange={(e) => setMinMb(Number(e.target.value))} /></label>
        <label className="flex items-center gap-1 text-sm">Idle days<input className="input w-20" type="number" min={0} value={minAge} onChange={(e) => setMinAge(Number(e.target.value))} /></label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={onlyIgnored} onChange={(e) => setOnlyIgnored(e.target.checked)} />Git-safe only</label>
        <div className="ml-auto flex gap-1">
          <button className={`btn ${view === "project" ? "btn-primary" : ""}`} onClick={() => setView("project")}>By project</button>
          <button className={`btn ${view === "flat" ? "btn-primary" : ""}`} onClick={() => setView("flat")}>Flat list</button>
          <button className={`btn ${view === "treemap" ? "btn-primary" : ""}`} onClick={() => setView("treemap")}>Treemap</button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-h-0 flex-1 overflow-auto">
          {view === "treemap" ? (
            <Treemap items={filtered} selected={focus} onSelect={setFocus} />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
                <tr>
                  <th className="w-8 px-3 py-2"><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.path)))} /></th>
                  {header("project_name", view === "project" ? "Folder to remove" : "Project / folder")}
                  {header("ecosystem", "Ecosystem")}
                  {header("disk_bytes", "Size", true)}
                  {header("file_count", "Files", true)}
                  {header("project_last_modified", "Project last active", true)}
                  <th className="px-3 py-2 text-left">Safety</th>
                </tr>
              </thead>
              <tbody>
                {view === "flat" && filtered.map((i) => itemRows(i, true))}
                {view === "project" && groups.map((g) => (
                  <Fragment key={g.path}>
                    <tr className="border-b border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-900/70">
                      <td className="px-3 py-2"><input type="checkbox" checked={g.items.filter((i) => !i.protected).length > 0 && g.items.filter((i) => !i.protected).every((i) => selected.has(i.path))} onChange={() => toggleGroup(g.items)} /></td>
                      <td className="px-3 py-2" colSpan={2}><div className="font-semibold">📁 {g.name}</div><div className="break-all text-xs text-slate-500">{g.path}</div></td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{fmtBytes(g.bytes)}</td>
                      <td colSpan={3} className="px-3 py-2 text-xs text-slate-500">{g.items.length} removable folder{g.items.length === 1 ? "" : "s"}; the rest of the project stays</td>
                    </tr>
                    {g.items.map((i) => itemRows(i, false))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
          {!filtered.length && !props.scanning && (
            items.length ? <div className="p-10 text-center text-slate-500">No results match the filters.</div> : (
              <div className="mx-auto max-w-2xl p-6">
                <h2 className="mb-1 text-lg font-semibold">Find folders you can safely rebuild</h2>
                <p className="mb-4 text-sm text-slate-500">Press <b>Scan</b>. Nothing is deleted until you tick folders and confirm.</p>
                <div className="card"><HowItWorks settings={settings} rules={rules} onOpenSettings={props.onOpenSettings} /></div>
              </div>
            )
          )}
        </div>
        {focusItem && <Details item={focusItem} onClose={() => setFocus(null)} />}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm">
          {plan.length} folder{plan.length === 1 ? "" : "s"} selected · {fmtBytes(planBytes)} ·{" "}
          {settings.dry_run ? "dry run (nothing will be deleted)" : settings.delete_mode === "trash" ? "moves to Trash" : "deletes permanently"}
        </div>
        <button className="btn btn-danger" disabled={!plan.length} onClick={() => (settings.confirm_before_delete || needsAck(plan) ? (setAck(false), setConfirming(true)) : doDelete())}>
          {settings.dry_run ? "Simulate cleanup" : "Clean selected"}
        </button>
      </div>

      {showWhere && <LocationsDialog items={items} onClose={() => setShowWhere(false)} onOpenSettings={props.onOpenSettings} />}
      {showHelp && (
        <Confirm title="How Dev Cleaner decides what to delete" confirmLabel="Got it" onConfirm={() => setShowHelp(false)} onCancel={() => setShowHelp(false)}>
          <div className="max-h-[60vh] overflow-auto"><HowItWorks settings={settings} rules={rules} onOpenSettings={props.onOpenSettings} onClose={() => setShowHelp(false)} /></div>
        </Confirm>
      )}
      {confirming && (
        <Confirm title={settings.dry_run ? "Simulate removing these folders?" : "Remove these folders?"} confirmLabel={settings.dry_run ? "Simulate" : settings.delete_mode === "trash" ? "Move to Trash" : "Delete permanently"} danger confirmDisabled={needsAck(plan) && !ack && !settings.dry_run} onConfirm={doDelete} onCancel={() => setConfirming(false)}>
          <p className="mb-2">{plan.length} folder{plan.length === 1 ? "" : "s"}, {fmtBytes(planBytes)}. {settings.delete_mode === "trash" && !settings.dry_run ? "They go to the Trash and can be restored." : ""} Your source code and other project files are not touched.</p>
          <ul className="max-h-60 space-y-1 overflow-auto rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
            {plan.map((e) => (
              <li key={e.path} className="flex justify-between gap-3"><span className="break-all font-mono">{e.path}</span><span className="shrink-0 tabular-nums">{fmtBytes(e.bytes)}</span></li>
            ))}
          </ul>
          <WarningPanel entries={plan} ack={ack} onAck={setAck} dryRun={settings.dry_run} />
        </Confirm>
      )}
      {result && (
        <Confirm title="Cleanup finished" confirmLabel="OK" onConfirm={() => setResult(null)} onCancel={() => setResult(null)}>
          <p>{result.filter((r) => r.ok).length} of {result.length} succeeded · {fmtBytes(result.filter((r) => r.ok).reduce((s, r) => s + r.bytes_freed, 0))} {result[0]?.dry_run ? "would be freed" : "freed"}.</p>
          {result.filter((r) => !r.ok).map((r) => <p key={r.path} className="mt-1 break-all text-red-600">{r.path}: {r.error}</p>)}
        </Confirm>
      )}
    </div>
  );
}
