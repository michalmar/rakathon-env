import { describe, expect, it } from "vitest";
import { canViewSpend, compareValues, filterSpend, loadSpend, parseSpend } from "../src/spend";
import { interactiveSpendFixture, spendFixture } from "./fixtures";

describe("organizer spend dashboard", () => {
  it("cross-filters all detail and model counters without changing the event totals", () => {
    const source = interactiveSpendFixture();
    const filtered = filterSpend(source, "team07");
    expect(filtered.summary.costUsd).toBe(110);
    expect(filtered.summary.budgetUsd).toBe(100);
    expect(filtered.models).toHaveLength(2);
    expect(filtered.models[0]).toMatchObject({ deployment: "test-model-two", costUsd: 100, requests: 100, teamCostUsd: 100, otherCostUsd: 0 });
    expect(filtered.models[1]).toMatchObject({ deployment: "test-model-one", costUsd: 10, promptTokens: 100, completionTokens: 20 });
    expect(filtered.usage.every((row) => row.team === "team07")).toBe(true);
    expect(filtered.hourly.every((row) => row.team === "team07")).toBe(true);
    expect(filterSpend(source, null)).toBe(source);
    expect(source.summary.costUsd).toBe(145.25);
    expect(source.models).toHaveLength(3);
    expect(() => filterSpend(source, "team99")).toThrow("Vybraný tým");
  });
  it("shows zero usage honestly and sorts numeric values rather than formatted currency", () => {
    const filtered = filterSpend(interactiveSpendFixture(), "team09");
    expect(filtered.models).toEqual([]);
    expect(filtered.usage).toEqual([]);
    expect(filtered.hourly).toEqual([]);
    expect(filtered.summary.costUsd).toBe(0);
    expect([100, 2, 30].sort(compareValues)).toEqual([2, 30, 100]);
    expect(["team19", "team07", "team08"].sort(compareValues)).toEqual(["team07", "team08", "team19"]);
  });
  it("hides only exact teamNN accounts, case-insensitively", () => {
    for (const user of ["team07@example.com", "TEAM19@example.com", ""]) expect(canViewSpend(user)).toBe(false);
    for (const user of ["organizer@example.com", "team7@example.com", "team123@example.com", "ops-team07@example.com"]) expect(canViewSpend(user)).toBe(true);
  });
  it("preserves raw cost precision, zero teams and suspension independent of budgets", () => {
    const data = spendFixture();
    data.summary.costUsd = 0.000123;
    expect(parseSpend(data).summary.costUsd).toBe(0.000123);
    expect(parseSpend(data).teams[0]?.state).toBe("active");
    expect(parseSpend(data).teams[0]?.budgetExceeded).toBe(true);
    expect(parseSpend(data).teams[1]?.costUsd).toBe(0);
    expect(parseSpend({ ...data, lastUsageAt: null, lastSnapshotAt: null }).lastUsageAt).toBeNull();
  });
  it("rejects malformed data instead of displaying empty totals", () => {
    for (const bad of [null, {}, { ...spendFixture(), models: null }, { ...spendFixture(), generatedAt: "invalid" },
      { ...spendFixture(), summary: { ...spendFixture().summary, costUsd: -1 } },
      { ...spendFixture(), summary: { ...spendFixture().summary, budgetUsd: 0 } }]) {
      expect(() => parseSpend(bad)).toThrow();
    }
  });
  it("uses the authenticated same-origin API and surfaces denied, failed and HTML responses", async () => {
    const fixture = spendFixture();
    const impl: typeof fetch = async (url, init) => {
      expect(url).toBe("/api/spend");
      expect(init?.credentials).toBe("same-origin");
      expect(init?.cache).toBe("no-store");
      expect(init?.redirect).toBe("error");
      return Response.json(fixture);
    };
    expect((await loadSpend(impl)).summary.costUsd).toBe(fixture.summary.costUsd);
    for (const status of [401, 403, 502, 503]) {
      await expect(loadSpend(async () => new Response("", { status }))).rejects.toThrow();
    }
    await expect(loadSpend(async () => new Response("<html>login</html>"))).rejects.toThrow("Server nevrátil");
  });
});
