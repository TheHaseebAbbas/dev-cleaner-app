import type { Warning } from "../api";

export interface WarnEntry {
  path: string;
  label: string;
  warnings: Warning[];
}

export const hasDanger = (w: Warning[] | undefined | null) => !!w?.some((x) => x.level === "danger");
export const needsAck = (entries: WarnEntry[]) => entries.some((e) => hasDanger(e.warnings));

/** Compact marker for table rows; the tooltip lists the reasons. */
export function WarnBadge({ warnings }: { warnings: Warning[] | undefined | null }) {
  if (!warnings?.length) return null;
  const danger = hasDanger(warnings);
  return (
    <span
      title={warnings.map((w) => w.message).join("\n")}
      className={`ml-1 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${danger ? "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"}`}
    >
      {danger ? "⛔ Required?" : "⚠ Check"}
    </span>
  );
}

/** Full list of reasons, used in the details panel. */
export function WarningLines({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="mb-2 space-y-1">
      {warnings.map((w, i) => (
        <li key={i} className={`rounded border p-2 text-xs ${w.level === "danger" ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200" : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"}`}>
          <b>{w.level === "danger" ? "⛔ Danger: " : "⚠ Check: "}</b>{w.message}
        </li>
      ))}
    </ul>
  );
}

/** Shown in the confirm dialog: every warning for what is about to be removed, plus an acknowledgement for dangers. */
export function WarningPanel(props: { entries: WarnEntry[]; ack: boolean; onAck: (v: boolean) => void; dryRun: boolean }) {
  const flagged = props.entries.filter((e) => e.warnings.length);
  if (!flagged.length) return null;
  const danger = needsAck(flagged);
  return (
    <div className={`mt-3 rounded border p-2 ${danger ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40" : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"}`}>
      <div className="mb-1 font-semibold">{danger ? "⛔ Some of these may be required" : "⚠ Please check before continuing"}</div>
      <ul className="max-h-40 space-y-1.5 overflow-auto text-xs">
        {flagged.map((e) => (
          <li key={e.path}>
            <div className="break-all font-mono">{e.label}</div>
            {e.warnings.map((w, i) => (
              <div key={i} className="ml-3 text-slate-700 dark:text-slate-300">{w.level === "danger" ? "⛔" : "⚠"} {w.message}</div>
            ))}
          </li>
        ))}
      </ul>
      {danger && !props.dryRun && (
        <label className="mt-2 flex items-start gap-2 text-xs font-medium">
          <input type="checkbox" className="mt-0.5" checked={props.ack} onChange={(e) => props.onAck(e.target.checked)} />
          I understand this may remove something I need and cannot easily get back.
        </label>
      )}
    </div>
  );
}
