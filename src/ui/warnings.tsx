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
    <div className={`mt-4 rounded-[10px] border p-3 ${danger ? "border-red-300 bg-red-50 dark:border-red-800/70 dark:bg-red-950/30" : "border-amber-300 bg-amber-50 dark:border-amber-800/70 dark:bg-amber-950/30"}`}>
      <div className="mb-2 flex items-center gap-2 font-semibold"><Icon name="alert" className="h-4 w-4" />{danger ? "Some selected folders may be required" : "Check these before continuing"}</div>
      <ul className="max-h-44 space-y-2.5 overflow-auto text-[13px]">
        {flagged.map((e) => (
          <li key={e.path}>
            {e.warnings.map((w, i) => <div key={i} className="flex gap-1.5"><span className="font-bold">{w.level === "danger" ? "!" : "•"}</span><span>{w.message}</span></div>)}
            <div className="mono mt-0.5 break-all text-xs opacity-80">{e.label}</div>
          </li>
        ))}
      </ul>
      {danger && !props.dryRun && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px] font-medium">
          <input type="checkbox" className="cb mt-0.5" checked={props.ack} onChange={(e) => props.onAck(e.target.checked)} />
          <span>I understand this may remove something I need<br />and cannot easily get back.</span>
        </label>
      )}
    </div>
  );
}

/** Plain-language safety summary for the details panel: rebuildable, git state, and every warning. */
export function SafetyList(props: { gitIgnored: boolean | null; gitTracked: boolean | null; warnings: Warning[]; regenerates: string }) {
  const row = (tone: "ok" | "warn" | "bad", text: string, sub?: string) => (
    <li key={text} className="flex gap-2 text-[13px]">
      <Icon name={tone === "ok" ? "check-circle" : "alert"} className={`mt-0.5 h-4 w-4 shrink-0 ${tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`} />
      <span><span className="font-medium">{text}</span>{sub && <span className="muted block text-xs">{sub}</span>}</span>
    </li>
  );
  const items = [];
  if (props.gitTracked) items.push(row("bad", "Git tracks files inside this folder", "Removing it deletes committed files."));
  else if (props.gitIgnored === true) items.push(row("ok", "Git ignored"));
  else if (props.gitIgnored === false) items.push(row("warn", "Not Git ignored", "Check that this folder only contains generated files."));
  const bad = props.warnings.some((w) => w.level === "danger");
  if (!bad && !props.gitTracked) items.push(row("ok", "Rebuildable", `Comes back with ${props.regenerates}.`));
  for (const w of props.warnings) {
    if (props.gitTracked && w.message.startsWith("Git tracks")) continue;
    if (props.gitIgnored === false && w.message.startsWith("This folder is not listed in .gitignore")) continue;
    items.push(row(w.level === "danger" ? "bad" : "warn", w.level === "danger" ? "May be required" : "Check first", w.message));
  }
  return <ul className="space-y-2">{items}</ul>;
}
