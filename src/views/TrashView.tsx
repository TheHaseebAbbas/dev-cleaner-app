import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, fmtAge, fmtBytes, fmtUntil, type Settings, type TrashEntry, type TrashHold, type TrashInfo, type TrashOutcome } from "../api";
import { Icon } from "../ui/Icon";
import { Banner, Checkbox, EmptyState, MetricStrip, Modal, PageHeader, Popover, SkeletonRows, Spinner } from "../ui/primitives";

const DAY = 86_400;
const cap = (s: string) => s.replace(/^the /, "").replace(/^\w/, (c) => c.toUpperCase());

/** Auto-clear cell: when it goes, and a small menu to keep it longer. */
function AutoClear({ entry, retention, onHold }: { entry: TrashEntry; retention: number; onHold: (h: TrashHold | null) => void }) {
  const now = Date.now() / 1000;
  const base = Math.max(now, entry.expires_at ?? now);
  const text = entry.hold?.kind === "forever" ? "Kept until you delete it" : entry.expires_at ? fmtUntil(entry.expires_at) : "Never";
  return (
    <div className="flex items-center gap-2">
      <span className={entry.hold ? "font-medium" : "muted"}>{text}</span>
      <Popover label="Change" width="w-60" align="right" triggerClass="rounded px-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300">
        {(close) => (
          <div className="space-y-0.5 text-[13px]">
            <div className="muted mb-1 text-xs">Keep {entry.name} in the Trash</div>
            {([["Until I delete it", { kind: "forever" }], ["30 more days", { kind: "until", until: Math.round(base + 30 * DAY) }], ["90 more days", { kind: "until", until: Math.round(base + 90 * DAY) }]] as [string, TrashHold][]).map(([label, h]) => (
              <button key={label} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700/60" onClick={() => { onHold(h); close(); }}>{label}</button>
            ))}
            {entry.hold && <button className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700/60" onClick={() => { onHold(null); close(); }}>Use the default {retention > 0 ? `(${retention} days)` : "(never clear)"}</button>}
          </div>
        )}
      </Popover>
    </div>
  );
}

export function TrashView(props: { settings: Settings; onOpenSettings: () => void; onChanged: () => void }) {
  const [info, setInfo] = useState<TrashInfo | null>(null);
  const [rows, setRows] = useState<TrashEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"restore" | "purge" | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [report, setReport] = useState<{ title: string; outcomes: TrashOutcome[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const i = await api.trashInfo();
      setInfo(i);
      if (!i.supported) { setRows([]); return; }
      setRows(await api.trashList());
      setError(null);
    } catch (e) { setError(String(e)); setRows([]); }
  }, []);

  useEffect(() => { load(); }, [load, props.settings.trash_retention_days]);
  useEffect(() => {
    const un = listen("trash-changed", () => load());
    return () => { un.then((f) => f()); };
  }, [load]);

  const list = rows ?? [];
  const chosen = useMemo(() => list.filter((r) => sel.has(r.id)), [list, sel]);
  const chosenBytes = chosen.reduce((s, r) => s + r.bytes, 0);
  const total = list.reduce((s, r) => s + r.bytes, 0);
  const allChecked = list.length > 0 && chosen.length === list.length;
  const flip = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function hold(ids: string[], h: TrashHold | null) {
    try { setRows(await api.trashSetHold(ids, h)); } catch (e) { setError(String(e)); }
  }

  async function run(kind: "restore" | "purge", ids: string[]) {
    setBusy(kind);
    setConfirmPurge(false);
    try {
      const out = kind === "restore" ? await api.trashRestore(ids) : await api.trashPurge(ids);
      setReport({ title: kind === "restore" ? "Restore finished" : "Deleted for good", outcomes: out });
      setSel(new Set());
      await load();
      props.onChanged();
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  const head = <PageHeader title="Trash" subtitle="Recover folders removed by Dev Cleaner until they are permanently deleted." />;
  if (!rows || !info) return <div>{head}<div className="card overflow-hidden"><SkeletonRows rows={4} /></div></div>;

  if (!info.supported) {
    return (
      <div>
        {head}
        <div className="card">
          <EmptyState icon="trash" title="Manage the Trash in Finder"
            description={<>macOS does not allow Dev Cleaner to list Trash contents here. Folders it removed are in the Trash; right-click one in Finder and choose Put Back to restore it.</>}
            actions={<button className="btn btn-primary" onClick={() => api.openTrash()}><Icon name="external" className="h-4 w-4" />Open Trash</button>} />
        </div>
      </div>
    );
  }

  const osTrash = cap(info.location.replace(/ \(.*\)$/, ""));
  const banner = (
    <div className="muted mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      <span>Only folders removed by Dev Cleaner are managed here. {props.settings.trash_retention_days > 0 ? `They are deleted for good ${props.settings.trash_retention_days} days after removal.` : "Automatic clearing is off."}</span>
      <button className="font-medium text-indigo-600 hover:underline dark:text-indigo-300" onClick={props.onOpenSettings}>Change</button>
      <button className="font-medium text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => api.openTrash()}>Open {osTrash}</button>
    </div>
  );

  if (error && !list.length) {
    return <div>{head}{banner}<Banner tone="red" icon="x-circle" title="Could not read the Trash" actions={<button className="btn btn-sm" onClick={load}>Try again</button>}>{error}</Banner></div>;
  }

  if (!list.length) {
    return (
      <div>
        {head}
        <div className="rounded-[10px] border divider">
          <EmptyState icon="trash" title="Nothing waiting in the Trash" description="Folders moved to Trash by Dev Cleaner will appear here."
            actions={<button className="btn" onClick={() => api.openTrash()}><Icon name="external" className="h-4 w-4" />Open {osTrash}</button>} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {head}
      <MetricStrip items={[{ label: "In the Trash", value: fmtBytes(total), hero: true }, { label: "Folders", value: list.length }]} />
      {banner}
      {error && <div className="mb-3"><Banner tone="red" icon="x-circle" title="Something went wrong">{error}</Banner></div>}
      <div className="min-h-0 flex-1 overflow-auto rounded-[10px] border bg-white divider dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b bg-slate-50 text-xs font-medium text-slate-500 divider dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="w-10 px-3 py-2 text-left"><Checkbox checked={allChecked} indeterminate={chosen.length > 0 && !allChecked} onChange={() => setSel(allChecked ? new Set() : new Set(list.map((r) => r.id)))} label="Select all" /></th>
              <th className="px-3 py-2 text-left">Folder</th>
              <th className="px-3 py-2 text-right">Size</th>
              <th className="px-3 py-2 text-right">Removed</th>
              <th className="px-3 py-2 text-left">Auto-clear</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={`border-b divider ${sel.has(r.id) ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"}`}>
                <td className="px-3 py-2.5"><Checkbox checked={sel.has(r.id)} onChange={() => flip(r.id)} label={`Select ${r.name}`} /></td>
                <td className="min-w-0 px-3 py-2.5">
                  <div className="font-medium">{r.name}</div>
                  <div className="muted break-all text-xs">Restores to {r.original_path.replace(/[\\/][^\\/]+$/, "")}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">{fmtBytes(r.bytes)}</td>
                <td className="muted whitespace-nowrap px-3 py-2.5 text-right" title={new Date(r.deleted_at * 1000).toLocaleString()}>{fmtAge(r.deleted_at)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[13px]">
                  <AutoClear entry={r} retention={props.settings.trash_retention_days} onHold={(h) => hold([r.id], h)} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  <button className="btn btn-sm border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-200 dark:hover:bg-indigo-500/10" disabled={!!busy} onClick={() => run("restore", [r.id])}><Icon name="undo" className="h-3 w-3" />Restore</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chosen.length > 0 && (
        <div role="region" aria-label="Selection" className="rise mt-3 flex items-center justify-between gap-4 rounded-[10px] border border-indigo-200 bg-indigo-50/60 px-4 py-2.5 dark:border-indigo-500/30 dark:bg-indigo-500/10">
          <div>
            <div className="font-semibold tabular-nums">{chosen.length} folder{chosen.length === 1 ? "" : "s"} selected <span className="muted font-normal">· {fmtBytes(chosenBytes)}</span></div>
            <div className="muted text-xs">Restore puts them back where they were. Delete forever cannot be undone.</div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => setSel(new Set())} disabled={!!busy}>Clear</button>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => run("restore", chosen.map((c) => c.id))}>{busy === "restore" ? <Spinner /> : <Icon name="undo" />}Restore selected</button>
            <button className="btn btn-danger" disabled={!!busy} onClick={() => setConfirmPurge(true)}>{busy === "purge" ? <Spinner /> : <Icon name="trash" />}Delete forever</button>
          </div>
        </div>
      )}

      {confirmPurge && (
        <Modal title="Delete forever?" subtitle={`${chosen.length} folder${chosen.length === 1 ? "" : "s"} · ${fmtBytes(chosenBytes)}`} onClose={() => setConfirmPurge(false)}
          footer={<><button className="btn" onClick={() => setConfirmPurge(false)}>Cancel</button><button className="btn btn-danger" onClick={() => run("purge", chosen.map((c) => c.id))}>Delete forever</button></>}>
          <p>This cannot be undone. They are removed from the Trash and cannot be restored.</p>
          <ul className="mt-3 max-h-48 overflow-auto rounded-lg border text-xs divider">
            {chosen.map((c) => <li key={c.id} className="break-all border-b px-3 py-1.5 font-mono last:border-0 divider">{c.original_path}</li>)}
          </ul>
        </Modal>
      )}

      {report && (
        <Modal title={report.title} onClose={() => setReport(null)} footer={<button className="btn btn-primary" onClick={() => setReport(null)}>OK</button>}>
          <p>{report.outcomes.filter((o) => o.ok).length} of {report.outcomes.length} succeeded · {fmtBytes(report.outcomes.filter((o) => o.ok).reduce((s, o) => s + o.bytes, 0))}.</p>
          {report.outcomes.filter((o) => !o.ok).map((o) => (
            <div key={o.id} className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs dark:border-red-900 dark:bg-red-950/30">
              <div className="break-all font-mono">{o.path || o.id}</div>
              <div className="text-red-700 dark:text-red-300">{o.error}</div>
              {o.error?.toLowerCase().includes("exist") && <div className="muted mt-1">Something already exists at the original location. Move or rename it, then try again.</div>}
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}
