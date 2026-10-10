"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { teamFromUpn, teamFromPrincipalHeader, myKey } = require("../src/lib");

const TENANT = "7f0c84c5-bbea-48b2-bad1-6baf63d0c73c";

function header(overrides = {}) {
  const principal = {
    identityProvider: "aad",
    userId: "u",
    userDetails: "team07@contoso.onmicrosoft.com",
    userRoles: ["anonymous", "authenticated"],
    claims: [{ typ: "tid", val: TENANT }],
    ...overrides,
  };
  return Buffer.from(JSON.stringify(principal)).toString("base64");
}

function status(fn) {
  try { fn(); } catch (error) { return error.status; }
  return 200;
}

test("UPN -> team", () => {
  assert.equal(teamFromUpn("team07@x.com"), "team07");
  assert.equal(teamFromUpn("TEAM12@x.com"), "team12");
  for (const bad of ["ops-test@x.com", "team7@x.com", "team123@x.com", "teamzz@x.com", "xteam07@x.com", "team07", "@x.com", "team07_a@x.com"]) {
    assert.equal(teamFromUpn(bad), null, bad);
  }
});

test("principal validation", () => {
  assert.equal(teamFromPrincipalHeader(header(), TENANT), "team07");
  assert.equal(status(() => teamFromPrincipalHeader(undefined, TENANT)), 401);
  assert.equal(status(() => teamFromPrincipalHeader("%%%", TENANT)), 401);
  assert.equal(status(() => teamFromPrincipalHeader(header({ userRoles: ["anonymous"] }), TENANT)), 401);
  assert.equal(status(() => teamFromPrincipalHeader(header({ identityProvider: "github" }), TENANT)), 401);
  assert.equal(status(() => teamFromPrincipalHeader(header({ claims: [{ typ: "tid", val: "other" }] }), TENANT)), 401);
  assert.equal(status(() => teamFromPrincipalHeader(header({ userDetails: "organizer@x.com" }), TENANT)), 404);
});

const env = {
  IDENTITY_ENDPOINT: "http://msi", IDENTITY_HEADER: "h",
  APIM_ID: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.ApiManagement/service/apim",
  APIM_PRODUCT: "hackathon", APIM_BASE_URL: "https://apim/openai/v1", TENANT_ID: TENANT,
};

function fakeFetch(subscription) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    const json = (code, body) => ({ ok: code < 400, status: code, json: async () => body });
    if (url.startsWith("http://msi")) return json(200, { access_token: "tok" });
    if (url.includes("/listSecrets")) return json(200, { primaryKey: "k-primary", secondaryKey: "k-secondary" });
    return subscription ? json(200, subscription) : json(404, {});
  };
  return { impl, calls };
}

const request = () => new Map([["x-ms-client-principal", header()]]);

test("returns primary key of the team's own subscription", async () => {
  const { impl, calls } = fakeFetch({ properties: { scope: `${env.APIM_ID}/products/hackathon`, state: "active" } });
  const result = await myKey(request(), env, impl);
  assert.deepEqual(result, { team: "team07", key: "k-primary", state: "active", baseUrl: env.APIM_BASE_URL });
  assert.ok(calls.some((c) => c.url.includes("/subscriptions/team07/listSecrets") && c.method === "POST"));
});

test("suspended passes through; foreign product and missing subscription are no-team", async () => {
  const suspended = fakeFetch({ properties: { scope: `${env.APIM_ID}/products/hackathon`, state: "suspended" } });
  assert.equal((await myKey(request(), env, suspended.impl)).state, "suspended");
  const other = fakeFetch({ properties: { scope: `${env.APIM_ID}/products/other`, state: "active" } });
  await assert.rejects(myKey(request(), env, other.impl), { status: 404 });
  await assert.rejects(myKey(request(), env, fakeFetch(null).impl), { status: 404 });
});
