import type { DeleteReport, Preview } from "../api";

/** Two previews (projects and tools) shown as one: counts add up, any flag set stays set. */
export function mergePreviews(list: Preview[]): Preview | null {
  if (!list.length) return null;
  return list.reduce((a, b) => {
    const out = { ...a } as Record<string, unknown>;
    for (const [k, v] of Object.entries(b)) {
      const cur = out[k];
      if (typeof v === "number" && typeof cur === "number") out[k] = k === "scan_age_secs" ? Math.max(cur, v) : k === "volume_free" ? cur : cur + v;
      else if (typeof v === "boolean") out[k] = Boolean(cur) || v;
      else if (Array.isArray(v)) out[k] = [...((cur as unknown[]) ?? []), ...v];
      else if (cur == null) out[k] = v;
    }
    return out as unknown as Preview;
  });
}

/** Two cleanup reports shown as one. */
export function mergeReports(list: DeleteReport[]): DeleteReport {
  return list.reduce((a, b) => ({
    outcomes: [...a.outcomes, ...b.outcomes],
    removed: a.removed + b.removed,
    failed: a.failed + b.failed,
    blocked: a.blocked + b.blocked,
    skipped: a.skipped + b.skipped,
    estimated_bytes: a.estimated_bytes + b.estimated_bytes,
    volume_free_before: a.volume_free_before ?? b.volume_free_before,
    volume_free_after: b.volume_free_after ?? a.volume_free_after,
    dry_run: a.dry_run || b.dry_run,
    mode: a.mode ?? b.mode,
  }));
}
