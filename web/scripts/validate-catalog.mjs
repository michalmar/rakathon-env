import { readFile, readdir } from "node:fs/promises";
import { environment, parseCatalog, parseCatalogKeys } from "../src/catalog.ts";

try {
  const catalog = parseCatalog(JSON.parse(await readFile(new URL("../public/catalog.json", import.meta.url), "utf8")));
  const publicFiles = await readdir(new URL("../public/", import.meta.url));
  if (catalog.foundry.keyIncluded || publicFiles.includes("catalog-keys.json")) {
    parseCatalogKeys(JSON.parse(await readFile(new URL("../public/catalog-keys.json", import.meta.url), "utf8")), catalog);
  }
  const config = JSON.parse(await readFile(new URL("../public/staticwebapp.config.json", import.meta.url), "utf8"));
  const provider = config.auth?.identityProviders?.azureActiveDirectory?.registration;
  if (
    provider?.openIdIssuer !== `https://login.microsoftonline.com/${environment.tenantId}/v2.0` ||
    Object.keys(config.auth.identityProviders).length !== 1 ||
    config.navigationFallback ||
    config.routes?.length !== 1 || config.routes[0].route !== "/*" ||
    config.routes[0].allowedRoles?.length !== 1 || config.routes[0].allowedRoles[0] !== "authenticated" ||
    !config.globalHeaders?.["Cache-Control"]?.includes("no-store")
  ) throw new Error("SWA konfigurace nechrání celý statický katalog správným tenantem.");
  console.log("Snapshot a tenant-specific ochrana statických souborů jsou připravené.");
} catch (error) {
  console.error(`Build zastaven: ${error.message}\nPřed buildem spusťte npm run catalog:refresh (případně catalog:refresh:keys).`);
  process.exitCode = 1;
}
