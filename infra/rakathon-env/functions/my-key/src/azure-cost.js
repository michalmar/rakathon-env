"use strict";

const { HttpError, managedIdentityToken } = require("./lib");

const TEAM_GROUP = /^rg-(team\d{2})$/i;
const REFRESH_MS = 15 * 60 * 1000;
const SNAPSHOT_CONTAINER = "portal-cache";
const SNAPSHOT_BLOB = "azure-cost.json";

function config(env) {
  const budgetUsd = Number(env.AZURE_COST_BUDGET_USD);
  if (!/^[0-9a-f-]{36}$/i.test(env.AZURE_SUBSCRIPTION_ID ?? "") || !Number.isFinite(budgetUsd) || budgetUsd <= 0 ||
      !Number.isFinite(Date.parse(env.AZURE_COST_WINDOW_START ?? ""))) {
    throw new HttpError(503, "azure-cost-not-configured");
  }
  return { subscriptionId: env.AZURE_SUBSCRIPTION_ID, budgetUsd, windowStart: new Date(env.AZURE_COST_WINDOW_START).toISOString() };
}

function usageDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value));
  if (!match) throw new HttpError(502, "azure-cost-query-error");
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function cost(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(502, "azure-cost-query-error");
  return value;
}

// Billing rows (Daily × ResourceGroupName) → total, per-team and per-resource-group costs in USD.
function buildAzureCost(columns, rows, settings, now) {
  const index = (name) => columns.findIndex((column) => column?.name === name);
  const [usd, date, group] = [index("CostUSD"), index("UsageDate"), index("ResourceGroupName")];
  if (usd < 0 || date < 0 || group < 0) throw new HttpError(502, "azure-cost-query-error");
  const groups = new Map();
  let dataThrough = null;
  for (const row of rows) {
    if (!Array.isArray(row)) throw new HttpError(502, "azure-cost-query-error");
    const name = typeof row[group] === "string" && row[group] ? row[group].toLowerCase() : "(bez resource group)";
    groups.set(name, (groups.get(name) ?? 0) + cost(row[usd]));
    const day = usageDate(row[date]);
    if (!dataThrough || day > dataThrough) dataThrough = day;
  }
  const resourceGroups = [...groups].map(([name, costUsd]) => ({ name, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd || a.name.localeCompare(b.name));
  const teams = resourceGroups.flatMap(({ name, costUsd }) => {
    const match = TEAM_GROUP.exec(name);
    return match ? [{ team: match[1].toLowerCase(), costUsd }] : [];
  });
  const totalUsd = resourceGroups.reduce((sum, item) => sum + item.costUsd, 0);
  const teamUsd = teams.reduce((sum, item) => sum + item.costUsd, 0);
  return {
    refreshedAt: now.toISOString(), windowStart: settings.windowStart, dataThrough,
    budgetUsd: settings.budgetUsd, totalUsd, teamUsd, sharedUsd: totalUsd - teamUsd,
    pct: 100 * totalUsd / settings.budgetUsd, teams, resourceGroups,
  };
}

async function queryAzureCost(env, fetchImpl = fetch, now = new Date()) {
  const settings = config(env);
  // Before the window opens there is nothing to bill; Cost Management rejects from > to.
  if (now < new Date(settings.windowStart)) return buildAzureCost([{ name: "CostUSD" }, { name: "UsageDate" }, { name: "ResourceGroupName" }], [], settings, now);
  const token = await managedIdentityToken(env, fetchImpl);
  const base = `https://management.azure.com/subscriptions/${settings.subscriptionId}/providers/Microsoft.CostManagement/query`;
  const body = JSON.stringify({
    type: "ActualCost", timeframe: "Custom",
    timePeriod: { from: settings.windowStart, to: now.toISOString() },
    dataset: {
      granularity: "Daily",
      aggregation: { totalCostUSD: { name: "CostUSD", function: "Sum" } },
      grouping: [{ type: "Dimension", name: "ResourceGroupName" }],
    },
  });
  // Cost Management throttles per client type; a dedicated value keeps the portal off the shared CLI/portal quota.
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ClientType: "rakathon-portal" };
  let next = `${base}?api-version=2023-11-01`;
  let columns;
  const rows = [];
  for (let page = 0; next; page += 1) {
    const url = new URL(next);
    if (page >= 20 || url.origin !== "https://management.azure.com" || url.pathname !== new URL(base).pathname) {
      throw new HttpError(502, "azure-cost-query-error");
    }
    const response = await fetchImpl(next, { method: "POST", headers, body, signal: AbortSignal.timeout(25000) });
    if (response.status === 429) throw new HttpError(503, "azure-cost-throttled");
    if (!response.ok) throw new HttpError(502, "azure-cost-upstream-error");
    const result = await response.json();
    const properties = result?.properties;
    if (!Array.isArray(properties?.columns) || !Array.isArray(properties.rows)) throw new HttpError(502, "azure-cost-query-error");
    columns ??= properties.columns;
    rows.push(...properties.rows);
    if (properties.nextLink !== null && properties.nextLink !== undefined && typeof properties.nextLink !== "string") {
      throw new HttpError(502, "azure-cost-query-error");
    }
    next = properties.nextLink || null;
  }
  return buildAzureCost(columns, rows, settings, now);
}

// Snapshot keeps the last successful billing result plus the latest attempt, so a throttled
// or failed refresh never replaces real data with zeros.
function mergeSnapshot(previous, attemptAt, result, error) {
  return {
    attemptedAt: attemptAt.toISOString(),
    error: error ? (error instanceof HttpError ? error.code : "azure-cost-upstream-error") : null,
    data: result ?? previous?.data ?? null,
  };
}

function snapshotStore(env) {
  const { BlobServiceClient } = require("@azure/storage-blob");
  if (!env.AzureWebJobsStorage) throw new HttpError(503, "azure-cost-not-configured");
  const container = BlobServiceClient.fromConnectionString(env.AzureWebJobsStorage).getContainerClient(SNAPSHOT_CONTAINER);
  const blob = container.getBlockBlobClient(SNAPSHOT_BLOB);
  return {
    async read() {
      try {
        return JSON.parse((await blob.downloadToBuffer()).toString("utf8"));
      } catch (error) {
        if (error?.statusCode === 404) return null;
        throw new HttpError(502, "azure-cost-storage-error");
      }
    },
    async write(snapshot) {
      await container.createIfNotExists();
      const text = JSON.stringify(snapshot);
      await blob.upload(text, Buffer.byteLength(text), { blobHTTPHeaders: { blobContentType: "application/json" } });
    },
  };
}

async function refreshSnapshot(env, store, fetchImpl = fetch, now = new Date()) {
  const previous = await store.read().catch(() => null);
  let result;
  let failure;
  try {
    result = await queryAzureCost(env, fetchImpl, now);
  } catch (error) {
    failure = error;
  }
  const snapshot = mergeSnapshot(previous, now, result, failure);
  await store.write(snapshot);
  return snapshot;
}

function isDue(snapshot, now = new Date()) {
  return !snapshot || !Number.isFinite(Date.parse(snapshot.attemptedAt)) || now - Date.parse(snapshot.attemptedAt) >= REFRESH_MS;
}

module.exports = { buildAzureCost, queryAzureCost, mergeSnapshot, snapshotStore, refreshSnapshot, isDue, REFRESH_MS };
