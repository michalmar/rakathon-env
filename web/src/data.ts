import { environment } from "./catalog";

export interface DataLink {
  blobUrl: string;
  downloadUrl: string;
  expiresAt: string;
}

export type DataLinkResult =
  | { status: "ok"; link: DataLink }
  | { status: "not-found" }
  | { status: "unauthenticated" }
  | { status: "error" };

export function blobUrl(name: string): string {
  const encodedName = name.split("/").map(encodeURIComponent).join("/");
  return `https://${environment.storageAccount}.blob.core.windows.net/${encodeURIComponent(environment.container)}/${encodedName}`;
}

export function parseDataLink(value: unknown, name: string): DataLink {
  if (typeof value !== "object" || value === null) throw new Error("Neplatná odpověď služby dat.");
  const record = value as Record<string, unknown>;
  const expectedBlobUrl = blobUrl(name);
  if (
    record.blobUrl !== expectedBlobUrl ||
    typeof record.downloadUrl !== "string" ||
    !record.downloadUrl.startsWith(`${expectedBlobUrl}?`) ||
    typeof record.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(record.expiresAt))
  ) throw new Error("Neplatná odpověď služby dat.");
  return {
    blobUrl: record.blobUrl,
    downloadUrl: record.downloadUrl,
    expiresAt: record.expiresAt,
  };
}

export async function loadDataLink(name: string, fetchImpl: typeof fetch = fetch): Promise<DataLinkResult> {
  try {
    const response = await fetchImpl(`/api/data-link?name=${encodeURIComponent(name)}`, {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    if (response.status === 404) return { status: "not-found" };
    if (response.status === 401 || response.status === 403) return { status: "unauthenticated" };
    if (!response.ok) return { status: "error" };
    return { status: "ok", link: parseDataLink(await response.json(), name) };
  } catch {
    return { status: "error" };
  }
}
