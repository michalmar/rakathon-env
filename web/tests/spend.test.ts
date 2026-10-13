import { describe, expect, it } from "vitest";
import { canViewSpend, loadSpend, parseSpend } from "../src/spend";
import { spendFixture } from "./fixtures";

describe("organizer spend dashboard", () => {
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
