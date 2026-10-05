import type { ReactNode } from "react";
import { fmtDuration } from "../api";
import { ProgressBar, Spinner } from "../ui/primitives";

/** The card shown while a scan runs: what it is doing, how far along, and progress; Stop lives in the page header. */
export function ScanPanel(props: {
  title: string;
  phase: string;
  /** 0..1, or null when the amount of work is not known yet. */
  fraction: number | null;
  current?: string;
  stats: { label: string; value: ReactNode }[];
  elapsedMs: number;
}) {
  return (
    <div className="card rise p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400"><Spinner className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{props.title}</h2>
          <p className="muted text-sm">{props.phase}</p>
          <div className="mt-3"><ProgressBar value={props.fraction ?? undefined} indeterminate={props.fraction === null} /></div>
          <div className="muted mt-2 h-4 truncate font-mono text-xs" title={props.current}>{props.current || " "}</div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {props.stats.map((s) => <div key={s.label}><span className="muted">{s.label} </span><span className="font-semibold tabular-nums">{s.value}</span></div>)}
            <div><span className="muted">Time </span><span className="font-semibold tabular-nums">{fmtDuration(props.elapsedMs)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
