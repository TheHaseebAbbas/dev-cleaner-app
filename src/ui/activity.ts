import type { HistoryEntry, TrashEntry } from "../api";

/** One cleanup as people remember it: everything removed together, at one time, in one way. */
export interface Run {
  key: string;
  timestamp: number;
  mode: HistoryEntry["mode"];
  entries: HistoryEntry[];
  bytes: number;
}

/** Entries cleaned together less than this many seconds apart belong to one run. */
const RUN_GAP = 120;

/** Removed entries, newest run first. Each run keeps one scan and one delete mode. */
export function groupRuns(history: HistoryEntry[]): Run[] {
  const removed = history.filter((h) => h.result === "removed").sort((a, b) => b.timestamp - a.timestamp);
  const runs: Run[] = [];
  for (const h of removed) {
    const last = runs[runs.length - 1];
    const prev = last?.entries[last.entries.length - 1];
    if (last && prev && last.mode === h.mode && prev.scan_id === h.scan_id && prev.timestamp - h.timestamp <= RUN_GAP) {
      last.entries.push(h);
      last.bytes += h.estimated_reclaimed;
    } else {
      runs.push({ key: `${h.scan_id}:${h.timestamp}:${h.id}`, timestamp: h.timestamp, mode: h.mode, entries: [h], bytes: h.estimated_reclaimed });
    }
  }
  return runs;
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * Which history entries are still in the Trash, matched the way the core matches them: same
 * path, moved to Trash, the closest removal time within a day. Each Trash entry is used once.
 */
export function stillInTrash(history: HistoryEntry[], trash: TrashEntry[]): Map<string, TrashEntry> {
  const out = new Map<string, TrashEntry>();
  for (const t of trash) {
    let best: HistoryEntry | null = null;
    for (const h of history) {
      if (h.mode !== "trash" || h.result !== "removed" || norm(h.path) !== norm(t.original_path) || out.has(h.id)) continue;
      const d = Math.abs(h.timestamp - t.deleted_at);
      if (d <= 86_400 && (!best || d < Math.abs(best.timestamp - t.deleted_at))) best = h;
    }
    if (best) out.set(best.id, t);
  }
  return out;
}
