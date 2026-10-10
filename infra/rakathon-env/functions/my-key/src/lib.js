"use strict";

const TEAM_PATTERN = /^team\d{2}$/;
const TENANT_CLAIMS = new Set(["tid", "http://schemas.microsoft.com/identity/claims/tenantid"]);

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function parsePrincipal(header, tenantId) {
  if (!header) throw new HttpError(401, "unauthenticated");
  let principal;
  try {
    principal = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new HttpError(401, "unauthenticated");
  }
  if (
    typeof principal !== "object" || principal === null ||
    principal.identityProvider !== "aad" ||
    !Array.isArray(principal.userRoles) || !principal.userRoles.includes("authenticated") ||
    typeof principal.userDetails !== "string" || principal.userDetails.length === 0
  ) throw new HttpError(401, "unauthenticated");
  if (tenantId && Array.isArray(principal.claims)) {
    for (const claim of principal.claims) {
      if (claim && TENANT_CLAIMS.has(claim.typ) && claim.val !== tenantId) {
        throw new HttpError(401, "unauthenticated");
      }
    }
  }
  return principal;
}

function teamFromUpn(upn) {
  const at = upn.lastIndexOf("@");
  if (at <= 0) return null;
  const local = upn.slice(0, at).toLowerCase();
  return TEAM_PATTERN.test(local) ? local : null;
}

function teamFromPrincipalHeader(header, tenantId) {
  const principal = parsePrincipal(header, tenantId);
  const team = teamFromUpn(principal.userDetails);
  if (!team) throw new HttpError(404, "no-team");
  return team;
}

async function managedIdentityToken(env, fetchImpl) {
  const response = await fetchImpl(
    `${env.IDENTITY_ENDPOINT}?resource=${encodeURIComponent("https://management.azure.com/")}&api-version=2019-08-01`,
    { headers: { "X-IDENTITY-HEADER": env.IDENTITY_HEADER } },
  );
  if (!response.ok) throw new HttpError(502, "upstream-error");
  const body = await response.json();
  return body.access_token;
}

async function fetchTeamKey(team, env, fetchImpl = fetch) {
  const token = await managedIdentityToken(env, fetchImpl);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = `https://management.azure.com${env.APIM_ID}/subscriptions/${team}`;
  const meta = await fetchImpl(`${base}?api-version=2024-05-01`, { headers });
  if (meta.status === 404) throw new HttpError(404, "no-team");
  if (!meta.ok) throw new HttpError(502, "upstream-error");
  const subscription = (await meta.json()).properties ?? {};
  if (typeof subscription.scope !== "string" || !subscription.scope.toLowerCase().endsWith(`/products/${env.APIM_PRODUCT}`)) {
    throw new HttpError(404, "no-team");
  }
  const secrets = await fetchImpl(`${base}/listSecrets?api-version=2024-05-01`, { method: "POST", headers });
  if (!secrets.ok) throw new HttpError(502, "upstream-error");
  const { primaryKey } = await secrets.json();
  if (typeof primaryKey !== "string" || primaryKey.length === 0) throw new HttpError(502, "upstream-error");
  return { team, key: primaryKey, state: String(subscription.state ?? "unknown").toLowerCase(), baseUrl: env.APIM_BASE_URL };
}

async function myKey(headers, env, fetchImpl = fetch) {
  const team = teamFromPrincipalHeader(headers.get("x-ms-client-principal"), env.TENANT_ID);
  return fetchTeamKey(team, env, fetchImpl);
}

module.exports = { HttpError, parsePrincipal, teamFromUpn, teamFromPrincipalHeader, fetchTeamKey, myKey };
