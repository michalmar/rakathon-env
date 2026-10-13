"use strict";

const { app } = require("@azure/functions");
const { HttpError } = require("../lib");
const { authorizeSpend, spend } = require("../spend");

let cached;
let pending;

app.http("spend", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "spend",
  handler: async (request, context) => {
    const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json" };
    try {
      authorizeSpend(request.headers, process.env);
      if (!cached || Date.now() - cached.createdAt >= 60000) {
        if (!pending) pending = spend(request.headers, process.env);
        try {
          cached = { body: await pending, createdAt: Date.now() };
        } finally {
          pending = undefined;
        }
      }
      return { status: 200, headers, jsonBody: cached.body };
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502;
      const code = error instanceof HttpError ? error.code : "spend-upstream-error";
      context.warn(`spend failed: ${code}`);
      return { status, headers, jsonBody: { error: code } };
    }
  },
});
