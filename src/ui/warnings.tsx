import type { Warning } from "../api";
import { Badge } from "./primitives";
import { Icon } from "./Icon";

export interface WarnEntry {
  path: string;
  label: string;
  warnings: Warning[];
}

export const hasDanger = (w: Warning[] | undefined | null) => !!w?.some((x) => x.level === "danger");
export const needsAck = (entries: WarnEntry[]) => entries.some((e) => hasDanger(e.warnings));

/** Compact marker for list rows; the tooltip lists the reasons. */
export function WarnBadge({ warnings }: { warnings: Warning[] | undefined | null }) {
  if (!warnings?.length) return null;
  const danger = hasDanger(warnings);
  return (
    <Badge tone={danger ? "red" : "amber"} icon="alert" title={warnings.map((w) => w.message).join("\n")}>
      {danger ? "May be required" : "Check first"}
    </Badge>
  );
}

/** Full reasons, used in the details panel. */
export function WarningLines({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="mb-3 space-y-1.5">
      {warnings.map((w, i) => (
        <li key={i} className={`flex gap-2 rounded-lg border p-2 text-xs ${w.level === "danger" ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200" : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"}`}>
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5" />
          <span><b>{w.level === "danger" ? "May be required. " : "Check first. "}</b>{w.message}</span>
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
    <div className={`mt-4 rounded-lg border p-3 ${danger ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40" : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"}`}>
      <div className="mb-2 flex items-center gap-2 font-semibold"><Icon name="alert" className="h-4 w-4" />{danger ? "Some of these may be required" : "Please check before continuing"}</div>
      <ul className="max-h-44 space-y-2 overflow-auto text-xs">
        {flagged.map((e) => (
          <li key={e.path}>
            <div className="break-all font-mono">{e.label}</div>
            {e.warnings.map((w, i) => <div key={i} className="ml-3 mt-0.5 opacity-90">{w.level === "danger" ? "Danger: " : "Check: "}{w.message}</div>)}
          </li>
        ))}
      </ul>
      {danger && !props.dryRun && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs font-medium">
          <input type="checkbox" className="mt-0.5 accent-red-600" checked={props.ack} onChange={(e) => props.onAck(e.target.checked)} />
          I understand this may remove something I need and cannot easily get back.
        </label>
      )}
    </div>
  );
}
