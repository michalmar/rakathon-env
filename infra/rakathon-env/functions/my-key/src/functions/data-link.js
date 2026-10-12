"use strict";

const { app } = require("@azure/functions");
const { dataLink, HttpError } = require("../lib");
const { createBlobLink } = require("../storage");

const responseHeaders = { "Cache-Control": "no-store", "Content-Type": "application/json" };

app.http("data-link", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "data-link",
  handler: async (request, context) => {
    try {
      const body = await dataLink(request.headers, request.query.get("name"), process.env, createBlobLink);
      return { status: 200, headers: responseHeaders, body: JSON.stringify(body) };
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : "internal-error";
      context.warn(`data-link failed: ${code}`);
      return { status, headers: responseHeaders, body: JSON.stringify({ error: code }) };
    }
  },
});
