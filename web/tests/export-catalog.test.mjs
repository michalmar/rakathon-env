import { describe, expect, it, vi } from "vitest";
import { createSnapshot } from "../scripts/export-catalog.mjs";
import { environment, resourceId } from "../src/catalog.ts";

function azureFixture({ localAuth = false, tenantId = environment.tenantId } = {}) {
  return vi.fn((args) => {
    if (args[0] === "account") return { id: environment.subscriptionId, tenantId };
    if (args.includes("deployment")) return [{
      name: "test-deployment",
      properties: { model: { name: "test-model", version: "1", format: "OpenAI" }, provisioningState: "Succeeded" },
      sku: { name: "DataZoneStandard", capacity: 10 },
    }];
    if (args.includes("keys")) return { key1: "test-only-not-a-real-credential" };
    if (args[0] === "cognitiveservices") return {
      name: environment.foundryAccount,
      id: resourceId("Microsoft.CognitiveServices/accounts", environment.foundryAccount),
      location: "swedencentral",
      properties: {
        disableLocalAuth: !localAuth,
        endpoints: { "OpenAI Language Model Instance API": `https://${environment.foundryAccount}.openai.azure.com/` },
      },
    };
    if (args[1] === "account") return {
      name: environment.storageAccount,
      id: resourceId("Microsoft.Storage/storageAccounts", environment.storageAccount),
      allowSharedKeyAccess: false,
    };
    if (args[1] === "blob") return [
      { name: "test.csv", size: 42, lastModified: "2026-10-09T06:00:00+00:00", contentType: "text/csv" },
    ];
    throw new Error("Neočekávaný Azure příkaz v testu.");
  });
}

describe("jednorázový Azure export", () => {
  it("používá Entra ID, všechny bloby a explicitní subscription; nemění Azure", () => {
    const run = azureFixture();
    const { catalog, keys } = createSnapshot(run, true, "2026-10-09T08:00:00.000Z");
    expect(catalog.foundry.models).toHaveLength(1);
    expect(catalog.storage.files[0].lastModified).toBe("2026-10-09T06:00:00.000Z");
    expect(keys.apiKey).toBeNull();
    for (const [args] of run.mock.calls) {
      expect(args).toContain("--subscription");
      expect(args).toContain(environment.subscriptionId);
      expect(args.some((arg) => ["create", "update", "delete", "generate-sas", "download"].includes(arg))).toBe(false);
      expect(args).not.toContain("keys");
    }
    const blobArgs = run.mock.calls.find(([args]) => args.includes("blob"))[0];
    expect(blobArgs).toContain("--auth-mode");
    expect(blobArgs).toContain("login");
    expect(blobArgs).toContain("--num-results");
    expect(blobArgs).toContain("*");
  });

  it("neexportuje klíče bez explicitního opt-in", () => {
    const run = azureFixture({ localAuth: true });
    const { catalog, keys } = createSnapshot(run);
    expect(catalog.foundry.keyAuthenticationEnabled).toBe(true);
    expect(catalog.foundry.keyIncluded).toBe(false);
    expect(keys.apiKey).toBeNull();
    expect(run.mock.calls.some(([args]) => args.includes("keys"))).toBe(false);
  });

  it("oddělí explicitně vyžádaný klíč od metadat", () => {
    const run = azureFixture({ localAuth: true });
    const { catalog, keys } = createSnapshot(run, true);
    expect(catalog.foundry.keyIncluded).toBe(true);
    expect(keys.apiKey).toBe("test-only-not-a-real-credential");
    expect(JSON.stringify(catalog)).not.toContain(keys.apiKey);
    expect(run.mock.calls.filter(([args]) => args.includes("keys"))).toHaveLength(1);
  });

  it("zastaví export při jiném tenantu nebo chybě Azure místo neúplného snapshotu", () => {
    const wrongTenant = azureFixture({ tenantId: "jiný-tenant" });
    expect(() => createSnapshot(wrongTenant)).toThrow("jiný tenant");
    expect(wrongTenant).toHaveBeenCalledTimes(1);
    const denied = () => { throw new Error("Azure odmítlo přístup"); };
    expect(() => createSnapshot(denied)).toThrow("odmítlo");
  });
});
