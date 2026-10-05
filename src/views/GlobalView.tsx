import { useMemo, useState } from "react";
import { api, fmtBytes, fmtDuration, type DeleteOutcome, type GlobalCache, type Settings } from "../api";
import { ConfirmDialog, LocationsDialog, ResultDialog, type PlanEntry } from "../components/dialogs";
import { ScanPanel } from "../components/ScanPanel";
import { SelectionBar } from "../components/SelectionBar";
import { GroupHeader, ListHeader, TreeRow, type RowModel } from "../components/Tree";
import { useElapsed, type useGlobalScan } from "../hooks/useScans";
import { Icon } from "../ui/Icon";
import { Badge, Banner, EmptyState, SkeletonRows, StatCard } from "../ui/primitives";
import { WarnBadge } from "../ui/warnings";

const COLUMNS = [
  { label: "Cache" }, { label: "Category" }, { label: "Size", align: "right" as const }, { label: "Files", align: "right" as const },
  { label: "Changed", align: "right" as const }, { label: "Notes" },
];

function toModel(c: GlobalCache): RowModel {
  return {
    key: c.id, name: c.name, sub: c.path, typeLabel: c.category, bytes: c.disk_bytes, files: c.file_count,
    modified: Math.max(0, ...c.parts.map((p) => p.last_modified)), parts: c.parts, viewOnly: c.info_only,
    lockedReason: c.info_only ? "View only. Dev Cleaner never deletes this." : c.parts_only ? "Choose individual parts instead" : undefined,
    status: (
      <div className="flex flex-wrap items-center gap-1">
        {c.info_only && <Badge icon="eye">View only</Badge>}
        {c.parts_only && !c.info_only && <Badge tone="amber">Pick parts</Badge>}
        <WarnBadge warnings={c.warnings} />
        {(c.info_only || !c.warnings.length) && c.note && <span className="muted line-clamp-2 text-xs" title={c.note}>{c.note}</span>}
      </div>
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

  const row = (c: GlobalCache) => {
    const partsSel = c.parts.filter((p) => sel.has(p.path)).length;
    return (
      <TreeRow key={c.id} model={toModel(c)} maxBytes={maxBytes} checked={sel.has(c.id)} partial={!sel.has(c.id) && partsSel > 0}
        focused={false} expanded={open.has(c.id)} selectedParts={sel} partsLocked={sel.has(c.id)}
        onToggle={() => setSel((s) => { const n = flip(s, c.id); c.parts.forEach((p) => n.delete(p.path)); return n; })}
        onExpand={() => setOpen((s) => flip(s, c.id))} onFocus={() => c.parts.length && setOpen((s) => flip(s, c.id))}
        onTogglePart={(p) => setSel((s) => flip(s, p.path))}
        onSelectAllParts={(all) => setSel((s) => { const n = new Set(s); c.parts.forEach((p) => (all ? n.add(p.path) : n.delete(p.path))); return n; })} />
    );
  };

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
        <EmptyState icon="database" title="Tool caches and SDKs"
          description="Package caches, SDK downloads, simulators and editor caches your tools keep in your user folder (like AppData), outside any project. Scan to see what is there and how big it is."
          actions={<><button className="btn btn-primary" onClick={scan.start}><Icon name="search" />Scan caches</button><button className="btn" onClick={() => setShowWhere(true)}><Icon name="eye" />Where it looks</button></>} />
        {dialogs}
      </div>
    );
  }

  const p = scan.progress;
  const scanning = status === "scanning";
  const panel = scanning && (
    <ScanPanel title="Measuring tool caches" phase={p ? `Checked ${p.done} of ${p.total} known locations` : "Looking for known locations"}
      fraction={p && p.total ? p.done / p.total : null} current={p?.current} stats={[{ label: "Found", value: caches.length }]} elapsedMs={elapsed} onStop={scan.stop} />
  );

  if (scanning && !caches.length) return <div className="h-full overflow-auto"><div className="space-y-3">{panel}<div className="card overflow-hidden"><SkeletonRows rows={5} /></div></div>{dialogs}</div>;
  if (status === "error") return <div className="h-full overflow-auto"><Banner tone="red" icon="x-circle" title="The scan could not finish" actions={<button className="btn btn-sm" onClick={scan.start}>Retry</button>}>{scan.error}</Banner>{dialogs}</div>;
  if (!scanning && !caches.length) {
    return (
      <div className="h-full overflow-auto">
        <EmptyState tone="success" icon="check-circle" title="No tool caches found"
          description={`Checked the known locations in ${fmtDuration(scan.summary?.elapsed_ms ?? 0)}. None of them exist on this computer.`}
          actions={<><button className="btn btn-primary" onClick={scan.start}><Icon name="refresh" />Scan again</button><button className="btn" onClick={() => setShowWhere(true)}>Where it looks</button></>} />
        {dialogs}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Can be cleaned" value={fmtBytes(total)} tone="green" hint={scanning ? "still measuring…" : undefined} />
        <StatCard label="Caches found" value={removable.length} hint={viewOnly.length ? `+ ${viewOnly.length} view only` : undefined} />
        <StatCard label="Selected" value={fmtBytes(bytes)} hint={`${plan.length} item${plan.length === 1 ? "" : "s"}`} />
        <div className="card flex items-center justify-center gap-2 px-3">
          {!scanning && <button className="btn" onClick={scan.start}><Icon name="refresh" />Rescan</button>}
          <button className="btn btn-ghost" onClick={() => setShowWhere(true)} title="Where it looks"><Icon name="eye" /></button>
        </div>
      </div>
      {panel}
      {status === "stopped" && <Banner tone="amber" icon="stop" title="Scan stopped" actions={<button className="btn btn-sm" onClick={scan.start}>Scan again</button>}>Results so far are shown. Sizes may be incomplete.</Banner>}
      <Banner tone="blue" icon="info" title="Remove a whole cache or just one part">Tick a cache, or open its arrow to pick single Gradle versions, SDK platforms or simulators. Rows marked "May be required" explain what breaks.</Banner>

      <div className="card min-h-0 flex-1 overflow-auto">
        <div className="min-w-[860px]">
          <ListHeader columns={COLUMNS} />
          {categories.map((g) => (
            <div key={g.name}>
              <GroupHeader icon="box" title={g.name} count={g.list.length} countLabel={g.list.length === 1 ? "cache" : "caches"} bytes={g.bytes} open={!collapsed.has(g.name)} onToggleOpen={() => setCollapsed((s) => flip(s, g.name))} />
              {!collapsed.has(g.name) && g.list.map(row)}
            </div>
          ))}
          {viewOnly.length > 0 && (
            <div>
              <GroupHeader icon="box" title="Disk images (view only)" sub="Never deleted. Notes explain how to shrink them." count={viewOnly.length} countLabel={viewOnly.length === 1 ? "item" : "items"} bytes={viewOnly.reduce((s, c) => s + c.disk_bytes, 0)} open={!collapsed.has("__view")} onToggleOpen={() => setCollapsed((s) => flip(s, "__view"))} />
              {!collapsed.has("__view") && viewOnly.map(row)}
            </div>
          )}
        </div>
      </div>

      <SelectionBar count={plan.length} bytes={bytes} noun="item" modeLabel={settings.delete_mode === "trash" ? "Moves to Trash, recoverable" : "Deleted permanently"}
        dryRun={settings.dry_run} busy={busy} onClear={() => setSel(new Set())} onClean={clean} blockedReason={scanning ? "Wait for the scan to finish" : undefined} />
      {dialogs}
    </div>
  );
}
