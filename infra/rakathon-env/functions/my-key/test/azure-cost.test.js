"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAzureCost, queryAzureCost, refreshSnapshot, isDue } = require("../src/azure-cost");

const env = {
  IDENTITY_ENDPOINT: "http://msi", IDENTITY_HEADER: "test",
  AZURE_SUBSCRIPTION_ID: "83ae1511-eee9-469a-8c48-b9a9069b92e4",
  AZURE_COST_BUDGET_USD: "5000", AZURE_COST_WINDOW_START: "2026-10-10T00:00:00Z",
};
const now = new Date("2026-10-14T12:00:00Z");
const settings = { subscriptionId: env.AZURE_SUBSCRIPTION_ID, budgetUsd: 5000, windowStart: "2026-10-10T00:00:00.000Z" };
const columns = [{ name: "CostUSD" }, { name: "UsageDate" }, { name: "ResourceGroupName" }, { name: "Currency" }];

test("billing rows aggregate per team resource group, shared costs stay separate", () => {
  const result = buildAzureCost(columns, [
    [10, 20261011, "rg-team02", "EUR"],
    [5, 20261012, "RG-TEAM02", "EUR"],
    [1.5, 20261012, "rg-team10", "EUR"],
    [100, 20261013, "rg-rakathon-shared", "EUR"],
    [0.25, 20261010, "", "EUR"],
  ], settings, now);
  assert.equal(result.totalUsd, 116.75);
  assert.equal(result.teamUsd, 16.5);
  assert.equal(result.sharedUsd, 100.25);
  assert.equal(result.pct, 116.75 / 5000 * 100);
  assert.equal(result.dataThrough, "2026-10-13");
  assert.deepEqual(result.teams, [{ team: "team02", costUsd: 15 }, { team: "team10", costUsd: 1.5 }]);
  assert.equal(result.resourceGroups[0].name, "rg-rakathon-shared");
  assert.equal(result.windowStart, settings.windowStart);
});

test("empty billing is zero with unknown data date, malformed rows are rejected", () => {
  const empty = buildAzureCost(columns, [], settings, now);
  assert.equal(empty.totalUsd, 0);
  assert.equal(empty.dataThrough, null);
  assert.throws(() => buildAzureCost([{ name: "Cost" }], [], settings, now), { code: "azure-cost-query-error" });
  assert.throws(() => buildAzureCost(columns, [["x", 20261011, "rg-team01"]], settings, now), { code: "azure-cost-query-error" });
});

function fakeFetch(responses, calls = []) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("http://msi")) return new Response(JSON.stringify({ access_token: "token" }));
    const next = responses.shift();
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200 });
  };
}

test("query uses USD billing over the window, own client type and follows Cost Management pages", async () => {
  const calls = [];
  const base = `https://management.azure.com/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/providers/Microsoft.CostManagement/query`;
  const result = await queryAzureCost(env, fakeFetch([
    { body: { properties: { columns, rows: [[1, 20261011, "rg-team01", "EUR"]], nextLink: `${base}?api-version=2023-11-01&$skiptoken=a` } } },
    { body: { properties: { columns, rows: [[2, 20261012, "rg-team01", "EUR"]], nextLink: null } } },
  ], calls), now);
  assert.equal(result.totalUsd, 3);
  const queries = calls.filter((call) => call.url.startsWith(base));
  assert.equal(queries.length, 2);
  const body = JSON.parse(queries[0].init.body);
  assert.equal(body.type, "ActualCost");
  assert.equal(body.dataset.aggregation.totalCostUSD.name, "CostUSD");
  assert.deepEqual(body.timePeriod, { from: settings.windowStart, to: now.toISOString() });
  assert.equal(queries[0].init.headers.ClientType, "rakathon-portal");
});

test("query refuses foreign next links, throttling and missing configuration", async () => {
  await assert.rejects(queryAzureCost(env, fakeFetch([
    { body: { properties: { columns, rows: [], nextLink: "https://evil.example/query" } } },
  ]), now), { code: "azure-cost-query-error" });
  await assert.rejects(queryAzureCost(env, fakeFetch([{ status: 429 }]), now), { code: "azure-cost-throttled" });
  await assert.rejects(queryAzureCost({ ...env, AZURE_SUBSCRIPTION_ID: "" }, fakeFetch([]), now), { code: "azure-cost-not-configured" });
});

test("failed refresh keeps the last successful data and records the error", async () => {
  let stored = null;
  const store = { read: async () => stored, write: async (value) => { stored = value; } };
  await refreshSnapshot(env, store, fakeFetch([{ body: { properties: { columns, rows: [[7, 20261011, "rg-team03", "EUR"]] } } }]), now);
  assert.equal(stored.data.totalUsd, 7);
  assert.equal(stored.error, null);
  const later = new Date(now.getTime() + 15 * 60000);
  await refreshSnapshot(env, store, fakeFetch([{ status: 429 }]), later);
  assert.equal(stored.data.totalUsd, 7);
  assert.equal(stored.error, "azure-cost-throttled");
  assert.equal(stored.attemptedAt, later.toISOString());
  assert.equal(isDue(stored, new Date(later.getTime() + 60000)), false);
  assert.equal(isDue(stored, new Date(later.getTime() + 15 * 60000)), true);
  assert.equal(isDue(null), true);
});

test("before the window opens no billing query is sent", async () => {
  const calls = [];
  const result = await queryAzureCost(env, fakeFetch([], calls), new Date("2026-10-09T12:00:00Z"));
  assert.equal(result.totalUsd, 0);
  assert.equal(result.dataThrough, null);
  assert.equal(calls.length, 0);
});
