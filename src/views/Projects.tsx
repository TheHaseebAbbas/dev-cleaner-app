import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, ageDays, fmtAge, fmtBytes, fmtDuration, failedReport, kindLine, profileMatches, reclaimOf, type CleanupProfile, type DeleteReport, type GitStatus, type Item, type Part, type Preview, type Rule, type Settings, type Verdict } from "../api";
import { Details } from "../components/Details";
import { CleanupNotice, ConfirmDialog, HelpDialog, LocationsDialog, ResultDialog, type PlanEntry } from "../components/dialogs";
import { ScanPanel } from "../components/ScanPanel";
import { SelectionBar } from "../components/SelectionBar";
import { ExpandToggle, FlatHeader, GroupHeader, TreeRow, type RowModel } from "../components/Tree";
import { Treemap } from "../components/Treemap";
import { useCmd } from "../hooks/commands";
import { useElapsed, type useScan } from "../hooks/useScans";
import { checksFor } from "../ui/checks";
import { Icon } from "../ui/Icon";
import { Banner, Checkbox, EmptyState, MenuSelect, MetricStrip, PageHeader, Popover, Segmented, SkeletonRows } from "../ui/primitives";
import { VerdictBadge } from "../ui/warnings";

type SortKey = "size" | "name" | "project" | "active";
type View = "project" | "flat" | "map";

const PROFILES: { value: CleanupProfile; label: string; hint: string }[] = [
  { value: "safe", label: "Safe", hint: "Recommended build output and caches that rebuild without downloads" },
  { value: "recommended", label: "Recommended", hint: "Everything marked Recommended" },
  { value: "deep", label: "Deep", hint: "Recommended and Review items. Never Keep or protected ones" },
];

const MOD = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl";
const hasBlockedPart = (i: Item) => i.parts.some((p) => p.block);

function toModel(i: Item, flat: boolean, verdicts: boolean): RowModel {
  const partsOnly = !i.block && hasBlockedPart(i);
  return {
    key: i.id,
    name: i.rule_name,
    kind: flat ? kindLine(i.ecosystem, i.category) : i.package_path && i.package_path !== i.project_path ? `${kindLine(i.ecosystem, i.category)} · ${i.package_path.startsWith(i.project_path) ? i.package_path.slice(i.project_path.length + 1) : i.package_path}` : kindLine(i.ecosystem, i.category),
    bytes: i.disk_bytes,
    parts: i.parts,
    state: i.block ? "blocked" : partsOnly ? "parts" : "selectable",
    reason: i.block?.reason ?? (partsOnly ? "Some parts must be kept, so choose parts one at a time." : undefined),
    checks: checksFor({ ...i }),
    badges: verdicts && !i.block ? <VerdictBadge rec={i.recommendation} block={i.block} /> : undefined,
    owner: { category: i.category, warnings: i.warnings, block: i.block },
    flat: flat ? { type: i.ecosystem, project: i.project_name } : undefined,
  };
}

export function Projects(props: {
  scan: ReturnType<typeof useScan>;
  settings: Settings;
  onChangeSettings: (s: Settings) => void;
  onOpenSettings: () => void;
  onDeleted: (r: DeleteReport) => void;
}) {
  const { scan, settings } = props;
  const { items, status } = scan;
  const est = settings.show_reclaim_estimate;
  const [rules, setRules] = useState<Rule[]>([]);
  const [query, setQuery] = useState("");
  const [eco, setEco] = useState("all");
  const [ruleName, setRuleName] = useState("all");
  const [minMb, setMinMb] = useState(settings.min_size_mb);
  const [minAge, setMinAge] = useState(settings.min_age_days);
  const [git, setGit] = useState<"all" | GitStatus>("all");
  const [verdict, setVerdict] = useState<"all" | Verdict>("all");
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
  const [result, setResult] = useState<DeleteReport | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const elapsed = useElapsed(scan.startedAt, status === "scanning");

  useEffect(() => { api.listRules().then(setRules); }, [settings.custom_rules, settings.rule_enabled]);
  const ruleNames = useMemo(() => Object.fromEntries(rules.map((r) => [r.id, r.name])), [rules]);

  const ecosystems = useMemo(() => [...new Set(items.map((i) => i.ecosystem))].sort(), [items]);
  const folderTypes = useMemo(() => [...new Set(items.map((i) => i.rule_name))].sort(), [items]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((i) =>
      (eco === "all" || i.ecosystem === eco) && (ruleName === "all" || i.rule_name === ruleName) &&
      i.disk_bytes >= minMb * 1024 * 1024 && ageDays(i.project_last_modified) >= minAge &&
      (git === "all" || i.git === git || (git === "tracked" && i.git === "modified")) &&
      (verdict === "all" || (i.block ? "blocked" : i.recommendation.verdict) === verdict) &&
      (!hideWarn || !i.warnings.length) && (!hideProtected || !i.block) &&
      (!q || `${i.path} ${i.rule_name} ${i.rule_id} ${i.ecosystem} ${i.project_name}`.toLowerCase().includes(q)));
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const cmp = sort.key === "size" ? a.disk_bytes - b.disk_bytes : sort.key === "name" ? a.rule_name.localeCompare(b.rule_name) : sort.key === "project" ? a.project_name.localeCompare(b.project_name) : a.project_last_modified - b.project_last_modified;
      return cmp * dir;
    });
  }, [items, query, eco, ruleName, minMb, minAge, git, verdict, hideWarn, hideProtected, sort]);

  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of filtered) m.set(i.project_path, [...(m.get(i.project_path) ?? []), i]);
    const arr = [...m.entries()].map(([path, its]) => ({ path, name: its[0].project_name, items: its, bytes: its.reduce((s, i) => s + i.disk_bytes, 0), active: Math.max(...its.map((i) => i.project_last_modified)), cleanable: its.filter((i) => !i.block).length, ws: its.find((i) => i.workspace)?.workspace }));
    const dir = sort.desc ? -1 : 1;
    return arr.sort((a, b) => (sort.key === "name" || sort.key === "project" ? a.name.localeCompare(b.name) : sort.key === "active" ? a.active - b.active : a.bytes - b.bytes) * dir);
  }, [filtered, sort]);

  const plan: (PlanEntry & { id: string })[] = useMemo(() => {
    const out: (PlanEntry & { id: string })[] = [];
    for (const i of items) {
      if (selected.has(i.id)) out.push({ id: i.id, path: i.path, label: i.path, bytes: reclaimOf(i, est), warnings: i.warnings });
      else for (const p of i.parts) if (selected.has(p.id)) out.push({ id: p.id, path: p.path, label: p.path, bytes: reclaimOf(p, est), warnings: [...i.warnings, ...(p.warning ? [p.warning] : [])] });
    }
    return out;
  }, [items, selected, est]);
  const planBytes = plan.reduce((s, e) => s + e.bytes, 0);
  const free = items.filter((i) => !i.block);
  const totalAll = free.reduce((s, i) => s + reclaimOf(i, est), 0);
  const verdicts = settings.recommendations_enabled;
  const projectCount = new Set(free.map((i) => i.project_path)).size;
  const focusItem = items.find((i) => i.id === focus) ?? null;
  const maxBytes = filtered.reduce((m, i) => Math.max(m, i.disk_bytes), 0);
  const filterCount = [eco !== "all", ruleName !== "all", minMb > 0, minAge > 0, git !== "all", verdict !== "all", hideWarn, hideProtected].filter(Boolean).length;
  const clearFilters = () => { setEco("all"); setRuleName("all"); setMinMb(0); setMinAge(0); setGit("all"); setVerdict("all"); setHideWarn(false); setHideProtected(false); };

  const flip = (set: Set<string>, key: string) => { const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); return n; };
  const wholeOk = (i: Item) => !i.block && !hasBlockedPart(i);
  const toggleItem = (i: Item) => setSelected((s) => { const n = flip(s, i.id); if (n.has(i.id)) i.parts.forEach((p) => n.delete(p.id)); return n; });
  const togglePart = (p: Part) => setSelected((s) => flip(s, p.id));
  const setAllParts = (i: Item, all: boolean) => setSelected((s) => { const n = new Set(s); i.parts.forEach((p) => (all && !p.block ? n.add(p.id) : n.delete(p.id))); return n; });
  const toggleGroup = (its: Item[]) => setSelected((s) => {
    const ok = its.filter(wholeOk);
    const all = ok.every((i) => s.has(i.id));
    const n = new Set(s);
    ok.forEach((i) => { all ? n.delete(i.id) : n.add(i.id); i.parts.forEach((p) => n.delete(p.id)); });
    return n;
  });
  const selectable = filtered.filter(wholeOk);
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.id));
  const someSelected = filtered.some((i) => selected.has(i.id) || i.parts.some((p) => selected.has(p.id)));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.id)));
  const quickSelect = (profile: CleanupProfile) => setSelected(new Set(filtered.filter((i) => wholeOk(i) && profileMatches(i, profile)).map((i) => i.id)));

  const withParts = filtered.filter((i) => i.parts.length);
  const allOpen = (view === "project" ? groups.every((g) => !collapsed.has(g.path)) : true) && withParts.every((i) => expanded.has(i.id));
  const setAllOpen = (o: boolean) => {
    setExpanded(o ? new Set(withParts.map((i) => i.id)) : new Set());
    setCollapsed(o ? new Set() : new Set(groups.map((g) => g.path)));
  };

  const scanId = scan.summary?.scan_id ?? items[0]?.scan_id ?? "";
  const scanAgeMin = scan.summary?.completed_at ? Math.floor((Date.now() / 1000 - scan.summary.completed_at) / 60) : 0;
  const isScanning = status === "scanning";
  const partial = status === "stopped" || (status === "done" && scan.summary != null && !scan.summary.complete);
  const stale = status === "done" && settings.require_rescan_before_cleanup && scanAgeMin >= settings.stale_scan_minutes;
  const cleanBlocked = isScanning ? "Wait for the scan to finish"
    : partial ? "The scan did not finish. Run a full scan to clean."
    : stale ? `This scan is ${scanAgeMin} minutes old. Rescan to clean.` : undefined;

  async function doDelete(ack: boolean) {
    setBusy(true);
    try {
      const out = await api.deleteItems(scanId, plan.map((e) => e.id), ack);
      setConfirming(false);
      setResult(out);
      setResultOpen(out.removed === 0 && out.outcomes.some((o) => !o.ok));
      props.onDeleted(out);
      if (!out.dry_run) setSelected(new Set());
    } catch (e) {
      setConfirming(false);
      setResult(failedReport(String(e)));
      setResultOpen(true);
    } finally { setBusy(false); }
  }
  async function clean() {
    setPreview(null);
    setResult(null);
    if (settings.confirm_before_delete) setConfirming(true);
    try {
      const pv = await api.previewCleanup(scanId, plan.map((e) => e.id));
      const quiet = !pv.needs_ack && !pv.critical && !pv.problems.length && !plan.some((e) => e.warnings.length) && settings.delete_mode === "trash";
      if (!settings.confirm_before_delete && quiet) return doDelete(false);
      setPreview(pv);
      setConfirming(true);
    } catch (e) {
      setConfirming(false);
      setResult(failedReport(String(e)));
      setResultOpen(true);
    }
  }

  useCmd((cmd) => {
    if (cmd === "scan") { isScanning ? scan.stop() : scan.start(); }
    else if (cmd === "select-all") toggleAll();
    else if (cmd === "delete") { if (plan.length && !cleanBlocked && !busy) clean(); }
    else if (cmd === "storage-map") setView("map");
    else if (cmd === "focus-search") { searchRef.current?.focus(); searchRef.current?.select(); }
    else if (cmd === "escape") { if (focus) setFocus(null); else if (query && document.activeElement === searchRef.current) setQuery(""); else if (selected.size) setSelected(new Set()); else return false; }
    else return false;
  });

  const row = (i: Item, depth: number, flat = false) => {
    const partsSel = i.parts.filter((p) => selected.has(p.id)).length;
    return (
      <TreeRow key={i.id} model={toModel(i, flat, verdicts)} maxBytes={maxBytes} checked={selected.has(i.id)} partial={!selected.has(i.id) && partsSel > 0}
        depth={depth} focused={focus === i.id} expanded={expanded.has(i.id)} selectedParts={selected} partsLocked={selected.has(i.id)}
        onToggle={() => toggleItem(i)} onExpand={() => setExpanded((s) => flip(s, i.id))} onFocus={() => setFocus(i.id)}
        onTogglePart={togglePart} onSelectAllParts={(all) => setAllParts(i, all)} />
    );
  };

  async function addFolders() {
    const p = await open({ directory: true, multiple: true });
    const picked = Array.isArray(p) ? p : typeof p === "string" ? [p] : [];
    if (picked.length) props.onChangeSettings({ ...settings, scan_roots: [...new Set([...settings.scan_roots, ...picked])] });
  }

  const scanBtn = <button className="btn btn-primary" onClick={scan.start} disabled={isScanning}><Icon name={status === "idle" ? "search" : "refresh"} className="h-4 w-4" />{status === "idle" ? "Scan" : "Scan again"}</button>;
  const extras = <>
    <button className="btn btn-ghost" onClick={() => setShowWhere(true)} aria-label="Where it looks" title="Where it looks"><Icon name="eye" className="h-[18px] w-[18px]" /></button>
    <button className="btn btn-ghost" onClick={() => setShowHelp(true)} aria-label="How it works" title="How it works"><Icon name="info" className="h-[18px] w-[18px]" /></button>
  </>;
  const header = (actions = true) => <PageHeader title="Projects" subtitle="Reclaim rebuildable files from your development projects." actions={actions ? <>{extras}{scanBtn}</> : undefined} />;
  const dialogs = (
    <>
      {confirming && <ConfirmDialog entries={plan} preview={preview} settings={settings} busy={busy} onConfirm={doDelete} onCancel={() => setConfirming(false)} ruleNames={ruleNames} />}
      {result && resultOpen && <ResultDialog report={result} onClose={() => setResultOpen(false)} />}
      {showHelp && <HelpDialog settings={settings} rules={rules} onOpenSettings={props.onOpenSettings} onClose={() => setShowHelp(false)} />}
      {showWhere && <LocationsDialog items={items} onClose={() => setShowWhere(false)} onOpenSettings={props.onOpenSettings} />}
    </>
  );

  // ---------- states without a list ----------
  if (!settings.scan_roots.length && status === "idle") {
    return (
      <div className="h-full overflow-auto">
        {header(false)}
        <EmptyState icon="folder-plus" title="Choose where your projects live" description="Dev Cleaner only scans folders you choose."
          actions={<><button className="btn btn-primary" onClick={addFolders}><Icon name="folder-plus" className="h-[18px] w-[18px]" />Add project folders</button><button className="btn" onClick={() => setShowHelp(true)}>How it works</button></>} />
        {dialogs}
      </div>
    );
  }

  if (status === "idle") {
    return (
      <div className="h-full overflow-auto">
        {header()}
        <div className="rounded-[10px] border divider">
          <EmptyState icon="search" title="Ready to find reclaimable space"
            description={<>Dev Cleaner looks through {settings.scan_roots.length === 1 ? "your project folder" : `your ${settings.scan_roots.length} project folders`} for rebuildable files such as <code>node_modules</code> and build output. Nothing is deleted until you choose it.</>}
            actions={<button className="btn btn-primary" onClick={scan.start}><Icon name="search" className="h-[18px] w-[18px]" />Scan projects</button>} />
          <ul className="flex flex-wrap justify-center gap-2 px-6 pb-8">
            {settings.scan_roots.map((r) => <li key={r} className="mono flex max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs dark:bg-slate-800"><Icon name="folder" className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{r}</span></li>)}
          </ul>
        </div>
        {dialogs}
      </div>
    );
  }

  const p = scan.progress;
  const panel = isScanning && (
    <ScanPanel title={p?.phase === "measure" ? "Measuring folder sizes…" : "Scanning projects…"} roots={settings.scan_roots}
      fraction={p?.phase === "measure" && p.total ? p.done / p.total : null}
      current={p?.current}
      stats={[{ label: "Found", value: `${items.length} folder${items.length === 1 ? "" : "s"}` }, { label: "Scanned", value: `${p?.phase === "discover" ? p.visited.toLocaleString() : (scan.summary?.dirs_visited ?? 0).toLocaleString() || "…"} directories` }]}
      elapsedMs={elapsed} onCancel={scan.stop} />
  );

  if (isScanning && !items.length) {
    return <div className="h-full overflow-auto">{header()}{panel}<div className="overflow-hidden rounded-[10px] border divider"><SkeletonRows /></div>{dialogs}</div>;
  }

  if (status === "error") {
    return (
      <div className="h-full overflow-auto">
        {header()}
        <div className="rounded-[10px] border border-red-200 px-5 py-4 dark:border-red-900/60" role="alert">
          <div className="flex items-center gap-2 font-semibold"><Icon name="x-circle" className="h-4 w-4 text-red-600 dark:text-red-400" />Could not finish the scan</div>
          <p className="mt-1 text-[13px]">We stopped because: {scan.error}</p>
          <button className="btn mt-3" onClick={scan.start}><Icon name="refresh" className="h-4 w-4" />Try again</button>
        </div>
        {dialogs}
      </div>
    );
  }

  if (!isScanning && !items.length) {
    return (
      <div className="h-full overflow-auto">
        {header(false)}
        {status === "stopped" && <div className="mb-3"><Banner tone="amber" icon="stop" title="Scan cancelled before it found anything" /></div>}
        {scan.summary?.missing_roots.length ? <div className="mb-3"><Banner tone="amber" icon="alert" title="Some scan folders do not exist">{scan.summary.missing_roots.join(", ")}</Banner></div> : null}
        <div className="rounded-[10px] border divider">
          <EmptyState icon="check" title="Nothing to clean here"
            description={<>Checked {settings.scan_roots.length} project folder{settings.scan_roots.length === 1 ? "" : "s"} in {fmtDuration(scan.summary?.elapsed_ms ?? 0)}.<br />No rebuildable folders were found.</>}
            actions={<><button className="btn btn-primary" onClick={scan.start}><Icon name="refresh" className="h-4 w-4" />Scan again</button><button className="btn" onClick={props.onOpenSettings}>Settings</button></>} />
        </div>
        {dialogs}
      </div>
    );
  }

  // ---------- results ----------
  const note = isScanning ? null
    : partial ? <span className="text-amber-700 dark:text-amber-300">Scan cancelled · partial results</span>
    : <span className="flex items-center gap-1.5"><Icon name="check" className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />Scan complete · {fmtDuration(scan.summary?.elapsed_ms ?? 0)}{scanAgeMin >= 2 ? ` · ${fmtAge(scan.summary!.completed_at)}` : ""}</span>;
  return (
    <div className="flex h-full flex-col">
      {header()}
      <MetricStrip note={note} items={[{ label: "Reclaimable", value: fmtBytes(totalAll), hero: true }, { label: "Folders", value: free.length }, { label: "Projects", value: projectCount }]} />
      {panel}
      {partial && <div className="mb-3"><Banner tone="amber" icon="stop" title="Partial scan" actions={<button className="btn btn-sm" onClick={scan.start}>Scan again</button>}>These are the results found so far. Cleaning is turned off until a full scan finishes.</Banner></div>}
      {stale && <div className="mb-3"><Banner tone="amber" icon="clock" title="This scan is out of date" actions={<button className="btn btn-sm" onClick={scan.start}>Scan again</button>}>It finished {scanAgeMin} minutes ago. Scan again before cleaning.</Banner></div>}
      {status === "done" && scan.summary?.missing_roots.length ? <div className="mb-3"><Banner tone="amber" icon="alert" title="Some scan folders do not exist">{scan.summary.missing_roots.join(", ")}</Banner></div> : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-0 max-w-md flex-1 basis-56">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input ref={searchRef} className="input w-full" style={{ paddingLeft: "2rem", paddingRight: "3.5rem" }} placeholder="Search projects and folders..." aria-label="Search projects and folders" value={query} onChange={(e) => setQuery(e.target.value)} />
          {!query && <kbd className="pointer-events-none absolute right-2 top-2">{MOD} K</kbd>}
        </div>
        <Popover label="Filters" icon="filter" badge={filterCount} width="w-80">
          {(close) => (
            <div className="space-y-3 text-[13px]">
              <label className="block"><span className="muted mb-1 block text-xs">Ecosystem</span>
                <select className="input w-full" value={eco} onChange={(e) => setEco(e.target.value)}><option value="all">All ecosystems</option>{ecosystems.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="block"><span className="muted mb-1 block text-xs">Folder type</span>
                <select className="input w-full" value={ruleName} onChange={(e) => setRuleName(e.target.value)}><option value="all">All folder types</option>{folderTypes.map((x) => <option key={x}>{x}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="muted mb-1 block text-xs">Minimum size (MB)</span><input className="input w-full" type="number" min={0} value={minMb} onChange={(e) => setMinMb(Number(e.target.value))} /></label>
                <label className="block"><span className="muted mb-1 block text-xs">Idle for (days)</span><input className="input w-full" type="number" min={0} value={minAge} onChange={(e) => setMinAge(Number(e.target.value))} /></label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {verdicts && <label className="block"><span className="muted mb-1 block text-xs">Verdict</span>
                  <select className="input w-full" value={verdict} onChange={(e) => setVerdict(e.target.value as typeof verdict)}><option value="all">Any</option><option value="recommended">Recommended</option><option value="review">Review</option><option value="keep">Keep</option><option value="blocked">Protected</option></select></label>}
                <label className="block"><span className="muted mb-1 block text-xs">Git</span>
                  <select className="input w-full" value={git} onChange={(e) => setGit(e.target.value as typeof git)}><option value="all">Any</option><option value="ignored">Only Git-ignored</option><option value="untracked">Not tracked</option><option value="tracked">Tracked</option><option value="not_repository">No repository</option></select></label>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" className="cb" checked={hideWarn} onChange={(e) => setHideWarn(e.target.checked)} />Hide folders with warnings</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="cb" checked={hideProtected} onChange={(e) => setHideProtected(e.target.checked)} />Hide protected folders</label>
              <div className="border-t pt-3 divider">
                <span className="muted mb-1 block text-xs">Sort by</span>
                <div className="flex items-center gap-2">
                  <select className="input flex-1" value={sort.key} onChange={(e) => { const k = e.target.value as SortKey; setSort({ key: k, desc: k === "size" || k === "active" }); }} aria-label="Sort by">
                    <option value="size">Size</option><option value="name">Folder name</option><option value="project">Project</option><option value="active">Last active</option>
                  </select>
                  <Segmented value={sort.desc ? "desc" : "asc"} onChange={(v) => setSort({ ...sort, desc: v === "desc" })} options={[{ value: "asc", label: "Asc" }, { value: "desc", label: "Desc" }]} />
                </div>
              </div>
              <div className="flex justify-between pt-1"><button className="btn btn-sm" onClick={clearFilters}>Clear filters</button><button className="btn btn-sm btn-primary" onClick={close}>Done</button></div>
            </div>
          )}
        </Popover>
        <div className="ml-auto">
          <MenuSelect<View> label="View" value={view} onChange={setView} options={[{ value: "project", label: "By project", icon: "folder" }, { value: "flat", label: "Flat", icon: "layers" }, { value: "map", label: "Storage map", icon: "map", hint: "Where the space is concentrated" }]} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border bg-white divider dark:bg-slate-900">
          {view !== "map" && filtered.length > 0 && (
            <div className="flex items-center gap-3 border-b px-3 py-1.5 text-xs divider" style={{ paddingLeft: 40 }}>
              <Checkbox checked={allSelected} indeterminate={!allSelected && someSelected} onChange={toggleAll} label="Select all cleanable folders" disabled={!selectable.length} />
              <span className="muted">{filtered.length === items.length ? `${items.length} folders` : `${filtered.length} of ${items.length} folders`}{query || filterCount ? " shown" : ""}</span>
              {verdicts && (
                <Popover label="Quick select" icon="sparkles" width="w-80" triggerClass="btn btn-ghost btn-sm">
                  {(close) => (
                    <div className="space-y-1 text-[13px]">
                      <div className="muted mb-1 text-xs">Select from the list shown</div>
                      {PROFILES.map((pr) => (
                        <button key={pr.value} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700/60" onClick={() => { quickSelect(pr.value); close(); }}>
                          <span className="font-medium">{pr.label}</span>{pr.value === settings.default_cleanup_profile && <span className="muted"> · default</span>}
                          <span className="muted block text-xs">{pr.hint}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </Popover>
              )}
              <span className="ml-auto">{withParts.length > 0 || view === "project" ? <ExpandToggle allOpen={allOpen} onChange={setAllOpen} /> : null}</span>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            {!filtered.length ? (
              <EmptyState icon="search" title="No folders match" description={`${items.length} found, all hidden by the search or filters.`}
                actions={(filterCount > 0 || query) && <button className="btn" onClick={() => { clearFilters(); setQuery(""); }}>Clear search and filters</button>} />
            ) : view === "map" ? (
              <div className="p-4">
                <p className="muted mb-3 text-[13px]">The largest {Math.min(200, filtered.length)} folders. Click one to see its details.</p>
                <Treemap items={filtered} selected={focus} onSelect={setFocus} />
              </div>
            ) : view === "flat" ? (
              <div className="min-w-[560px]">
                <FlatHeader sortKey={sort.key} desc={sort.desc} onSort={(k) => setSort((s) => ({ key: k as SortKey, desc: s.key === k ? !s.desc : k === "size" }))} allChecked={allSelected} someChecked={!allSelected && someSelected} onToggleAll={toggleAll} />
                {filtered.map((i) => row(i, 0, true))}
              </div>
            ) : (
              groups.map((g) => {
                const ok = g.items.filter(wholeOk);
                const all = ok.length > 0 && ok.every((i) => selected.has(i.id));
                const some = g.items.some((i) => selected.has(i.id) || i.parts.some((x) => selected.has(x.id)));
                return (
                  <div key={g.path}>
                    <GroupHeader icon="folder" title={g.name} path={g.path} detail={`${g.cleanable} reclaimable folder${g.cleanable === 1 ? "" : "s"}${g.ws ? ` · ${g.ws.kind} workspace` : ""}`} bytes={g.bytes} open={!collapsed.has(g.path)}
                      onToggleOpen={() => setCollapsed((s) => flip(s, g.path))} checked={all} partial={!all && some} onToggle={ok.length ? () => toggleGroup(g.items) : undefined} />
                    {!collapsed.has(g.path) && g.items.map((i) => row(i, 1))}
                  </div>
                );
              })
            )}
          </div>
        </div>
        {focusItem && <Details item={focusItem} settings={settings} onClose={() => setFocus(null)} />}
      </div>

      {plan.length > 0 || busy
        ? <SelectionBar count={plan.length} bytes={planBytes} noun="folder" permanent={settings.delete_mode === "permanent"} dryRun={settings.dry_run} busy={busy} onClear={() => setSelected(new Set())} onClean={clean} blockedReason={cleanBlocked} />
        : result && <CleanupNotice report={result} noun="folder" onDetails={() => setResultOpen(true)} onClose={() => setResult(null)} />}
      {dialogs}
    </div>
  );
}
