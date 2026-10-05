import { useEffect, useState } from "react";
import { api, CATEGORY_LABEL, fmtBytes, RISK_LABEL, type HistoryEntry } from "../api";
import { Badge, EmptyState, MetricStrip, PageHeader, SkeletonRows } from "../ui/primitives";

export function History() {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  useEffect(() => { api.getHistory().then((r) => setRows([...r].reverse())).catch(() => setRows([])); }, []);
  const head = <PageHeader title="History" subtitle="Everything Dev Cleaner has removed." />;
  if (!rows) return <div>{head}<div className="card overflow-hidden"><SkeletonRows rows={4} /></div></div>;
  if (!rows.length) return <div>{head}<div className="card"><EmptyState icon="clock" title="No cleanups yet" description="Everything you remove is logged here, with when it happened and how much space it freed." /></div></div>;
  const total = rows.reduce((s, r) => s + r.estimated_reclaimed, 0);
  return (
    <div className="flex h-full flex-col">
      {head}
      <MetricStrip items={[{ label: "Total reclaimed", value: fmtBytes(total), hero: true }, { label: "Folders removed", value: rows.length }, { label: "Last cleanup", value: new Date(rows[0].timestamp * 1000).toLocaleDateString() }]} />
      <div className="card min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800">
            <tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Folder</th><th className="px-3 py-2 text-left">Kind</th><th className="px-3 py-2 text-left">How</th><th className="px-3 py-2 text-right" title="Estimated from the scan; files hard-linked elsewhere are not counted">Freed (est.)</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b divider hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="whitespace-nowrap px-3 py-2.5">{new Date(r.timestamp * 1000).toLocaleString()}</td>
                <td className="mono break-all px-3 py-2.5 text-xs">{r.path}{r.project_root && <div className="muted font-sans">in {r.project_root}</div>}</td>
                <td className="px-3 py-2.5 text-xs" title={r.rule_id ? `Rule ${r.rule_id}` : undefined}>{r.category ? CATEGORY_LABEL[r.category] : "—"}{r.risk && r.risk !== "safe" ? <div className="muted">{RISK_LABEL[r.risk]}</div> : null}</td>
                <td className="px-3 py-2.5"><Badge tone={r.mode === "trash" ? "brand" : "amber"}>{r.mode === "trash" ? "Trash" : "Permanent"}</Badge></td>
                <td className="px-3 py-2.5 text-right font-medium tabular-nums">{fmtBytes(r.estimated_reclaimed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
