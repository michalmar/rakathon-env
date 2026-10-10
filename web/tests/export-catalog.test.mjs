import { describe, expect, it, vi } from "vitest";
import { createSnapshot } from "../scripts/export-catalog.mjs";
import { environment, resourceId } from "../src/catalog.ts";

function azureFixture({ tenantId = environment.tenantId } = {}) {
  return vi.fn((args) => {
    if (args[0] === "account") return { id: environment.subscriptionId, tenantId };
    if (args.includes("deployment")) return [{
      name: "test-deployment",
      properties: { model: { name: "test-model", version: "1", format: "OpenAI" }, provisioningState: "Succeeded" },
      sku: { name: "DataZoneStandard", capacity: 10 },
    }];
    if (args[0] === "apim") return {
      name: environment.gatewayService,
      id: resourceId("Microsoft.ApiManagement/service", environment.gatewayService),
      gatewayUrl: `https://${environment.gatewayService}.azure-api.net`,
    };
    if (args[0] === "cognitiveservices") return {
      name: environment.foundryAccount,
      id: resourceId("Microsoft.CognitiveServices/accounts", environment.foundryAccount),
      location: "swedencentral",
      properties: {
        disableLocalAuth: true,
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
    const { catalog } = createSnapshot(run, "2026-10-09T08:00:00.000Z");
    expect(catalog.foundry.models).toHaveLength(1);
    expect(catalog.gateway.endpoint).toBe(`https://${environment.gatewayService}.azure-api.net/openai/v1/`);
    expect(catalog.storage.files[0].lastModified).toBe("2026-10-09T06:00:00.000Z");
    for (const [args] of run.mock.calls) {
      expect(args).toContain("--subscription");
      expect(args).toContain(environment.subscriptionId);
      expect(args.some((arg) => ["create", "update", "delete", "generate-sas", "download"].includes(arg))).toBe(false);
    }
    const blobArgs = run.mock.calls.find(([args]) => args.includes("blob"))[0];
    expect(blobArgs).toContain("--auth-mode");
    expect(blobArgs).toContain("login");
    expect(blobArgs).toContain("--num-results");
    expect(blobArgs).toContain("*");
  });

  it("nikdy nečte ani nezapisuje žádné klíče ani subscription secrets", () => {
    const run = azureFixture();
    const { catalog } = createSnapshot(run);
    expect(Object.keys(catalog)).not.toContain("keys");
    expect(run.mock.calls.some(([args]) => args.includes("keys") || args.includes("listSecrets"))).toBe(false);
    expect(JSON.stringify(catalog)).not.toMatch(/api.?key/i);
  });

  it("zastaví export při jiném tenantu nebo chybě Azure místo neúplného snapshotu", () => {
    const wrongTenant = azureFixture({ tenantId: "jiný-tenant" });
    expect(() => createSnapshot(wrongTenant)).toThrow("jiný tenant");
    expect(wrongTenant).toHaveBeenCalledTimes(1);
    const denied = () => { throw new Error("Azure odmítlo přístup"); };
    expect(() => createSnapshot(denied)).toThrow("odmítlo");
  });
});
