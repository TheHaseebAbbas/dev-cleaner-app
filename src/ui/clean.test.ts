import { describe, expect, it } from "vitest";
import type { Part, Recommendation, Verdict } from "../api";
import { BLOCK_LABEL, groupOf, groupTotals, oldProjects, preselectIds, profileMatches, reasonLine, type Candidate } from "./clean";
import { checksFor } from "./checks";

const rec = (verdict: Verdict, reasons: Recommendation["reasons"] = []): Recommendation => ({ verdict, score: 50, reasons });
const item = (over: Partial<Candidate & { id: string; size: number }> = {}) => ({
  id: "a",
  size: 100,
  block: null,
  recommendation: rec("recommended"),
  warnings: [],
  risk: "safe" as const,
  in_use: null,
  parts: [] as Part[],
  regenerates_with: "npm ci",
  ...over,
});

describe("groupOf", () => {
  it("reads the group the core decided", () => {
    expect(groupOf(item({ clean_group: "safe" }))).toBe("safe");
    expect(groupOf(item({ clean_group: "look" }))).toBe("look");
  });
  it("treats a missing group as Leaving alone", () => {
    expect(groupOf(item())).toBe("leave");
    expect(groupOf(item({ clean_group: null }))).toBe("leave");
  });
});

describe("totals and pre-selection", () => {
  const list = [
    item({ id: "safe", size: 100, clean_group: "safe" }),
    item({ id: "review", size: 50, recommendation: rec("review"), clean_group: "look" }),
    item({ id: "keep", size: 30, recommendation: rec("keep"), clean_group: "leave" }),
    item({ id: "blocked", size: 20, block: { source: "system", reason: "System folder" } }),
    item({ id: "docker", size: 1000, info_only: true }),
  ];
  it("counts only Safe to clean in the headline", () => {
    const t = groupTotals(list, (c) => c.size);
    expect(t.safe).toBe(100);
    expect(t.look).toBe(50);
    expect(t.leave).toBe(1050);
  });
  it("ticks only Safe to clean items, and nothing when deleting permanently", () => {
    expect(preselectIds(list, "trash")).toEqual(["safe"]);
    expect(preselectIds(list, "permanent")).toEqual([]);
  });
  it("quick select never picks Leaving alone", () => {
    expect(list.filter((c) => profileMatches(c, "deep")).map((c) => c.id)).toEqual(["safe", "review"]);
    expect(list.filter((c) => profileMatches(c, "recommended")).map((c) => c.id)).toEqual(["safe"]);
  });
});

describe("reasonLine", () => {
  it("says how a safe item comes back", () => {
    expect(reasonLine(item({ clean_group: "safe", recommendation: rec("recommended", [{ ok: true, text: "Frees about 1 GB" }, { ok: true, text: "Not changed for 45 days" }]) }))).toBe("Comes back with npm ci. Not changed for 45 days.");
  });
  it("names the program using an item", () => {
    expect(reasonLine(item({ clean_group: "look", in_use: { status: "in_use", by: ["cargo"], locked_files: 0, locked_bytes: 0 } }))).toBe("cargo is using it right now.");
  });
  it("leads with the reason against, not size or confidence", () => {
    const r = rec("keep", [{ ok: false, text: "Small (2 KB)" }, { ok: false, text: "Used by app, web" }]);
    expect(reasonLine(item({ clean_group: "leave", recommendation: r }))).toBe("Used by app, web.");
  });
});

describe("labels", () => {
  it("uses the same block words on rows and badges", () => {
    for (const source of Object.keys(BLOCK_LABEL) as (keyof typeof BLOCK_LABEL)[]) {
      const checks = checksFor({ block: { source, reason: "r" }, warnings: [], category: "build_artifact" });
      expect(checks[0].text).toBe(BLOCK_LABEL[source]);
    }
  });
});

describe("old projects", () => {
  const now = 1_000 * 86_400;
  const at = (daysAgo: number) => now - daysAgo * 86_400;
  const p = (id: string, project: string, daysAgo: number, size: number, clean_group: "safe" | "look" | "leave") =>
    ({ ...item({ id, size, clean_group }), project_path: project, project_last_modified: at(daysAgo) });
  it("adds up what can be cleaned in projects untouched for 90 days, largest first", () => {
    const list = [p("a", "/old1", 120, 100, "safe"), p("b", "/old1", 120, 50, "look"), p("c", "/old2", 200, 500, "safe"), p("d", "/new", 10, 900, "safe")];
    const o = oldProjects(list, (c) => c.size, now);
    expect(o.paths).toEqual(["/old2", "/old1"]);
    expect(o.bytes).toBe(650);
  });
  it("never counts Leaving alone", () => {
    expect(oldProjects([p("a", "/old", 120, 100, "leave")], (c) => c.size, now)).toEqual({ paths: [], bytes: 0 });
  });
});
