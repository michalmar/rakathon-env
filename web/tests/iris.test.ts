import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { generateIrisPassword, irisDeployment, irisImage, irisTeam, validContainerName } from "../src/iris";

const team = irisTeam("team07@example.onmicrosoft.com")!;

describe("týmový návod IRIS", () => {
  it("určí pouze přesný týmový UPN, nikoli display name nebo cizí název", () => {
    expect(irisTeam("TEAM07@EXAMPLE.ONMICROSOFT.COM")).toEqual(team);
    expect(team.resourceGroup).toBe("rg-team07");
    expect(team.containerName).toBe("aci-irishealth-team07");
    for (const user of ["Lokální náhled", "team07", "team7@example.com", "ops@example.com", "team07@example.com;echo bad", "team07@example.com\n"]) {
      expect(irisTeam(user)).toBeNull();
    }
  });

  it("vytvoří silné, odlišné heslo pomocí Web Crypto", () => {
    const passwords = new Set(Array.from({ length: 100 }, generateIrisPassword));
    expect(passwords.size).toBe(100);
    for (const password of passwords) {
      expect(password).toHaveLength(32);
      expect(password).toMatch(/^Ir1![A-Za-z0-9_-]{28}$/);
    }
  });

  it("validuje délku a syntaxi ACI názvu a odmítá shell injection", () => {
    for (const name of ["a", "iris-07", "a".repeat(63)]) expect(validContainerName(name)).toBe(true);
    for (const name of ["", "0iris", "IRIS", "-iris", "iris-", "a".repeat(64), "iris;echo bad", "iris\n"]) {
      expect(validContainerName(name)).toBe(false);
      expect(() => irisDeployment(team, name)).toThrow();
    }
    expect(() => irisDeployment({ ...team, resourceGroup: "rg-rakathon-shared" }, team.containerName)).toThrow();
  });

  it("zobrazí pouze create příkaz s pevným regionem bez osobní konfigurace a kontrol", () => {
    const deploy = irisDeployment(team, team.containerName);
    expect(deploy.startsWith("az container create \\\n")).toBe(true);
    expect(deploy.match(/\baz\b/g)).toHaveLength(1);
    expect(deploy).toContain('--resource-group "rg-team07"');
    expect(deploy).toContain('--name "aci-irishealth-team07"');
    expect(deploy).toContain("--location swedencentral");
    expect(deploy).toContain(irisImage);
    expect(deploy).toContain("--cpu 2 --memory 2 --restart-policy Never");
    expect(deploy).toContain("--ports 1972 52773");
    expect(deploy).toContain('--secrets "iris-password=$IRIS_PASSWORD"');
    expect(deploy).toContain("--password-file /mnt/secrets/iris-password");
    expect(deploy).not.toMatch(/AZURE_CONFIG_DIR|azure-rak|subscription|tenant|az login|az group|read |if |set |unset |base64|registry-password|--debug|--output none/);
    const result = spawnSync("bash", ["-n"], { input: deploy, encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("předvyplní skutečný tým a upravený název bez pevných team07 hodnot", () => {
    for (const number of ["01", "19", "42"]) {
      const other = irisTeam(`team${number}@example.onmicrosoft.com`)!;
      const deploy = irisDeployment(other, `iris-demo-${number}`);
      expect(deploy).toContain(`--resource-group "rg-team${number}"`);
      expect(deploy).toContain(`--name "iris-demo-${number}"`);
      expect(deploy).not.toContain("team07");
    }
  });

  it("předá uživatelem nastavené heslo jako jediný secret argument bez dalšího kódu", () => {
    const secret = "Test!password with spaces=$value";
    const result = spawnSync("bash", ["-c", `az() { printf '%s\\n' "$@"; }\n${irisDeployment(team, team.containerName)}`], {
      encoding: "utf8",
      env: { ...process.env, IRIS_PASSWORD: secret },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const args = result.stdout.trim().split("\n");
    expect(args.slice(0, 2)).toEqual(["container", "create"]);
    expect(args[args.indexOf("--secrets") + 1]).toBe(`iris-password=${secret}`);
  });
});
