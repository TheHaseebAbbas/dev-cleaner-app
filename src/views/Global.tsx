import { useEffect, useState } from "react";
import { api, fmtBytes, type DeleteOutcome, type GlobalCache, type Settings } from "../api";
import { Confirm } from "../components/Confirm";

export function Global({ settings }: { settings: Settings }) {
  const [caches, setCaches] = useState<GlobalCache[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<DeleteOutcome[] | null>(null);
  const load = () => api.listGlobalCaches().then(setCaches);
  useEffect(() => { load(); }, []);

  const present = (caches ?? []).filter((c) => c.exists);
  const bytes = present.filter((c) => sel.has(c.id)).reduce((s, c) => s + c.disk_bytes, 0);
  async function run() {
    setConfirm(false);
    const out = await api.deleteGlobalCaches([...sel]);
    setResult(out);
    setSel(new Set());
    load();
  }
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Global caches</h2>
          <p className="text-sm text-slate-500">Per-user caches of package managers, IDEs and toolchains.</p>
        </div>
        <button className="btn" onClick={() => { setCaches(null); load(); }}>Refresh</button>
      </div>
      {caches === null ? <p className="text-slate-500">Measuring…</p> : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
              <tr><th className="w-8" /><th className="px-3 py-2 text-left">Cache</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-right">Size</th><th className="px-3 py-2 text-right">Files</th><th className="px-3 py-2 text-left">Note</th></tr>
            </thead>
            <tbody>
              {present.sort((a, b) => b.disk_bytes - a.disk_bytes).map((c) => (
                <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-3"><input type="checkbox" checked={sel.has(c.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} /></td>
                  <td className="px-3 py-2"><div className="font-medium">{c.name}</div><div className="break-all text-xs text-slate-500">{c.path}</div></td>
                  <td className="px-3 py-2">{c.category}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtBytes(c.disk_bytes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.file_count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-slate-500">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!present.length && <p className="p-8 text-center text-slate-500">No known global caches found on this machine.</p>}
        </div>
      )}
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <span className="text-sm">{sel.size} selected · {fmtBytes(bytes)}</span>
        <button className="btn btn-danger" disabled={!sel.size} onClick={() => (settings.confirm_before_delete ? setConfirm(true) : run())}>Clean selected</button>
      </div>
      {confirm && <Confirm title="Clean global caches?" confirmLabel="Clean" danger onConfirm={run} onCancel={() => setConfirm(false)}><p>{sel.size} caches · {fmtBytes(bytes)}. Tools will re-download what they need.</p></Confirm>}
      {result && <Confirm title="Done" confirmLabel="OK" onConfirm={() => setResult(null)} onCancel={() => setResult(null)}>
        <p>{result.filter((r) => r.ok).length}/{result.length} succeeded · {fmtBytes(result.filter((r) => r.ok).reduce((s, r) => s + r.bytes_freed, 0))}.</p>
        {result.filter((r) => !r.ok).map((r) => <p key={r.path} className="text-red-600">{r.path}: {r.error}</p>)}
      </Confirm>}
    </div>
  );
}
