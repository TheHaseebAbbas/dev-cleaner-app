import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, ageDays, fmtAge, fmtBytes, fmtDuration, type DeleteOutcome, type Item, type Part, type Rule, type Settings } from "../api";
import { Details } from "../components/Details";
import { ConfirmDialog, HelpDialog, LocationsDialog, ResultDialog, type PlanEntry } from "../components/dialogs";
import { ScanPanel } from "../components/ScanPanel";
import { SelectionBar } from "../components/SelectionBar";
import { ExpandToggle, FlatHeader, GroupHeader, TreeRow, type RowModel } from "../components/Tree";
import { Treemap } from "../components/Treemap";
import { useCmd } from "../hooks/commands";
import { useElapsed, type useScan } from "../hooks/useScans";
import { Icon } from "../ui/Icon";
import { Badge, Banner, EmptyState, MetricStrip, PageHeader, Popover, Segmented, SkeletonRows } from "../ui/primitives";
import { WarnBadge } from "../ui/warnings";

type SortKey = "size" | "name" | "project" | "active";
type View = "project" | "flat" | "map";

function toModel(i: Item, flat: boolean): RowModel {
  return {
    key: i.path, name: i.rule_name, desc: i.description || i.rule_name, meta: flat ? undefined : `${i.ecosystem} · ${i.file_count.toLocaleString()} files`,
    bytes: i.disk_bytes, parts: i.parts, protected: i.protected,
    flat: flat ? { type: i.ecosystem, project: i.project_name } : undefined,
    badges: (
      <>
        {i.protected && <Badge icon="lock">Protected</Badge>}
        <WarnBadge warnings={i.warnings} />
        {i.git_tracked && <Badge tone="red">In Git</Badge>}
      </>
    ),
  };
}

export function Projects(props: {
  scan: ReturnType<typeof useScan>;
  settings: Settings;
  onChangeSettings: (s: Settings) => void;
  onOpenSettings: () => void;
  onDeleted: (o: DeleteOutcome[]) => void;
}) {
  const { scan, settings } = props;
  const { items, status } = scan;
  const [rules, setRules] = useState<Rule[]>([]);
  const [query, setQuery] = useState("");
  const [eco, setEco] = useState("all");
  const [ruleName, setRuleName] = useState("all");
  const [minMb, setMinMb] = useState(settings.min_size_mb);
  const [minAge, setMinAge] = useState(settings.min_age_days);
  const [onlyIgnored, setOnlyIgnored] = useState(false);
  const [hideWarn, setHideWarn] = useState(false);
  const [hideProtected, setHideProtected] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "size", desc: true });
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
  const searchRef = useRef<HTMLInputElement>(null);
  const elapsed = useElapsed(scan.startedAt, status === "scanning");

  useEffect(() => { api.listRules().then(setRules); }, [settings.custom_rules, settings.rule_enabled]);

  const ecosystems = useMemo(() => [...new Set(items.map((i) => i.ecosystem))].sort(), [items]);
  const ruleNames = useMemo(() => [...new Set(items.map((i) => i.rule_name))].sort(), [items]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((i) =>
      (eco === "all" || i.ecosystem === eco) && (ruleName === "all" || i.rule_name === ruleName) &&
      i.disk_bytes >= minMb * 1024 * 1024 && ageDays(i.project_last_modified) >= minAge &&
      (!onlyIgnored || i.git_ignored !== false) && (!hideWarn || !i.warnings.length) && (!hideProtected || !i.protected) &&
      (!q || `${i.path} ${i.rule_name} ${i.ecosystem} ${i.project_name}`.toLowerCase().includes(q)));
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const cmp = sort.key === "size" ? a.disk_bytes - b.disk_bytes : sort.key === "name" ? a.rule_name.localeCompare(b.rule_name) : sort.key === "project" ? a.project_name.localeCompare(b.project_name) : a.project_last_modified - b.project_last_modified;
      return cmp * dir;
    });
  }, [items, query, eco, ruleName, minMb, minAge, onlyIgnored, hideWarn, hideProtected, sort]);

  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of filtered) m.set(i.project_path, [...(m.get(i.project_path) ?? []), i]);
    const arr = [...m.entries()].map(([path, its]) => ({ path, name: its[0].project_name, items: its, bytes: its.reduce((s, i) => s + i.disk_bytes, 0), active: Math.max(...its.map((i) => i.project_last_modified)) }));
    const dir = sort.desc ? -1 : 1;
    return arr.sort((a, b) => (sort.key === "name" || sort.key === "project" ? a.name.localeCompare(b.name) : sort.key === "active" ? a.active - b.active : a.bytes - b.bytes) * dir);
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
  const projectCount = new Set(items.map((i) => i.project_path)).size;
  const focusItem = items.find((i) => i.path === focus) ?? null;
  const maxBytes = filtered.reduce((m, i) => Math.max(m, i.disk_bytes), 0);
  const filterCount = [eco !== "all", ruleName !== "all", minMb > 0, minAge > 0, onlyIgnored, hideWarn, hideProtected].filter(Boolean).length;
  const clearFilters = () => { setEco("all"); setRuleName("all"); setMinMb(0); setMinAge(0); setOnlyIgnored(false); setHideWarn(false); setHideProtected(false); };

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

  const withParts = filtered.filter((i) => i.parts.length);
  const allOpen = (view === "project" ? groups.every((g) => !collapsed.has(g.path)) : true) && withParts.every((i) => expanded.has(i.path));
  const setAllOpen = (open: boolean) => {
    setExpanded(open ? new Set(withParts.map((i) => i.path)) : new Set());
    setCollapsed(open ? new Set() : new Set(groups.map((g) => g.path)));
  };

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
  const dangerous = plan.some((e) => e.warnings.some((w) => w.level === "danger"));
  const clean = () => (settings.confirm_before_delete || dangerous ? setConfirming(true) : doDelete());

  useCmd((cmd) => {
    if (cmd === "scan") { status === "scanning" ? scan.stop() : scan.start(); }
    else if (cmd === "select-all") toggleAll();
    else if (cmd === "delete") { if (plan.length && status !== "scanning" && !busy) clean(); }
    else if (cmd === "storage-map") setView("map");
    else if (cmd === "focus-search") searchRef.current?.focus();
    else if (cmd === "escape") { if (focus) setFocus(null); else if (selected.size) setSelected(new Set()); else return false; }
  });

  const row = (i: Item, depth: number, flat = false) => {
    const partsSel = i.parts.filter((p) => selected.has(p.path)).length;
    return (
      <TreeRow key={i.path} model={toModel(i, flat)} maxBytes={maxBytes} checked={selected.has(i.path)} partial={!selected.has(i.path) && partsSel > 0}
        depth={depth} focused={focus === i.path} expanded={expanded.has(i.path)} selectedParts={selected} partsLocked={selected.has(i.path)}
        onToggle={() => toggleItem(i)} onExpand={() => setExpanded((s) => flip(s, i.path))} onFocus={() => setFocus(i.path)}
        onTogglePart={togglePart} onSelectAllParts={(all) => setAllParts(i, all)} />
    );
  };

  async function addFolders() {
    const p = await open({ directory: true, multiple: true });
    const picked = Array.isArray(p) ? p : typeof p === "string" ? [p] : [];
    if (picked.length) props.onChangeSettings({ ...settings, scan_roots: [...new Set([...settings.scan_roots, ...picked])] });
  }

  const header = (actions?: React.ReactNode) => <PageHeader title="Projects" subtitle="Reclaim rebuildable files from your development projects." actions={actions} />;
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
        {header()}
        <EmptyState icon="folder-plus" title="Choose where your projects live" description="Dev Cleaner only scans folders you explicitly choose."
          actions={<><button className="btn btn-primary" onClick={addFolders}><Icon name="folder-plus" className="h-[18px] w-[18px]" />Add project folders</button><button className="btn" onClick={() => setShowHelp(true)}>How it works</button></>} />
        {dialogs}
      </div>
    );
  }

  if (status === "idle") {
    return (
      <div className="h-full overflow-auto">
        {header()}
        <div className="card">
          <EmptyState icon="search" title="Ready to find reclaimable space"
            description={<>Dev Cleaner will look through <b>{settings.scan_roots.length}</b> folder{settings.scan_roots.length === 1 ? "" : "s"} for rebuildable files such as <code>node_modules</code> and build output. Nothing is deleted until you choose it.</>}
            actions={<><button className="btn btn-primary" onClick={scan.start}><Icon name="search" className="h-[18px] w-[18px]" />Scan projects</button><button className="btn btn-ghost" onClick={() => setShowWhere(true)}>Where it looks</button><button className="btn btn-ghost" onClick={() => setShowHelp(true)}>How it works</button></>} />
        </div>
        <ul className="mt-4 flex flex-wrap gap-2">
          {settings.scan_roots.map((r) => <li key={r} className="mono flex max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs dark:bg-slate-800"><Icon name="folder" className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{r}</span></li>)}
        </ul>
        {dialogs}
      </div>
    );
  }

  const p = scan.progress;
  const scanning = status === "scanning";
  const scanBtn = scanning
    ? <button className="btn" onClick={scan.stop}><Icon name="stop" className="h-3 w-3" />Stop</button>
    : <button className="btn" onClick={scan.start}><Icon name="refresh" className="h-4 w-4" />Rescan</button>;
  const panel = scanning && (
    <div className="mb-4"><ScanPanel title="Scanning projects"
      phase={p?.phase === "measure" ? `Measuring folder sizes (${p.done} of ${p.total})` : "Looking for rebuildable folders"}
      fraction={p?.phase === "measure" && p.total ? p.done / p.total : null}
      current={p?.current}
      stats={[{ label: "Folders checked", value: p?.phase === "discover" ? p.visited.toLocaleString() : (scan.summary?.dirs_visited ?? "…") }, { label: "Found", value: items.length }]}
      elapsedMs={elapsed} onStop={scan.stop} /></div>
  );

  if (scanning && !items.length) {
    return <div className="h-full overflow-auto">{header(scanBtn)}{panel}<div className="card overflow-hidden"><SkeletonRows /></div>{dialogs}</div>;
  }

  if (status === "error") {
    return (
      <div className="h-full overflow-auto">
        {header()}
        <Banner tone="red" icon="x-circle" title="Could not finish the scan" actions={<button className="btn btn-sm" onClick={scan.start}><Icon name="refresh" className="h-3.5 w-3.5" />Try again</button>}>
          We stopped because: {scan.error}
        </Banner>
        {dialogs}
      </div>
    );
  }

  if (!scanning && !items.length) {
    return (
      <div className="h-full overflow-auto">
        {header()}
        {status === "stopped" && <div className="mb-3"><Banner tone="amber" icon="stop" title="Scan stopped before it found anything" /></div>}
        {scan.summary?.missing_roots.length ? <div className="mb-3"><Banner tone="amber" icon="alert" title="Some scan folders do not exist">{scan.summary.missing_roots.join(", ")}</Banner></div> : null}
        <div className="card">
          <EmptyState tone="success" icon="check-circle" title="Nothing to clean here"
            description={<>Checked {settings.scan_roots.length} project folder{settings.scan_roots.length === 1 ? "" : "s"} in {fmtDuration(scan.summary?.elapsed_ms ?? 0)}.<br />No rebuildable folders were found.</>}
            actions={<><button className="btn btn-primary" onClick={scan.start}><Icon name="refresh" className="h-4 w-4" />Scan again</button><button className="btn" onClick={props.onOpenSettings}>Settings</button></>} />
        </div>
        {dialogs}
      </div>
    );
  }

  // ---------- results ----------
  const note = scanning ? "Still scanning…" : status === "stopped" ? "Scan stopped" : `Scan complete · ${fmtDuration(scan.summary?.elapsed_ms ?? 0)}`;
  return (
    <div className="flex h-full flex-col">
      {header(<>{scanBtn}<button className="btn btn-ghost" onClick={() => setShowWhere(true)} aria-label="Where it looks" title="Where it looks"><Icon name="eye" className="h-[18px] w-[18px]" /></button><button className="btn btn-ghost" onClick={() => setShowHelp(true)} aria-label="How it works" title="How it works"><Icon name="info" className="h-[18px] w-[18px]" /></button></>)}
      <MetricStrip note={note} items={[{ label: "Reclaimable", value: fmtBytes(totalAll), hero: true }, { label: "Folders", value: items.length }, { label: "Projects", value: projectCount }]} />
      {panel}
      {status === "stopped" && <div className="mb-3"><Banner tone="amber" icon="stop" title="Scan stopped" actions={<button className="btn btn-sm" onClick={scan.start}>Scan again</button>}>These are the results found so far. Sizes may be incomplete.</Banner></div>}
      {status === "done" && scan.summary?.missing_roots.length ? <div className="mb-3"><Banner tone="amber" icon="alert" title="Some scan folders do not exist">{scan.summary.missing_roots.join(", ")}</Banner></div> : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input ref={searchRef} className="input w-72 max-w-full" style={{ paddingLeft: "2rem" }} placeholder="Search projects and folders..." aria-label="Search projects and folders" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Popover label="Filters" icon="filter" badge={filterCount} width="w-80">
          {(close) => (
            <div className="space-y-3 text-[13px]">
              <div className="font-semibold">Filters</div>
              <label className="block"><span className="muted mb-1 block text-xs">Ecosystem</span>
                <select className="input w-full" value={eco} onChange={(e) => setEco(e.target.value)}><option value="all">All ecosystems</option>{ecosystems.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="block"><span className="muted mb-1 block text-xs">Folder type</span>
                <select className="input w-full" value={ruleName} onChange={(e) => setRuleName(e.target.value)}><option value="all">All folder types</option>{ruleNames.map((x) => <option key={x}>{x}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="muted mb-1 block text-xs">Minimum size (MB)</span><input className="input w-full" type="number" min={0} value={minMb} onChange={(e) => setMinMb(Number(e.target.value))} /></label>
                <label className="block"><span className="muted mb-1 block text-xs">Idle for (days)</span><input className="input w-full" type="number" min={0} value={minAge} onChange={(e) => setMinAge(Number(e.target.value))} /></label>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" className="cb" checked={onlyIgnored} onChange={(e) => setOnlyIgnored(e.target.checked)} />Only Git-ignored</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="cb" checked={hideWarn} onChange={(e) => setHideWarn(e.target.checked)} />Hide folders with warnings</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="cb" checked={hideProtected} onChange={(e) => setHideProtected(e.target.checked)} />Hide protected folders</label>
              <div className="flex justify-between pt-1"><button className="btn btn-sm" onClick={clearFilters}>Clear filters</button><button className="btn btn-sm btn-primary" onClick={close}>Done</button></div>
            </div>
          )}
        </Popover>
        <Popover label="Sort" icon="sort" width="w-56">
          {(close) => (
            <div className="space-y-1 text-[13px]" role="radiogroup" aria-label="Sort by">
              <div className="muted mb-1 text-xs font-semibold uppercase tracking-wide">Sort by</div>
              {([["size", "Size"], ["name", "Name"], ["project", "Project"], ["active", "Last active"]] as [SortKey, string][]).map(([k, label]) => (
                <button key={k} role="radio" aria-checked={sort.key === k} className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700/60 ${sort.key === k ? "font-semibold text-indigo-600 dark:text-indigo-300" : ""}`} onClick={() => { setSort({ key: k, desc: k === "size" || k === "active" }); close(); }}>
                  {label}{sort.key === k && <Icon name="check" className="h-4 w-4" />}
                </button>
              ))}
              <div className="mt-2 border-t pt-2 divider"><Segmented value={sort.desc ? "desc" : "asc"} onChange={(v) => setSort({ ...sort, desc: v === "desc" })} options={[{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]} /></div>
            </div>
          )}
        </Popover>
        <div className="ml-auto flex items-center gap-2">
          {view !== "map" && filtered.length > 0 && <ExpandToggle allOpen={allOpen} onChange={setAllOpen} />}
          <Segmented<View> value={view} onChange={setView} options={[{ value: "project", label: "By project", icon: "folder" }, { value: "flat", label: "Flat", icon: "layers" }, { value: "map", label: "Storage map", icon: "map" }]} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="card min-w-0 flex-1 overflow-auto">
          {!filtered.length ? (
            <EmptyState icon="search" title="No folders match these filters" description={`${items.length} found, all hidden by the search or filters.`}
              actions={(filterCount > 0 || query) && <button className="btn" onClick={() => { clearFilters(); setQuery(""); }}>Clear filters</button>} />
          ) : view === "map" ? (
            <div className="p-4">
              <h2 className="text-[15px] font-semibold">Storage map</h2>
              <p className="muted mb-3 text-[13px]">See where reclaimable space is concentrated.</p>
              <Treemap items={filtered} selected={focus} onSelect={setFocus} />
            </div>
          ) : view === "flat" ? (
            <div className="min-w-[640px]">
              <FlatHeader sortKey={sort.key} desc={sort.desc} onSort={(k) => setSort((s) => ({ key: k as SortKey, desc: s.key === k ? !s.desc : k === "size" }))} allChecked={allSelected} someChecked={!allSelected && someSelected} onToggleAll={toggleAll} />
              {filtered.map((i) => row(i, 0, true))}
            </div>
          ) : (
            groups.map((g) => {
              const free = g.items.filter((i) => !i.protected);
              const all = free.length > 0 && free.every((i) => selected.has(i.path));
              const some = g.items.some((i) => selected.has(i.path) || i.parts.some((x) => selected.has(x.path)));
              return (
                <div key={g.path}>
                  <GroupHeader icon="folder" title={g.name} path={g.path} detail={`${g.items.length} reclaimable folder${g.items.length === 1 ? "" : "s"} · Last active ${fmtAge(g.active)}`} bytes={g.bytes} open={!collapsed.has(g.path)}
                    onToggleOpen={() => setCollapsed((s) => flip(s, g.path))} checked={all} partial={!all && some} onToggle={() => toggleGroup(g.items)} />
                  {!collapsed.has(g.path) && g.items.map((i) => row(i, 1))}
                </div>
              );
            })
          )}
        </div>
        {focusItem && <Details item={focusItem} onClose={() => setFocus(null)} />}
      </div>

      <SelectionBar count={plan.length} bytes={planBytes} noun="folder" permanent={settings.delete_mode === "permanent"}
        dryRun={settings.dry_run} busy={busy} onClear={() => setSelected(new Set())} onClean={clean} blockedReason={scanning ? "Wait for the scan to finish" : undefined} />
      {dialogs}
    </div>
  );
}
