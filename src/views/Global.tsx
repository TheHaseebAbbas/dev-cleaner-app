import { Fragment, useEffect, useState } from "react";
import { api, fmtBytes, fmtDate, type DeleteOutcome, type GlobalCache, type Settings } from "../api";
import { Confirm } from "../components/Confirm";
import { LocationsDialog } from "../components/LocationsDialog";
import { needsAck, WarnBadge, WarningPanel, type WarnEntry } from "../components/Warnings";

interface PlanEntry extends WarnEntry { bytes: number; whole: boolean }

export function Global({ settings, onOpenSettings }: { settings: Settings; onOpenSettings: () => void }) {
  const [showWhere, setShowWhere] = useState(false);
  const [caches, setCaches] = useState<GlobalCache[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set()); // cache ids and part paths
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState<DeleteOutcome[] | null>(null);
  const load = () => api.listGlobalCaches().then(setCaches);
  useEffect(() => { load(); }, []);

  const flip = (s: Set<string>, k: string) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; };
  const present = (caches ?? []).filter((c) => c.exists).sort((a, b) => b.disk_bytes - a.disk_bytes);
  const removable = present.filter((c) => !c.info_only);
  const viewOnly = present.filter((c) => c.info_only);

  const plan: PlanEntry[] = removable.flatMap((c): PlanEntry[] =>
    sel.has(c.id)
      ? [{ path: c.id, label: c.path, bytes: c.disk_bytes, whole: true, warnings: [...c.warnings, ...c.parts.flatMap((p) => (p.warning ? [p.warning] : []))] }]
      : c.parts.filter((p) => sel.has(p.path)).map((p) => ({ path: p.path, label: p.path, bytes: p.disk_bytes, whole: false, warnings: [...c.warnings, ...(p.warning ? [p.warning] : [])] })),
  );
  const bytes = plan.reduce((s, e) => s + e.bytes, 0);

  async function run() {
    setConfirm(false);
    const out = await api.deleteGlobalCaches(plan.filter((e) => e.whole).map((e) => e.path), plan.filter((e) => !e.whole).map((e) => e.path));
    setResult(out);
    setSel(new Set());
    setCaches(null);
    load();
  }
  const clean = () => (settings.confirm_before_delete || needsAck(plan) ? (setAck(false), setConfirm(true)) : run());

  const row = (c: GlobalCache) => {
    const isOpen = open.has(c.id);
    const some = !sel.has(c.id) && c.parts.some((p) => sel.has(p.path));
    return (
      <Fragment key={c.id}>
        <tr className="border-b border-slate-100 dark:border-slate-800">
          <td className="px-3">
            {!c.info_only && <input type="checkbox" disabled={c.parts_only} title={c.parts_only ? "Choose individual parts instead" : undefined} checked={sel.has(c.id)} ref={(el) => { if (el) el.indeterminate = some; }} onChange={() => setSel((s) => { const n = flip(s, c.id); c.parts.forEach((p) => n.delete(p.path)); return n; })} />}
          </td>
          <td className="px-3 py-2">
            <div className="flex items-start gap-1">
              {c.parts.length > 0 ? <button className="w-4 text-slate-500" onClick={() => setOpen((s) => flip(s, c.id))}>{isOpen ? "▾" : "▸"}</button> : <span className="w-4" />}
              <div>
                <div className="font-medium">{c.name}
                  {c.info_only && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-normal dark:bg-slate-700">view only</span>}
                  {c.parts_only && !c.info_only && <span className="ml-2 text-xs font-normal text-amber-600">choose parts</span>}
                  {c.parts.length > 0 && !c.info_only && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-normal dark:bg-slate-700">{c.parts.length} parts</span>}
                  <WarnBadge warnings={c.warnings} />
                </div>
                <div className="break-all text-xs text-slate-500">{c.path}</div>
              </div>
            </div>
          </td>
          <td className="px-3 py-2">{c.category}</td>
          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtBytes(c.disk_bytes)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{c.file_count.toLocaleString()}</td>
          <td className="px-3 py-2 text-slate-500">{c.note}</td>
        </tr>
        {isOpen && c.parts.map((p) => (
          <tr key={p.path} className="border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
            <td className="px-3 text-right">{!c.info_only && <input type="checkbox" disabled={sel.has(c.id)} checked={sel.has(c.id) || sel.has(p.path)} onChange={() => setSel((s) => flip(s, p.path))} />}</td>
            <td className="py-1.5 pl-8 pr-3"><span className="font-mono text-xs">{p.name}</span> <span className="text-xs text-slate-500">{c.info_only ? "" : "optional part"}</span>{p.warning && <WarnBadge warnings={[p.warning]} />}</td>
            <td className="px-3 py-1.5 text-xs text-slate-500">modified {fmtDate(p.last_modified)}</td>
            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{fmtBytes(p.disk_bytes)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{p.file_count.toLocaleString()}</td>
            <td className="px-3 py-1.5 text-xs">{p.warning ? p.warning.message : ""}</td>
          </tr>
        ))}
      </Fragment>
    );
  };
  const head = (
    <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
      <tr><th className="w-8" /><th className="px-3 py-2 text-left">Cache and location</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-right">Size</th><th className="px-3 py-2 text-right">Files</th><th className="px-3 py-2 text-left">What happens if removed</th></tr>
    </thead>
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Global caches and SDKs</h2>
          <p className="text-sm text-slate-500">Things your tools keep in your user folder (AppData on Windows), outside any project. Expand a row (▸) to remove just one part, such as a single Gradle version, SDK platform or simulator. Rows marked ⛔ or ⚠ may be required: read the note first.</p>
        </div>
        <div className="flex shrink-0 gap-2 whitespace-nowrap"><button className="btn" onClick={() => setShowWhere(true)}>Where it looks</button><button className="btn" onClick={() => { setCaches(null); load(); }}>Refresh</button></div>
      </div>
      {caches === null ? <p className="text-slate-500">Measuring…</p> : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">{head}<tbody>{removable.map(row)}</tbody></table>
          {!removable.length && <p className="p-8 text-center text-slate-500">No known global caches found on this machine.</p>}
          {viewOnly.length > 0 && (
            <>
              <h3 className="mt-6 mb-1 font-semibold">Large disk images (view only)</h3>
              <p className="mb-2 text-sm text-slate-500">These files contain whole systems or all of your containers, so Dev Cleaner never deletes them. Use the hints in the last column to shrink them safely.</p>
              <table className="w-full text-sm">{head}<tbody>{viewOnly.map(row)}</tbody></table>
            </>
          )}
        </div>
      )}
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <span className="text-sm">{plan.length} selected · {fmtBytes(bytes)} · {settings.dry_run ? "dry run" : settings.delete_mode === "trash" ? "moves to Trash" : "deletes permanently"}</span>
        <button className="btn btn-danger" disabled={!plan.length} onClick={clean}>Clean selected</button>
      </div>
      {showWhere && <LocationsDialog onClose={() => setShowWhere(false)} onOpenSettings={onOpenSettings} />}
      {confirm && (
        <Confirm title="Remove these folders?" confirmLabel="Remove" danger confirmDisabled={needsAck(plan) && !ack && !settings.dry_run} onConfirm={run} onCancel={() => setConfirm(false)}>
          <p className="mb-2">{fmtBytes(bytes)} in total. Tools will re-download or rebuild what they need.</p>
          <ul className="max-h-48 space-y-1 overflow-auto rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
            {plan.map((e) => <li key={e.path} className="flex justify-between gap-3"><span className="break-all font-mono">{e.label}</span><span className="shrink-0 tabular-nums">{fmtBytes(e.bytes)}</span></li>)}
          </ul>
          <WarningPanel entries={plan} ack={ack} onAck={setAck} dryRun={settings.dry_run} />
        </Confirm>
      )}
      {result && (
        <Confirm title="Done" confirmLabel="OK" onConfirm={() => setResult(null)} onCancel={() => setResult(null)}>
          <p>{result.filter((r) => r.ok).length}/{result.length} succeeded · {fmtBytes(result.filter((r) => r.ok).reduce((s, r) => s + r.bytes_freed, 0))}.</p>
          {result.filter((r) => !r.ok).map((r) => <p key={r.path} className="break-all text-red-600">{r.path}: {r.error}</p>)}
        </Confirm>
      )}
    </div>
  );
}
