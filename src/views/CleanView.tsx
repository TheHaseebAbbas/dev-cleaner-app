import { useEffect, useMemo, useRef, useState } from "react";
import { api, failedReport, fmtBytes, fmtDuration, kindLine, reclaimOf, type DeleteReport, type GlobalCache, type Item, type Part, type Preview, type ScanSummary, type Settings } from "../api";
import { Details } from "../components/Details";
import { CleanupNotice, ConfirmDialog, ResultDialog, type PlanEntry } from "../components/dialogs";
import { SelectionBar } from "../components/SelectionBar";
import { GroupHeader, TreeRow, type RowModel } from "../components/Tree";
import { useCmd } from "../hooks/commands";
import { useElapsed, type ScanStatus, type useGlobalScan, type useScan } from "../hooks/useScans";
import { GROUP_LABEL, groupOf, groupTotals, preselectIds, reasonLine, type CleanGroup } from "../ui/clean";
import { Icon, type IconName } from "../ui/Icon";
import { EmptyState, MetricStrip, PageHeader, Spinner } from "../ui/primitives";
import { toModel as cacheModel } from "./GlobalView";
import { toModel as itemModel } from "./Projects";
import { mergePreviews, mergeReports } from "../ui/merge";

/** One row of the Clean page: a project folder or a Tools & SDKs location. */
type Row = { src: "p"; key: string; item: Item; bytes: number } | { src: "g"; key: string; cache: GlobalCache; bytes: number };

const SECTIONS: { group: CleanGroup; icon: IconName; hint: string }[] = [
  { group: "safe", icon: "check-circle", hint: "Comes back on its own the next time you build or install." },
  { group: "look", icon: "eye", hint: "Probably fine. Each row says what to check first." },
  { group: "leave", icon: "lock", hint: "Dev Cleaner will not remove these from here." },
];

type SourceState = { label: string; tone: "ok" | "busy" | "warn" | "bad" | "idle"; text: string };

/** What one scan source did, in words: never a silent empty list. */
function sourceState(label: string, status: ScanStatus, summary: ScanSummary | null, error: string | null, found: number, noun: string, progress: string | null): SourceState {
  if (status === "idle") return { label, tone: "idle", text: "Not scanned yet" };
  if (status === "scanning") return { label, tone: "busy", text: progress ? `Scanning · ${progress}` : "Scanning…" };
  if (status === "error") return { label, tone: "bad", text: `Failed: ${error ?? "unknown error"}` };
  const what = `${found} ${noun}${found === 1 ? "" : "s"}`;
  if (status === "stopped") return { label, tone: "warn", text: `Partial: the scan was stopped. ${what} so far.` };
  const gaps: string[] = [];
  if (summary?.missing_roots.length) gaps.push(`${summary.missing_roots.length === 1 ? "a folder is" : `${summary.missing_roots.length} folders are`} missing (${summary.missing_roots.join(", ")})`);
  if (summary?.measure_errors) gaps.push(`${summary.measure_errors} could not be measured`);
  if (summary && !summary.complete) gaps.push("the scan did not finish");
  if (gaps.length) return { label, tone: "warn", text: `Partial: ${gaps.join("; ")}. ${what} found.` };
  return { label, tone: "ok", text: `Done · ${what} · ${fmtDuration(summary?.elapsed_ms ?? 0)}` };
}

const TONE: Record<SourceState["tone"], { icon: IconName; cls: string }> = {
  ok: { icon: "check", cls: "text-emerald-600 dark:text-emerald-400" },
  busy: { icon: "refresh", cls: "text-indigo-600 dark:text-indigo-300" },
  warn: { icon: "alert", cls: "text-amber-700 dark:text-amber-300" },
  bad: { icon: "x-circle", cls: "text-red-600 dark:text-red-400" },
  idle: { icon: "info", cls: "text-slate-400" },
};

/**
 * The one screen most people need: everything both scans found, sorted by the core into Safe to
 * clean, Worth a look and Leaving alone, with one selection and one button. Projects and Tools &
 * SDKs keep their full pages for filters, maps and parts.
 */
export function CleanView(props: {
  scan: ReturnType<typeof useScan>;
  globalScan: ReturnType<typeof useGlobalScan>;
  settings: Settings;
  onOpenSettings: () => void;
  onDeleted: (r: DeleteReport) => void;
}) {
  const { scan, globalScan: gscan, settings } = props;
  const est = settings.show_reclaim_estimate;
  const verdicts = settings.recommendations_enabled;
  // Two selections (project ids and tool ids live in separate spaces) read as one.
  const [selP, setSelP] = useState<Set<string>>(new Set());
  const [selG, setSelG] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<CleanGroup>>(new Set(["safe"]));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<DeleteReport | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const scanning = scan.status === "scanning" || gscan.status === "scanning";
  const elapsed = useElapsed(Math.min(scan.startedAt || Infinity, gscan.startedAt || Infinity), scanning);

  const rows = useMemo(() => {
    const out: Row[] = [
      ...scan.items.map((i): Row => ({ src: "p", key: `p:${i.id}`, item: i, bytes: reclaimOf(i, est) })),
      ...gscan.caches.map((c): Row => ({ src: "g", key: `g:${c.id}`, cache: c, bytes: reclaimOf(c, est) })),
    ];
    return out.sort((a, b) => b.bytes - a.bytes);
  }, [scan.items, gscan.caches, est]);
  const of = (r: Row) => (r.src === "p" ? r.item : r.cache);
  const bySection = useMemo(() => {
    const m: Record<CleanGroup, Row[]> = { safe: [], look: [], leave: [] };
    for (const r of rows) m[groupOf(of(r))].push(r);
    return m;
  }, [rows]);
  const totals = groupTotals(rows.map((r) => ({ ...of(r), size: r.bytes })), (c) => c.size);
  const maxBytes = rows.reduce((m, r) => Math.max(m, r.bytes), 0);

  // Whole-row selectability on this page: Leaving alone is never ticked here.
  const model = (r: Row): RowModel => {
    const m = r.src === "p" ? itemModel(r.item, true, true) : cacheModel(r.cache, true);
    const kind = r.src === "p" ? `${r.item.project_name} · ${kindLine(r.item.ecosystem, r.item.category)}` : m.kind;
    if (groupOf(of(r)) === "leave" && m.state !== "blocked") return { ...m, kind, flat: undefined, state: "view", reason: reasonLine(of(r)) };
    return { ...m, kind, flat: undefined };
  };

  // Each source preselects its own Safe to clean rows once per scan id, after a complete scan.
  const pScanId = scan.summary?.scan_id ?? scan.items[0]?.scan_id ?? "";
  const gScanId = gscan.summary?.scan_id ?? gscan.caches[0]?.scan_id ?? "";
  const pPartial = scan.status === "stopped" || (scan.status === "done" && !!scan.summary && !scan.summary.complete);
  const gPartial = gscan.status === "stopped" || (gscan.status === "done" && !!gscan.summary && !gscan.summary.complete);
  const preP = useRef("");
  const preG = useRef("");
  useEffect(() => {
    if (scan.status !== "done" || pPartial || !verdicts || !pScanId || preP.current === pScanId) return;
    preP.current = pScanId;
    setSelP(new Set(preselectIds(scan.items, settings.delete_mode)));
  }, [scan.status, pPartial, verdicts, pScanId, scan.items, settings.delete_mode]);
  useEffect(() => {
    if (gscan.status !== "done" || gPartial || !verdicts || !gScanId || preG.current === gScanId) return;
    preG.current = gScanId;
    setSelG(new Set(preselectIds(gscan.caches.filter((c) => !c.info_only), settings.delete_mode)));
  }, [gscan.status, gPartial, verdicts, gScanId, gscan.caches, settings.delete_mode]);

  type Entry = PlanEntry & { id: string; whole: boolean };
  const planP: Entry[] = scan.items.flatMap((i): Entry[] => selP.has(i.id)
    ? [{ id: i.id, path: i.path, label: i.path, bytes: reclaimOf(i, est), whole: true, warnings: i.warnings }]
    : i.parts.filter((p) => selP.has(p.id)).map((p) => ({ id: p.id, path: p.path, label: p.path, bytes: reclaimOf(p, est), whole: false, warnings: [...i.warnings, ...(p.warning ? [p.warning] : [])] })));
  const planG: Entry[] = gscan.caches.filter((c) => !c.info_only).flatMap((c): Entry[] => selG.has(c.id)
    ? [{ id: c.id, path: c.path, label: c.path, bytes: reclaimOf(c, est), whole: true, warnings: [...c.warnings, ...c.parts.flatMap((p) => (p.warning ? [p.warning] : []))] }]
    : c.parts.filter((p) => selG.has(p.id)).map((p) => ({ id: p.id, path: p.path, label: p.path, bytes: reclaimOf(p, est), whole: false, warnings: [...c.warnings, ...(p.warning ? [p.warning] : [])] })));
  const plan = [...planP, ...planG];
  const planBytes = plan.reduce((s, e) => s + e.bytes, 0);

  const ageMin = (s: ScanSummary | null) => (s?.completed_at ? Math.floor((Date.now() / 1000 - s.completed_at) / 60) : 0);
  const staleMin = Math.max(planP.length ? ageMin(scan.summary) : 0, planG.length ? ageMin(gscan.summary) : 0);
  const cleanBlocked = scanning ? "Wait for the scan to finish"
    : (planP.length && pPartial) || (planG.length && gPartial) ? "The scan did not finish. Run a full scan to clean."
    : settings.require_rescan_before_cleanup && staleMin >= settings.stale_scan_minutes ? `This scan is ${staleMin} minutes old. Scan again to clean.` : undefined;

  const startBoth = () => { setResult(null); setFocus(null); scan.start(); gscan.start(); };
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const stopBoth = () => { if (scan.status === "scanning") scan.stop(); if (gscan.status === "scanning") gscan.stop(); };

  async function run(ack: boolean) {
    setBusy(true);
    try {
      const reports: DeleteReport[] = [];
      if (planP.length) reports.push(await api.deleteItems(pScanId, planP.map((e) => e.id), ack));
      if (planG.length) reports.push(await api.deleteGlobalCaches(gScanId, planG.filter((e) => e.whole).map((e) => e.id), planG.filter((e) => !e.whole).map((e) => e.id), ack));
      const out = mergeReports(reports);
      setConfirming(false);
      setResult(out);
      setResultOpen(out.removed === 0 && out.outcomes.some((o) => !o.ok));
      props.onDeleted(out);
      if (!out.dry_run) {
        setSelP(new Set()); setSelG(new Set()); setFocus(null);
        if (planG.length) gscan.start();
      }
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
      const pvs: Preview[] = [];
      if (planP.length) pvs.push(await api.previewCleanup(pScanId, planP.map((e) => e.id)));
      if (planG.length) pvs.push(await api.previewGlobalCleanup(gScanId, planG.filter((e) => e.whole).map((e) => e.id), planG.filter((e) => !e.whole).map((e) => e.id)));
      const pv = mergePreviews(pvs)!;
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
  /** Puts back what the last cleanup moved to Trash, matched by original path. */
  async function undo() {
    if (!result) return;
    const moved = new Set(result.outcomes.filter((o) => o.ok && !o.dry_run).map((o) => o.path));
    const entries = (await api.trashList()).filter((t) => moved.has(t.original_path));
    if (!entries.length) return;
    const out = await api.trashRestore(entries.map((t) => t.id));
    const bad = out.filter((o) => !o.ok);
    setUndoNote(bad.length ? `${bad.length} could not be put back. ${bad[0].error ?? ""}`.trim() : `Put back ${out.length} item${out.length === 1 ? "" : "s"}.`);
    startBoth();
  }

  useCmd((cmd) => {
    if (cmd === "scan") { scanning ? stopBoth() : startBoth(); }
    else if (cmd === "delete") { if (plan.length && !cleanBlocked && !busy) clean(); }
    else if (cmd === "escape") { if (focus) setFocus(null); else if (plan.length) { setSelP(new Set()); setSelG(new Set()); } else return false; }
    else return false;
  });

  const flip = (s: Set<string>, k: string) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; };
  const setterOf = (r: Row) => (r.src === "p" ? setSelP : setSelG);
  const selOf = (r: Row) => (r.src === "p" ? selP : selG);
  const idOf = (r: Row) => of(r).id;
  const row = (r: Row) => {
    const sel = selOf(r);
    const set = setterOf(r);
    const parts: Part[] = of(r).parts;
    const id = idOf(r);
    return (
      <TreeRow key={r.key} model={model(r)} maxBytes={maxBytes} depth={1}
        checked={sel.has(id)} partial={!sel.has(id) && parts.some((p) => sel.has(p.id))}
        focused={focus === r.key} expanded={expanded.has(r.key)} selectedParts={sel} partsLocked={sel.has(id)}
        onToggle={() => set((s) => { const n = flip(s, id); parts.forEach((p) => n.delete(p.id)); return n; })}
        onExpand={() => setExpanded((s) => flip(s, r.key))} onFocus={() => setFocus(r.key)}
        onTogglePart={(p) => set((s) => flip(s, p.id))}
        onSelectAllParts={(all) => set((s) => { const n = new Set(s); parts.forEach((p) => (all && !p.block ? n.add(p.id) : n.delete(p.id))); return n; })} />
    );
  };
  // Header tick for a section: only whole rows that can be ticked.
  const tickable = (list: Row[]) => list.filter((r) => model(r).state === "selectable");
  const sectionTick = (list: Row[]) => {
    const ok = tickable(list);
    const all = ok.length > 0 && ok.every((r) => selOf(r).has(idOf(r)));
    const some = ok.some((r) => selOf(r).has(idOf(r)));
    const toggle = () => {
      for (const setSel of [setSelP, setSelG]) {
        const mine = ok.filter((r) => setterOf(r) === setSel);
        setSel((s) => { const n = new Set(s); mine.forEach((r) => (all ? n.delete(idOf(r)) : n.add(idOf(r)))); return n; });
      }
    };
    return { all, some, toggle, any: ok.length > 0 };
  };

  const focusRow = rows.find((r) => r.key === focus) ?? null;
  const pState = sourceState("Projects", scan.status, scan.summary, scan.error, scan.items.length, "folder",
    scan.progress ? (scan.progress.phase === "discover" ? `${scan.progress.visited.toLocaleString()} folders checked` : `measuring ${scan.progress.done} of ${scan.progress.total}`) : null);
  const gState = sourceState("Tools & SDKs", gscan.status, gscan.summary, gscan.error, gscan.caches.length, "location",
    gscan.progress ? `${gscan.progress.done} of ${gscan.progress.total} locations` : null);
  const nothingYet = scan.status === "idle" && gscan.status === "idle";
  const permanent = settings.delete_mode === "permanent";

  const scanBtn = scanning
    ? <button className="btn" onClick={stopBoth}><Icon name="stop" className="h-4 w-4" />Stop</button>
    : <button className="btn btn-primary" onClick={startBoth}><Icon name={nothingYet ? "search" : "refresh"} className="h-4 w-4" />{nothingYet ? "Scan" : "Scan again"}</button>;
  const header = <PageHeader title="Clean" subtitle="Build output, installed packages and caches your tools can bring back." actions={scanBtn} />;
  const dialogs = (
    <>
      {confirming && <ConfirmDialog entries={plan} preview={preview} settings={settings} busy={busy} onConfirm={run} onCancel={() => setConfirming(false)} noun="item" />}
      {result && resultOpen && <ResultDialog report={result} onClose={() => setResultOpen(false)} />}
    </>
  );

  if (nothingYet) {
    return (
      <div className="h-full overflow-auto">
        {header}
        <div className="rounded-[10px] border divider">
          <EmptyState icon="search" title="Find what you can clean"
            description={settings.scan_roots.length
              ? "Dev Cleaner looks through your project folders and your tools' caches, then sorts what it finds into Safe to clean, Worth a look and Leaving alone."
              : "Add the folders where your projects live, then scan. Tools & SDKs are found without any setup."}
            actions={<>
              <button className="btn btn-primary" onClick={startBoth}><Icon name="search" className="h-[18px] w-[18px]" />Scan</button>
              {!settings.scan_roots.length && <button className="btn" onClick={props.onOpenSettings}>Add project folders</button>}
            </>} />
        </div>
        {dialogs}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {header}
      <MetricStrip
        note={scanning ? <span className="flex items-center gap-1.5"><Spinner className="h-3.5 w-3.5" />Scanning · {fmtDuration(elapsed)}</span> : null}
        items={[
          { label: "You can safely clean", hint: est ? "estimate" : undefined, value: fmtBytes(totals.safe), hero: true },
          { label: "Worth a look", value: fmtBytes(totals.look) },
        ]} />
      <ul className="mb-3 space-y-1 text-xs" aria-label="Scan status">
        {[pState, gState].map((s) => (
          <li key={s.label} className="flex min-w-0 items-center gap-2">
            {s.tone === "busy" ? <Spinner className="h-3.5 w-3.5" /> : <Icon name={TONE[s.tone].icon} className={`h-3.5 w-3.5 shrink-0 ${TONE[s.tone].cls}`} />}
            <span className="w-24 shrink-0 font-medium">{s.label}</span>
            <span className={`min-w-0 truncate ${s.tone === "warn" || s.tone === "bad" ? TONE[s.tone].cls : "muted"}`} title={s.text}>{s.text}</span>
            {(s.tone === "bad" || s.tone === "warn") && !scanning && <button className="btn btn-ghost btn-sm" onClick={s.label === "Projects" ? scan.start : gscan.start}>Try again</button>}
          </li>
        ))}
      </ul>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-w-0 flex-1 overflow-auto rounded-[10px] border bg-white divider dark:bg-slate-900">
          {SECTIONS.map(({ group, icon, hint }) => {
            const list = bySection[group];
            const tick = group === "leave" ? null : sectionTick(list);
            const isOpen = open.has(group);
            return (
              <section key={group} aria-label={GROUP_LABEL[group]}>
                <GroupHeader icon={icon} title={GROUP_LABEL[group]}
                  detail={list.length ? `${list.length} item${list.length === 1 ? "" : "s"} · ${hint}` : group === "safe" && scanning ? "Looking…" : "Nothing here"}
                  bytes={totals[group]} open={isOpen} onToggleOpen={() => setOpen((s) => { const n = new Set(s); n.has(group) ? n.delete(group) : n.add(group); return n; })}
                  {...(tick?.any ? { checked: tick.all, partial: !tick.all && tick.some, onToggle: tick.toggle } : {})} />
                {isOpen && list.map(row)}
              </section>
            );
          })}
        </div>
        {focusRow && (focusRow.src === "p"
          ? <Details item={focusRow.item} settings={settings} onClose={() => setFocus(null)} brief={!settings.show_advanced} />
          : <Details cache={focusRow.cache} settings={settings} onClose={() => setFocus(null)} brief={!settings.show_advanced} />)}
      </div>

      {result && !busy && <CleanupNotice report={result} noun="item" onDetails={() => setResultOpen(true)} onClose={() => setResult(null)} onUndo={undo} />}
      {undoNote && !result && (
        <div role="status" className="rise mt-3 flex items-center gap-3 rounded-[10px] border px-4 py-2.5 text-[13px] divider">
          <Icon name="refresh" className="h-4 w-4 text-indigo-600 dark:text-indigo-300" /><span className="min-w-0 flex-1 truncate">{undoNote}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setUndoNote(null)} aria-label="Dismiss"><Icon name="x" /></button>
        </div>
      )}
      {(plan.length > 0 || busy) && <SelectionBar count={plan.length} bytes={planBytes} noun="item" permanent={permanent} dryRun={settings.dry_run} busy={busy} onClear={() => { setSelP(new Set()); setSelG(new Set()); }} onClean={clean} blockedReason={cleanBlocked} />}
      {dialogs}
    </div>
  );
}
