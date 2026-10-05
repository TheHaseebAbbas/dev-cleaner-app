import type { ReactNode } from "react";
import { fmtDuration } from "../api";
import { Icon } from "../ui/Icon";
import { ProgressBar, Spinner } from "../ui/primitives";

/**
 * Shown above the results while a scan runs. Results keep streaming into the list below, and the
 * rest of the app stays usable.
 */
export function ScanPanel(props: {
  title: string;
  /** Folders being checked (project scan roots). */
  roots?: string[];
  /** 0..1, or null when the amount of work is not known yet. */
  fraction: number | null;
  current?: string;
  stats: { label: string; value: ReactNode }[];
  elapsedMs: number;
  onCancel: () => void;
}) {
  return (
    <div className="rise mb-4 rounded-[10px] border px-4 py-3 divider" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Spinner className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">{props.title}</div>
        </div>
        <button className="btn btn-sm" onClick={props.onCancel}><Icon name="stop" className="h-3 w-3" />Cancel scan</button>
      </div>
      {props.roots && props.roots.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="muted">Checking</span>
          {props.roots.slice(0, 4).map((r) => <span key={r} className="mono max-w-[16rem] truncate rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800" title={r}>{r}</span>)}
          {props.roots.length > 4 && <span className="muted">and {props.roots.length - 4} more</span>}
        </div>
      )}
      <div className="mt-2.5"><ProgressBar value={props.fraction ?? undefined} indeterminate={props.fraction === null} /></div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        {props.stats.map((s) => <span key={s.label}><span className="muted">{s.label} </span><span className="font-semibold tabular-nums">{s.value}</span></span>)}
        <span><span className="muted">Time </span><span className="font-semibold tabular-nums">{fmtDuration(props.elapsedMs)}</span></span>
        <span className="muted mono min-w-0 flex-1 truncate text-right" title={props.current}>{props.current}</span>
      </div>
    </div>
  );
}
