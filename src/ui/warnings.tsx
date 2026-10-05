import { RISK_LABEL, VERDICT_LABEL, type Block, type Reason, type Recommendation, type Risk, type Usage, type Warning } from "../api";
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
export function WarningPanel(props: { entries: WarnEntry[]; ack: boolean; onAck: (v: boolean) => void; dryRun: boolean; forceAck?: boolean }) {
  const flagged = props.entries.filter((e) => e.warnings.length);
  const danger = needsAck(flagged) || !!props.forceAck;
  if (!flagged.length && !danger) return null;
  return (
    <div className={`mt-4 rounded-[10px] border p-3 ${danger ? "border-red-300 bg-red-50 dark:border-red-800/70 dark:bg-red-950/30" : "border-amber-300 bg-amber-50 dark:border-amber-800/70 dark:bg-amber-950/30"}`}>
      <div className="mb-2 flex items-center gap-2 font-semibold"><Icon name="alert" className="h-4 w-4" />{danger ? "Some selected items may be required" : "Check these before continuing"}</div>
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

const BLOCK_LABEL: Record<Block["source"], string> = {
  user: "Protected",
  system: "System folder",
  git: "Tracked by Git",
  sensitive: "Contains keys",
  rule: "Not removable",
};

/** Why a row cannot be selected. */
export function BlockBadge({ block }: { block: Block | null | undefined }) {
  if (!block) return null;
  return <Badge icon="lock" title={block.reason}>{BLOCK_LABEL[block.source]}</Badge>;
}

/** The recommendation engine's verdict, with its score and top reason in the tooltip. */
export function VerdictBadge({ rec, block }: { rec: Recommendation | null | undefined; block?: Block | null }) {
  if (!rec || block) return null;
  const tone = rec.verdict === "recommended" ? "green" : rec.verdict === "review" ? "amber" : "neutral";
  const title = [`Score ${rec.score} of 100`, ...rec.reasons.map((r) => `${r.ok ? "+" : "−"} ${r.text}`)].join("\n");
  return <Badge tone={tone} title={title}>{VERDICT_LABEL[rec.verdict]}</Badge>;
}

/** Shown only when risk is above Caution, since Safe and Caution are the normal case. */
export function RiskBadge({ risk }: { risk: Risk | null | undefined }) {
  if (risk !== "danger" && risk !== "critical") return null;
  return <Badge tone="red" icon="alert" title={risk === "critical" ? "Removing this may lose data permanently." : "Removing this may lose local state or break a tool."}>{RISK_LABEL[risk]}</Badge>;
}

/** Whether a shared SDK or toolchain version is used by a scanned project. */
export function UsageBadge({ usage }: { usage: Usage | null | undefined }) {
  if (!usage) return null;
  if (usage.status === "used") return <Badge tone="blue" title={`Used by ${usage.by.join(", ")}`}>Used by {usage.by.length} project{usage.by.length === 1 ? "" : "s"}</Badge>;
  if (usage.status === "unused") return <Badge title={`No reference in ${usage.projects_checked} scanned project${usage.projects_checked === 1 ? "" : "s"}`}>Not used by scanned projects</Badge>;
  return <Badge title="Scan your projects first so Dev Cleaner can check which versions they use.">Usage unknown</Badge>;
}

/** "Why" lists: green ticks support cleaning, amber marks count against it. */
export function ReasonList({ reasons }: { reasons: Reason[] }) {
  if (!reasons.length) return null;
  return (
    <ul className="space-y-1.5">
      {reasons.map((r, i) => (
        <li key={i} className="flex gap-2 text-[13px]">
          <Icon name={r.ok ? "check-circle" : "alert"} className={`mt-0.5 h-4 w-4 shrink-0 ${r.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`} />
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

export interface Check {
  tone: "ok" | "caution" | "danger" | "neutral";
  icon: "check" | "alert" | "lock" | "eye" | "clock";
  text: string;
  title?: string;
}

/** Compact safety line: "✓ Rebuildable ✓ Git ignored ⚠ Check first". Icons and words, never color alone. */
export function SafetyLine({ checks, max = 3 }: { checks: Check[]; max?: number }) {
  if (!checks.length) return null;
  const color = { ok: "text-emerald-600 dark:text-emerald-400", caution: "text-amber-600 dark:text-amber-400", danger: "text-red-600 dark:text-red-400", neutral: "text-slate-500 dark:text-slate-400" };
  const text = { ok: "", caution: "text-amber-700 dark:text-amber-300", danger: "text-red-700 dark:text-red-300", neutral: "" };
  return (
    <span className="flex min-w-0 items-center gap-3 overflow-hidden text-xs">
      {checks.slice(0, max).map((c) => (
        <span key={c.text} className={`flex shrink-0 items-center gap-1 ${text[c.tone]}`} title={c.title}>
          <Icon name={c.icon === "check" ? "check" : c.icon} className={`h-3.5 w-3.5 ${color[c.tone]}`} />{c.text}
        </span>
      ))}
    </span>
  );
}

/** Full list for the details panel. */
export function CheckList({ checks }: { checks: Check[] }) {
  if (!checks.length) return null;
  const color = { ok: "text-emerald-600 dark:text-emerald-400", caution: "text-amber-600 dark:text-amber-400", danger: "text-red-600 dark:text-red-400", neutral: "text-slate-500 dark:text-slate-400" };
  return (
    <ul className="space-y-1.5">
      {checks.map((c) => (
        <li key={c.text} className="flex gap-2 text-[13px]">
          <Icon name={c.icon} className={`mt-0.5 h-4 w-4 shrink-0 ${color[c.tone]}`} />
          <span>{c.text}{c.title && <span className="muted block text-xs">{c.title}</span>}</span>
        </li>
      ))}
    </ul>
  );
}
