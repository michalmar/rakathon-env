"use strict";

const { app } = require("@azure/functions");
const { HttpError } = require("../lib");
const { authorizeSpend } = require("../spend");
const { isDue, refreshSnapshot, snapshotStore } = require("../azure-cost");

let cached;
let pending;

function refresh() {
  pending ??= refreshSnapshot(process.env, snapshotStore(process.env)).finally(() => { pending = undefined; });
  return pending;
}

app.timer("azure-cost-refresh", {
  schedule: "0 */15 * * * *",
  runOnStartup: false,
  handler: async (_timer, context) => {
    try {
      const snapshot = await refresh();
      cached = { snapshot, readAt: Date.now() };
      if (snapshot.error) context.warn(`azure-cost refresh failed: ${snapshot.error}`);
    } catch (error) {
      context.warn(`azure-cost refresh failed: ${error instanceof HttpError ? error.code : "azure-cost-storage-error"}`);
    }
  },
});

app.http("azure-cost", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "azure-cost",
  handler: async (request, context) => {
    const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json" };
    try {
      authorizeSpend(request.headers, process.env);
      if (!cached || Date.now() - cached.readAt >= 60000) {
        cached = { snapshot: await snapshotStore(process.env).read(), readAt: Date.now() };
      }
      // Bootstrap only: the timer owns regular refreshes, so viewers never multiply billing queries.
      if (!cached.snapshot?.data && isDue(cached.snapshot)) cached = { snapshot: await refresh(), readAt: Date.now() };
      const { snapshot } = cached;
      if (!snapshot?.data) return { status: 503, headers, jsonBody: { error: snapshot?.error ?? "azure-cost-unavailable" } };
      return { status: 200, headers, jsonBody: snapshot };
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502;
      const code = error instanceof HttpError ? error.code : "azure-cost-upstream-error";
      context.warn(`azure-cost failed: ${code}`);
      return { status, headers, jsonBody: { error: code } };
    }
  },
});
