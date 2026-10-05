import { useMemo, useState } from "react";
import { api, failedReport, fmtBytes, fmtDuration, type DeleteReport, type GlobalCache, type Preview, type Settings } from "../api";
import { Details } from "../components/Details";
import { ConfirmDialog, LocationsDialog, ResultDialog, type PlanEntry } from "../components/dialogs";
import { ScanPanel } from "../components/ScanPanel";
import { SelectionBar } from "../components/SelectionBar";
import { ExpandToggle, GroupHeader, TreeRow, type RowModel } from "../components/Tree";
import { useCmd } from "../hooks/commands";
import { useElapsed, type useGlobalScan } from "../hooks/useScans";
import { Icon } from "../ui/Icon";
import { Badge, Banner, EmptyState, MetricStrip, PageHeader, SkeletonRows } from "../ui/primitives";
import { BlockBadge, RiskBadge, VerdictBadge, WarnBadge } from "../ui/warnings";

const VIEW_ONLY_NOTE = "Dev Cleaner can show this location but does not delete it.";

function toModel(c: GlobalCache, verdicts: boolean): RowModel {
  const blockedPart = c.parts.some((p) => p.block);
  return {
    key: c.id, name: c.name, desc: c.note || c.path, meta: c.path, bytes: c.disk_bytes, parts: c.parts, viewOnly: c.info_only,
    blockedReason: c.info_only ? undefined : c.block?.reason,
    lockedReason: c.info_only ? VIEW_ONLY_NOTE : c.parts_only ? "Choose individual parts" : blockedPart ? "Some parts are protected, so choose parts one at a time" : undefined,
    badges: (
      <>
        {c.info_only ? <Badge icon="eye" title={VIEW_ONLY_NOTE}>View only</Badge> : <BlockBadge block={c.block} />}
        {verdicts && !c.info_only && !c.parts_only && <VerdictBadge rec={c.recommendation} block={c.block} />}
        {!c.block && <RiskBadge risk={c.risk} />}
        <WarnBadge warnings={c.warnings} />
      </>
    ),
  };
}

export function GlobalView(props: { scan: ReturnType<typeof useGlobalScan>; settings: Settings; onOpenSettings: () => void; onDeleted: (r: DeleteReport) => void }) {
  const { scan, settings } = props;
  const { caches, status } = scan;
  const [sel, setSel] = useState<Set<string>>(new Set()); // cache ids and part ids
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showWhere, setShowWhere] = useState(false);
  const [result, setResult] = useState<DeleteReport | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const verdicts = settings.recommendations_enabled;
  const elapsed = useElapsed(scan.startedAt, status === "scanning");

  const flip = (s: Set<string>, k: string) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; };
  const sorted = useMemo(() => [...caches].sort((a, b) => b.disk_bytes - a.disk_bytes), [caches]);
  const removable = sorted.filter((c) => !c.info_only);
  const viewOnly = sorted.filter((c) => c.info_only);
  const maxBytes = sorted.reduce((m, c) => Math.max(m, c.disk_bytes), 0);
  const total = removable.filter((c) => !c.block).reduce((s, c) => s + (c.reclaimable_bytes || c.disk_bytes), 0);
  const recommended = removable.filter((c) => !c.block && c.recommendation.verdict === "recommended").reduce((s, c) => s + (c.reclaimable_bytes || c.disk_bytes), 0);
  const focusCache = caches.find((c) => c.id === focus) ?? null;
  const categories = useMemo(() => {
    const m = new Map<string, GlobalCache[]>();
    for (const c of removable) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()].map(([name, list]) => ({ name, list, bytes: list.reduce((s, c) => s + c.disk_bytes, 0) })).sort((a, b) => b.bytes - a.bytes);
  }, [removable]);

  const withParts = sorted.filter((c) => c.parts.length);
  const groupKeys = [...categories.map((g) => g.name), ...(viewOnly.length ? ["__view"] : [])];
  const allOpen = groupKeys.every((k) => !collapsed.has(k)) && withParts.every((c) => open.has(c.id));
  const setAllOpen = (v: boolean) => {
    setOpen(v ? new Set(withParts.map((c) => c.id)) : new Set());
    setCollapsed(v ? new Set() : new Set(groupKeys));
  };

  const plan: (PlanEntry & { id: string; whole: boolean })[] = removable.flatMap((c): (PlanEntry & { id: string; whole: boolean })[] =>
    sel.has(c.id)
      ? [{ id: c.id, path: c.path, label: c.path, bytes: c.reclaimable_bytes || c.disk_bytes, whole: true, warnings: [...c.warnings, ...c.parts.flatMap((p) => (p.warning ? [p.warning] : []))] }]
      : c.parts.filter((p) => sel.has(p.id)).map((p) => ({ id: p.id, path: p.path, label: p.path, bytes: p.reclaimable_bytes || p.disk_bytes, whole: false, warnings: [...c.warnings, ...(p.warning ? [p.warning] : [])] })));
  const bytes = plan.reduce((s, e) => s + e.bytes, 0);
  const scanId = scan.summary?.scan_id ?? caches[0]?.scan_id ?? "";
  const ids = () => plan.filter((e) => e.whole).map((e) => e.id);
  const partIds = () => plan.filter((e) => !e.whole).map((e) => e.id);
  const cleanBlocked = status === "scanning" ? "Wait for the scan to finish" : status === "stopped" ? "The scan did not finish. Run a full scan to clean." : undefined;

  async function run(ack: boolean) {
    setBusy(true);
    try {
      const out = await api.deleteGlobalCaches(scanId, ids(), partIds(), ack);
      setConfirming(false);
      setResult(out);
      props.onDeleted(out);
      if (!out.dry_run) { setSel(new Set()); setFocus(null); scan.start(); }
    } catch (e) {
      setConfirming(false);
      setResult(failedReport(String(e)));
    } finally { setBusy(false); }
  }
  async function clean() {
    setPreview(null);
    if (settings.confirm_before_delete) setConfirming(true);
    try {
      const pv = await api.previewGlobalCleanup(scanId, ids(), partIds());
      const quiet = !pv.needs_ack && !pv.critical && !pv.problems.length && !plan.some((e) => e.warnings.length);
      if (!settings.confirm_before_delete && quiet) return run(false);
      setPreview(pv);
      setConfirming(true);
    } catch (e) {
      setConfirming(false);
      setResult(failedReport(String(e)));
    }
  }

  useCmd((cmd) => {
    if (cmd === "scan") { status === "scanning" ? scan.stop() : scan.start(); }
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

  const header = (actions?: React.ReactNode) => <PageHeader title="Tools & SDKs" subtitle="Caches, SDKs, simulators and developer data outside your projects." actions={actions} />;
  const dialogs = (
    <>
      {confirming && <ConfirmDialog entries={plan} preview={preview} settings={settings} busy={busy} onConfirm={run} onCancel={() => setConfirming(false)} what="Tools will download or rebuild what they need the next time you use them." />}
      {result && <ResultDialog report={result} onClose={() => setResult(null)} />}
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
      fraction={p && p.total ? p.done / p.total : null} current={p?.current} stats={[{ label: "Found", value: caches.length }]} elapsedMs={elapsed} /></div>
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
        items={[{ label: "Reclaimable", value: fmtBytes(total), hero: true }, ...(verdicts ? [{ label: "Recommended", value: fmtBytes(recommended) }] : []), { label: "Locations", value: sorted.length, hint: viewOnly.length ? `${viewOnly.length} view only` : undefined }, { label: "Selected", value: fmtBytes(bytes) }]} />
      {panel}
      {status === "stopped" && <div className="mb-3"><Banner tone="amber" icon="stop" title="Partial scan" actions={<button className="btn btn-sm" onClick={scan.start}>Scan again</button>}>Results so far are shown. Sizes may be incomplete, so cleaning is turned off until a full scan finishes.</Banner></div>}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="muted text-[13px]">Open a location to choose individual parts, such as single Gradle versions, SDK platforms or simulators. Versions are checked against your scanned projects.</p>
        <ExpandToggle allOpen={allOpen} onChange={setAllOpen} />
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
      <div className="card min-w-0 flex-1 overflow-auto">
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
      {focusCache && <Details cache={focusCache} onClose={() => setFocus(null)} />}
      </div>

      <SelectionBar count={plan.length} bytes={bytes} noun="item" permanent={settings.delete_mode === "permanent"}
        dryRun={settings.dry_run} busy={busy} onClear={() => setSel(new Set())} onClean={clean} blockedReason={cleanBlocked} />
      {dialogs}
    </div>
  );
}
