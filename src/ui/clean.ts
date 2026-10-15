import { inUse, type ActiveUse, type CleanGroup, type Block, type BlockSource, type CleanupProfile, type DeleteMode, type Part, type Recommendation, type Risk, type Warning } from "../api";

/**
 * How every screen sorts results for people. The core decides the group (`recommend::group`), so
 * no view makes up its own idea of what is safe; an item without one is Leaving alone. The backend
 * still checks every item again before removing it, whatever is selected here.
 */
export type { CleanGroup };

export const GROUP_LABEL: Record<CleanGroup, string> = {
  safe: "Safe to clean",
  look: "Worth a look",
  leave: "Leaving alone",
};

/** Why an item can never be selected, in the same words on every screen. */
export const BLOCK_LABEL: Record<BlockSource, string> = {
  user: "Protected",
  system: "System folder",
  git: "Tracked by Git",
  sensitive: "Contains signing keys",
  rule: "Not removable",
};

/** What the grouping looks at. Project folders and Tools & SDKs locations both fit. */
export interface Candidate {
  /** Set by the core. */
  clean_group?: CleanGroup | null;
  block: Block | null | undefined;
  recommendation?: Recommendation | null;
  warnings: Warning[];
  risk: Risk;
  in_use?: ActiveUse | null;
  parts: Part[];
  regenerates_with?: string;
  /** Tools & SDKs: shown but never removed (Docker, WSL). */
  info_only?: boolean;
  /** Tools & SDKs: only single parts can be removed. */
  parts_only?: boolean;
}

/** The whole item can be ticked: not blocked, no blocked part, not parts-only, not view-only. */
export const wholeSelectable = (c: Candidate) => !c.info_only && !c.block && !c.parts_only && !c.parts.some((p) => p.block);

export function groupOf(c: Pick<Candidate, "clean_group">): CleanGroup {
  return c.clean_group ?? "leave";
}

const RANK: Record<CleanGroup, number> = { safe: 0, look: 1, leave: 2 };
export const groupRank = (c: Candidate) => RANK[groupOf(c)];

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
/** Reasons that say how sure or how big, not why; they never lead the line. */
const minor = (t: string) => /detection confidence|^Frees about|^Small \(/.test(t);

/** One plain sentence for the row: why it is in its group. Built only from what the scan found. */
export function reasonLine(c: Candidate): string {
  const g = groupOf(c);
  const reasons = c.recommendation?.reasons ?? [];
  if (c.info_only) return "Shown for information. Dev Cleaner does not clean it.";
  if (c.block) return sentence(c.block.reason || BLOCK_LABEL[c.block.source]);
  if (g === "leave") {
    const danger = c.warnings.find((w) => w.level === "danger");
    const against = reasons.find((r) => !r.ok && !minor(r.text));
    if (danger) return sentence(danger.message);
    if (against) return sentence(against.text);
    return "Kept to be careful: Dev Cleaner could not confirm it is safe.";
  }
  if (g === "look") {
    if (inUse(c.in_use)) return `${c.in_use!.by[0] ?? "A running program"} is using it right now.`;
    if (c.parts_only) return "Only single parts can be removed. Open it to choose.";
    if (c.parts.some((p) => p.block)) return "Some parts must be kept. Open it to choose parts.";
    const warn = c.warnings[0];
    const against = reasons.find((r) => !r.ok && !minor(r.text));
    if (warn) return sentence(warn.message);
    if (against) return sentence(against.text);
    return "Probably fine, but check it before removing.";
  }
  const back = c.regenerates_with ? `Comes back with ${c.regenerates_with}.` : "Your tools recreate it when needed.";
  const why = reasons.find((r) => r.ok && /^Not changed for|^Not used by|^Git ignores/.test(r.text));
  return why ? `${back} ${sentence(why.text)}` : back;
}

/** Sizes for the headline. Only whole items count, so parts are never counted twice. */
export function groupTotals<T extends Candidate>(list: T[], size: (c: T) => number): Record<CleanGroup, number> {
  const out: Record<CleanGroup, number> = { safe: 0, look: 0, leave: 0 };
  for (const c of list) out[groupOf(c)] += size(c);
  return out;
}

/**
 * Ids ticked for the user after a complete scan: every Safe to clean item, as a whole.
 * Nothing is ticked for permanent deletion; that stays a choice the user makes item by item.
 */
export function preselectIds<T extends Candidate & { id: string }>(list: T[], mode: DeleteMode): string[] {
  if (mode !== "trash") return [];
  return list.filter((c) => groupOf(c) === "safe").map((c) => c.id);
}

/** Quick select (Advanced): "safe" = Safe to clean that rebuilds without downloads; "deep" adds Worth a look. Never Leaving alone. */
export function profileMatches(c: Candidate, profile: CleanupProfile): boolean {
  const g = groupOf(c);
  if (profile === "safe") return g === "safe" && c.risk === "safe";
  if (profile === "recommended") return g === "safe";
  return g === "safe" || g === "look";
}
