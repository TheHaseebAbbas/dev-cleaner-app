import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, fmtAge, fmtBytes, fmtUntil, type Settings, type TrashEntry, type TrashInfo, type TrashOutcome } from "../api";
import { Icon } from "../ui/Icon";
import { Badge, Banner, Checkbox, EmptyState, Modal, SkeletonRows, Spinner, StatCard } from "../ui/primitives";

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

  if (!rows || !info) return <div className="card overflow-hidden"><SkeletonRows rows={4} /></div>;

  if (!info.supported) {
    return (
      <EmptyState icon="trash" title="Manage the Trash in Finder"
        description={<>On macOS the Trash cannot be listed from the app, so restoring and auto-clearing are not available. Folders Dev Cleaner removed are in {info.location}. Right-click an item in Finder and choose Put Back to restore it.</>}
        actions={<button className="btn btn-primary" onClick={() => api.openTrash()}><Icon name="external" />Open Trash</button>} />
    );
  }

  const header = (
    <Banner tone="blue" icon="info" title={`Removed folders wait in ${info.location}`}
      actions={<><button className="btn btn-sm" onClick={() => api.openTrash()}><Icon name="external" />Open</button><button className="btn btn-sm" onClick={props.onOpenSettings}>Auto-clear settings</button></>}>
      {props.settings.trash_retention_days > 0
        ? <>Items are deleted for good <b>{props.settings.trash_retention_days} days</b> after they were removed. Only folders Dev Cleaner removed are listed here; the rest of your Trash is never touched.</>
        : <>Auto-clear is off, so items stay until you delete them. Only folders Dev Cleaner removed are listed here.</>}
    </Banner>
  );

  if (error && !list.length) {
    return <div className="space-y-3">{header}<Banner tone="red" icon="x-circle" title="Could not read the Trash" actions={<button className="btn btn-sm" onClick={load}>Retry</button>}>{error}</Banner></div>;
  }

  if (!list.length) {
    return (
      <div className="space-y-3">
        {header}
        <EmptyState tone="success" icon="check-circle" title="Nothing waiting in the Trash" description="When you clean in Move to Trash mode, the folders show up here so you can put them back." />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="In the Trash" value={list.length} hint="removed by Dev Cleaner" />
        <StatCard label="Space held" value={fmtBytes(total)} tone="green" hint="freed once deleted for good" />
        <StatCard label="Selected" value={fmtBytes(chosenBytes)} hint={`${chosen.length} item${chosen.length === 1 ? "" : "s"}`} />
      </div>
      {header}
      {error && <Banner tone="red" icon="x-circle" title="Something went wrong">{error}</Banner>}
      <div className="card min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-200 text-[11px] uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th className="w-10 px-3 py-2 text-left"><Checkbox checked={allChecked} indeterminate={chosen.length > 0 && !allChecked} onChange={() => setSel(allChecked ? new Set() : new Set(list.map((r) => r.id)))} label="Select all" /></th>
              <th className="px-3 py-2 text-left">Folder</th>
              <th className="px-3 py-2 text-right">Size</th>
              <th className="px-3 py-2 text-right">Removed</th>
              <th className="px-3 py-2 text-left">Auto-clear</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={`border-b divider ${sel.has(r.id) ? "bg-emerald-50 dark:bg-emerald-950/30" : ""}`}>
                <td className="px-3 py-2"><Checkbox checked={sel.has(r.id)} onChange={() => flip(r.id)} label={`Select ${r.name}`} /></td>
                <td className="min-w-0 px-3 py-2">
                  <div className="font-medium">{r.name}</div>
                  <div className="muted break-all text-xs">Restores to {r.original_path}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{fmtBytes(r.bytes)}</td>
                <td className="muted whitespace-nowrap px-3 py-2 text-right" title={new Date(r.deleted_at * 1000).toLocaleString()}>{fmtAge(r.deleted_at)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.expires_at ? <Badge tone="amber" icon="clock">{fmtUntil(r.expires_at)}</Badge> : <span className="muted text-xs">Never</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button className="btn btn-sm" disabled={!!busy} onClick={() => run("restore", [r.id])}><Icon name="refresh" className="h-3 w-3" />Restore</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chosen.length > 0 && (
        <div className="rise sticky bottom-0 z-20 flex items-center justify-between gap-4 rounded-xl border border-slate-300 bg-white px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div>
            <div className="font-semibold tabular-nums">{chosen.length} item{chosen.length === 1 ? "" : "s"} · {fmtBytes(chosenBytes)}</div>
            <div className="muted text-xs">Restore puts them back where they were. Delete forever cannot be undone.</div>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => setSel(new Set())} disabled={!!busy}>Clear</button>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => run("restore", chosen.map((c) => c.id))}>{busy === "restore" ? <Spinner /> : <Icon name="refresh" />}Restore selected</button>
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
