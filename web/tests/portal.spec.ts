import { expect, test, type Page } from "@playwright/test";
import { environment } from "../src/catalog";
import { catalogFixture, userFixture } from "./fixtures";

const teamKeyFixture = { team: "team07", key: "FAKE-KEY", state: "active", baseUrl: `https://${environment.gatewayService}.azure-api.net/openai/v1` };

async function prepare(page: Page, catalog = catalogFixture(), user: unknown = userFixture(), keyStatus = 200, keyBody: unknown = teamKeyFixture) {
  let keyRequests = 0;
  let myKeyRequests = 0;
  await page.route("**/api/my-key", (route) => {
    myKeyRequests += 1;
    return route.fulfill({ status: keyStatus, json: keyBody });
  });
  let catalogRequests = 0;
  await page.route("**/.auth/me", (route) => route.fulfill({ json: user }));
  await page.route("**/catalog.json", (route) => {
    catalogRequests += 1;
    return route.fulfill({ json: catalog });
  });
  await page.route("**/catalog-keys.json", (route) => {
    keyRequests += 1;
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { Reflect.set(window, "testClipboard", value); } },
    });
  });
  return { keyRequests: () => keyRequests, myKeyRequests: () => myKeyRequests, catalogRequests: () => catalogRequests };
}

async function openFirstModel(page: Page) {
  const card = page.locator(".model-card").first();
  await expect(card).not.toHaveAttribute("open", "");
  await card.locator("summary").click();
  await expect(card).toHaveAttribute("open", "");
}

test("zobrazí modely, APIM endpoint, odkaz na klíč týmu a návod místo downloadů", async ({ page }) => {
  const requests = await prepare(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Modely a datové podklady");
  await expect(page.locator(".model-card")).toHaveCount(2);
  await expect(page.locator(".deployment-zone")).toHaveCount(1);
  await expect(page.locator(".deployment-global")).toHaveCount(1);
  await expect(page.locator(".provider-openai")).toHaveCount(1);
  await expect(page.locator(".provider-xai")).toHaveCount(1);
  await expect(page.getByText("Každý tým má vlastní klíč", { exact: false })).toBeVisible();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Datové podklady pouze pro výzvy VZP" })).toBeVisible();
  await expect(page.getByText("Jak soubory stáhnout v Azure Portalu")).toBeVisible();
  await expect(page.getByRole("link", { name: "Otevřít storage v portálu", exact: false })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("button", { name: /Stáhnout|SAS|Kopírovat klíč/ })).toHaveCount(0);
  expect(requests.keyRequests()).toBe(0);
  await expect(page.getByRole("button", { name: "Kopírovat endpoint Testovací model 1" })).toBeHidden();
  await openFirstModel(page);
  await page.getByRole("button", { name: "Kopírovat endpoint Testovací model 1" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "testClipboard"))).toBe(catalogFixture().gateway.endpoint);
  await expect(page.getByRole("status")).toHaveText("APIM gateway (OpenAI v1) zkopírován do schránky.");
  await page.getByRole("button", { name: "Kopírovat deployment Testovací model 1" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "testClipboard"))).toBe("test-model-one");
});

test("filtruje soubory a prázdný výsledek vysvětlí", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  const search = page.getByRole("searchbox", { name: "Najít soubor podle názvu" });
  await search.fill("CSV");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("1 z 3 souborů")).toBeVisible();
  await search.fill("nenalezeno");
  await expect(page.getByText("Žádný soubor neodpovídá hledání.", { exact: false })).toBeVisible();
  await search.fill("");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(3);
});

test("klíč týmu je maskovaný, lze ho zobrazit a zkopírovat; statický katalog klíče nenačítá", async ({ page }) => {
  const requests = await prepare(page);
  await page.goto("/");
  const section = page.locator("#klic");
  await expect(section.getByRole("heading", { name: "Váš API klíč" })).toBeVisible();
  await expect(section.getByText("Tým team07")).toBeVisible();
  await expect(section.getByText("aktivní", { exact: true })).toBeVisible();
  await expect(section.locator(".key-value")).not.toContainText(teamKeyFixture.key);
  await section.getByRole("button", { name: "Zobrazit API klíč" }).click();
  await expect(section.locator(".key-value")).toHaveText(teamKeyFixture.key);
  await section.getByRole("button", { name: "Skrýt API klíč" }).click();
  await expect(section.locator(".key-value")).not.toContainText(teamKeyFixture.key);
  await section.getByRole("button", { name: "Kopírovat API klíč" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "testClipboard"))).toBe(teamKeyFixture.key);
  await expect(section.getByText("openai/v1", { exact: false }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(`${teamKeyFixture.key}\n`);
  expect(requests.keyRequests()).toBe(0);
  expect(requests.myKeyRequests()).toBe(1);
});

test("zablokovaný tým vidí stav a vysvětlení", async ({ page }) => {
  await prepare(page, catalogFixture(), userFixture(), 200, { ...teamKeyFixture, state: "suspended" });
  await page.goto("/");
  await expect(page.locator("#klic").getByText("zablokováno – rozpočet")).toBeVisible();
  await expect(page.locator("#klic").getByText("vyčerpán rozpočet", { exact: false })).toBeVisible();
});

test("účet mimo tým dostane vysvětlení bez klíče", async ({ page }) => {
  await prepare(page, catalogFixture(), userFixture(), 404, { error: "no-team" });
  await page.goto("/");
  await expect(page.locator("#klic").getByText("Tento účet není týmový", { exact: false })).toBeVisible();
  await expect(page.locator("#klic").getByRole("button", { name: /API klíč/ })).toHaveCount(0);
  await expect(page.locator(".model-card")).toHaveCount(2);
});

test("chyba služby klíče nerozbije katalog a nabídne opakování", async ({ page }) => {
  const requests = await prepare(page, catalogFixture(), userFixture(), 502, { error: "upstream-error" });
  await page.goto("/");
  await expect(page.locator("#klic").getByText("Klíč se nepodařilo načíst", { exact: false })).toBeVisible();
  await expect(page.locator(".model-card")).toHaveCount(2);
  await page.route("**/api/my-key", (route) => route.fulfill({ json: teamKeyFixture }));
  await page.locator("#klic").getByRole("button", { name: "Zkusit znovu" }).click();
  await expect(page.locator("#klic").getByText("Tým team07")).toBeVisible();
  expect(requests.myKeyRequests()).toBe(1);
});

test("chybu schránky viditelně oznámí", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await openFirstModel(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => { throw new Error("clipboard denied"); } },
    });
  });
  await page.getByRole("button", { name: "Kopírovat endpoint Testovací model 1" }).click();
  await expect(page.getByRole("alert")).toContainText("Kopírování se nezdařilo");
});

test("bez přihlášení nebo s jiným tenantem vůbec nenačítá katalog", async ({ page }) => {
  const requests = await prepare(page, catalogFixture(), { clientPrincipal: null });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Katalog se nepodařilo otevřít");
  await expect(page.getByRole("link", { name: "Přihlásit přes Microsoft Entra ID" })).toBeVisible();
  expect(requests.catalogRequests()).toBe(0);
  const user = userFixture();
  user.clientPrincipal.claims[0]!.val = "jiný-tenant";
  await page.route("**/.auth/me", (route) => route.fulfill({ json: user }));
  await page.reload();
  await expect(page.getByText("Tento účet nepatří do Rakathon tenantu.")).toBeVisible();
  expect(requests.catalogRequests()).toBe(0);
});

test("chybný nebo nedostupný snapshot není vydáván za prázdný katalog", async ({ page }) => {
  await prepare(page);
  await page.route("**/catalog.json", (route) => route.fulfill({ status: 404, body: "not found" }));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Katalog se nepodařilo otevřít");
  await expect(page.getByText("Katalog není připravený.", { exact: false })).toBeVisible();
  await expect(page.locator(".model-card")).toHaveCount(0);
});

test("názvy blobů jsou text, ne HTML, a mobil nepřetéká", async ({ page }) => {
  const catalog = catalogFixture();
  catalog.storage.files[0]!.name = '<img src=x onerror="alert(1)">.csv';
  await prepare(page, catalog);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/?scoutTheme=dark");
  await expect(page.getByRole("table").getByText(catalog.storage.files[0]!.name)).toBeVisible();
  await expect(page.getByRole("table").locator("img")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await openFirstModel(page);
  await expect(page.getByRole("button", { name: "Kopírovat endpoint Testovací model 1" })).toBeVisible();
});
