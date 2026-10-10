"use strict";

const { app } = require("@azure/functions");
const { HttpError, myKey } = require("../lib");

const responseHeaders = { "Cache-Control": "no-store", "Content-Type": "application/json" };

app.http("my-key", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "my-key",
  handler: async (request, context) => {
    try {
      const body = await myKey(request.headers, process.env);
      return { status: 200, headers: responseHeaders, body: JSON.stringify(body) };
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : "internal-error";
      context.warn(`my-key failed: ${code}`);
      return { status, headers: responseHeaders, body: JSON.stringify({ error: code }) };
    }
  },
});
