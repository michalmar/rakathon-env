import { environment, resourceId, type Catalog } from "../src/catalog";
import type { Spend } from "../src/spend";

export function catalogFixture(): Catalog {
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-09T08:00:00.000Z",
    tenantId: environment.tenantId,
    subscriptionId: environment.subscriptionId,
    resourceGroup: environment.resourceGroup,
    foundry: {
      name: environment.foundryAccount,
      resourceId: resourceId("Microsoft.CognitiveServices/accounts", environment.foundryAccount),
      location: "swedencentral",
      models: [
        { deployment: "test-model-one", model: "Testovací model 1", version: "1", format: "OpenAI", state: "Succeeded", sku: "DataZoneStandard", capacity: 10 },
        { deployment: "test-model-two", model: "Testovací model 2", version: "2", format: "xAI", state: "Succeeded", sku: "GlobalStandard", capacity: 20 },
      ],
    },
    gateway: {
      name: environment.gatewayService,
      resourceId: resourceId("Microsoft.ApiManagement/service", environment.gatewayService),
      endpoint: `https://${environment.gatewayService}.azure-api.net/openai/v1/`,
    },
    storage: {
      name: environment.storageAccount,
      resourceId: resourceId("Microsoft.Storage/storageAccounts", environment.storageAccount),
      container: environment.container,
      sharedKeyAccessEnabled: false,
      files: [
        { name: "ukazkova-data.csv", size: 1024, lastModified: "2026-10-09T06:00:00.000Z", contentType: "text/csv" },
        { name: "ukazkovy-popis.docx", size: 2048, lastModified: "2026-10-09T06:00:00.000Z", contentType: "application/octet-stream" },
        { name: "ukazkovy-archiv.zip", size: 4096, lastModified: "2026-10-09T06:00:00.000Z", contentType: "application/zip" },
      ],
    },
  };
}

export function userFixture() {
  const claims: { typ: string; val: string }[] = [{ typ: "tid", val: environment.tenantId }];
  return {
    clientPrincipal: {
      identityProvider: "aad",
      userId: "test-user",
      userDetails: "Testovací účastník",
      userRoles: ["anonymous", "authenticated"],
      claims,
    },
  };
}

export function spendFixture(): Spend {
  const now = new Date().toISOString();
  return {
    generatedAt: now, windowStart: "2026-10-10T00:00:00Z", lastUsageAt: now, lastSnapshotAt: now,
    enforcementEnabled: true, warnPct: 90,
    summary: { costUsd: 1200.25, teamCostUsd: 1200, otherCostUsd: 0.25, budgetUsd: 5000, revokeAtUsd: 4800, pct: 24.005, budgetExceeded: false },
    teams: [
      { team: "team07", state: "active", costUsd: 1200, budgetUsd: 1000, pct: 120, budgetExceeded: true, warning: true, blockedByOverall: false },
      { team: "team08", state: "suspended", costUsd: 0, budgetUsd: 1000, pct: 0, budgetExceeded: false, warning: false, blockedByOverall: false },
    ],
    models: [{ deployment: "test-model-one", costUsd: 1200.25, teamCostUsd: 1200, otherCostUsd: 0.25, requests: 12, promptTokens: 10000, completionTokens: 5000, images: 0 }],
    usage: [{ team: "team07", deployment: "test-model-one", costUsd: 1200, requests: 11, promptTokens: 9900, completionTokens: 4900, images: 0 },
      { team: "ops-test", deployment: "test-model-one", costUsd: 0.25, requests: 1, promptTokens: 100, completionTokens: 100, images: 0 }],
    hourly: [{ at: new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString(), team: "team07", deployment: "test-model-one", costUsd: 12 }],
  };
}

export function interactiveSpendFixture(): Spend {
  const data = spendFixture();
  const hour = data.hourly[0]!.at;
  data.usage = [
    { team: "team07", deployment: "test-model-one", costUsd: 10, requests: 2, promptTokens: 100, completionTokens: 20, images: 0 },
    { team: "team08", deployment: "test-model-one", costUsd: 2, requests: 10, promptTokens: 30, completionTokens: 10, images: 0 },
    { team: "ops-test", deployment: "test-model-one", costUsd: 0.25, requests: 1, promptTokens: 10, completionTokens: 5, images: 0 },
    { team: "team07", deployment: "test-model-two", costUsd: 100, requests: 100, promptTokens: 1000, completionTokens: 200, images: 0 },
    { team: "team08", deployment: "test-model-two", costUsd: 30, requests: 9, promptTokens: 300, completionTokens: 100, images: 0 },
    { team: "ops-test", deployment: "old-model", costUsd: 3, requests: 20, promptTokens: 500, completionTokens: 150, images: 1 },
  ];
  data.models = [
    { deployment: "test-model-one", costUsd: 12.25, teamCostUsd: 12, otherCostUsd: 0.25, requests: 13, promptTokens: 140, completionTokens: 35, images: 0 },
    { deployment: "test-model-two", costUsd: 130, teamCostUsd: 130, otherCostUsd: 0, requests: 109, promptTokens: 1300, completionTokens: 300, images: 0 },
    { deployment: "old-model", costUsd: 3, teamCostUsd: 0, otherCostUsd: 3, requests: 20, promptTokens: 500, completionTokens: 150, images: 1 },
  ];
  data.teams = [
    { team: "team07", state: "active", costUsd: 110, budgetUsd: 100, pct: 110, budgetExceeded: true, warning: true, blockedByOverall: false },
    { team: "team08", state: "suspended", costUsd: 32, budgetUsd: 1000, pct: 3.2, budgetExceeded: false, warning: false, blockedByOverall: false },
    { team: "team09", state: "active", costUsd: 0, budgetUsd: 1000, pct: 0, budgetExceeded: false, warning: false, blockedByOverall: false },
  ];
  data.summary = { ...data.summary, costUsd: 145.25, teamCostUsd: 142, otherCostUsd: 3.25, pct: 2.905 };
  data.hourly = [
    { at: hour, team: "team07", deployment: "test-model-one", costUsd: 12 },
    { at: hour, team: "team08", deployment: "test-model-two", costUsd: 3 },
    { at: hour, team: "ops-test", deployment: "old-model", costUsd: 4 },
  ];
  return data;
}
