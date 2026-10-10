import { execFileSync, spawnSync } from "node:child_process";
import { arch, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { environment } from "../src/catalog.ts";
import { runAzure } from "./export-catalog.mjs";

try {
  const terraformDirectory = fileURLToPath(new URL("../../infra/rakathon-env/shared/", import.meta.url));
  const webDirectory = fileURLToPath(new URL("../", import.meta.url));
  const appName = execFileSync("terraform", [`-chdir=${terraformDirectory}`, "output", "-raw", "portal_name"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const site = runAzure([
    "staticwebapp", "show", "--name", appName, "--resource-group", environment.resourceGroup,
    "--subscription", environment.subscriptionId,
  ]);
  if (site.sku?.name !== "Standard") throw new Error("Tenant-specific Easy Auth vyžaduje SWA Standard.");
  const secrets = runAzure([
    "staticwebapp", "secrets", "list", "--name", appName, "--resource-group", environment.resourceGroup,
    "--subscription", environment.subscriptionId,
  ]);
  const token = secrets.properties?.apiKey;
  if (typeof token !== "string" || token.length === 0) throw new Error("SWA nevrátilo deployment token.");
  const result = platform() === "darwin" && arch() === "arm64"
    ? spawnSync("docker", [
      "run", "--rm", "--platform", "linux/amd64",
      "-e", "DEPLOYMENT_TOKEN",
      "-e", "DEPLOYMENT_ACTION=upload",
      "-e", "DEPLOYMENT_PROVIDER=SwaCli",
      "-e", "REPOSITORY_BASE=/workspace",
      "-e", "SKIP_APP_BUILD=true",
      "-e", "SKIP_API_BUILD=true",
      "-e", "APP_LOCATION=/workspace/dist",
      "-e", "CONFIG_FILE_LOCATION=/workspace/public",
      "-e", "VERBOSE=false",
      "-e", "FUNCTION_LANGUAGE=node",
      "-e", "FUNCTION_LANGUAGE_VERSION=22",
      "-v", `${webDirectory}:/workspace:ro`,
      "--entrypoint", "/bin/staticsites/StaticSitesClient",
      "mcr.microsoft.com/appsvc/staticappsclient:stable",
    ], {
      cwd: webDirectory,
      env: { ...process.env, DEPLOYMENT_TOKEN: token },
      stdio: "inherit",
    })
    : spawnSync("npm", [
      "exec", "--no", "--", "swa", "deploy", "dist", "--env", "production", "--no-use-keychain",
    ], {
      cwd: webDirectory,
      env: { ...process.env, SWA_CLI_DEPLOYMENT_TOKEN: token, SWA_CLI_TELEMETRY_OPTOUT: "true" },
      stdio: "inherit",
    });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Publikování SWA selhalo (exit ${result.status}).`);
  console.log(`Portál publikován: https://${site.defaultHostname}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
