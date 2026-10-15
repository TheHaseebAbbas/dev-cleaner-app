import { describe, expect, it } from "vitest";
import type { HistoryEntry, TrashEntry } from "../api";
import { groupRuns, stillInTrash } from "./activity";

const h = (id: string, timestamp: number, o: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id, timestamp, scan_id: "s1", path: `/code/${id}`, project_root: "/code", rule_id: "r", category: null, risk: null,
  size_before: 10, estimated_reclaimed: 10, mode: "trash", result: "removed", ...o,
});
const t = (id: string, original_path: string, deleted_at: number): TrashEntry => ({ id, name: id, original_path, deleted_at, bytes: 10, expires_at: null });

describe("activity timeline", () => {
  it("groups one cleanup into one run and keeps runs newest first", () => {
    const runs = groupRuns([h("a", 1000), h("b", 1005), h("c", 5000, { scan_id: "s2" }), h("d", 1010, { mode: "permanent" })]);
    expect(runs.map((r) => r.entries.map((e) => e.id))).toEqual([["c"], ["d"], ["b", "a"]]);
    expect(runs[2].bytes).toBe(20);
  });
  it("leaves out entries that were not removed", () => {
    expect(groupRuns([h("a", 1, { result: "skipped" })])).toEqual([]);
  });
  it("matches Trash items to the cleanup that moved them, once each", () => {
    const hist = [h("old", 1000, { path: "/code/app/node_modules" }), h("new", 900_000, { path: "/code/app/node_modules" }), h("perm", 900_000, { path: "/code/x", mode: "permanent" })];
    const m = stillInTrash(hist, [t("t1", "/code/app/node_modules/", 900_010), t("t2", "/code/x", 900_000)]);
    expect(m.get("new")?.id).toBe("t1");
    expect(m.has("old")).toBe(false);
    expect(m.has("perm")).toBe(false);
  });
});
