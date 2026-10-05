import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, fmtAge, fmtBytes, fmtUntil, type Settings, type TrashEntry, type TrashInfo, type TrashOutcome } from "../api";
import { Icon } from "../ui/Icon";
import { Badge, Banner, Checkbox, EmptyState, MetricStrip, Modal, PageHeader, SkeletonRows, Spinner } from "../ui/primitives";

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

  const head = <PageHeader title="Trash" subtitle="Restore or permanently delete folders Dev Cleaner removed." />;
  if (!rows || !info) return <div>{head}<div className="card overflow-hidden"><SkeletonRows rows={4} /></div></div>;

  if (!info.supported) {
    return (
      <div>
        {head}
        <div className="card">
          <EmptyState icon="trash" title="Manage the Trash in Finder"
            description={<>On macOS the Trash cannot be listed from the app, so restoring and auto-clearing are not available. Folders Dev Cleaner removed are in {info.location}. Right-click an item in Finder and choose Put Back to restore it.</>}
            actions={<button className="btn btn-primary" onClick={() => api.openTrash()}><Icon name="external" className="h-4 w-4" />Open Trash</button>} />
        </div>
      </div>
    );
  }

  const banner = (
    <div className="mb-4">
      <Banner tone="blue" icon="info" title={`Removed folders wait in ${info.location}`}
        actions={<><button className="btn btn-sm" onClick={() => api.openTrash()}><Icon name="external" className="h-3.5 w-3.5" />Open {info.location}</button><button className="btn btn-sm" onClick={props.onOpenSettings}>Change retention</button></>}>
        {props.settings.trash_retention_days > 0
          ? <>Items are deleted for good <b>{props.settings.trash_retention_days} days</b> after removal. Only folders removed by Dev Cleaner are managed here.</>
          : <>Auto-clear is off, so items stay until you delete them. Only folders removed by Dev Cleaner are managed here.</>}
      </Banner>
    </div>
  );

  if (error && !list.length) {
    return <div>{head}{banner}<Banner tone="red" icon="x-circle" title="Could not read the Trash" actions={<button className="btn btn-sm" onClick={load}>Try again</button>}>{error}</Banner></div>;
  }

  if (!list.length) {
    return (
      <div>
        {head}{banner}
        <div className="card">
          <EmptyState tone="success" icon="check-circle" title="Trash is empty" description="When you clean in Move to Trash mode, folders show up here so you can put them back."
            actions={<button className="btn" onClick={() => api.openTrash()}><Icon name="external" className="h-4 w-4" />Open {info.location}</button>} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {head}
      <MetricStrip items={[{ label: "Space held", value: fmtBytes(total), hero: true }, { label: "Folders", value: list.length }, { label: "Selected", value: fmtBytes(chosenBytes) }]} />
      {banner}
      {error && <div className="mb-3"><Banner tone="red" icon="x-circle" title="Something went wrong">{error}</Banner></div>}
      <div className="card min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800">
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
                  <div className="muted break-all text-xs">Restores to {r.original_path}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">{fmtBytes(r.bytes)}</td>
                <td className="muted whitespace-nowrap px-3 py-2.5 text-right" title={new Date(r.deleted_at * 1000).toLocaleString()}>{fmtAge(r.deleted_at)}</td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {r.expires_at ? <Badge tone="amber" icon="clock">{fmtUntil(r.expires_at)}</Badge> : <span className="muted text-xs">Never</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  <button className="btn btn-sm" disabled={!!busy} onClick={() => run("restore", [r.id])}><Icon name="undo" className="h-3 w-3" />Restore</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chosen.length > 0 && (
        <div role="region" aria-label="Selection" className="float rise sticky bottom-0 z-20 mt-3 flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <div className="font-semibold tabular-nums">{chosen.length} folder{chosen.length === 1 ? "" : "s"} selected <span className="muted font-normal">· {fmtBytes(chosenBytes)}</span></div>
            <div className="muted text-xs">Restore puts them back where they were. Delete forever cannot be undone.</div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => setSel(new Set())} disabled={!!busy}>Clear</button>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => run("restore", chosen.map((c) => c.id))}>{busy === "restore" ? <Spinner /> : <Icon name="undo" />}Restore</button>
            <button className="btn btn-danger" disabled={!!busy} onClick={() => setConfirmPurge(true)}>{busy === "purge" ? <Spinner /> : <Icon name="trash" />}Delete forever</button>
          </div>
        </div>
      )}

      {confirmPurge && (
        <Modal title="Delete these for good?" subtitle={`${chosen.length} item${chosen.length === 1 ? "" : "s"} · ${fmtBytes(chosenBytes)}`} onClose={() => setConfirmPurge(false)}
          footer={<><button className="btn" onClick={() => setConfirmPurge(false)}>Cancel</button><button className="btn btn-danger" onClick={() => run("purge", chosen.map((c) => c.id))}>Delete forever</button></>}>
          <p>They are removed from the Trash and cannot be restored.</p>
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
