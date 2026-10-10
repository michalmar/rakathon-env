import { environment } from "./catalog";

export type KeyState = "active" | "suspended" | "other";

export interface TeamKey {
  team: string;
  key: string;
  state: KeyState;
  baseUrl: string;
}

export type KeyResult =
  | { status: "ok"; key: TeamKey }
  | { status: "no-team" }
  | { status: "unauthenticated" }
  | { status: "error" };

export function parseTeamKey(value: unknown): TeamKey {
  if (typeof value !== "object" || value === null) throw new Error("Neplatná odpověď služby klíče.");
  const record = value as Record<string, unknown>;
  const { team, key, state, baseUrl } = record;
  if (
    typeof team !== "string" || !/^team\d{2}$/.test(team) ||
    typeof key !== "string" || key.length === 0 ||
    typeof state !== "string" ||
    typeof baseUrl !== "string" || !baseUrl.startsWith(`https://${environment.gatewayService}.azure-api.net/`)
  ) throw new Error("Neplatná odpověď služby klíče.");
  return { team, key, baseUrl, state: state === "active" ? "active" : state === "suspended" ? "suspended" : "other" };
}

export async function loadTeamKey(fetchImpl: typeof fetch = fetch): Promise<KeyResult> {
  try {
    const response = await fetchImpl("/api/my-key", { cache: "no-store", credentials: "same-origin", redirect: "error" });
    if (response.status === 404) return { status: "no-team" };
    if (response.status === 401 || response.status === 403) return { status: "unauthenticated" };
    if (!response.ok) return { status: "error" };
    return { status: "ok", key: parseTeamKey(await response.json()) };
  } catch {
    return { status: "error" };
  }
}

export function maskKey(key: string): string {
  return "•".repeat(Math.min(Math.max(key.length, 12), 32));
}

export function curlExample(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, "");
  return [
    `curl ${root}/chat/completions \\`,
    '  -H "api-key: $API_KEY" -H "Content-Type: application/json" \\',
    `  -d '{"model": "<deployment>", "messages": [{"role": "user", "content": "Ahoj"}]}'`,
  ].join("\n");
}

export function pythonExample(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, "");
  return [
    "import os",
    "from openai import OpenAI",
    "",
    `client = OpenAI(base_url="${root}/",`,
    '                api_key="unused", default_headers={"api-key": os.environ["API_KEY"]})',
    'reply = client.chat.completions.create(model="<deployment>",',
    '                                       messages=[{"role": "user", "content": "Ahoj"}])',
    "print(reply.choices[0].message.content)",
  ].join("\n");
}
