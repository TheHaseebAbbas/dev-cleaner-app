import { useEffect, useState } from "react";
import { api, fmtBytes, type HistoryEntry } from "../api";
import { EmptyState, SkeletonRows, StatCard } from "../ui/primitives";
import { Badge } from "../ui/primitives";

export function History() {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  useEffect(() => { api.getHistory().then((r) => setRows([...r].reverse())).catch(() => setRows([])); }, []);
  if (!rows) return <div className="card overflow-hidden"><SkeletonRows rows={4} /></div>;
  if (!rows.length) return <EmptyState icon="clock" title="No cleanups yet" description="Everything you remove is logged here, with when it happened and how much space it freed." />;
  const total = rows.reduce((s, r) => s + r.bytes_freed, 0);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total reclaimed" value={fmtBytes(total)} tone="green" />
        <StatCard label="Folders removed" value={rows.length} />
        <StatCard label="Last cleanup" value={new Date(rows[0].timestamp * 1000).toLocaleDateString()} />
      </div>
      <div className="card min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-100 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Folder</th><th className="px-3 py-2 text-left">How</th><th className="px-3 py-2 text-right">Freed</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b divider">
                <td className="whitespace-nowrap px-3 py-2">{new Date(r.timestamp * 1000).toLocaleString()}</td>
                <td className="break-all px-3 py-2 font-mono text-xs">{r.path}</td>
                <td className="px-3 py-2"><Badge tone={r.mode === "trash" ? "green" : "amber"}>{r.mode === "trash" ? "Trash" : "Permanent"}</Badge></td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtBytes(r.bytes_freed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
