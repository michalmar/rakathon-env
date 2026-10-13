"use strict";

const { HttpError, parsePrincipal, teamFromUpn, managedIdentityToken } = require("./lib");

const TEAM = /^team\d{2}$/;
const QUERY = `
let R = materialize(HackathonRequests());
let U = R | summarize Requests=count(), PromptTokens=sum(PromptTokens),
  CompletionTokens=sum(CompletionTokens), Images=sum(Images), CostUsd=sum(CostUsd) by Team, DeploymentName;
union
  (HackathonCostConfig() | project Kind="config", Payload=pack_all()),
  (HackathonCostStatus() | project Kind="status", Payload=pack_all()),
  (U | project Kind="usage", Payload=pack_all()),
  (R | where TimeGenerated >= ago(24h)
     | summarize CostUsd=sum(CostUsd) by TimeGenerated=bin(TimeGenerated, 1h), Team, DeploymentName
     | project Kind="hourly", Payload=pack_all()),
  (R | summarize LastUsage=max(TimeGenerated) | project Kind="freshness", Payload=pack_all()),
  (CostControl_CL | where Action == "status"
     | summarize LastSnapshot=max(TimeGenerated) | project Kind="snapshot", Payload=pack_all())
`;

function authorizeSpend(headers, env) {
  const principal = parsePrincipal(headers.get("x-ms-client-principal"), env.TENANT_ID);
  if (teamFromUpn(principal.userDetails)) throw new HttpError(403, "forbidden");
  return principal;
}

async function readJson(url, init, fetchImpl) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new HttpError(502, "spend-upstream-error");
  return response.json();
}

async function subscriptions(env, fetchImpl) {
  const token = await managedIdentityToken(env, fetchImpl);
  const base = `https://management.azure.com${env.APIM_ID}/subscriptions`;
  let next = `${base}?api-version=2024-05-01`;
  const visited = new Set();
  const teams = [];
  while (next) {
    const url = new URL(next);
    if (url.origin !== "https://management.azure.com" || url.pathname !== new URL(base).pathname || visited.has(next)) {
      throw new HttpError(502, "spend-upstream-error");
    }
    visited.add(next);
    const page = await readJson(next, { headers: { Authorization: `Bearer ${token}` } }, fetchImpl);
    if (!Array.isArray(page.value)) throw new HttpError(502, "spend-upstream-error");
    for (const item of page.value) {
      if (typeof item.name !== "string") throw new HttpError(502, "spend-upstream-error");
      if (!TEAM.test(item.name)) continue;
      if (typeof item.properties?.scope !== "string" || typeof item.properties.state !== "string") {
        throw new HttpError(502, "spend-upstream-error");
      }
      if (!item.properties.scope.toLowerCase().endsWith(`/products/${env.APIM_PRODUCT.toLowerCase()}`)) continue;
      teams.push({ team: item.name, state: item.properties.state.toLowerCase() });
    }
    if (page.nextLink !== undefined && typeof page.nextLink !== "string") throw new HttpError(502, "spend-upstream-error");
    next = page.nextLink || null;
  }
  return teams;
}

async function queryLogs(env, fetchImpl) {
  if (!env.LOG_ANALYTICS_WORKSPACE_ID) throw new HttpError(503, "spend-not-configured");
  const token = await managedIdentityToken(env, fetchImpl, "https://api.loganalytics.io");
  const result = await readJson(
    `https://api.loganalytics.azure.com/v1/workspaces/${encodeURIComponent(env.LOG_ANALYTICS_WORKSPACE_ID)}/query`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY }) }, fetchImpl,
  );
  // Log Analytics can return HTTP 200 with partial results and an error.
  if (result.error || result.tables?.length !== 1) throw new HttpError(502, "spend-query-error");
  const table = result.tables[0];
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows)) throw new HttpError(502, "spend-query-error");
  const kind = table.columns.findIndex((column) => column.name === "Kind");
  const payload = table.columns.findIndex((column) => column.name === "Payload");
  if (kind < 0 || payload < 0) throw new HttpError(502, "spend-query-error");
  return table.rows.map((row) => {
    if (!Array.isArray(row) || typeof row[kind] !== "string") throw new HttpError(502, "spend-query-error");
    const data = typeof row[payload] === "string" ? JSON.parse(row[payload]) : row[payload];
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(502, "spend-query-error");
    return { kind: row[kind], data };
  });
}

function number(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new HttpError(502, "spend-query-error");
  return value;
}

function date(value, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new HttpError(502, "spend-query-error");
  return new Date(value).toISOString();
}

function one(rows, kind) {
  const matches = rows.filter((row) => row.kind === kind);
  if (matches.length !== 1) throw new HttpError(502, "spend-query-error");
  return matches[0].data;
}

function buildSpend(rows, roster, now) {
  const config = one(rows, "config");
  const defaultBudget = number(config.DefaultTeamBudgetUsd);
  const overallBudget = number(config.OverallBudgetUsd);
  const revokeAt = number(config.OverallRevokeAtUsd);
  const warnPct = number(config.WarnPct);
  if (defaultBudget === 0 || overallBudget === 0 || typeof config.EnforcementEnabled !== "boolean" ||
      !config.TeamBudgetOverrides || typeof config.TeamBudgetOverrides !== "object" || Array.isArray(config.TeamBudgetOverrides)) {
    throw new HttpError(502, "spend-query-error");
  }
  const statuses = rows.filter((row) => row.kind === "status").map((row) => row.data);
  const overall = statuses.filter((row) => row.Scope === "overall");
  if (overall.length !== 1 || typeof overall[0].Revoke !== "boolean") throw new HttpError(502, "spend-query-error");
  const usage = rows.filter((row) => row.kind === "usage").map(({ data }) => {
    if (typeof data.Team !== "string" || !data.Team || typeof data.DeploymentName !== "string" || !data.DeploymentName) {
      throw new HttpError(502, "spend-query-error");
    }
    return {
      team: data.Team, deployment: data.DeploymentName, requests: number(data.Requests),
      promptTokens: number(data.PromptTokens), completionTokens: number(data.CompletionTokens),
      images: number(data.Images), costUsd: number(data.CostUsd),
    };
  });
  const teamMap = new Map(roster.map((item) => [item.team, item]));
  for (const item of usage) {
    if (TEAM.test(item.team) && !teamMap.has(item.team)) teamMap.set(item.team, { team: item.team, state: "unavailable" });
  }
  const teams = [...teamMap.values()].map((item) => {
    const budget = number(config.TeamBudgetOverrides[item.team] ?? defaultBudget);
    if (!budget) throw new HttpError(502, "spend-query-error");
    const cost = usage.filter((row) => row.team === item.team).reduce((sum, row) => sum + row.costUsd, 0);
    const pct = 100 * cost / budget;
    return {
      ...item, costUsd: cost, budgetUsd: budget, pct,
      budgetExceeded: Math.round(cost * 10000) / 10000 >= budget,
      warning: pct >= warnPct,
      blockedByOverall: overall[0].Revoke,
    };
  }).sort((a, b) => b.pct - a.pct || a.team.localeCompare(b.team));
  const modelMap = new Map();
  for (const item of usage) {
    if (!modelMap.has(item.deployment)) modelMap.set(item.deployment, {
      deployment: item.deployment, costUsd: 0, teamCostUsd: 0, otherCostUsd: 0,
      requests: 0, promptTokens: 0, completionTokens: 0, images: 0,
    });
    const model = modelMap.get(item.deployment);
    for (const key of ["costUsd", "requests", "promptTokens", "completionTokens", "images"]) model[key] += item[key];
    model[TEAM.test(item.team) ? "teamCostUsd" : "otherCostUsd"] += item.costUsd;
  }
  const total = usage.reduce((sum, row) => sum + row.costUsd, 0);
  const teamCost = usage.filter((row) => TEAM.test(row.team)).reduce((sum, row) => sum + row.costUsd, 0);
  const otherCost = usage.filter((row) => !TEAM.test(row.team)).reduce((sum, row) => sum + row.costUsd, 0);
  const hourly = rows.filter((row) => row.kind === "hourly").map(({ data }) => {
    if (typeof data.Team !== "string" || typeof data.DeploymentName !== "string") throw new HttpError(502, "spend-query-error");
    return { at: date(data.TimeGenerated), team: data.Team, deployment: data.DeploymentName, costUsd: number(data.CostUsd) };
  });
  return {
    generatedAt: now.toISOString(), windowStart: date(config.WindowStart),
    lastUsageAt: date(one(rows, "freshness").LastUsage, true),
    lastSnapshotAt: date(one(rows, "snapshot").LastSnapshot, true),
    enforcementEnabled: config.EnforcementEnabled, warnPct,
    summary: {
      costUsd: total, teamCostUsd: teamCost, otherCostUsd: otherCost,
      budgetUsd: overallBudget, revokeAtUsd: revokeAt, pct: 100 * total / overallBudget,
      budgetExceeded: overall[0].Revoke,
    },
    teams, models: [...modelMap.values()].sort((a, b) => b.costUsd - a.costUsd), usage, hourly,
  };
}

async function spend(headers, env, fetchImpl = fetch, now = new Date()) {
  authorizeSpend(headers, env);
  const [rows, roster] = await Promise.all([queryLogs(env, fetchImpl), subscriptions(env, fetchImpl)]);
  return buildSpend(rows, roster, now);
}

module.exports = { authorizeSpend, buildSpend, spend, QUERY };
