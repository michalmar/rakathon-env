import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseUser } from "../src/auth";
import { environment, formatSize, parseCatalog, parseCatalogKeys, portalUrl } from "../src/catalog";
import { catalogFixture, keysFixture, userFixture } from "./fixtures";

describe("statický katalog", () => {
  it("přijme úplný snapshot a správně formátuje velikosti", () => {
    expect(parseCatalog(catalogFixture()).storage.files).toHaveLength(3);
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1024)).toBe("1 KiB");
    expect(formatSize(182763436)).toBe("174,3 MiB");
  });

  it("odmítne jiný tenant, subscription nebo storage", () => {
    expect(() => parseCatalog({ ...catalogFixture(), tenantId: "jiný-tenant" })).toThrow("tenant");
    expect(() => parseCatalog({ ...catalogFixture(), subscriptionId: "jiná-subscription" })).toThrow("subscription");
    const catalog = catalogFixture();
    catalog.storage.name = "jinystorage";
    expect(() => parseCatalog(catalog)).toThrow("storage account");
  });

  it("odmítne nebezpečný nebo neodpovídající endpoint", () => {
    for (const endpoint of [
      "javascript:alert(1)",
      "https://example.com/openai/v1/",
      `https://${environment.foundryAccount}.openai.azure.com.attacker.example/openai/v1/`,
      `https://${environment.foundryAccount}.openai.azure.com/openai/v1/?key=unexpected`,
      `http://${environment.foundryAccount}.openai.azure.com/openai/v1/`,
    ]) {
      const catalog = catalogFixture();
      catalog.foundry.endpoint = endpoint;
      expect(() => parseCatalog(catalog)).toThrow("endpoint");
    }
  });

  it("odmítne chybné typy, duplicitní soubory a tajné pole v metadatech", () => {
    const catalog = catalogFixture();
    catalog.storage.files[0]!.size = -1;
    expect(() => parseCatalog(catalog)).toThrow("velikost");
    const duplicate = catalogFixture();
    duplicate.storage.files.push({ ...duplicate.storage.files[0]! });
    expect(() => parseCatalog(duplicate)).toThrow("duplicitní soubor");
    expect(() => parseCatalog({ ...catalogFixture(), apiKey: "test-only" })).toThrow("neznámé pole");
    const unsupportedFormat = catalogFixture();
    Reflect.set(unsupportedFormat.foundry.models[0]!, "format", "Unknown");
    expect(() => parseCatalog(unsupportedFormat)).toThrow("nepodporovaný formát");
  });

  it("nepovolí klíč, když je autentizace klíčem vypnutá", () => {
    const catalog = catalogFixture();
    catalog.foundry.keyIncluded = true;
    expect(() => parseCatalog(catalog)).toThrow("vypnuté");
  });

  it("váže klíč na stejné Foundry a generaci katalogu", () => {
    const catalog = catalogFixture();
    catalog.foundry.keyAuthenticationEnabled = true;
    catalog.foundry.keyIncluded = true;
    const keys = keysFixture(catalog);
    expect(parseCatalogKeys(keys, catalog).apiKey).toBe("test-only-not-a-real-credential");
    expect(() => parseCatalogKeys({ ...keys, generatedAt: "2026-10-08T08:00:00.000Z" }, catalog)).toThrow("různých exportů");
    expect(() => parseCatalogKeys({ ...keys, foundryResourceId: "/another-resource" }, catalog)).toThrow("resource ID");
    expect(() => parseCatalogKeys({ ...keys, apiKey: null }, catalog)).toThrow("dostupnost");
  });

  it("vede Portal do správného tenantu a resource", () => {
    const catalog = catalogFixture();
    expect(portalUrl(catalog.storage.resourceId)).toBe(
      `https://portal.azure.com/#@${environment.tenantId}/resource${catalog.storage.resourceId}/overview`,
    );
  });
});

describe("Easy Auth", () => {
  it("přijme pouze přihlášeného Entra uživatele", () => {
    expect(parseUser(userFixture())).toBe("Testovací účastník");
    expect(() => parseUser({ clientPrincipal: null })).toThrow("přihlaste");
    const anonymous = userFixture();
    anonymous.clientPrincipal.userRoles = ["anonymous"];
    expect(() => parseUser(anonymous)).toThrow("přihlaste");
    const github = userFixture();
    github.clientPrincipal.identityProvider = "github";
    expect(() => parseUser(github)).toThrow("přihlaste");
  });

  it("odmítne tenant claim jiného tenantu", () => {
    const user = userFixture();
    user.clientPrincipal.claims[0]!.val = "jiný-tenant";
    expect(() => parseUser(user)).toThrow("nepatří");
  });

  it("konfiguruje jen konkrétní tenant a chrání také JSON i assety", () => {
    const config = JSON.parse(readFileSync(new URL("../public/staticwebapp.config.json", import.meta.url), "utf8"));
    expect(Object.keys(config.auth.identityProviders)).toEqual(["azureActiveDirectory"]);
    expect(config.auth.identityProviders.azureActiveDirectory.registration.openIdIssuer).toBe(
      `https://login.microsoftonline.com/${environment.tenantId}/v2.0`,
    );
    expect(config.routes).toEqual([{ route: "/*", allowedRoles: ["authenticated"] }]);
    expect(config.navigationFallback).toBeUndefined();
    expect(config.globalHeaders["Cache-Control"]).toContain("no-store");
    expect(config.globalHeaders["Content-Security-Policy"]).toContain("script-src 'self'");
    expect(config.globalHeaders["Content-Security-Policy"]).not.toContain("unsafe-inline");
  });
});
