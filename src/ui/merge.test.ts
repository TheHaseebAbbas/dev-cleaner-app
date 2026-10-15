import { describe, expect, it } from "vitest";
import type { DeleteReport, Preview } from "../api";
import { mergePreviews, mergeReports } from "./merge";

const pv = (o: Partial<Preview>): Preview => ({
  selected: 1, ready: 1, blocked: 0, changed: 0, size_bytes: 10, estimated_bytes: 8, download_bytes: 0, projects: 1, with_warnings: 0,
  needs_ack: false, critical: false, recommended: 1, review: 0, keep: 0, in_use: 0, running: 0, first_use_rules: [], scan_age_secs: 30,
  volume_free: 500, problems: [], ...o,
});
const rep = (o: Partial<DeleteReport>): DeleteReport => ({
  outcomes: [], removed: 0, failed: 0, blocked: 0, skipped: 0, estimated_bytes: 0, volume_free_before: null, volume_free_after: null, dry_run: false, mode: "trash", ...o,
});

describe("merging projects and tools into one cleanup", () => {
  it("adds counts, keeps any flag, and uses the older scan's age", () => {
    const m = mergePreviews([pv({ ready: 2, estimated_bytes: 5, scan_age_secs: 30 }), pv({ ready: 3, estimated_bytes: 7, needs_ack: true, scan_age_secs: 900, first_use_rules: ["x"] })])!;
    expect(m.ready).toBe(5);
    expect(m.estimated_bytes).toBe(12);
    expect(m.needs_ack).toBe(true);
    expect(m.scan_age_secs).toBe(900);
    expect(m.volume_free).toBe(500);
    expect(m.first_use_rules).toEqual(["x"]);
  });
  it("keeps every outcome so a partial move is reported as partial", () => {
    const ok = { id: "a", path: "/a", ok: true } as DeleteReport["outcomes"][number];
    const bad = { id: "b", path: "/b", ok: false } as DeleteReport["outcomes"][number];
    const m = mergeReports([rep({ outcomes: [ok], removed: 1, estimated_bytes: 4 }), rep({ outcomes: [bad], failed: 1 })]);
    expect(m.outcomes).toHaveLength(2);
    expect(m.removed).toBe(1);
    expect(m.failed).toBe(1);
    expect(m.estimated_bytes).toBe(4);
    expect(m.mode).toBe("trash");
  });
});
