import { describe, expect, it, vi } from "vitest";
import { blobUrl, loadDataLink, parseDataLink } from "./data";

describe("data links", () => {
  it("encodes nested blob names into a stable private URL", () => {
    expect(blobUrl("folder/data set #1.csv")).toContain("/data/folder/data%20set%20%231.csv");
  });

  it("accepts only download links for the requested blob", () => {
    const name = "folder/data.csv";
    const url = blobUrl(name);
    expect(parseDataLink({
      blobUrl: url,
      downloadUrl: `${url}?sv=test&sig=fake`,
      expiresAt: "2026-10-12T12:00:00.000Z",
    }, name).blobUrl).toBe(url);
    expect(() => parseDataLink({
      blobUrl: "https://evil.example/data.csv",
      downloadUrl: "https://evil.example/data.csv?sig=fake",
      expiresAt: "2026-10-12T12:00:00.000Z",
    }, name)).toThrow();
  });

  it("maps authentication, missing blob and success responses", async () => {
    const name = "data.csv";
    const url = blobUrl(name);
    const ok = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      blobUrl: url,
      downloadUrl: `${url}?sig=fake`,
      expiresAt: "2026-10-12T12:00:00.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(loadDataLink(name, ok)).resolves.toMatchObject({ status: "ok" });
    await expect(loadDataLink(name, vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })))).resolves.toEqual({ status: "not-found" });
    await expect(loadDataLink(name, vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })))).resolves.toEqual({ status: "unauthenticated" });
  });
});
