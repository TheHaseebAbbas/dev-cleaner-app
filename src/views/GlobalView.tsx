import { useMemo, useState } from "react";
import { api, fmtBytes, fmtDuration, type DeleteOutcome, type GlobalCache, type Settings } from "../api";
import { ConfirmDialog, LocationsDialog, ResultDialog, type PlanEntry } from "../components/dialogs";
import { ScanPanel } from "../components/ScanPanel";
import { SelectionBar } from "../components/SelectionBar";
import { ExpandToggle, GroupHeader, TreeRow, type RowModel } from "../components/Tree";
import { useCmd } from "../hooks/commands";
import { useElapsed, type useGlobalScan } from "../hooks/useScans";
import { Icon } from "../ui/Icon";
import { Badge, Banner, EmptyState, MetricStrip, PageHeader, SkeletonRows } from "../ui/primitives";
import { WarnBadge } from "../ui/warnings";

const VIEW_ONLY_NOTE = "Dev Cleaner can show this location but does not delete it.";

function toModel(c: GlobalCache): RowModel {
  return {
    key: c.id, name: c.name, desc: c.note || c.path, meta: c.path, bytes: c.disk_bytes, parts: c.parts, viewOnly: c.info_only,
    lockedReason: c.info_only ? VIEW_ONLY_NOTE : c.parts_only ? "Choose individual parts" : undefined,
    badges: (
      <>
        {c.info_only && <Badge icon="eye" title={VIEW_ONLY_NOTE}>View only</Badge>}
        <WarnBadge warnings={c.warnings} />
      </>
    ),
  };
}

export function GlobalView(props: { scan: ReturnType<typeof useGlobalScan>; settings: Settings; onOpenSettings: () => void; onDeleted: (o: DeleteOutcome[]) => void }) {
  const { scan, settings } = props;
  const { caches, status } = scan;
  const [sel, setSel] = useState<Set<string>>(new Set()); // cache ids and part paths
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showWhere, setShowWhere] = useState(false);
  const [result, setResult] = useState<DeleteOutcome[] | null>(null);
  const elapsed = useElapsed(scan.startedAt, status === "scanning");

  const flip = (s: Set<string>, k: string) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; };
  const sorted = useMemo(() => [...caches].sort((a, b) => b.disk_bytes - a.disk_bytes), [caches]);
  const removable = sorted.filter((c) => !c.info_only);
  const viewOnly = sorted.filter((c) => c.info_only);
  const maxBytes = sorted.reduce((m, c) => Math.max(m, c.disk_bytes), 0);
  const total = removable.reduce((s, c) => s + c.disk_bytes, 0);
  const categories = useMemo(() => {
    const m = new Map<string, GlobalCache[]>();
    for (const c of removable) m.set(c.category, [...(m.get(c.category) ?? []), c]);
    return [...m.entries()].map(([name, list]) => ({ name, list, bytes: list.reduce((s, c) => s + c.disk_bytes, 0) })).sort((a, b) => b.bytes - a.bytes);
  }, [removable]);

  const withParts = sorted.filter((c) => c.parts.length);
  const groupKeys = [...categories.map((g) => g.name), ...(viewOnly.length ? ["__view"] : [])];
  const allOpen = groupKeys.every((k) => !collapsed.has(k)) && withParts.every((c) => open.has(c.id));
  const setAllOpen = (v: boolean) => {
    setOpen(v ? new Set(withParts.map((c) => c.id)) : new Set());
    setCollapsed(v ? new Set() : new Set(groupKeys));
  };

  const plan: (PlanEntry & { whole: boolean })[] = removable.flatMap((c): (PlanEntry & { whole: boolean })[] =>
    sel.has(c.id)
      ? [{ path: c.id, label: c.path, bytes: c.disk_bytes, whole: true, warnings: [...c.warnings, ...c.parts.flatMap((p) => (p.warning ? [p.warning] : []))] }]
      : c.parts.filter((p) => sel.has(p.path)).map((p) => ({ path: p.path, label: p.path, bytes: p.disk_bytes, whole: false, warnings: [...c.warnings, ...(p.warning ? [p.warning] : [])] })));
  const bytes = plan.reduce((s, e) => s + e.bytes, 0);

  async function run() {
    setBusy(true);
    try {
      const out = await api.deleteGlobalCaches(plan.filter((e) => e.whole).map((e) => e.path), plan.filter((e) => !e.whole).map((e) => e.path));
      setConfirming(false);
      setResult(out);
      props.onDeleted(out);
      if (!out[0]?.dry_run) { setSel(new Set()); scan.start(); }
    } catch (e) {
      setConfirming(false);
      setResult([{ path: "(request)", ok: false, bytes_freed: 0, error: String(e), dry_run: false }]);
    } finally { setBusy(false); }
  }
  const clean = () => (settings.confirm_before_delete || plan.some((e) => e.warnings.some((w) => w.level === "danger")) ? setConfirming(true) : run());

  useCmd((cmd) => {
    if (cmd === "scan") { status === "scanning" ? scan.stop() : scan.start(); }
    else if (cmd === "select-all") setSel((s) => (s.size ? new Set() : new Set(removable.filter((c) => !c.parts_only).map((c) => c.id))));
    else if (cmd === "delete") { if (plan.length && status !== "scanning" && !busy) clean(); }
    else if (cmd === "escape") { if (sel.size) setSel(new Set()); else return false; }
    else return false;
  });

  const row = (c: GlobalCache) => {
    const partsSel = c.parts.filter((p) => sel.has(p.path)).length;
    return (
      <TreeRow key={c.id} model={toModel(c)} maxBytes={maxBytes} checked={sel.has(c.id)} partial={!sel.has(c.id) && partsSel > 0}
        depth={1} focused={false} expanded={open.has(c.id)} selectedParts={sel} partsLocked={sel.has(c.id)}
        onToggle={() => setSel((s) => { const n = flip(s, c.id); c.parts.forEach((p) => n.delete(p.path)); return n; })}
        onExpand={() => setOpen((s) => flip(s, c.id))} onFocus={() => c.parts.length && setOpen((s) => flip(s, c.id))}
        onTogglePart={(p) => setSel((s) => flip(s, p.path))}
        onSelectAllParts={(all) => setSel((s) => { const n = new Set(s); c.parts.forEach((p) => (all ? n.add(p.path) : n.delete(p.path))); return n; })} />
    );
  };

  const header = (actions?: React.ReactNode) => <PageHeader title="Tools & SDKs" subtitle="Caches, SDKs, simulators and developer data outside your projects." actions={actions} />;
  const dialogs = (
    <>
      {confirming && <ConfirmDialog entries={plan} settings={settings} busy={busy} onConfirm={run} onCancel={() => setConfirming(false)} what="Tools will download or rebuild what they need the next time you use them." />}
      {result && <ResultDialog result={result} onClose={() => setResult(null)} />}
      {showWhere && <LocationsDialog onClose={() => setShowWhere(false)} onOpenSettings={props.onOpenSettings} />}
    </>
  );

  if (status === "idle") {
    return (
      <div className="h-full overflow-auto">
        {header()}
        <div className="card">
          <EmptyState icon="database" title="Ready to scan tools & SDKs"
            description="Package caches, SDK downloads, simulators and editor caches your tools keep in your user folder, outside any project."
            actions={<><button className="btn btn-primary" onClick={scan.start}><Icon name="search" className="h-[18px] w-[18px]" />Scan tools & SDKs</button><button className="btn btn-ghost" onClick={() => setShowWhere(true)}>Where it looks</button></>} />
        </div>
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
    <div className="mb-4"><ScanPanel title="Scanning tools & SDKs" phase={p ? `Checked ${p.done} of ${p.total} known locations` : "Looking for known locations"}
      fraction={p && p.total ? p.done / p.total : null} current={p?.current} stats={[{ label: "Found", value: caches.length }]} elapsedMs={elapsed} onStop={scan.stop} /></div>
  );

  if (scanning && !caches.length) return <div className="h-full overflow-auto">{header(scanBtn)}{panel}<div className="card overflow-hidden"><SkeletonRows rows={5} /></div>{dialogs}</div>;
  if (status === "error") return <div className="h-full overflow-auto">{header()}<Banner tone="red" icon="x-circle" title="The scan could not finish" actions={<button className="btn btn-sm" onClick={scan.start}>Try again</button>}>{scan.error}</Banner>{dialogs}</div>;
  if (!scanning && !caches.length) {
    return (
      <div className="h-full overflow-auto">
        {header()}
        <div className="card">
          <EmptyState tone="success" icon="check-circle" title="No tools or SDKs found"
            description={`Checked the known locations in ${fmtDuration(scan.summary?.elapsed_ms ?? 0)}. None of them exist on this computer.`}
            actions={<><button className="btn btn-primary" onClick={scan.start}><Icon name="refresh" className="h-4 w-4" />Scan again</button><button className="btn" onClick={() => setShowWhere(true)}>Where it looks</button></>} />
        </div>
        {dialogs}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {header(<>{scanBtn}<button className="btn btn-ghost" onClick={() => setShowWhere(true)} aria-label="Where it looks" title="Where it looks"><Icon name="eye" className="h-[18px] w-[18px]" /></button></>)}
      <MetricStrip note={scanning ? "Still scanning…" : status === "stopped" ? "Scan stopped" : `Scan complete · ${fmtDuration(scan.summary?.elapsed_ms ?? 0)}`}
        items={[{ label: "Reclaimable", value: fmtBytes(total), hero: true }, { label: "Locations", value: sorted.length, hint: viewOnly.length ? `${viewOnly.length} view only` : undefined }, { label: "Selected", value: fmtBytes(bytes) }]} />
      {panel}
      {status === "stopped" && <div className="mb-3"><Banner tone="amber" icon="stop" title="Scan stopped" actions={<button className="btn btn-sm" onClick={scan.start}>Scan again</button>}>Results so far are shown. Sizes may be incomplete.</Banner></div>}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="muted text-[13px]">Open a location to choose individual parts, such as single Gradle versions, SDK platforms or simulators.</p>
        <ExpandToggle allOpen={allOpen} onChange={setAllOpen} />
      </div>

      <div className="card min-h-0 flex-1 overflow-auto">
        {categories.map((g) => (
          <div key={g.name}>
            <GroupHeader icon="box" title={g.name} detail={`${g.list.length} location${g.list.length === 1 ? "" : "s"}`} bytes={g.bytes} open={!collapsed.has(g.name)} onToggleOpen={() => setCollapsed((s) => flip(s, g.name))} />
            {!collapsed.has(g.name) && g.list.map(row)}
          </div>
        ))}
        {viewOnly.length > 0 && (
          <div>
            <GroupHeader icon="box" title="View only" detail="Shown for information. Never deleted." bytes={viewOnly.reduce((s, c) => s + c.disk_bytes, 0)} open={!collapsed.has("__view")} onToggleOpen={() => setCollapsed((s) => flip(s, "__view"))} />
            {!collapsed.has("__view") && viewOnly.map(row)}
          </div>
        )}
      </div>

      <SelectionBar count={plan.length} bytes={bytes} noun="item" permanent={settings.delete_mode === "permanent"}
        dryRun={settings.dry_run} busy={busy} onClear={() => setSel(new Set())} onClean={clean} blockedReason={scanning ? "Wait for the scan to finish" : undefined} />
      {dialogs}
    </div>
  );
}
