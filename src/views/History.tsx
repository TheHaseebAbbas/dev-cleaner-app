import { useEffect, useState } from "react";
import { api, fmtBytes, type HistoryEntry } from "../api";

export function History() {
  const [rows, setRows] = useState<HistoryEntry[]>([]);
  useEffect(() => { api.getHistory().then((r) => setRows([...r].reverse())); }, []);
  const total = rows.reduce((s, r) => s + r.bytes_freed, 0);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="card"><div className="text-xs text-slate-500">Total reclaimed (all time)</div><div className="text-2xl font-semibold">{fmtBytes(total)}</div></div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900"><tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Path</th><th className="px-3 py-2 text-left">Mode</th><th className="px-3 py-2 text-right">Freed</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 whitespace-nowrap">{new Date(r.timestamp * 1000).toLocaleString()}</td>
                <td className="break-all px-3 py-2">{r.path}</td>
                <td className="px-3 py-2">{r.mode === "trash" ? "Trash" : "Permanent"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtBytes(r.bytes_freed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-8 text-center text-slate-500">No cleanups yet.</p>}
      </div>
    </div>
  );
}
