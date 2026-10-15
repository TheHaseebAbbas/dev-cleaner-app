import { describe, expect, it } from "vitest";
import type { Part, Recommendation, Verdict } from "../api";
import { BLOCK_LABEL, groupOf, groupTotals, preselectIds, profileMatches, reasonLine, type Candidate } from "./clean";
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
const part = (over: Partial<Part> = {}): Part => ({ id: "p", path: "/x/p", name: "p", disk_bytes: 1, apparent_bytes: 1, reclaimable_bytes: 1, file_count: 1, last_modified: 0, is_file: false, ...over });

describe("groupOf", () => {
  it("puts a plain recommended item in Safe to clean", () => {
    expect(groupOf(item())).toBe("safe");
  });
  it("never lets a recommendation beat a block", () => {
    expect(groupOf(item({ block: { source: "git", reason: "Git tracks files inside it." } }))).toBe("leave");
  });
  it("treats a missing verdict as Leaving alone", () => {
    expect(groupOf(item({ recommendation: undefined }))).toBe("leave");
    expect(groupOf(item({ recommendation: null }))).toBe("leave");
  });
  it("keeps critical risk out of Safe to clean even when recommended", () => {
    expect(groupOf(item({ risk: "critical" }))).toBe("leave");
  });
  it("moves recommended items that are in use or carry a warning to Worth a look", () => {
    expect(groupOf(item({ in_use: { status: "in_use", by: ["cargo"], locked_files: 0, locked_bytes: 0 } }))).toBe("look");
    expect(groupOf(item({ warnings: [{ level: "caution", message: "Not in .gitignore" }] }))).toBe("look");
  });
  it("sends view-only, parts-only and partly blocked items out of Safe to clean", () => {
    expect(groupOf(item({ info_only: true }))).toBe("leave");
    expect(groupOf(item({ parts_only: true }))).toBe("look");
    expect(groupOf(item({ parts: [part({ block: { source: "user", reason: "Protected path" } })] }))).toBe("look");
  });
  it("maps review and keep verdicts", () => {
    expect(groupOf(item({ recommendation: rec("review") }))).toBe("look");
    expect(groupOf(item({ recommendation: rec("keep") }))).toBe("leave");
  });
});

describe("totals and pre-selection", () => {
  const list = [
    item({ id: "safe", size: 100 }),
    item({ id: "review", size: 50, recommendation: rec("review") }),
    item({ id: "keep", size: 30, recommendation: rec("keep") }),
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
    expect(reasonLine(item({ recommendation: rec("recommended", [{ ok: true, text: "Frees about 1 GB" }, { ok: true, text: "Not changed for 45 days" }]) }))).toBe("Comes back with npm ci. Not changed for 45 days.");
  });
  it("names the program using an item", () => {
    expect(reasonLine(item({ in_use: { status: "in_use", by: ["cargo"], locked_files: 0, locked_bytes: 0 } }))).toBe("cargo is using it right now.");
  });
  it("leads with the reason against, not size or confidence", () => {
    const r = rec("keep", [{ ok: false, text: "Small (2 KB)" }, { ok: false, text: "Used by app, web" }]);
    expect(reasonLine(item({ recommendation: r }))).toBe("Used by app, web.");
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
