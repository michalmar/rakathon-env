"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { authorizeSpend, buildSpend, spend, QUERY } = require("../src/spend");

const env = {
  TENANT_ID: "test-tenant", IDENTITY_ENDPOINT: "http://msi", IDENTITY_HEADER: "test",
  APIM_ID: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.ApiManagement/service/apim",
  APIM_PRODUCT: "hackathon", LOG_ANALYTICS_WORKSPACE_ID: "workspace",
};
const now = new Date("2026-10-13T10:00:00Z");

function headers(user = "organizer@example.com", overrides = {}) {
  return new Map([["x-ms-client-principal", Buffer.from(JSON.stringify({
    identityProvider: "aad", userDetails: user, userRoles: ["authenticated"],
    claims: [{ typ: "tid", val: env.TENANT_ID }], ...overrides,
  })).toString("base64")]]);
}

function rows() {
  return [
    { kind: "config", data: {
      DefaultTeamBudgetUsd: 1000, OverallBudgetUsd: 5000, OverallRevokeAtUsd: 4800, WarnPct: 90,
      EnforcementEnabled: false, WindowStart: "2026-10-10T00:00:00Z", TeamBudgetOverrides: { team07: 2000 },
    } },
    { kind: "status", data: { Scope: "overall", Revoke: false } },
    { kind: "usage", data: { Team: "team07", DeploymentName: "model-a", CostUsd: 1900.12345, Requests: 2, PromptTokens: 100, CompletionTokens: 200, Images: 0 } },
    { kind: "usage", data: { Team: "ops-test", DeploymentName: "model-a", CostUsd: 0.004, Requests: 1, PromptTokens: 10, CompletionTokens: 20, Images: 0 } },
    { kind: "usage", data: { Team: "team09", DeploymentName: "image-model", CostUsd: 0.2, Requests: 1, PromptTokens: 0, CompletionTokens: 0, Images: 1 } },
    { kind: "hourly", data: { TimeGenerated: "2026-10-13T09:00:00Z", Team: "team07", DeploymentName: "model-a", CostUsd: 0.01 } },
    { kind: "freshness", data: { LastUsage: "2026-10-13T09:58:00Z" } },
    { kind: "snapshot", data: { LastSnapshot: "2026-10-13T09:55:00Z" } },
  ];
}
const roster = [{ team: "team07", state: "active" }, { team: "team08", state: "suspended" }];

test("only authenticated non-team principals can query spend", async () => {
  assert.equal(authorizeSpend(headers(), env).userDetails, "organizer@example.com");
  assert.equal(authorizeSpend(headers("team7@example.com"), env).userDetails, "team7@example.com");
  for (const user of ["team07@example.com", "TEAM07@example.com"]) {
    await assert.rejects(spend(headers(user), env, () => assert.fail("Azure must not be called")), { status: 403 });
  }
  for (const request of [new Map(), headers("x@example.com", { identityProvider: "github" }),
    headers("x@example.com", { userRoles: ["anonymous"] }),
    headers("x@example.com", { claims: [{ typ: "tid", val: "foreign" }] })]) {
    await assert.rejects(spend(request, env, () => assert.fail("Azure must not be called")), { status: 401 });
  }
});

test("roster includes zero usage, budgets and actual state are independent, operations stay separate", () => {
  const result = buildSpend(rows(), roster, now);
  const used = result.teams.find((item) => item.team === "team07");
  assert.equal(used.budgetUsd, 2000);
  assert.equal(used.costUsd, 1900.12345);
  assert.equal(used.warning, true);
  assert.equal(used.state, "active");
  const unused = result.teams.find((item) => item.team === "team08");
  assert.equal(unused.costUsd, 0);
  assert.equal(unused.state, "suspended");
  assert.equal(unused.budgetExceeded, false);
  assert.equal(result.teams.find((item) => item.team === "team09").state, "unavailable");
  assert.equal(result.teams.some((item) => item.team === "ops-test"), false);
  assert.equal(result.summary.otherCostUsd, 0.004);
  assert.equal(result.models[0].otherCostUsd, 0.004);
  assert.equal(result.enforcementEnabled, false);
  assert.equal(result.hourly[0].costUsd, 0.01);
  assert.ok(result.summary.costUsd > result.hourly[0].costUsd);
});

test("overall breach applies to zero-usage teams but does not pretend they are suspended", () => {
  const data = rows();
  data.find((row) => row.kind === "status").data.Revoke = true;
  const result = buildSpend(data, [{ team: "team08", state: "active" }], now);
  const team = result.teams.find((item) => item.team === "team08");
  assert.equal(team.blockedByOverall, true);
  assert.equal(team.state, "active");
  assert.equal(team.budgetExceeded, false);
});

test("empty usage and missing snapshots remain explicit", () => {
  const data = rows().filter((row) => !["usage", "hourly"].includes(row.kind));
  data.find((row) => row.kind === "freshness").data.LastUsage = null;
  data.find((row) => row.kind === "snapshot").data.LastSnapshot = null;
  const result = buildSpend(data, roster, now);
  assert.equal(result.summary.costUsd, 0);
  assert.equal(result.teams.length, 2);
  assert.equal(result.models.length, 0);
  assert.equal(result.lastUsageAt, null);
  assert.equal(result.lastSnapshotAt, null);
  assert.throws(() => buildSpend([], roster, now), { status: 502 });
});

function fakeFetch(options = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url.startsWith("http://msi")) return response({ access_token: "token" });
    if (url.includes("loganalytics.azure.com")) return response(options.logs ?? {
      tables: [{ columns: [{ name: "Payload" }, { name: "Kind" }],
        rows: rows().map((row) => [JSON.stringify(row.data), row.kind]) }],
    });
    if (url.includes("page=2")) return response({ value: [
      { name: "team08", properties: { scope: `${env.APIM_ID}/products/hackathon`, state: "suspended" } },
    ] });
    return response({ value: [
      { name: "team07", properties: { scope: `${env.APIM_ID}/products/hackathon`, state: "active" } },
      { name: "ops-test", properties: {} },
      { name: "team10", properties: { scope: `${env.APIM_ID}/products/other`, state: "active" } },
    ], nextLink: options.nextLink ?? `https://management.azure.com${env.APIM_ID}/subscriptions?api-version=2024-05-01&page=2` });
  };
  return { impl, calls };
}

test("queries fixed KQL with MI and paginates APIM without reading keys", async () => {
  const { impl, calls } = fakeFetch();
  const result = await spend(headers(), env, impl, now);
  assert.ok(result.teams.some((item) => item.team === "team08"));
  assert.ok(!result.teams.some((item) => item.team === "team10"));
  const query = calls.find((call) => call.url.includes("loganalytics.azure.com"));
  assert.deepEqual(JSON.parse(query.init.body), { query: QUERY });
  assert.ok(calls.some((call) => call.url.includes("resource=https%3A%2F%2Fapi.loganalytics.io")));
  assert.ok(!calls.some((call) => call.url.includes("listSecrets")));
});

test("upstream partial/malformed results and unsafe pagination are errors, not zero spend", async () => {
  for (const logs of [
    { error: { code: "PartialError" }, tables: [] }, { tables: [] },
    { tables: [{ columns: [], rows: [] }] },
    { tables: [{ columns: [{ name: "Kind" }, { name: "Payload" }], rows: [["config", "{}"]] }] },
  ]) await assert.rejects(spend(headers(), env, fakeFetch({ logs }).impl, now), { status: 502 });
  await assert.rejects(spend(headers(), env, fakeFetch({ nextLink: "https://attacker.example/page" }).impl, now), { status: 502 });
  await assert.rejects(spend(headers(), env, async () => ({ ok: false, status: 403 })), { status: 502 });
  await assert.rejects(spend(headers(), { ...env, LOG_ANALYTICS_WORKSPACE_ID: "" }, fakeFetch().impl), { status: 503 });
});

test("HTTP handler checks team authorization even when organizer data is cached", async () => {
  const { app } = require("@azure/functions");
  const originalHttp = app.http;
  const originalFetch = global.fetch;
  const originalEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  let handler;
  try {
    app.http = (name, definition) => { if (name === "spend") handler = definition.handler; };
    require("../src/functions/spend");
    app.http = originalHttp;
    Object.assign(process.env, env);
    const { impl, calls } = fakeFetch();
    global.fetch = impl;
    const warnings = [];
    const context = { warn: (message) => warnings.push(message) };
    const response = await handler({ headers: headers() }, context);
    assert.equal(response.status, 200);
    assert.equal(response.headers["Cache-Control"], "private, no-store");
    const count = calls.length;
    assert.equal((await handler({ headers: headers("another-organizer@example.com") }, context)).status, 200);
    assert.equal(calls.length, count);
    const denied = await handler({ headers: headers("team07@example.com") }, context);
    assert.equal(denied.status, 403);
    assert.deepEqual(denied.jsonBody, { error: "forbidden" });
    assert.equal(calls.length, count);
    assert.deepEqual(warnings, ["spend failed: forbidden"]);
  } finally {
    app.http = originalHttp;
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
