export const environment = {
  tenantId: "7f0c84c5-bbea-48b2-bad1-6baf63d0c73c",
  subscriptionId: "83ae1511-eee9-469a-8c48-b9a9069b92e4",
  resourceGroup: "rg-rakathon-shared",
  foundryAccount: "ais-rakathon-q7146n",
  storageAccount: "strakathondataq7146n",
  container: "data",
} as const;

export interface ModelDeployment {
  deployment: string;
  model: string;
  version: string;
  format: "OpenAI" | "xAI" | "DeepSeek" | "Microsoft" | "MoonshotAI";
  state: string;
  sku: string;
  capacity: number;
}

export interface DataFile {
  name: string;
  size: number;
  lastModified: string;
  contentType: string;
}

export interface Catalog {
  schemaVersion: 1;
  generatedAt: string;
  tenantId: string;
  subscriptionId: string;
  resourceGroup: string;
  foundry: {
    name: string;
    resourceId: string;
    location: string;
    endpoint: string;
    keyAuthenticationEnabled: boolean;
    keyIncluded: boolean;
    models: ModelDeployment[];
  };
  storage: {
    name: string;
    resourceId: string;
    container: string;
    sharedKeyAccessEnabled: boolean;
    files: DataFile[];
  };
}

export interface CatalogKeys {
  schemaVersion: 1;
  generatedAt: string;
  foundryResourceId: string;
  apiKey: string | null;
}

function invalid(label: string): never {
  throw new Error(`Neplatný katalog: ${label}. Obnovte export dat.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, label: string, fields: string[]): Record<string, unknown> {
  if (!isRecord(value)) invalid(label);
  if (Object.keys(value).some((key) => !fields.includes(key))) invalid(`${label}: neznámé pole`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) invalid(label);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(label);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}

function date(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) invalid(label);
  return result;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(label);
  return value;
}

export function resourceId(provider: string, name: string): string {
  return `/subscriptions/${environment.subscriptionId}/resourceGroups/${environment.resourceGroup}/providers/${provider}/${name}`;
}

function expectedText(value: unknown, expected: string, label: string): string {
  if (value !== expected) invalid(label);
  return expected;
}

function endpoint(value: unknown): string {
  const input = text(value, "Foundry endpoint");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return invalid("Foundry endpoint");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== `${environment.foundryAccount}.openai.azure.com` ||
    url.pathname !== "/openai/v1/" ||
    url.username || url.password || url.port || url.search || url.hash
  ) invalid("Foundry endpoint");
  return url.href;
}

export function parseCatalog(value: unknown): Catalog {
  const root = object(value, "hlavička", [
    "schemaVersion", "generatedAt", "tenantId", "subscriptionId", "resourceGroup", "foundry", "storage",
  ]);
  if (root.schemaVersion !== 1) invalid("verze formátu");
  const foundry = object(root.foundry, "Foundry", [
    "name", "resourceId", "location", "endpoint", "keyAuthenticationEnabled", "keyIncluded", "models",
  ]);
  const storage = object(root.storage, "storage", [
    "name", "resourceId", "container", "sharedKeyAccessEnabled", "files",
  ]);
  const models = array(foundry.models, "modely").map((value): ModelDeployment => {
    const model = object(value, "model", [
      "deployment", "model", "version", "format", "state", "sku", "capacity",
    ]);
    const format = text(model.format, "formát modelu");
    if (!["OpenAI", "xAI", "DeepSeek", "Microsoft", "MoonshotAI"].includes(format)) {
      invalid("nepodporovaný formát modelu");
    }
    return {
      deployment: text(model.deployment, "název deploymentu"),
      model: text(model.model, "název modelu"),
      version: text(model.version, "verze modelu"),
      format: format as ModelDeployment["format"],
      state: text(model.state, "stav deploymentu"),
      sku: text(model.sku, "SKU deploymentu"),
      capacity: number(model.capacity, "kapacita deploymentu"),
    };
  });
  const files = array(storage.files, "soubory").map((value): DataFile => {
    const file = object(value, "soubor", ["name", "size", "lastModified", "contentType"]);
    return {
      name: text(file.name, "název souboru"),
      size: number(file.size, "velikost souboru"),
      lastModified: date(file.lastModified, "datum změny souboru"),
      contentType: text(file.contentType, "typ souboru"),
    };
  });
  if (new Set(models.map((model) => model.deployment)).size !== models.length) invalid("duplicitní deployment");
  if (new Set(files.map((file) => file.name)).size !== files.length) invalid("duplicitní soubor");
  const keyAuthenticationEnabled = boolean(foundry.keyAuthenticationEnabled, "autentizace klíčem");
  const keyIncluded = boolean(foundry.keyIncluded, "dostupnost klíče");
  if (keyIncluded && !keyAuthenticationEnabled) invalid("klíč při vypnuté klíčové autentizaci");
  return {
    schemaVersion: 1,
    generatedAt: date(root.generatedAt, "datum exportu"),
    tenantId: expectedText(root.tenantId, environment.tenantId, "tenant"),
    subscriptionId: expectedText(root.subscriptionId, environment.subscriptionId, "subscription"),
    resourceGroup: expectedText(root.resourceGroup, environment.resourceGroup, "resource group"),
    foundry: {
      name: expectedText(foundry.name, environment.foundryAccount, "Foundry resource"),
      resourceId: expectedText(foundry.resourceId, resourceId("Microsoft.CognitiveServices/accounts", environment.foundryAccount), "Foundry resource ID"),
      location: text(foundry.location, "region"),
      endpoint: endpoint(foundry.endpoint),
      keyAuthenticationEnabled,
      keyIncluded,
      models,
    },
    storage: {
      name: expectedText(storage.name, environment.storageAccount, "storage account"),
      resourceId: expectedText(storage.resourceId, resourceId("Microsoft.Storage/storageAccounts", environment.storageAccount), "storage resource ID"),
      container: expectedText(storage.container, environment.container, "container"),
      sharedKeyAccessEnabled: boolean(storage.sharedKeyAccessEnabled, "storage autentizace"),
      files,
    },
  };
}

export function parseCatalogKeys(value: unknown, catalog: Catalog): CatalogKeys {
  const root = object(value, "export klíče", [
    "schemaVersion", "generatedAt", "foundryResourceId", "apiKey",
  ]);
  if (root.schemaVersion !== 1) invalid("verze exportu klíče");
  expectedText(root.generatedAt, catalog.generatedAt, "klíč a katalog jsou z různých exportů");
  expectedText(root.foundryResourceId, catalog.foundry.resourceId, "resource ID klíče");
  const apiKey = root.apiKey === null ? null : text(root.apiKey, "API klíč");
  if (Boolean(apiKey) !== catalog.foundry.keyIncluded) invalid("dostupnost exportovaného klíče");
  return {
    schemaVersion: 1,
    generatedAt: catalog.generatedAt,
    foundryResourceId: catalog.foundry.resourceId,
    apiKey,
  };
}

export function portalUrl(id: string): string {
  return `https://portal.azure.com/#@${environment.tenantId}/resource${id}/overview`;
}

export function formatSize(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(bytes / 1024 ** index)} ${units[index]}`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
