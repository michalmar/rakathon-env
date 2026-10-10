import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { environment, parseCatalog } from "../src/catalog.ts";

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));

export function runAzure(args) {
  const command = [...args, "--only-show-errors", "--output", "json"];
  let output;
  try {
    output = execFileSync("az", command, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
      env: {
        ...process.env,
        AZURE_CONFIG_DIR: process.env.AZURE_CONFIG_DIR || join(homedir(), ".azure-rak"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = typeof error.stderr === "string" ? error.stderr.trim() : error.message;
    throw new Error(`Azure CLI: ${args.slice(0, 4).join(" ")} selhalo.\n${detail}`);
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Azure CLI nevrátilo platný JSON. Export nebyl uložen.");
  }
}

export function createSnapshot(run = runAzure, generatedAt = new Date().toISOString()) {
  const subscription = ["--subscription", environment.subscriptionId];
  const account = run(["account", "show", ...subscription, "--query", "{id:id,tenantId:tenantId}"]);
  if (account.id !== environment.subscriptionId || account.tenantId !== environment.tenantId) {
    throw new Error("Azure CLI používá jiný tenant nebo subscription. Export byl zastaven.");
  }
  const foundry = run([
    "cognitiveservices", "account", "show", "--name", environment.foundryAccount,
    "--resource-group", environment.resourceGroup, ...subscription,
  ]);
  const deployments = run([
    "cognitiveservices", "account", "deployment", "list", "--name", environment.foundryAccount,
    "--resource-group", environment.resourceGroup, ...subscription,
  ]);
  const storage = run([
    "storage", "account", "show", "--name", environment.storageAccount,
    "--resource-group", environment.resourceGroup, ...subscription,
  ]);
  const files = run([
    "storage", "blob", "list", "--account-name", environment.storageAccount,
    "--container-name", environment.container, "--auth-mode", "login", "--num-results", "*",
    ...subscription, "--query",
    "[].{name:name,size:properties.contentLength,lastModified:properties.lastModified,contentType:properties.contentSettings.contentType}",
  ]);

  const apim = run([
    "apim", "show", "--name", environment.gatewayService,
    "--resource-group", environment.resourceGroup, ...subscription,
  ]);
  if (typeof apim.gatewayUrl !== "string") throw new Error("APIM nevrátilo gateway URL. Export nebyl uložen.");
  const catalog = parseCatalog({
    schemaVersion: 1,
    generatedAt,
    tenantId: account.tenantId,
    subscriptionId: account.id,
    resourceGroup: environment.resourceGroup,
    foundry: {
      name: foundry.name,
      resourceId: foundry.id,
      location: foundry.location,
      models: deployments.map((deployment) => ({
        deployment: deployment.name,
        model: deployment.properties?.model?.name,
        version: deployment.properties?.model?.version,
        format: deployment.properties?.model?.format,
        state: deployment.properties?.provisioningState,
        sku: deployment.sku?.name,
        capacity: deployment.sku?.capacity,
      })).sort((a, b) => a.deployment.localeCompare(b.deployment)),
    },
    gateway: {
      name: apim.name,
      resourceId: apim.id,
      endpoint: new URL("openai/v1/", apim.gatewayUrl).href,
    },
    storage: {
      name: storage.name,
      resourceId: storage.id,
      container: environment.container,
      sharedKeyAccessEnabled: storage.allowSharedKeyAccess,
      files: files.map((file) => ({
        ...file,
        lastModified: new Date(file.lastModified).toISOString(),
      })).sort((a, b) => a.name.localeCompare(b.name, "cs")),
    },
  });
  return { catalog };
}

async function atomicWrite(path, value) {
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${randomUUID()}`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Použití: node scripts/export-catalog.mjs\nPouze čte Azure; soubory, klíče ani SAS odkazy nestahuje.");
    return;
  }
  if (args.length > 0) throw new Error("Neznámý argument. Použijte --help.");
  const { catalog } = createSnapshot(runAzure);
  await mkdir(publicDirectory, { recursive: true });
  await atomicWrite(join(publicDirectory, "catalog.json"), catalog);
  await unlink(join(publicDirectory, "catalog-keys.json")).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  console.log(`Katalog uložen: ${catalog.foundry.models.length} modelů, ${catalog.storage.files.length} souborů.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
