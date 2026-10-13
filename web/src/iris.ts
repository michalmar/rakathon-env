export const irisImage = "intersystems/irishealth-community@sha256:aad59884bdd89ee21c8cb059937c6b9b26947457641e5e04adecb68754376c6c";

export interface IrisTeam {
  team: string;
  user: string;
  resourceGroup: string;
  containerName: string;
}

export function irisTeam(user: string): IrisTeam | null {
  const match = /^(team\d{2})@([a-z0-9.-]+)$/i.exec(user);
  if (!match || match[0] !== user) return null;
  const team = match[1]!.toLowerCase();
  return { team, user: user.toLowerCase(), resourceGroup: `rg-${team}`, containerName: `aci-irishealth-${team}` };
}

export function generateIrisPassword(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = crypto.getRandomValues(new Uint8Array(28));
  return `Ir1!${Array.from(bytes, (byte) => alphabet[byte & 63]).join("")}`;
}

export function validContainerName(name: string): boolean {
  return /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.exec(name)?.[0] === name;
}

function validate(team: IrisTeam, name: string): void {
  const expected = irisTeam(team.user);
  if (!expected || expected.team !== team.team || expected.resourceGroup !== team.resourceGroup || !validContainerName(name)) {
    throw new Error("Neplatný tým nebo název kontejneru.");
  }
}

export function irisDeployment(team: IrisTeam, name: string): string {
  validate(team, name);
  return [
    "az container create \\",
    `  --resource-group "${team.resourceGroup}" \\`,
    `  --name "${name}" \\`,
    "  --location swedencentral \\",
    `  --image "${irisImage}" \\`,
    "  --os-type Linux --cpu 2 --memory 2 --restart-policy Never \\",
    "  --ip-address Public --ports 1972 52773 --protocol TCP \\",
    '  --secrets "iris-password=$IRIS_PASSWORD" \\',
    "  --secrets-mount-path /mnt/secrets \\",
    '  --command-line "/iris-main --password-file /mnt/secrets/iris-password"',
  ].join("\n");
}
