import { useEffect, useMemo, useState } from "react";
import { api, ecosystemFamily, failedReport, fmtAge, fmtBytes, fmtDuration, kindLine, reclaimOf, type DeleteReport, type GlobalCache, type Location, type Preview, type Settings } from "../api";
import { DependencyMap } from "../components/DependencyMap";
import { Details } from "../components/Details";
import { CleanupNotice, ConfirmDialog, LocationsDialog, ResultDialog, type PlanEntry } from "../components/dialogs";
import { ScanPanel } from "../components/ScanPanel";
import { SelectionBar } from "../components/SelectionBar";
import { ExpandToggle, GroupHeader, TreeRow, type RowModel } from "../components/Tree";
import { useCmd } from "../hooks/commands";
import { useElapsed, type useGlobalScan } from "../hooks/useScans";
import { checksFor } from "../ui/checks";
import { Icon } from "../ui/Icon";
import { Banner, EmptyState, MenuSelect, MetricStrip, PageHeader, SkeletonRows } from "../ui/primitives";
import { VerdictBadge } from "../ui/warnings";

const VIEW_ONLY_NOTE = "View only. Dev Cleaner can show this location but does not delete it.";
type View = "locations" | "map";

function toModel(c: GlobalCache, verdicts: boolean): RowModel {
  const blockedPart = c.parts.some((p) => p.block);
  const state = c.info_only ? "view" : c.block ? "blocked" : c.parts_only || blockedPart ? "parts" : "selectable";
  return {
    key: c.id,
    name: c.name,
    kind: kindLine(c.ecosystem, c.category),
    bytes: c.disk_bytes,
    parts: c.parts,
    state,
    reason: c.info_only ? VIEW_ONLY_NOTE : c.block?.reason ?? (c.parts_only ? "Only individual parts can be removed." : blockedPart ? "Some parts must be kept, so choose parts one at a time." : undefined),
    checks: checksFor({ ...c, viewOnly: c.info_only }),
    badges: verdicts && state === "selectable" ? <VerdictBadge rec={c.recommendation} block={c.block} /> : undefined,
    owner: { category: c.category, warnings: c.warnings, block: c.block },
  };
}

export function GlobalView(props: { scan: ReturnType<typeof useGlobalScan>; settings: Settings; onOpenSettings: () => void; onDeleted: (r: DeleteReport) => void }) {
  const { scan, settings } = props;
  const { caches, status } = scan;
  const est = settings.show_reclaim_estimate;
  const [sel, setSel] = useState<Set<string>>(new Set()); // cache ids and part ids
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showWhere, setShowWhere] = useState(false);
  const [result, setResult] = useState<DeleteReport | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<View>("locations");
  const [missing, setMissing] = useState<Location[]>([]);
  const verdicts = settings.recommendations_enabled;
  const elapsed = useElapsed(scan.startedAt, status === "scanning");
  useEffect(() => { if (status === "done") api.getLocations().then((l) => setMissing(l.global.filter((g) => !g.exists))).catch(() => {}); }, [status]);

  const flip = (s: Set<string>, k: string) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; };
  const sorted = useMemo(() => [...caches].sort((a, b) => Number(a.info_only) - Number(b.info_only) || b.disk_bytes - a.disk_bytes), [caches]);
  const removable = sorted.filter((c) => !c.info_only);
  const viewOnlyCount = sorted.length - removable.length;
  const maxBytes = sorted.reduce((m, c) => Math.max(m, c.disk_bytes), 0);
  const total = removable.filter((c) => !c.block).reduce((s, c) => s + reclaimOf(c, est), 0);
  const focusCache = caches.find((c) => c.id === focus) ?? null;
  const groups = useMemo(() => {
    const m = new Map<string, GlobalCache[]>();
    for (const c of sorted) m.set(ecosystemFamily(c.ecosystem), [...(m.get(ecosystemFamily(c.ecosystem)) ?? []), c]);
    return [...m.entries()].map(([name, list]) => ({ name, list, bytes: list.filter((c) => !c.info_only).reduce((s, c) => s + c.disk_bytes, 0), viewOnly: list.every((c) => c.info_only) }))
      .sort((a, b) => Number(a.viewOnly) - Number(b.viewOnly) || b.bytes - a.bytes);
  }, [sorted]);

  const withParts = sorted.filter((c) => c.parts.length);
  const allOpen = groups.every((g) => !collapsed.has(g.name)) && withParts.every((c) => open.has(c.id));
  const setAllOpen = (v: boolean) => {
    setOpen(v ? new Set(withParts.map((c) => c.id)) : new Set());
    setCollapsed(v ? new Set() : new Set(groups.map((g) => g.name)));
  };

  const plan: (PlanEntry & { id: string; whole: boolean })[] = removable.flatMap((c): (PlanEntry & { id: string; whole: boolean })[] =>
    sel.has(c.id)
      ? [{ id: c.id, path: c.path, label: c.path, bytes: reclaimOf(c, est), whole: true, warnings: [...c.warnings, ...c.parts.flatMap((p) => (p.warning ? [p.warning] : []))] }]
      : c.parts.filter((p) => sel.has(p.id)).map((p) => ({ id: p.id, path: p.path, label: p.path, bytes: reclaimOf(p, est), whole: false, warnings: [...c.warnings, ...(p.warning ? [p.warning] : [])] })));
  const bytes = plan.reduce((s, e) => s + e.bytes, 0);
  const scanId = scan.summary?.scan_id ?? caches[0]?.scan_id ?? "";
  const ids = () => plan.filter((e) => e.whole).map((e) => e.id);
  const partIds = () => plan.filter((e) => !e.whole).map((e) => e.id);
  const scanning = status === "scanning";
  const cleanBlocked = scanning ? "Wait for the scan to finish" : status === "stopped" ? "The scan did not finish. Run a full scan to clean." : undefined;

  async function run(ack: boolean) {
    setBusy(true);
    try {
      const out = await api.deleteGlobalCaches(scanId, ids(), partIds(), ack);
      setConfirming(false);
      setResult(out);
      setResultOpen(out.removed === 0 && out.outcomes.some((o) => !o.ok));
      props.onDeleted(out);
      if (!out.dry_run) { setSel(new Set()); setFocus(null); scan.start(); }
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
      const pv = await api.previewGlobalCleanup(scanId, ids(), partIds());
      const quiet = !pv.needs_ack && !pv.critical && !pv.problems.length && !plan.some((e) => e.warnings.length) && settings.delete_mode === "trash";
      if (!settings.confirm_before_delete && quiet) return run(false);
      setPreview(pv);
      setConfirming(true);
    } catch (e) {
      setConfirming(false);
      setResult(failedReport(String(e)));
      setResultOpen(true);
    }
  }

  useCmd((cmd) => {
    if (cmd === "scan") { scanning ? scan.stop() : scan.start(); }
    else if (cmd === "select-all") setSel((s) => (s.size ? new Set() : new Set(removable.filter((c) => !c.parts_only && !c.block && !c.parts.some((p) => p.block)).map((c) => c.id))));
    else if (cmd === "delete") { if (plan.length && !cleanBlocked && !busy) clean(); }
    else if (cmd === "escape") { if (focus) setFocus(null); else if (sel.size) setSel(new Set()); else return false; }
    else return false;
  });

  const row = (c: GlobalCache) => {
    const partsSel = c.parts.filter((p) => sel.has(p.id)).length;
    return (
      <TreeRow key={c.id} model={toModel(c, verdicts)} maxBytes={maxBytes} checked={sel.has(c.id)} partial={!sel.has(c.id) && partsSel > 0}
        depth={1} focused={focus === c.id} expanded={open.has(c.id)} selectedParts={sel} partsLocked={sel.has(c.id)}
        onToggle={() => setSel((s) => { const n = flip(s, c.id); c.parts.forEach((p) => n.delete(p.id)); return n; })}
        onExpand={() => setOpen((s) => flip(s, c.id))} onFocus={() => setFocus(c.id)}
        onTogglePart={(p) => setSel((s) => flip(s, p.id))}
        onSelectAllParts={(all) => setSel((s) => { const n = new Set(s); c.parts.forEach((p) => (all && !p.block ? n.add(p.id) : n.delete(p.id))); return n; })} />
    );
  };

  const scanBtn = <button className="btn btn-primary" onClick={scan.start} disabled={scanning}><Icon name={status === "idle" ? "search" : "refresh"} className="h-4 w-4" />{status === "idle" ? "Scan" : "Scan again"}</button>;
  const header = (actions = true) => <PageHeader title="Tools & SDKs" subtitle="Caches, SDKs, simulators and developer data outside your projects." actions={actions ? <><button className="btn btn-ghost" onClick={() => setShowWhere(true)} aria-label="Where it looks" title="Where it looks"><Icon name="eye" className="h-[18px] w-[18px]" /></button>{scanBtn}</> : undefined} />;
  const dialogs = (
    <>
      {confirming && <ConfirmDialog entries={plan} preview={preview} settings={settings} busy={busy} onConfirm={run} onCancel={() => setConfirming(false)} noun="item" />}
      {result && resultOpen && <ResultDialog report={result} onClose={() => setResultOpen(false)} />}
      {showWhere && <LocationsDialog onClose={() => setShowWhere(false)} onOpenSettings={props.onOpenSettings} />}
    </>
  );

  if (status === "idle") {
    return (
      <div className="h-full overflow-auto">
        {header()}
        <div className="rounded-[10px] border divider">
          <EmptyState icon="database" title="Not scanned yet"
            description="Package caches, SDK downloads, simulators and editor caches your tools keep in your user folder, outside any project."
            actions={<><button className="btn btn-primary" onClick={scan.start}><Icon name="search" className="h-[18px] w-[18px]" />Scan tools & SDKs</button><button className="btn btn-ghost" onClick={() => setShowWhere(true)}>Where it looks</button></>} />
        </div>
        {dialogs}
      </div>
    );
  }

  const p = scan.progress;
  const panel = scanning && (
    <ScanPanel title="Scanning tools & SDKs…" fraction={p && p.total ? p.done / p.total : null} current={p?.current}
      stats={[{ label: "Checked", value: p ? `${p.done} of ${p.total} locations` : "…" }, { label: "Found", value: caches.length }]} elapsedMs={elapsed} onCancel={scan.stop} />
  );

  if (scanning && !caches.length) return <div className="h-full overflow-auto">{header()}{panel}<div className="overflow-hidden rounded-[10px] border divider"><SkeletonRows rows={5} /></div>{dialogs}</div>;
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
  if (!scanning && !caches.length) {
    return (
      <div className="h-full overflow-auto">
        {header(false)}
        <div className="rounded-[10px] border divider">
          <EmptyState icon="check" title="No tools or SDKs found"
            description={`Checked the known locations in ${fmtDuration(scan.summary?.elapsed_ms ?? 0)}. None of them exist on this computer.`}
            actions={<><button className="btn btn-primary" onClick={scan.start}><Icon name="refresh" className="h-4 w-4" />Scan again</button><button className="btn" onClick={() => setShowWhere(true)}>Where it looks</button></>} />
        </div>
        {dialogs}
      </div>
    );
  }

  const note = scanning ? null : status === "stopped"
    ? <span className="text-amber-700 dark:text-amber-300">Scan cancelled · partial results</span>
    : <span className="flex items-center gap-1.5"><Icon name="check" className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />Scan complete · {fmtDuration(scan.summary?.elapsed_ms ?? 0)}{scan.summary && Date.now() / 1000 - scan.summary.completed_at > 120 ? ` · ${fmtAge(scan.summary.completed_at)}` : ""}</span>;
  return (
    <div className="flex h-full flex-col">
      {header()}
      <MetricStrip note={note} items={[{ label: "Reclaimable", value: fmtBytes(total), hero: true }, { label: "Locations", value: removable.length }, ...(viewOnlyCount ? [{ label: "View only", value: viewOnlyCount }] : [])]} />
      {panel}
      {status === "stopped" && <div className="mb-3"><Banner tone="amber" icon="stop" title="Partial scan" actions={<button className="btn btn-sm" onClick={scan.start}>Scan again</button>}>Results so far are shown. Cleaning is turned off until a full scan finishes.</Banner></div>}
      <div className="mb-3 flex items-center gap-2">
        <p className="muted min-w-0 flex-1 truncate text-[13px]">{view === "map" ? "Installed versions and the scanned projects that use them." : "Open a location to choose single versions, platforms or simulators."}</p>
        {view === "locations" && <ExpandToggle allOpen={allOpen} onChange={setAllOpen} />}
        <MenuSelect<View> label="View" value={view} onChange={setView} options={[{ value: "locations", label: "By ecosystem", icon: "box" }, { value: "map", label: "Dependency map", icon: "layers", hint: "Which projects use which versions" }]} />
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-w-0 flex-1 overflow-auto rounded-[10px] border bg-white divider dark:bg-slate-900">
          {view === "map" ? (
            <DependencyMap refreshKey={`${scanId}:${caches.length}`} selected={sel} onSelectParts={(list) => setSel((s) => new Set([...s, ...list]))} onFocus={(id) => { setFocus(id); }} />
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.name}>
                  <GroupHeader icon={g.viewOnly ? "eye" : "box"} title={g.name}
                    detail={`${g.list.length} location${g.list.length === 1 ? "" : "s"}${!g.viewOnly && g.list.some((c) => c.info_only) ? ` · ${g.list.filter((c) => c.info_only).length} view only` : g.viewOnly ? " · view only" : ""}`}
                    bytes={g.viewOnly ? g.list.reduce((s, c) => s + c.disk_bytes, 0) : g.bytes} open={!collapsed.has(g.name)} onToggleOpen={() => setCollapsed((s) => flip(s, g.name))} />
                  {!collapsed.has(g.name) && g.list.map(row)}
                </div>
              ))}
              {missing.length > 0 && !scanning && (
                <div className="muted flex items-center gap-2 px-4 py-3 text-xs">
                  <Icon name="info" className="h-3.5 w-3.5" />{missing.length} other known location{missing.length === 1 ? " is" : "s are"} not on this computer.
                  <button className="font-medium text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => setShowWhere(true)}>Where it looks</button>
                </div>
              )}
            </>
          )}
        </div>
        {focusCache && <Details cache={focusCache} settings={settings} onClose={() => setFocus(null)} />}
      </div>

      {plan.length > 0 || busy
        ? <SelectionBar count={plan.length} bytes={bytes} noun="item" permanent={settings.delete_mode === "permanent"} dryRun={settings.dry_run} busy={busy} onClear={() => setSel(new Set())} onClean={clean} blockedReason={cleanBlocked} />
        : result && <CleanupNotice report={result} noun="item" onDetails={() => setResultOpen(true)} onClose={() => setResult(null)} />}
      {dialogs}
    </div>
  );
}
