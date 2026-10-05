import { fmtBytes } from "../api";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/primitives";

/** Footer that appears once something is selected: what is selected, how big, and the one action. */
export function SelectionBar(props: { count: number; bytes: number; noun: string; permanent: boolean; dryRun: boolean; busy: boolean; blockedReason?: string; onClear: () => void; onClean: () => void }) {
  if (!props.count && !props.busy) return null;
  const status = props.blockedReason ?? (props.dryRun ? "Dry run: nothing will be deleted" : props.permanent ? "Deletes permanently" : "Moves to Trash, so you can restore it");
  return (
    <div role="region" aria-label="Selection" className="rise mt-3 flex items-center justify-between gap-4 rounded-[10px] border border-indigo-200 bg-indigo-50/60 px-4 py-2.5 dark:border-indigo-500/30 dark:bg-indigo-500/10">
      <div className="flex min-w-0 items-center gap-3">
        <Icon name="check" className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
        <div className="min-w-0">
          <div className="font-semibold tabular-nums">{props.count} selected <span className="font-normal text-slate-500 dark:text-slate-400">· {fmtBytes(props.bytes)}</span></div>
          <div className={`truncate text-xs ${props.blockedReason ? "text-amber-700 dark:text-amber-300" : props.dryRun ? "text-amber-700 dark:text-amber-300" : props.permanent ? "text-red-600 dark:text-red-400" : "muted"}`}>{status}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button className="btn btn-ghost" onClick={props.onClear} disabled={props.busy}>Clear</button>
        <button className={`btn ${props.permanent && !props.dryRun ? "btn-danger" : "btn-primary"} px-4`} onClick={props.onClean} disabled={props.busy || !!props.blockedReason}>
          {props.busy ? <><Spinner />Cleaning…</> : <>Reclaim {fmtBytes(props.bytes)}</>}
        </button>
      </div>
    </div>
  );
}
