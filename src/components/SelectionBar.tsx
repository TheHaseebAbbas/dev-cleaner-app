import { fmtBytes } from "../api";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/primitives";

/** Floating command bar: appears as soon as something is selected. */
export function SelectionBar(props: { count: number; bytes: number; noun: string; permanent: boolean; dryRun: boolean; busy: boolean; blockedReason?: string; onClear: () => void; onClean: () => void }) {
  if (!props.count && !props.busy) return null;
  const status = props.blockedReason ?? (props.dryRun ? "Nothing will be deleted" : props.permanent ? "Deleted permanently" : "Moves to Trash");
  return (
    <div role="region" aria-label="Selection" className="float rise sticky bottom-0 z-20 mt-3 flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"><Icon name="check" /></div>
        <div className="min-w-0">
          <div className="font-semibold tabular-nums">{props.count} {props.noun}{props.count === 1 ? "" : "s"} selected <span className="muted font-normal">· {fmtBytes(props.bytes)}</span></div>
          <div className={`truncate text-xs ${props.dryRun && !props.blockedReason ? "text-amber-600 dark:text-amber-400" : props.permanent && !props.blockedReason ? "text-red-600 dark:text-red-400" : "muted"}`}>{status}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button className="btn btn-ghost" onClick={props.onClear} disabled={props.busy}>Clear</button>
        <button className={`btn ${props.permanent && !props.dryRun ? "btn-danger" : "btn-primary"} px-4`} onClick={props.onClean} disabled={props.busy || !!props.blockedReason}>
          {props.busy ? <><Spinner />Removing…</> : <>Reclaim {fmtBytes(props.bytes)}</>}
        </button>
      </div>
    </div>
  );
}
