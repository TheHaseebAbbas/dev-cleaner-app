import { useEffect, useMemo, useState } from "react";
import { api, ageDays, fmtBytes, fmtDuration, type DeleteOutcome, type Item, type Part, type Rule, type Settings } from "../api";
import { Details } from "../components/Details";
import { ConfirmDialog, HelpDialog, LocationsDialog, ResultDialog, type PlanEntry } from "../components/dialogs";
import { ScanPanel } from "../components/ScanPanel";
import { SelectionBar } from "../components/SelectionBar";
import { GroupHeader, ListHeader, TreeRow, type RowModel } from "../components/Tree";
import { Treemap } from "../components/Treemap";
import type { useScan } from "../hooks/useScans";
import { useElapsed } from "../hooks/useScans";
import { Icon } from "../ui/Icon";
import { Badge, Banner, EmptyState, Segmented, SkeletonRows, StatCard } from "../ui/primitives";
import { WarnBadge } from "../ui/warnings";

type SortKey = "disk_bytes" | "project_name" | "ecosystem" | "file_count" | "project_last_modified";
type View = "project" | "flat" | "treemap";

const COLUMNS = [
  { label: "Folder", sortKey: "project_name" },
  { label: "Type", sortKey: "ecosystem" },
  { label: "Size", sortKey: "disk_bytes", align: "right" as const },
  { label: "Files", sortKey: "file_count", align: "right" as const },
  { label: "Project used", sortKey: "project_last_modified", align: "right" as const },
  { label: "Notes" },
];

function toModel(i: Item): RowModel {
  return {
    key: i.path, name: i.rule_name, sub: i.path, typeLabel: i.ecosystem, bytes: i.disk_bytes, files: i.file_count,
    modified: i.project_last_modified, parts: i.parts, protected: i.protected,
    status: (
      <div className="flex flex-wrap items-center gap-1">
        {i.protected && <Badge icon="lock">Protected</Badge>}
        <WarnBadge warnings={i.warnings} />
        {i.git_tracked && <Badge tone="red">In git</Badge>}
      </div>
    ),
  };
}

export function Projects(props: { scan: ReturnType<typeof useScan>; settings: Settings; onOpenSettings: () => void; onDeleted: (o: DeleteOutcome[]) => void }) {
  const { scan, settings } = props;
  const { items, status } = scan;
  const [rules, setRules] = useState<Rule[]>([]);
  const [query, setQuery] = useState("");
  const [eco, setEco] = useState("all");
  const [minMb, setMinMb] = useState(settings.min_size_mb);
  const [minAge, setMinAge] = useState(settings.min_age_days);
  const [onlyIgnored, setOnlyIgnored] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "disk_bytes", desc: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<View>("project");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showWhere, setShowWhere] = useState(false);
  const [result, setResult] = useState<DeleteOutcome[] | null>(null);
  const elapsed = useElapsed(scan.startedAt, status === "scanning");

  useEffect(() => { api.listRules().then(setRules); }, [settings.custom_rules, settings.rule_enabled]);

  const ecosystems = useMemo(() => [...new Set(items.map((i) => i.ecosystem))].sort(), [items]);
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const list = items.filter((i) =>
      (eco === "all" || i.ecosystem === eco) && i.disk_bytes >= minMb * 1024 * 1024 && ageDays(i.project_last_modified) >= minAge &&
      (!onlyIgnored || i.git_ignored !== false) && (!q || i.path.toLowerCase().includes(q) || i.rule_name.toLowerCase().includes(q)));
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * dir;
    });
  }, [items, query, eco, minMb, minAge, onlyIgnored, sort]);

  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of filtered) m.set(i.project_path, [...(m.get(i.project_path) ?? []), i]);
    return [...m.entries()].map(([path, its]) => ({ path, name: its[0].project_name, items: its, bytes: its.reduce((s, i) => s + i.disk_bytes, 0) }))
      .sort((a, b) => (sort.key === "project_name" ? a.name.localeCompare(b.name) * (sort.desc ? -1 : 1) : b.bytes - a.bytes));
  }, [filtered, sort]);

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
  const maxBytes = filtered.reduce((m, i) => Math.max(m, i.disk_bytes), 0);
  const filtersActive = !!query || eco !== "all" || minMb > 0 || minAge > 0 || onlyIgnored;

  const flip = (set: Set<string>, key: string) => { const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); return n; };
  const toggleItem = (i: Item) => setSelected((s) => { const n = flip(s, i.path); if (n.has(i.path)) i.parts.forEach((p) => n.delete(p.path)); return n; });
  const togglePart = (p: Part) => setSelected((s) => flip(s, p.path));
  const setAllParts = (i: Item, all: boolean) => setSelected((s) => { const n = new Set(s); i.parts.forEach((p) => (all ? n.add(p.path) : n.delete(p.path))); return n; });
  const toggleGroup = (its: Item[]) => setSelected((s) => {
    const free = its.filter((i) => !i.protected);
    const all = free.every((i) => s.has(i.path));
    const n = new Set(s);
    free.forEach((i) => { all ? n.delete(i.path) : n.add(i.path); i.parts.forEach((p) => n.delete(p.path)); });
    return n;
  });
  const selectable = filtered.filter((i) => !i.protected);
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.path));
  const someSelected = selectable.some((i) => selected.has(i.path) || i.parts.some((p) => selected.has(p.path)));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.path)));
  const onSort = (k: string) => setSort((s) => ({ key: k as SortKey, desc: s.key === k ? !s.desc : true }));

  async function doDelete() {
    setBusy(true);
    try {
      const out = await api.deleteItems(plan.map((e) => e.path));
      setConfirming(false);
      setResult(out);
      props.onDeleted(out);
      if (!out[0]?.dry_run) setSelected(new Set());
    } catch (e) {
      setConfirming(false);
      setResult([{ path: "(request)", ok: false, bytes_freed: 0, error: String(e), dry_run: false }]);
    } finally { setBusy(false); }
  }
  const clean = () => (settings.confirm_before_delete || plan.some((e) => e.warnings.some((w) => w.level === "danger")) ? setConfirming(true) : doDelete());

  const row = (i: Item, depth = 0) => {
    const partsSel = i.parts.filter((p) => selected.has(p.path)).length;
    return (
      <TreeRow key={i.path} model={toModel(i)} maxBytes={maxBytes} checked={selected.has(i.path)} partial={!selected.has(i.path) && partsSel > 0}
        depth={depth} focused={focus === i.path} expanded={expanded.has(i.path)} selectedParts={selected} partsLocked={selected.has(i.path)}
        onToggle={() => toggleItem(i)} onExpand={() => setExpanded((s) => flip(s, i.path))} onFocus={() => setFocus(i.path)}
        onTogglePart={togglePart} onSelectAllParts={(all) => setAllParts(i, all)} />
    );
  };

  const dialogs = (
    <>
      {confirming && <ConfirmDialog entries={plan} settings={settings} busy={busy} onConfirm={doDelete} onCancel={() => setConfirming(false)} />}
      {result && <ResultDialog result={result} onClose={() => setResult(null)} />}
      {showHelp && <HelpDialog settings={settings} rules={rules} onOpenSettings={props.onOpenSettings} onClose={() => setShowHelp(false)} />}
      {showWhere && <LocationsDialog items={items} onClose={() => setShowWhere(false)} onOpenSettings={props.onOpenSettings} />}
    </>
  );

  // ---------- states without a list ----------
  if (!settings.scan_roots.length && status === "idle") {
    return (
      <div className="h-full overflow-auto">
        <EmptyState icon="folder-plus" title="Choose where your projects live"
          description="Dev Cleaner only looks inside the folders you give it. Add the folder that holds your code, for example Documents/code or C:\development."
          actions={<><button className="btn btn-primary" onClick={props.onOpenSettings}><Icon name="folder-plus" />Add scan folders</button><button className="btn" onClick={() => setShowHelp(true)}>How it works</button></>} />
        {dialogs}
      </div>
    );
  }

  if (status === "idle") {
    return (
      <div className="h-full overflow-auto">
        <EmptyState icon="search" title="Ready to find reclaimable space"
          description={<>Dev Cleaner will look through <b>{settings.scan_roots.length}</b> folder{settings.scan_roots.length === 1 ? "" : "s"} for folders your tools can rebuild, like <code>node_modules</code>, build output and caches. Nothing is deleted until you choose it.</>}
          actions={<><button className="btn btn-primary" onClick={scan.start}><Icon name="search" />Scan now</button><button className="btn" onClick={() => setShowWhere(true)}><Icon name="eye" />Where it looks</button><button className="btn" onClick={() => setShowHelp(true)}><Icon name="info" />How it works</button></>} />
        <ul className="mx-auto mb-10 max-w-lg space-y-1 text-sm">
          {settings.scan_roots.map((r) => <li key={r} className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-xs dark:bg-slate-800"><Icon name="folder" className="h-4 w-4 text-slate-400" /><span className="truncate">{r}</span></li>)}
        </ul>
        {dialogs}
      </div>
    );
  }

  const p = scan.progress;
  const scanning = status === "scanning";
  const panel = scanning && (
    <ScanPanel title="Scanning your projects"
      phase={p?.phase === "measure" ? `Measuring sizes (${p.done} of ${p.total})` : "Looking for folders that can be cleaned"}
      fraction={p?.phase === "measure" && p.total ? p.done / p.total : null}
      current={p?.current}
      stats={[{ label: "Folders checked", value: p?.phase === "discover" ? p.visited.toLocaleString() : (scan.summary?.dirs_visited ?? "…") }, { label: "Found", value: items.length }]}
      elapsedMs={elapsed} onStop={scan.stop} />
  );

  if (scanning && !items.length) {
    return <div className="h-full overflow-auto"><div className="space-y-3">{panel}<div className="card overflow-hidden"><SkeletonRows /></div></div>{dialogs}</div>;
  }

  if (status === "error") {
    return (
      <div className="h-full overflow-auto">
        <div className="mb-3"><Banner tone="red" icon="x-circle" title="The scan could not finish" actions={<button className="btn btn-sm" onClick={scan.start}><Icon name="refresh" />Retry</button>}>{scan.error}</Banner></div>
        {dialogs}
      </div>
    );
  }

  if (!scanning && !items.length) {
    return (
      <div className="h-full overflow-auto">
        {status === "stopped" && <Banner tone="amber" icon="stop" title="Scan stopped before it found anything" />}
        {scan.summary?.missing_roots.length ? <div className="mt-3"><Banner tone="amber" icon="alert" title="Some scan folders do not exist">{scan.summary.missing_roots.join(", ")}</Banner></div> : null}
        <EmptyState tone="success" icon="check-circle" title="Nothing to clean here"
          description={<>Checked {scan.summary?.dirs_visited.toLocaleString() ?? 0} folders in {fmtDuration(scan.summary?.elapsed_ms ?? 0)} and found no rebuildable folders. Check your scan folders, or lower the minimum size in Settings.</>}
          actions={<><button className="btn btn-primary" onClick={scan.start}><Icon name="refresh" />Scan again</button><button className="btn" onClick={props.onOpenSettings}>Open settings</button><button className="btn" onClick={() => setShowWhere(true)}>Where it looks</button></>} />
        {dialogs}
      </div>
    );
  }

  // ---------- results ----------
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Can be cleaned" value={fmtBytes(totalAll)} tone="green" hint={scanning ? "still counting…" : undefined} />
        <StatCard label="Folders" value={items.length} hint={`in ${new Set(items.map((i) => i.project_path)).size} projects`} />
        <StatCard label="Selected" value={fmtBytes(planBytes)} hint={`${plan.length} folder${plan.length === 1 ? "" : "s"}`} />
        <div className="card flex items-center justify-center gap-2 px-3">
          {!scanning && <button className="btn" onClick={scan.start}><Icon name="refresh" />Rescan</button>}
          <button className="btn btn-ghost" onClick={() => setShowWhere(true)} title="Where it looks"><Icon name="eye" /></button>
          <button className="btn btn-ghost" onClick={() => setShowHelp(true)} title="How it works"><Icon name="info" /></button>
        </div>
      </div>

      {panel}
      {status === "stopped" && <Banner tone="amber" icon="stop" title="Scan stopped" actions={<button className="btn btn-sm" onClick={scan.start}>Scan again</button>}>These are the results found so far. Sizes may be incomplete.</Banner>}
      {status === "done" && scan.summary?.missing_roots.length ? <Banner tone="amber" icon="alert" title="Some scan folders do not exist">{scan.summary.missing_roots.join(", ")}</Banner> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input w-60" style={{ paddingLeft: "2rem" }} placeholder="Search path or type" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="input" value={eco} onChange={(e) => setEco(e.target.value)} aria-label="Type"><option value="all">All types</option>{ecosystems.map((x) => <option key={x}>{x}</option>)}</select>
        <label className="muted flex items-center gap-1.5 text-xs">Min size<input className="input w-16" type="number" min={0} value={minMb} onChange={(e) => setMinMb(Number(e.target.value))} />MB</label>
        <label className="muted flex items-center gap-1.5 text-xs">Idle<input className="input w-16" type="number" min={0} value={minAge} onChange={(e) => setMinAge(Number(e.target.value))} />days</label>
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="cb" checked={onlyIgnored} onChange={(e) => setOnlyIgnored(e.target.checked)} />Only git-ignored</label>
        <div className="ml-auto"><Segmented<View> value={view} onChange={setView} options={[{ value: "project", label: "By project", icon: "folder" }, { value: "flat", label: "Flat", icon: "layers" }, { value: "treemap", label: "Map", icon: "box" }]} /></div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="card min-w-0 flex-1 overflow-auto">
          {!filtered.length ? (
            <EmptyState icon="search" title="No folders match these filters" description={`${items.length} found, all hidden by the filters above.`}
              actions={filtersActive && <button className="btn" onClick={() => { setQuery(""); setEco("all"); setMinMb(0); setMinAge(0); setOnlyIgnored(false); }}>Clear filters</button>} />
          ) : view === "treemap" ? (
            <div className="p-3"><Treemap items={filtered} selected={focus} onSelect={setFocus} /></div>
          ) : (
            <div className="min-w-[860px]">
              <ListHeader columns={COLUMNS} sortKey={sort.key} desc={sort.desc} onSort={onSort} allChecked={allSelected} someChecked={!allSelected && someSelected} onToggleAll={toggleAll} />
              {view === "flat" ? filtered.map((i) => row(i, 0)) : groups.map((g) => {
                const free = g.items.filter((i) => !i.protected);
                const all = free.length > 0 && free.every((i) => selected.has(i.path));
                const some = g.items.some((i) => selected.has(i.path) || i.parts.some((x) => selected.has(x.path)));
                return (
                  <div key={g.path}>
                    <GroupHeader icon="folder" title={g.name} sub={g.path} count={g.items.length} countLabel={g.items.length === 1 ? "folder" : "folders"} bytes={g.bytes} open={!collapsed.has(g.path)}
                      onToggleOpen={() => setCollapsed((s) => flip(s, g.path))} checked={all} partial={!all && some} onToggle={() => toggleGroup(g.items)} />
                    {!collapsed.has(g.path) && g.items.map((i) => row(i, 1))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {focusItem && <Details item={focusItem} onClose={() => setFocus(null)} />}
      </div>

      <SelectionBar count={plan.length} bytes={planBytes} noun="folder" modeLabel={settings.delete_mode === "trash" ? "Moves to Trash, recoverable" : "Deleted permanently"}
        dryRun={settings.dry_run} busy={busy} onClear={() => setSelected(new Set())} onClean={clean} blockedReason={scanning ? "Wait for the scan to finish" : undefined} />
      {dialogs}
    </div>
  );
}
