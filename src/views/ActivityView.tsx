import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, fmtAge, fmtBytes, type HistoryEntry, type Settings, type TrashEntry, type TrashInfo, type TrashOutcome } from "../api";
import { groupRuns, stillInTrash, type Run } from "../ui/activity";
import { Icon } from "../ui/Icon";
import { Banner, Disclosure, EmptyState, MetricStrip, PageHeader, Segmented, SkeletonRows, Spinner } from "../ui/primitives";
import { History } from "./History";
import { TrashView } from "./TrashView";

type View = "timeline" | "trash" | "history";

const items = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

/** One cleanup: what was removed, how, and a Restore for whatever is still in the Trash. */
function RunCard(props: { run: Run; inTrash: Map<string, TrashEntry>; canRestore: boolean; busy: boolean; onRestore: (ids: string[]) => void }) {
  const { run, inTrash } = props;
  const restorable = run.entries.map((e) => inTrash.get(e.id)).filter((t): t is TrashEntry => !!t);
  const trash = run.mode === "trash";
  const title = trash ? `Moved ${items(run.entries.length)} to Trash` : `Deleted ${items(run.entries.length)} permanently`;
  const status = !trash ? `${fmtBytes(run.bytes)} freed`
    : restorable.length === run.entries.length ? `${fmtBytes(run.bytes)} · all still in the Trash`
    : restorable.length ? `${fmtBytes(run.bytes)} · ${restorable.length} still in the Trash`
    : `${fmtBytes(run.bytes)} · no longer in the Trash`;
  return (
    <li className="border-b px-4 py-3 last:border-0 divider">
      <div className="flex items-start gap-3">
        <Icon name={trash ? "trash" : "x-circle"} className={`mt-0.5 h-4 w-4 shrink-0 ${trash ? "text-slate-500" : "text-red-600 dark:text-red-400"}`} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          <div className="muted text-xs"><span title={new Date(run.timestamp * 1000).toLocaleString()}>{fmtAge(run.timestamp)}</span> · {status}</div>
        </div>
        {props.canRestore && restorable.length > 0 && (
          <button className="btn btn-sm" disabled={props.busy} onClick={() => props.onRestore(restorable.map((t) => t.id))}>
            <Icon name="undo" className="h-3 w-3" />{restorable.length === run.entries.length ? "Restore" : `Restore ${restorable.length}`}
          </button>
        )}
      </div>
      <Disclosure className="ml-7 mt-1" title={`Show ${items(run.entries.length)}`}>
        <ul className="rounded-lg border text-xs divider">
          {run.entries.map((e: HistoryEntry) => {
            const t = inTrash.get(e.id);
            return (
              <li key={e.id} className="flex items-center gap-3 border-b px-3 py-1.5 last:border-0 divider">
                <span className="mono min-w-0 flex-1 break-all">{e.path}</span>
                <span className="shrink-0 tabular-nums">{fmtBytes(e.estimated_reclaimed)}</span>
                {trash && (t && props.canRestore
                  ? <button className="shrink-0 font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-300" disabled={props.busy} onClick={() => props.onRestore([t.id])}>Restore</button>
                  : <span className="muted w-24 shrink-0 text-right">{t ? "In the Trash" : "Not in the Trash"}</span>)}
              </li>
            );
          })}
        </ul>
      </Disclosure>
    </li>
  );
}

/**
 * Trash and History as one page: every cleanup, newest first, with Restore on what is still in
 * the Trash. Advanced adds the full Trash manager (holds, delete forever) and the History report.
 */
export function ActivityView(props: { settings: Settings; onOpenSettings: () => void; onChanged: () => void }) {
  const advanced = props.settings.show_advanced;
  const [view, setView] = useState<View>("timeline");
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [info, setInfo] = useState<TrashInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState<TrashOutcome[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, i] = await Promise.all([api.getHistory(), api.trashInfo().catch(() => null)]);
      setHistory(h);
      setInfo(i);
      setTrash(i?.supported ? await api.trashList() : []);
      setError(null);
    } catch (e) { setError(String(e)); setHistory((h) => h ?? []); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const un = listen("trash-changed", () => load());
    return () => { un.then((f) => f()).catch(() => {}); };
  }, [load]);
  useEffect(() => { if (!advanced) setView("timeline"); }, [advanced]);

  const runs = useMemo(() => groupRuns(history ?? []), [history]);
  const inTrash = useMemo(() => stillInTrash(history ?? [], trash), [history, trash]);
  const canRestore = !!info?.supported;

  async function restore(ids: string[]) {
    setBusy(true);
    try {
      // The core refuses to put anything back over a folder that exists again.
      setRestored(await api.trashRestore(ids));
      await load();
      props.onChanged();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const tabs = advanced && (
    <Segmented<View> value={view} onChange={setView} options={[{ value: "timeline", label: "Timeline" }, { value: "trash", label: "Manage Trash" }, { value: "history", label: "Report" }]} />
  );
  const head = <PageHeader title="Activity" subtitle="What Dev Cleaner removed, and what you can still put back." actions={tabs || undefined} />;
  if (view === "trash") return <div className="flex h-full flex-col">{head}<div className="min-h-0 flex-1"><TrashView settings={props.settings} onOpenSettings={props.onOpenSettings} onChanged={() => { load(); props.onChanged(); }} embedded /></div></div>;
  if (view === "history") return <div className="flex h-full flex-col">{head}<div className="min-h-0 flex-1"><History embedded /></div></div>;

  if (!history) return <div>{head}<div className="overflow-hidden rounded-[10px] border divider"><SkeletonRows rows={4} /></div></div>;
  if (!runs.length) {
    return (
      <div>
        {head}
        {error && <div className="mb-3"><Banner tone="red" icon="x-circle" title="Could not read your activity">{error}</Banner></div>}
        <div className="rounded-[10px] border divider">
          <EmptyState icon="clock" title="Nothing cleaned yet" description="Every cleanup shows up here. Anything moved to the Trash can be put back from this page until the Trash is emptied." />
        </div>
      </div>
    );
  }

  const inTrashBytes = trash.reduce((s, t) => s + t.bytes, 0);
  const restoredOk = restored?.filter((o) => o.ok) ?? [];
  const restoredBad = restored?.filter((o) => !o.ok) ?? [];
  return (
    <div className="flex h-full flex-col">
      {head}
      <MetricStrip items={[
        ...(canRestore ? [{ label: "In the Trash", value: fmtBytes(inTrashBytes), hero: true }] : []),
        { label: "Removed so far", value: fmtBytes(runs.reduce((s, r) => s + r.bytes, 0)), hero: !canRestore },
        { label: "Last cleanup", value: fmtAge(runs[0].timestamp) },
      ]} />
      <div className="muted mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        {canRestore
          ? <span>{props.settings.trash_retention_days > 0 ? `Items Dev Cleaner moved to the Trash are deleted for good ${props.settings.trash_retention_days} days later.` : "Items stay in the Trash until you empty it."} Restore never replaces a folder that is already back.</span>
          : <span>On this system, put items back from the Trash itself: right-click one and choose Put Back.</span>}
        {!canRestore && <button className="font-medium text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => api.openTrash()}>Open Trash</button>}
      </div>
      {error && <div className="mb-3"><Banner tone="red" icon="x-circle" title="Something went wrong">{error}</Banner></div>}
      {restored && (
        <div className="mb-3">
          <Banner tone={restoredBad.length ? "amber" : "green"} icon={restoredBad.length ? "alert" : "check-circle"}
            title={restoredBad.length ? `Put back ${restoredOk.length} of ${restored.length}` : `Put back ${items(restoredOk.length)}`}
            actions={<button className="btn btn-ghost btn-sm" onClick={() => setRestored(null)} aria-label="Dismiss"><Icon name="x" /></button>}>
            {restoredBad.map((o) => <div key={o.id} className="text-xs"><span className="mono break-all">{o.path || o.id}</span>: {o.error}</div>)}
          </Banner>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto rounded-[10px] border bg-white divider dark:bg-slate-900">
        <ul aria-label="Cleanups">
          {runs.map((r) => <RunCard key={r.key} run={r} inTrash={inTrash} canRestore={canRestore} busy={busy} onRestore={restore} />)}
        </ul>
      </div>
      {busy && <div className="muted mt-2 flex items-center gap-2 text-xs"><Spinner className="h-3.5 w-3.5" />Putting items back…</div>}
    </div>
  );
}
