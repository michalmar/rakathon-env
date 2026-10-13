import { expect, test, type Page } from "@playwright/test";
import { catalogFixture, spendFixture, userFixture } from "./fixtures";

async function prepare(page: Page, user = "organizer@example.com") {
  const principal = userFixture();
  principal.clientPrincipal.userDetails = user;
  let calls = 0;
  await page.route("**/.auth/me", (route) => route.fulfill({ json: principal }));
  await page.route("**/catalog.json", (route) => route.fulfill({ json: catalogFixture() }));
  await page.route("**/api/my-key", (route) => route.fulfill({ status: 404, json: { error: "no-team" } }));
  await page.route("**/api/spend", (route) => {
    calls++;
    return route.fulfill({ json: spendFixture() });
  });
  return () => calls;
}

test("teamNN has no spend navigation, section or API request even with a direct hash", async ({ page }) => {
  const calls = await prepare(page, "TEAM07@example.com");
  await page.goto("/#spend");
  await expect(page.locator(".model-card")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Náklady", exact: true })).toHaveCount(0);
  await expect(page.locator("#spend")).toHaveCount(0);
  expect(calls()).toBe(0);
});

test("non-team account sees estimates, zero usage and real APIM state separately", async ({ page }) => {
  const calls = await prepare(page);
  await page.goto("/");
  expect(calls()).toBe(0);
  await page.getByRole("link", { name: "Náklady", exact: true }).click();
  const section = page.locator("#spend");
  await expect(section.getByRole("heading", { name: "Odhad nákladů modelů" })).toBeVisible();
  await expect(section.getByText("nikoli fakturovaná cena Azure", { exact: false })).toBeVisible();
  const teamTable = section.getByRole("table", { name: "Týmy · rozpočet a skutečný stav APIM" });
  await expect(teamTable.getByRole("row").filter({ hasText: "team07" })).toContainText("Týmový limit dosažen");
  await expect(teamTable.getByRole("row").filter({ hasText: "team07" })).toContainText("Aktivní");
  const zero = teamTable.getByRole("row").filter({ hasText: "team08" });
  await expect(zero).toContainText("0,00");
  await expect(zero).toContainText("Pozastaveno");
  await expect(zero).toContainText("Pod limitem");
  await expect(teamTable.getByText("ops-test")).toHaveCount(0);
  await expect(section.getByRole("table", { name: "Modely · odhad za celé rozpočtové okno" })).toContainText("test-model-one");
  await section.getByText("Rozpad tým × deployment", { exact: true }).click();
  await expect(section.getByRole("table", { name: "Spotřeba podle subscription a deploymentu" })).toContainText("ops-test");
  await section.getByRole("button", { name: "Obnovit přehled" }).click();
  await expect.poll(calls).toBe(2);
});

test("failed refresh marks retained data stale and a retry recovers", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Náklady", exact: true }).click();
  const section = page.locator("#spend");
  await expect(section.locator(".spend-summary")).toBeVisible();
  await page.route("**/api/spend", (route) => route.fulfill({ status: 502, json: { error: "spend-query-error" } }));
  await section.getByRole("button", { name: "Obnovit přehled" }).click();
  await expect(section.getByRole("alert")).toContainText("není aktuální");
  await expect(section.locator(".spend-summary")).toBeVisible();
  await page.route("**/api/spend", (route) => route.fulfill({ json: spendFixture() }));
  await section.getByRole("button", { name: "Obnovit přehled" }).click();
  await expect(section.getByRole("alert")).toHaveCount(0);
});

test("currency uses USD and exactly two decimal places across dashboard surfaces", async ({ page }) => {
  await prepare(page);
  const data = spendFixture();
  data.summary.costUsd = 1234.56789;
  data.teams[0]!.costUsd = 12.34567;
  data.models[0]!.costUsd = 0.004;
  data.usage[0]!.costUsd = 0.016;
  data.hourly[0]!.costUsd = 0.12876;
  await page.route("**/api/spend", (route) => route.fulfill({ json: data }));
  await page.goto("/");
  await page.getByRole("link", { name: "Náklady", exact: true }).click();
  const section = page.locator("#spend");
  await expect(section.locator(".spend-summary dd").first()).toHaveText("1 234,57 USD");
  await expect(section.getByRole("table", { name: "Týmy · rozpočet a skutečný stav APIM" })
    .getByRole("row").filter({ hasText: "team07" })).toContainText("12,35 USD");
  await expect(section.getByRole("table", { name: "Modely · odhad za celé rozpočtové okno" })
    .getByRole("row").filter({ hasText: "test-model-one" })).toContainText("0,00 USD");
  await section.getByText("Rozpad tým × deployment", { exact: true }).click();
  await expect(section.getByRole("table", { name: "Spotřeba podle subscription a deploymentu" })
    .getByRole("row").filter({ hasText: "team07" })).toContainText("0,02 USD");
  await expect(section.locator(".spend-chart-label").first()).toHaveText("0,13 USD");
  await expect(section).not.toContainText("US$");
  await expect(section).not.toContainText(/\d,\d{3,}/);
});

test("empty usage and stalled job have explicit states", async ({ page }) => {
  await prepare(page);
  const data = spendFixture();
  data.models = [];
  data.usage = [];
  data.hourly = [];
  data.lastSnapshotAt = null;
  data.lastUsageAt = null;
  data.enforcementEnabled = false;
  await page.route("**/api/spend", (route) => route.fulfill({ json: data }));
  await page.goto("/");
  await page.getByRole("link", { name: "Náklady", exact: true }).click();
  const section = page.locator("#spend");
  await expect(section.getByText("V rozpočtovém okně zatím není zaznamenaná spotřeba modelů.")).toBeVisible();
  await expect(section.getByText("Job řízení nákladů nemá aktuální snapshot", { exact: false })).toBeVisible();
  await expect(section.getByText("Automatické blokování je vypnuté.", { exact: false })).toBeVisible();
});

test("dashboard remains readable on desktop/mobile in light/dark with accessible chart data", async ({ page }, testInfo) => {
  await prepare(page);
  for (const width of [1440, 375]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/?scoutTheme=${theme}`);
      await page.getByRole("link", { name: "Náklady", exact: true }).click();
      const section = page.locator("#spend");
      await expect(section.locator(".spend-summary")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const refresh = section.getByRole("button", { name: "Obnovit přehled" });
      const box = await refresh.boundingBox();
      const requiredWidth = await refresh.evaluate((button) => button.scrollWidth);
      expect(box && box.width >= requiredWidth).toBe(true);
      await expect(section.getByRole("img", { name: /Hodinové náklady/ })).toHaveCount(1);
      await section.getByText("Číselné hodnoty hodinového grafu", { exact: true }).click();
      await expect(section.getByRole("table", { name: "Hodinový odhad (USD)" }).locator("tbody tr")).toHaveCount(25);
      await page.screenshot({ path: testInfo.outputPath(`spend-${width}-${theme}.png`) });
    }
  }
});
