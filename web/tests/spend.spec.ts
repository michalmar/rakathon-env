import { expect, test, type Page } from "@playwright/test";
import { azureCostFixture, catalogFixture, interactiveSpendFixture, spendFixture, userFixture } from "./fixtures";

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
  await page.route("**/api/azure-cost", (route) => {
    calls++;
    return route.fulfill({ json: azureCostFixture() });
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
  await expect.poll(calls).toBe(4);
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

test("team clicks cross-filter summaries, model totals, detail tables and hourly charts", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/spend", (route) => route.fulfill({ json: interactiveSpendFixture() }));
  await page.goto("/");
  await page.getByRole("link", { name: "Náklady", exact: true }).click();
  const section = page.locator("#spend");
  const teams = section.getByRole("table", { name: "Týmy · rozpočet a skutečný stav APIM" });
  const models = section.getByRole("table", { name: "Modely · odhad za celé rozpočtové okno" });
  await section.getByText("Rozpad tým × deployment", { exact: true }).click();
  await expect(section.getByRole("table", { name: "Spotřeba podle subscription a deploymentu" })).toBeVisible();
  await teams.getByRole("button", { name: "Filtrovat tým team07", exact: true }).click();
  await expect(section.getByRole("combobox", { name: "Filtrovat přehled podle týmu" })).toHaveValue("team07");
  await expect(section.locator(".spend-summary dd").first()).toHaveText("110,00 USD");
  await expect(section.locator(".spend-summary")).toContainText("Celá akce (nefiltrovaná)");
  await expect(section.locator(".spend-summary")).toContainText("145,25 USD");
  await expect(models.locator("tbody tr")).toHaveCount(2);
  await expect(models.getByRole("row").filter({ hasText: "test-model-two" }).locator("td").first()).toHaveText("100,00 USD");
  await expect(models.getByRole("row").filter({ hasText: "test-model-one" }).locator("td").first()).toHaveText("10,00 USD");
  const usage = section.getByRole("table", { name: "Spotřeba podle subscription a deploymentu" });
  await expect(usage).toBeVisible();
  await expect(usage.locator("tbody tr")).toHaveCount(2);
  await expect(usage).not.toContainText("ops-test");
  await expect(usage).not.toContainText("team08");
  await expect(section.locator(".spend-chart-label").first()).toHaveText("12,00 USD");
  await expect(section.locator(".spend-model-chart")).not.toContainText("old-model");
  await expect(teams.locator("tbody tr")).toHaveCount(3);
  await expect(teams.getByRole("button", { name: "Filtrovat tým team07", exact: true })).toBeFocused();
  await expect(teams.getByRole("button", { name: "Filtrovat tým team07", exact: true })).toHaveAttribute("aria-pressed", "true");
  await section.getByRole("button", { name: "Zobrazit vše", exact: true }).click();
  await expect(section.getByRole("combobox")).toHaveValue("");
  await expect(models.locator("tbody tr")).toHaveCount(3);
  await expect(usage.locator("tbody tr")).toHaveCount(6);
  await expect(section.locator(".spend-chart-label").first()).toHaveText("19,00 USD");
});

test("sorting uses numeric values, toggles aria-sort and persists through filtering and refresh", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/spend", (route) => route.fulfill({ json: interactiveSpendFixture() }));
  await page.goto("/");
  await page.getByRole("link", { name: "Náklady", exact: true }).click();
  const section = page.locator("#spend");
  const models = section.getByRole("table", { name: "Modely · odhad za celé rozpočtové okno" });
  await models.getByRole("button", { name: "Seřadit podle Odhad USD", exact: true }).click();
  await expect(models.getByRole("columnheader").filter({ hasText: "Odhad USD" })).toHaveAttribute("aria-sort", "ascending");
  await expect(models.locator("tbody tr th")).toHaveText(["◇old-model", "test-model-one", "xAItest-model-two"]);
  await models.getByRole("button", { name: "Seřadit podle Požadavky", exact: true }).click();
  await expect(models.locator("tbody tr").first()).toContainText("test-model-two");
  await expect(models.locator("tbody tr").nth(1)).toContainText("old-model");
  await models.getByRole("button", { name: "Seřadit podle Odhad USD", exact: true }).click();
  await models.getByRole("button", { name: "Seřadit podle Odhad USD", exact: true }).click();
  await section.getByRole("combobox").selectOption("team07");
  await expect(models.locator("tbody tr").first()).toContainText("test-model-one");
  await section.getByRole("button", { name: "Obnovit přehled", exact: true }).click();
  await expect(section.getByRole("combobox")).toHaveValue("team07");
  await expect(models.getByRole("columnheader").filter({ hasText: "Odhad USD" })).toHaveAttribute("aria-sort", "ascending");
  await expect(models.locator("tbody tr").first()).toContainText("test-model-one");
  const teams = section.getByRole("table", { name: "Týmy · rozpočet a skutečný stav APIM" });
  await teams.getByRole("button", { name: "Seřadit podle Tým", exact: true }).click();
  await expect(teams.locator("tbody tr").first()).toContainText("team07");
  await teams.getByRole("button", { name: "Seřadit podle Tým", exact: true }).click();
  await expect(teams.locator("tbody tr").first()).toContainText("team09");
  await section.getByText("Číselné hodnoty hodinového grafu", { exact: true }).click();
  const hours = section.getByRole("table", { name: "Hodinový odhad (USD)" });
  await hours.getByRole("button", { name: "Seřadit podle team07", exact: true }).click();
  await expect(hours.locator("tbody tr").first()).toContainText("12,00 USD");
});

test("ranked charts expose risk, cost drivers and catalog provider icons; keyboard selection handles zero usage", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/spend", (route) => route.fulfill({ json: interactiveSpendFixture() }));
  await page.goto("/");
  await page.getByRole("link", { name: "Náklady", exact: true }).click();
  const section = page.locator("#spend");
  const chart = section.locator(".spend-team-chart");
  await expect(chart.locator(".spend-rank-row").first()).toContainText("team07");
  await expect(chart.locator(".spend-rank-row").first()).toContainText("110 %");
  await expect(chart.locator(".spend-rank-row").first()).toContainText("Přes limit o 10,00 USD");
  await expect(chart.locator(".spend-rank-row").first().locator(".is-danger")).toHaveCount(1);
  await expect(section.locator(".spend-insights")).toContainText("APIM přístup je stále aktivní");
  const drivers = section.locator(".spend-model-chart");
  await expect(drivers.locator(".spend-model-rank").first()).toContainText("test-model-two");
  await expect(drivers.locator(".spend-model-rank").first()).toContainText("89,5 %");
  const models = section.getByRole("table", { name: "Modely · odhad za celé rozpočtové okno" });
  await expect(models.locator(".provider-openai img")).toHaveAttribute("src", "/provider-openai.svg");
  await expect(models.locator(".provider-xai")).toContainText("xAI");
  await expect(models.locator(".spend-model-unknown")).toHaveAttribute("title", "Deployment není v aktuálním katalogu");
  await chart.getByRole("button", { name: "Filtrovat tým team08", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(section.getByRole("combobox")).toHaveValue("team08");
  await expect(section.locator(".spend-summary dd").first()).toHaveText("32,00 USD");
  await section.getByRole("combobox").selectOption("team09");
  await expect(section.locator(".spend-summary dd").first()).toHaveText("0,00 USD");
  await expect(section.getByRole("table", { name: "Modely · odhad za celé rozpočtové okno" })).toHaveCount(0);
  await expect(section.getByText("V rozpočtovém okně zatím není zaznamenaná spotřeba modelů.")).toBeVisible();
  await expect(section.locator(".spend-chart")).toContainText("není pro tento výběr zaznamenaná spotřeba");
});

test("dashboard remains readable on desktop/mobile in light/dark with accessible chart data", async ({ page }, testInfo) => {
  await prepare(page);
  await page.route("**/api/spend", (route) => route.fulfill({ json: interactiveSpendFixture() }));
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
      await section.locator(".spend-overview-charts").screenshot({ path: testInfo.outputPath(`overview-${width}-${theme}.png`) });
      await section.locator(".spend-team-chart").getByRole("button", { name: "Filtrovat tým team07", exact: true }).click();
      await expect(section.getByRole("combobox")).toHaveValue("team07");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await section.getByText("Číselné hodnoty hodinového grafu", { exact: true }).click();
      await expect(section.getByRole("table", { name: "Hodinový odhad (USD)" }).locator("tbody tr")).toHaveCount(25);
      await page.screenshot({ path: testInfo.outputPath(`spend-${width}-${theme}.png`) });
    }
  }
});

test("billing shows real Azure spend vs budget and teams ranked by total spend", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Náklady", exact: true }).click();
  const section = page.locator("#spend");
  await expect(section.getByRole("heading", { name: "Skutečné náklady Azure (billing)" })).toBeVisible();
  await expect(section.locator(".billing-summary dd").first()).toHaveText("812,50 USD");
  await expect(section.locator(".billing-summary")).toContainText("5 000,00 USD");
  await expect(section.locator(".billing-meter")).toContainText("16,3 %");
  await expect(section.locator(".billing-content .spend-freshness")).toContainText("12. 10. 2026");
  // team07: 0 billing + 1200 models; team08: 50 billing + 0 models; team03: 12.5 billing only
  await expect(section.locator(".billing-team")).toHaveText(["team07", "team08", "team03"]);
  await expect(section.locator(".billing-rank-row").first()).toContainText("1 200,00 USD");
  await section.getByText("Rozpad podle resource group", { exact: true }).click();
  await expect(section.getByRole("table", { name: "Skutečné náklady podle resource group (USD)" })).toContainText("rg-rakathon-shared");
});

test("billing and estimate fail independently", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/azure-cost", (route) => route.fulfill({ status: 503, json: { error: "azure-cost-unavailable" } }));
  await page.goto("/");
  await page.getByRole("link", { name: "Náklady", exact: true }).click();
  const section = page.locator("#spend");
  await expect(section.getByRole("alert")).toContainText("Skutečné náklady Azure se nepodařilo načíst (HTTP 503)");
  await expect(section.locator(".spend-summary")).toBeVisible();
  const stale = azureCostFixture();
  stale.error = "azure-cost-throttled";
  await page.route("**/api/azure-cost", (route) => route.fulfill({ json: stale }));
  await page.route("**/api/spend", (route) => route.fulfill({ status: 502, json: { error: "spend-query-error" } }));
  await section.getByRole("button", { name: "Obnovit přehled" }).click();
  await expect(section.locator(".billing-content")).toContainText("Poslední obnovení billingu selhalo (azure-cost-throttled");
  await expect(section.getByRole("alert")).toContainText("Náklady se nepodařilo načíst (HTTP 502)");
});
