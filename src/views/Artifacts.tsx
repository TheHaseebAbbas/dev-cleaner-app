import { useMemo, useState } from "react";
import { api, ageDays, fmtBytes, fmtDate, type DeleteOutcome, type Item, type Settings } from "../api";
import { Confirm } from "../components/Confirm";
import { Details } from "../components/Details";
import { Treemap } from "../components/Treemap";

type SortKey = "disk_bytes" | "project_name" | "ecosystem" | "file_count" | "project_last_modified";

export function Artifacts(props: {
  items: Item[];
  scanning: boolean;
  settings: Settings;
  onScan: () => void;
  onCancel: () => void;
  onDeleted: (outcomes: DeleteOutcome[]) => void;
}) {
  const { items, settings } = props;
  const [query, setQuery] = useState("");
  const [eco, setEco] = useState("all");
  const [minMb, setMinMb] = useState(settings.min_size_mb);
  const [minAge, setMinAge] = useState(settings.min_age_days);
  const [onlyIgnored, setOnlyIgnored] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "disk_bytes", desc: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "treemap">("table");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<DeleteOutcome[] | null>(null);

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

  const totalAll = items.reduce((s, i) => s + i.disk_bytes, 0);
  const selItems = items.filter((i) => selected.has(i.path));
  const selBytes = selItems.reduce((s, i) => s + i.disk_bytes, 0);
  const focusItem = items.find((i) => i.path === focus) ?? null;
  const toggle = (p: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
  const selectable = filtered.filter((i) => !i.protected);
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.path));
  const header = (key: SortKey, label: string, right = false) => (
    <th
      className={`cursor-pointer select-none px-3 py-2 ${right ? "text-right" : "text-left"}`}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
    >
      {label} {sort.key === key ? (sort.desc ? "▼" : "▲") : ""}
    </th>
  );

  async function doDelete() {
    setConfirming(false);
    const out = await api.deleteItems([...selected]);
    setResult(out);
    props.onDeleted(out);
    setSelected(new Set());
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-4 gap-3">
        <div className="card"><div className="text-xs text-slate-500">Reclaimable found</div><div className="text-2xl font-semibold">{fmtBytes(totalAll)}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Directories</div><div className="text-2xl font-semibold">{items.length}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Shown after filters</div><div className="text-2xl font-semibold">{fmtBytes(filtered.reduce((s, i) => s + i.disk_bytes, 0))}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Selected</div><div className="text-2xl font-semibold">{fmtBytes(selBytes)}</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {props.scanning ? (
          <button className="btn" onClick={props.onCancel}>Stop scan</button>
        ) : (
          <button className="btn btn-primary" onClick={props.onScan}>{items.length ? "Rescan" : "Scan"}</button>
        )}
        {props.scanning && <span className="text-sm text-slate-500">Scanning… {items.length} found</span>}
        <input className="input w-56" placeholder="Search path or type" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input" value={eco} onChange={(e) => setEco(e.target.value)}>
          <option value="all">All ecosystems</option>
          {ecosystems.map((e) => <option key={e}>{e}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm">Min MB
          <input className="input w-20" type="number" min={0} value={minMb} onChange={(e) => setMinMb(Number(e.target.value))} />
        </label>
        <label className="flex items-center gap-1 text-sm">Idle days
          <input className="input w-20" type="number" min={0} value={minAge} onChange={(e) => setMinAge(Number(e.target.value))} />
        </label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={onlyIgnored} onChange={(e) => setOnlyIgnored(e.target.checked)} />Git-safe only</label>
        <div className="ml-auto flex gap-1">
          <button className={`btn ${view === "table" ? "btn-primary" : ""}`} onClick={() => setView("table")}>Table</button>
          <button className={`btn ${view === "treemap" ? "btn-primary" : ""}`} onClick={() => setView("treemap")}>Treemap</button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-h-0 flex-1 overflow-auto">
          {view === "treemap" ? (
            <Treemap items={filtered} selected={focus} onSelect={setFocus} />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.path)))} />
                  </th>
                  {header("project_name", "Project")}
                  <th className="px-3 py-2 text-left">Artifact</th>
                  {header("ecosystem", "Ecosystem")}
                  {header("disk_bytes", "Size", true)}
                  {header("file_count", "Files", true)}
                  {header("project_last_modified", "Last active", true)}
                  <th className="px-3 py-2 text-left">Safety</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr
                    key={i.path}
                    onClick={() => setFocus(i.path)}
                    className={`cursor-pointer border-b border-slate-100 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-900 ${focus === i.path ? "bg-emerald-50 dark:bg-emerald-950/40" : ""}`}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" disabled={i.protected} checked={selected.has(i.path)} onChange={() => toggle(i.path)} />
                    </td>
                    <td className="px-3 py-2 font-medium">{i.project_name}</td>
                    <td className="px-3 py-2">{i.rule_name}</td>
                    <td className="px-3 py-2">{i.ecosystem}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtBytes(i.disk_bytes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.file_count.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{fmtDate(i.project_last_modified)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {i.protected ? "🔒 protected" : i.git_ignored === false ? "⚠ not git-ignored" : i.risk}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!filtered.length && !props.scanning && (
            <div className="p-10 text-center text-slate-500">{items.length ? "No results match the filters." : "Press Scan to find node_modules, build folders, caches and more."}</div>
          )}
        </div>
        {focusItem && <Details item={focusItem} onClose={() => setFocus(null)} />}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm">
          {selected.size} selected · {fmtBytes(selBytes)} ·{" "}
          {settings.dry_run ? "dry run (nothing will be deleted)" : settings.delete_mode === "trash" ? "moves to Trash" : "deletes permanently"}
        </div>
        <button
          className="btn btn-danger"
          disabled={!selected.size}
          onClick={() => (settings.confirm_before_delete ? setConfirming(true) : doDelete())}
        >
          {settings.dry_run ? "Simulate cleanup" : "Clean selected"}
        </button>
      </div>

      {confirming && (
        <Confirm title="Clean selected folders?" confirmLabel={settings.dry_run ? "Simulate" : "Clean"} danger onConfirm={doDelete} onCancel={() => setConfirming(false)}>
          <p>{selected.size} folders · {fmtBytes(selBytes)} will be {settings.dry_run ? "simulated" : settings.delete_mode === "trash" ? "moved to the Trash" : "permanently deleted"}.</p>
          {selItems.some((i) => i.git_ignored === false) && (
            <p className="mt-2 font-medium text-amber-600">Some selected folders are not git-ignored; they may be tracked files.</p>
          )}
        </Confirm>
      )}
      {result && (
        <Confirm title="Cleanup finished" confirmLabel="OK" onConfirm={() => setResult(null)} onCancel={() => setResult(null)}>
          <p>
            {result.filter((r) => r.ok).length} of {result.length} succeeded ·{" "}
            {fmtBytes(result.filter((r) => r.ok).reduce((s, r) => s + r.bytes_freed, 0))} {result[0]?.dry_run ? "would be freed" : "freed"}.
          </p>
          {result.filter((r) => !r.ok).map((r) => <p key={r.path} className="mt-1 break-all text-red-600">{r.path}: {r.error}</p>)}
        </Confirm>
      )}
    </div>
  );
}
