import { fmtBytes } from "../api";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/primitives";

/** Appears at the bottom as soon as something is selected. */
export function SelectionBar(props: { count: number; bytes: number; noun: string; modeLabel: string; dryRun: boolean; busy: boolean; blockedReason?: string; onClear: () => void; onClean: () => void }) {
  if (!props.count && !props.busy) return null;
  return (
    <div className="rise sticky bottom-0 z-20 mt-3 flex items-center justify-between gap-4 rounded-xl border border-slate-300 bg-white px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"><Icon name="trash" /></div>
        <div>
          <div className="font-semibold tabular-nums">{props.count} {props.noun}{props.count === 1 ? "" : "s"} · {fmtBytes(props.bytes)}</div>
          <div className="muted text-xs">{props.dryRun ? "Dry run: nothing will be deleted" : props.modeLabel}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {props.blockedReason && <span className="muted text-xs">{props.blockedReason}</span>}
        <button className="btn" onClick={props.onClear} disabled={props.busy}>Clear</button>
        <button className="btn btn-danger" onClick={props.onClean} disabled={props.busy || !!props.blockedReason}>
          {props.busy ? <><Spinner />Removing…</> : props.dryRun ? "Simulate cleanup" : "Clean selected"}
        </button>
      </div>
    </div>
  );
}
