import { environment, resourceId, type Catalog } from "../src/catalog";

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
