import { useEffect, useState } from "react";
import { api, CATEGORY_LABEL, fmtAge, fmtBytes, type Analytics, type Category, type HistoryEntry } from "../api";
import { Disclosure, EmptyState, MetricStrip, PageHeader, SkeletonRows, Spinner } from "../ui/primitives";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A small look back: space reclaimed per month and what it was. Deliberately not a dashboard. */
function OverTime() {
  const [a, setA] = useState<Analytics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { if (!a) api.getAnalytics().then(setA, (e) => setErr(String(e))); };
  const max = a ? Math.max(1, ...a.months.map((m) => m.bytes)) : 1;
  return (
    <Disclosure title="Over time" onOpen={load} className="mb-3">
      {err ? <p className="text-xs text-red-600">{err}</p> : !a ? <Spinner /> : (
        <div className="grid gap-6 rounded-[10px] border p-4 divider md:grid-cols-[1fr_16rem]">
          <div>
            <div className="muted mb-2 text-xs">Reclaimed per month</div>
            <div className="flex h-24 items-end gap-1.5" role="img" aria-label="Space reclaimed per month for the last 12 months">
              {a.months.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.month}: ${fmtBytes(m.bytes)} · ${m.folders} folders`}>
                  <div className="w-full rounded-sm bg-indigo-500/70 dark:bg-indigo-400/60" style={{ height: `${Math.max(m.bytes ? 4 : 1, (m.bytes / max) * 80)}px`, opacity: m.bytes ? 1 : 0.25 }} />
                  <span className="muted text-[10px]">{MONTHS[Number(m.month.slice(5)) - 1]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="text-xs">
            <div className="muted mb-2">Most reclaimed</div>
            {!a.by_category.length ? <p className="muted">Nothing yet.</p> : (
              <ul className="space-y-1">
                {a.by_category.slice(0, 5).map((c) => (
                  <li key={c.key} className="flex justify-between gap-3"><span className="truncate">{CATEGORY_LABEL[c.key as Category] ?? c.key}</span><span className="tabular-nums">{fmtBytes(c.bytes)}</span></li>
                ))}
              </ul>
            )}
            {a.scans.length > 1 && (
              <p className="muted mt-3">Last scan found {fmtBytes(a.scans[a.scans.length - 1].reclaimable_bytes)} reclaimable, {a.scans[a.scans.length - 1].reclaimable_bytes > a.scans[0].reclaimable_bytes ? "up" : "down"} from {fmtBytes(a.scans[0].reclaimable_bytes)} {a.scans.length} scans ago.</p>
            )}
          </div>
        </div>
      )}
    </Disclosure>
  );
}

export function History() {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  useEffect(() => { api.getHistory().then((r) => setRows([...r].reverse())).catch(() => setRows([])); }, []);
  const head = <PageHeader title="History" subtitle="Everything Dev Cleaner has removed." />;
  if (!rows) return <div>{head}<div className="overflow-hidden rounded-[10px] border divider"><SkeletonRows rows={4} /></div></div>;
  if (!rows.length) return <div>{head}<div className="rounded-[10px] border divider"><EmptyState icon="clock" title="No cleanups yet" description="Everything you remove is listed here, with when it happened and how much space it freed." /></div></div>;
  const total = rows.reduce((s, r) => s + r.estimated_reclaimed, 0);
  return (
    <div className="flex h-full flex-col">
      {head}
      <MetricStrip items={[{ label: "Total reclaimed", value: fmtBytes(total), hero: true }, { label: "Folders removed", value: rows.length }, { label: "Last cleanup", value: fmtAge(rows[0].timestamp) }]} />
      <OverTime />
      <div className="min-h-0 flex-1 overflow-auto rounded-[10px] border bg-white divider dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b bg-slate-50 text-xs font-medium text-slate-500 divider dark:bg-slate-800 dark:text-slate-400">
            <tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Folder</th><th className="px-3 py-2 text-left">How</th><th className="px-3 py-2 text-right" title="Estimated from the scan; files hard-linked elsewhere are not counted">Freed</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || i} className="border-b divider hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="whitespace-nowrap px-3 py-2 align-top text-[13px]" title={new Date(r.timestamp * 1000).toLocaleString()}>{new Date(r.timestamp * 1000).toLocaleDateString()}<div className="muted text-xs">{new Date(r.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></td>
                <td className="px-3 py-2 align-top">
                  <div className="mono break-all text-xs">{r.path}</div>
                  <div className="muted text-xs">{r.category ? CATEGORY_LABEL[r.category] : ""}{r.project_root ? `${r.category ? " · " : ""}in ${r.project_root.split(/[\\/]/).pop()}` : ""}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 align-top text-[13px]">{r.mode === "trash" ? "Moved to Trash" : <span className="text-red-700 dark:text-red-300">Deleted permanently</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right align-top font-medium tabular-nums">{fmtBytes(r.estimated_reclaimed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
