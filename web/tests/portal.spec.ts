import { expect, test, type Page } from "@playwright/test";
import { environment } from "../src/catalog";
import { irisImage } from "../src/iris";
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
  let dataLinkRequests = 0;
  await page.route("**/api/data-link?*", (route) => {
    dataLinkRequests += 1;
    const name = new URL(route.request().url()).searchParams.get("name") ?? "";
    const encodedName = name.split("/").map(encodeURIComponent).join("/");
    const blobUrl = `https://${environment.storageAccount}.blob.core.windows.net/${environment.container}/${encodedName}`;
    return route.fulfill({
      json: {
        blobUrl,
        downloadUrl: `${blobUrl}?sv=test&sig=fake`,
        expiresAt: "2026-10-12T12:00:00.000Z",
      },
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { Reflect.set(window, "testClipboard", value); } },
    });
  });
  return {
    keyRequests: () => keyRequests,
    myKeyRequests: () => myKeyRequests,
    catalogRequests: () => catalogRequests,
    dataLinkRequests: () => dataLinkRequests,
  };
}

async function openFirstModel(page: Page) {
  const card = page.locator(".model-card").first();
  await expect(card).not.toHaveAttribute("open", "");
  await card.locator("summary").click();
  await expect(card).toHaveAttribute("open", "");
}

test("zobrazí modely, APIM endpoint, klíč týmu a akce nad datovými soubory", async ({ page }) => {
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
  await expect(page.getByText("Jak data použít v projektu")).toBeVisible();
  await expect(page.getByRole("link", { name: "Otevřít storage v portálu", exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stáhnout" })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Kopírovat URL" })).toHaveCount(3);
  expect(requests.keyRequests()).toBe(0);
  await expect(page.getByRole("button", { name: "Kopírovat endpoint Testovací model 1" })).toBeHidden();
  await openFirstModel(page);
  await page.getByRole("button", { name: "Kopírovat endpoint Testovací model 1" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "testClipboard"))).toBe(catalogFixture().gateway.endpoint);
  await expect(page.getByRole("status")).toHaveText("APIM gateway (OpenAI v1) zkopírován do schránky.");
  await page.getByRole("button", { name: "Kopírovat deployment Testovací model 1" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "testClipboard"))).toBe("test-model-one");
});

test("zkopíruje stabilní blob URL a stáhne soubor přes krátkodobý odkaz", async ({ page }) => {
  const requests = await prepare(page);
  const catalog = catalogFixture();
  const file = catalog.storage.files[0]!;
  const blobUrl = `https://${environment.storageAccount}.blob.core.windows.net/${environment.container}/${encodeURIComponent(file.name)}`;
  await page.route(`${blobUrl}?*`, (route) => route.fulfill({
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.name}"`,
    },
    body: "sample",
  }));
  await page.goto("/");
  const row = page.getByRole("row").filter({ hasText: file.name });
  await row.getByRole("button", { name: "Kopírovat URL" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "testClipboard"))).toBe(blobUrl);
  const downloadPromise = page.waitForEvent("download");
  await row.getByRole("button", { name: "Stáhnout" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(file.name);
  expect(requests.dataLinkRequests()).toBe(1);
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

test("Azure Portal a GitHub registrace mají bezpečné odkazy a lokální obrázky", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  const azure = page.locator(".topbar").getByRole("link", { name: "Azure Portal (otevře novou kartu)", exact: true });
  await expect(azure).toHaveAttribute("href", "https://portal.azure.com/");
  await expect(azure).toHaveAttribute("target", "_blank");
  await expect(azure).toHaveAttribute("rel", "noopener noreferrer");
  await expect(azure.locator("img")).toHaveAttribute("src", "/azure-logo.svg");

  await page.getByRole("navigation", { name: "Sekce katalogu" }).getByRole("link", { name: "GitHub Copilot", exact: true }).click();
  await expect(page).toHaveURL(/#github$/);
  const section = page.locator("#github");
  await expect(section.getByRole("heading", { name: "GitHub Copilot pro hackathon" })).toBeVisible();
  const enrollment = section.getByRole("link", { name: "Registrovat se pro GitHub Copilot", exact: false });
  const href = await enrollment.getAttribute("href");
  if (href === null) throw new Error("Chybí registrační odkaz.");
  const url = new URL(href);
  expect(url.origin).toBe("https://polite-glacier-0ea2cfe0f.7.azurestaticapps.net");
  expect(new URLSearchParams(url.hash.slice(1)).get("token")).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  await expect(enrollment).toHaveAttribute("target", "_blank");
  await expect(enrollment).toHaveAttribute("rel", "noopener noreferrer");
  await expect(section.getByRole("link", { name: "Otevřít registraci z QR kódu", exact: false })).toHaveAttribute("href", href);
  await expect(section.getByText("Enterprise Managed User (EMU)", { exact: false })).toBeVisible();
  await expect(section.getByText("Do registrační stránky nevkládejte TAP ani API klíč.", { exact: false })).toBeVisible();
  await expect(section.getByRole("link", { name: "Otevřít náhled registrace v plné velikosti", exact: false })).toHaveAttribute("href", "/github-enrollment.png");
  for (const image of await page.locator(".azure-portal-logo, #github img").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true);
  }
});

test("GitHub registrace je čitelná na mobilu v obou tématech", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 375, height: 812 });
  for (const theme of ["light", "dark"]) {
    await page.goto(`/?scoutTheme=${theme}#github`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("#github").getByRole("heading", { level: 2 })).toBeVisible();
    await expect(page.locator(".enrollment-qr img")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("GitHub Copilot obsahuje zdroje organizace, datum smazání a logo v menu", async ({ page }) => {
  await prepare(page);
  await page.goto("/#github");
  await expect(page.locator(".github-nav-logo")).toHaveAttribute("src", "/github-logo.svg");
  const section = page.locator("#github");
  await expect(section.getByRole("heading", { name: "GitHub Copilot pro Rakathon 2026" })).toHaveCount(0);
  await expect(section.getByText("19. října 2026", { exact: false })).toBeVisible();
  await expect(section.getByText("Privátní organizace", { exact: false })).toHaveCount(0);
  await expect(section.getByRole("link", { name: "Organizace Rakathon 2026", exact: false })).toHaveCount(0);
  await expect(section.getByRole("link", { name: "GitHub Skills", exact: false })).toHaveAttribute("href", "https://skills.github.com/");
  await expect(section.locator(".resource-links a")).toHaveCount(5);
  for (const link of await section.locator(".resource-links a").all()) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
});

test("Examples jsou sbalené, kopírují přesný kód a fungují i na mobilu", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await page.getByRole("navigation").getByRole("link", { name: "Examples", exact: true }).click();
  await expect(page).toHaveURL(/#examples$/);
  const section = page.locator("#examples");
  const guides = section.locator("details");
  await expect(guides).toHaveCount(4);
  for (const guide of await guides.all()) {
    await expect(guide).not.toHaveAttribute("open", "");
    await guide.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(guide).toHaveAttribute("open", "");
    for (const pre of await guide.locator("pre").all()) {
      const label = await pre.getAttribute("aria-label");
      await guide.getByRole("button", { name: `Kopírovat ${label}`, exact: true }).click();
      expect(await page.evaluate(() => Reflect.get(window, "testClipboard"))).toBe(await pre.textContent());
    }
  }
  await expect(section.getByLabel("hello.py", { exact: true })).toContainText("client.responses.create(");
  await expect(section.getByLabel("hello.py", { exact: true })).toContainText(catalogFixture().gateway.endpoint);
  await expect(section.getByLabel("SWA nasazení (Bash)")).toContainText("az staticwebapp create");
  await expect(section.getByLabel("ACA job (Bash)")).toContainText("--trigger-type Manual");
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/?scoutTheme=${theme}#examples`);
    for (const guide of await guides.all()) await guide.locator("summary").click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

function irisUser() {
  const user = userFixture();
  user.clientPrincipal.userDetails = "team07@example.onmicrosoft.com";
  return user;
}

test("IRIS předvyplní tým a přesné příkazy bez ukládání nebo odesílání hesla", async ({ page }) => {
  await prepare(page, catalogFixture(), irisUser());
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url() + (request.postData() ?? "")));
  await page.goto("/");
  await page.getByRole("navigation").getByRole("link", { name: "IRIS", exact: true }).click();
  await expect(page).toHaveURL(/#iris$/);
  const section = page.locator("#iris");
  const password = section.getByLabel("Heslo IRIS pro _SYSTEM", { exact: true });
  const deploy = section.getByRole("button", { name: "Kopírovat nasazení IRIS", exact: true });
  await expect(section.getByText("rg-team07", { exact: true })).toBeVisible();
  await expect(section.getByLabel("Název nového kontejneru")).toHaveValue("aci-irishealth-team07");
  await expect(password).toHaveValue("");
  await expect(deploy).toBeEnabled();
  await expect(section.locator("pre")).toHaveCount(2);
  await section.getByRole("button", { name: "Vygenerovat heslo", exact: true }).click();
  const secret = await password.inputValue();
  expect(secret).toMatch(/^Ir1![A-Za-z0-9_-]{28}$/);
  await expect(password).toHaveAttribute("type", "password");
  await section.getByRole("button", { name: "Kopírovat heslo IRIS", exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, "testClipboard"))).toBe(secret);
  await section.getByRole("button", { name: "Zobrazit heslo IRIS", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(password).toHaveAttribute("type", "password");
  await deploy.click();
  const command = await page.evaluate(() => Reflect.get(window, "testClipboard"));
  expect(command).toContain('--resource-group "rg-team07"');
  expect(command).toContain('--name "aci-irishealth-team07"');
  expect(command).toContain("--location swedencentral");
  expect(command).toContain(irisImage);
  expect(command).toContain('--secrets "iris-password=$IRIS_PASSWORD"');
  expect(command).toMatch(/^az container create /);
  expect(command).not.toMatch(/AZURE_CONFIG_DIR|azure-rak|--subscription|az login|read |if |set |unset /);
  expect(command).not.toContain(secret);
  expect(await section.locator("pre").allTextContents()).not.toEqual(expect.arrayContaining([expect.stringContaining(secret)]));
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain(secret);
  expect(requests.join("\n")).not.toContain(secret);
  await section.getByRole("button", { name: "Vygenerovat jiné heslo", exact: true }).click();
  expect(await password.inputValue()).not.toBe(secret);
  await page.reload();
  await expect(page.locator("#iris").getByLabel("Heslo IRIS pro _SYSTEM", { exact: true })).toHaveValue("");
});

test("IRIS aktualizuje jediný create příkaz a odmítne neplatný název", async ({ page }) => {
  await prepare(page, catalogFixture(), irisUser());
  await page.goto("/#iris");
  const section = page.locator("#iris");
  const name = section.getByLabel("Název nového kontejneru");
  await name.fill("iris-demo-07");
  await section.getByRole("button", { name: "Kopírovat nasazení IRIS", exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, "testClipboard"))).toContain('--name "iris-demo-07"');
  await expect(section.getByRole("button", { name: "Kopírovat přihlášení IRIS" })).toBeEnabled();
  await expect(section.getByText("Logy, shell, zastavení a úklid", { exact: true })).toHaveCount(0);
  await name.fill("iris;echo bad");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(section.getByRole("status")).toContainText("Název musí");
  await expect(section.getByRole("button", { name: "Kopírovat nasazení IRIS", exact: true })).toBeDisabled();
  await expect(section.getByRole("button", { name: "Kopírovat přihlášení IRIS" })).toBeEnabled();
  await name.fill("iris-fixed");
  await expect(name).toHaveAttribute("aria-invalid", "false");
  await expect(section.getByRole("button", { name: "Kopírovat nasazení IRIS", exact: true })).toBeEnabled();
});

test("IRIS krok 1 kopíruje pouze jednoduché az login", async ({ page }) => {
  await prepare(page, catalogFixture(), irisUser());
  await page.goto("/#iris");
  const section = page.locator("#iris");
  await expect(section.getByRole("heading", { name: "1. Přihlaste se do Azure CLI" })).toBeVisible();
  await expect(section.getByRole("heading", { name: "2. Spusťte kontejner" })).toBeVisible();
  await expect(section.getByLabel("přihlášení IRIS", { exact: true })).toHaveText("az login");
  await section.getByRole("button", { name: "Kopírovat přihlášení IRIS", exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, "testClipboard"))).toBe("az login");
});

test("IRIS používá dynamicky přihlášený tým, ne vzorový team07", async ({ page }) => {
  const user = irisUser();
  user.clientPrincipal.userDetails = "team19@example.onmicrosoft.com";
  await prepare(page, catalogFixture(), user);
  await page.goto("/#iris");
  const section = page.locator("#iris");
  await expect(section.getByText("rg-team19", { exact: true })).toBeVisible();
  await expect(section.getByLabel("Název nového kontejneru")).toHaveValue("aci-irishealth-team19");
  await section.getByRole("button", { name: "Kopírovat nasazení IRIS", exact: true }).click();
  const command = await page.evaluate(() => Reflect.get(window, "testClipboard"));
  expect(command).toContain('--resource-group "rg-team19"');
  expect(command).toContain('--name "aci-irishealth-team19"');
  expect(command).not.toContain("team07");
});

test("IRIS mimo tým nevymýšlí resource group ani příkazy", async ({ page }) => {
  await prepare(page);
  await page.goto("/#iris");
  await expect(page.locator("#iris").getByText("U tohoto účtu nelze určit tým", { exact: false })).toBeVisible();
  await expect(page.locator("#iris pre")).toHaveCount(0);
  await expect(page.locator("#iris input")).toHaveCount(0);
});

test("IRIS je čitelný na desktopu i mobilu v obou tématech", async ({ page }) => {
  await prepare(page, catalogFixture(), irisUser());
  for (const width of [1440, 1280, 1024, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.goto(`/?scoutTheme=${theme}#iris`);
      await page.getByRole("navigation").getByRole("link", { name: "IRIS", exact: true }).click();
      await expect(page.locator("#iris").getByRole("heading", { level: 2 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const brand = await page.locator(".brand").boundingBox();
      const nav = await page.getByRole("navigation").boundingBox();
      expect(brand && nav && (brand.x + brand.width <= nav.x || brand.y + brand.height <= nav.y)).toBe(true);
    }
  }
});

test("IRIS chybu schránky viditelně oznámí", async ({ page }) => {
  await prepare(page, catalogFixture(), irisUser());
  await page.goto("/#iris");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => { throw new Error("clipboard denied"); } },
    });
  });
  await page.locator("#iris").getByRole("button", { name: "Kopírovat nasazení IRIS", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Kopírování příkazu se nezdařilo");
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
