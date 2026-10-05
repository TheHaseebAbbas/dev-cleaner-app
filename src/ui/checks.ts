import { inUse, isRebuildable, type ActiveUse, type Block, type GitStatus, type Category, type Part, type PartActivity, type Usage, type Warning } from "../api";
import type { Check } from "./warnings";

const BLOCK_TEXT: Record<Block["source"], string> = {
  user: "Protected",
  system: "System folder",
  git: "Git tracks files inside",
  sensitive: "Contains signing keys",
  rule: "Kept",
};

/** What a row says about safety, most important first. */
export function checksFor(x: { block: Block | null | undefined; warnings: Warning[]; category: Category; git?: GitStatus; in_use?: ActiveUse | null; usage?: Usage | null; activity?: PartActivity | null; viewOnly?: boolean }, detail = false): Check[] {
  const out: Check[] = [];
  if (x.viewOnly) out.push({ tone: "neutral", icon: "eye", text: "View only", title: "Dev Cleaner can show this location but does not delete it." });
  else if (x.block) out.push({ tone: "neutral", icon: "lock", text: BLOCK_TEXT[x.block.source], title: x.block.reason });
  if (inUse(x.in_use)) out.push({ tone: "danger", icon: "alert", text: "In use now", title: x.in_use!.by.join(", ") || "A running program uses it" });
  const danger = x.warnings.filter((w) => w.level === "danger" && !w.message.startsWith("In use by"));
  const caution = x.warnings.filter((w) => w.level === "caution");
  if (danger.length) out.push({ tone: "danger", icon: "alert", text: "May be required", title: danger.map((w) => w.message).join("\n") });
  else if (caution.length) out.push({ tone: "caution", icon: "alert", text: "Check first", title: caution.map((w) => w.message).join("\n") });
  if (x.usage?.status === "used") out.push({ tone: "caution", icon: "alert", text: `Used by ${x.usage.by.length} project${x.usage.by.length === 1 ? "" : "s"}`, title: x.usage.by.join(", ") });
  if (x.activity === "active" && !inUse(x.in_use)) out.push({ tone: "caution", icon: "clock", text: "Active", title: "Changed in the last day, or a build is running in this project." });
  if (!x.block && !x.viewOnly) {
    if (isRebuildable(x.category)) out.push({ tone: "ok", icon: "check", text: "Rebuildable", title: detail ? "Your tools recreate it when it is needed." : undefined });
    if (x.git === "ignored") out.push({ tone: "ok", icon: "check", text: "Git ignored", title: detail ? "Listed in .gitignore, so it is not part of your source." : undefined });
    if (x.usage?.status === "unused") out.push({ tone: "ok", icon: "check", text: "Not used by scanned projects" });
    if (detail && x.in_use?.status === "not_detected") out.push({ tone: "ok", icon: "check", text: "Not currently in use", title: "No running program was found using it when it was scanned." });
  }
  return out;
}

export function partChecks(p: Part, owner: { warnings: Warning[]; category: Category; block: Block | null }, viewOnly = false): Check[] {
  return checksFor({ block: p.block ?? null, warnings: p.warning ? [p.warning] : [], category: owner.category, in_use: p.in_use, usage: p.usage, activity: p.activity, viewOnly });
}
