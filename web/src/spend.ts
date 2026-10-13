export interface Usage {
  team: string; deployment: string; costUsd: number; requests: number;
  promptTokens: number; completionTokens: number; images: number;
}
export interface SpendTeam {
  team: string; state: string; costUsd: number; budgetUsd: number; pct: number;
  budgetExceeded: boolean; warning: boolean; blockedByOverall: boolean;
}
export interface SpendModel {
  deployment: string; costUsd: number; teamCostUsd: number; otherCostUsd: number;
  requests: number; promptTokens: number; completionTokens: number; images: number;
}
export interface Spend {
  generatedAt: string; windowStart: string; lastUsageAt: string | null; lastSnapshotAt: string | null;
  enforcementEnabled: boolean; warnPct: number;
  summary: { costUsd: number; teamCostUsd: number; otherCostUsd: number; budgetUsd: number;
    revokeAtUsd: number; pct: number; budgetExceeded: boolean };
  teams: SpendTeam[]; models: SpendModel[]; usage: Usage[];
  hourly: { at: string; team: string; deployment: string; costUsd: number }[];
}

export function canViewSpend(user: string): boolean {
  const at = user.lastIndexOf("@");
  return user.length > 0 && !(at > 0 && /^team\d{2}$/i.test(user.slice(0, at)));
}

function invalid(): never {
  throw new Error("Server vrátil neplatný přehled nákladů. Kontaktujte správce.");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalid();
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value) invalid();
  return value;
}
function numeric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalid();
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}
function timestamp(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) invalid();
  return result;
}
function list<T>(value: unknown, parse: (item: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) invalid();
  return value.map((item: unknown) => parse(record(item)));
}
function counters(item: Record<string, unknown>) {
  return {
    costUsd: numeric(item.costUsd), requests: numeric(item.requests),
    promptTokens: numeric(item.promptTokens), completionTokens: numeric(item.completionTokens), images: numeric(item.images),
  };
}

export function parseSpend(value: unknown): Spend {
  const data = record(value);
  const summary = record(data.summary);
  const budgetUsd = numeric(summary.budgetUsd);
  if (!budgetUsd) invalid();
  return {
    generatedAt: timestamp(data.generatedAt), windowStart: timestamp(data.windowStart),
    lastUsageAt: data.lastUsageAt === null ? null : timestamp(data.lastUsageAt),
    lastSnapshotAt: data.lastSnapshotAt === null ? null : timestamp(data.lastSnapshotAt),
    enforcementEnabled: bool(data.enforcementEnabled), warnPct: numeric(data.warnPct),
    summary: {
      costUsd: numeric(summary.costUsd), teamCostUsd: numeric(summary.teamCostUsd), otherCostUsd: numeric(summary.otherCostUsd),
      budgetUsd, revokeAtUsd: numeric(summary.revokeAtUsd), pct: numeric(summary.pct), budgetExceeded: bool(summary.budgetExceeded),
    },
    teams: list(data.teams, (item) => {
      const budget = numeric(item.budgetUsd);
      if (!budget || !/^team\d{2}$/.test(text(item.team))) invalid();
      return {
        team: text(item.team), state: text(item.state), costUsd: numeric(item.costUsd), budgetUsd: budget, pct: numeric(item.pct),
        budgetExceeded: bool(item.budgetExceeded), warning: bool(item.warning), blockedByOverall: bool(item.blockedByOverall),
      };
    }),
    models: list(data.models, (item) => ({
      deployment: text(item.deployment), ...counters(item),
      teamCostUsd: numeric(item.teamCostUsd), otherCostUsd: numeric(item.otherCostUsd),
    })),
    usage: list(data.usage, (item) => ({ team: text(item.team), deployment: text(item.deployment), ...counters(item) })),
    hourly: list(data.hourly, (item) => ({
      at: timestamp(item.at), team: text(item.team), deployment: text(item.deployment), costUsd: numeric(item.costUsd),
    })),
  };
}

export async function loadSpend(fetchImpl: typeof fetch = fetch): Promise<Spend> {
  const response = await fetchImpl("/api/spend", {
    cache: "no-store", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(30000),
  });
  if (response.status === 401 || response.status === 403) throw new Error("Přehled je pouze pro přihlášené účty mimo teamNN. Ověřte přihlášení.");
  if (!response.ok) throw new Error(`Náklady se nepodařilo načíst (HTTP ${response.status}). Zkuste obnovit přehled; při opakované chybě kontaktujte správce.`);
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Server nevrátil přehled nákladů. Ověřte přihlášení a nasazení API.");
  return parseSpend(await response.json());
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", textValue?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  if (textValue !== undefined) result.textContent = textValue;
  return result;
}
const usd = (amount: number) => new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "USD", currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
const count = (amount: number) => new Intl.NumberFormat("cs-CZ").format(amount);
const when = (at: string | null) => at ? new Date(at).toLocaleString("cs-CZ") : "Zatím bez záznamu";

function table(title: string, headings: string[], rows: (string | HTMLElement)[][]): HTMLElement {
  const wrap = node("div", "spend-table-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", `${title} · tabulku lze posouvat vodorovně`);
  const result = node("table", "file-table spend-table");
  result.append(node("caption", "", title));
  const head = node("thead");
  const header = node("tr");
  for (const label of headings) {
    const cell = node("th", "", label);
    cell.scope = "col";
    header.append(cell);
  }
  head.append(header);
  const body = node("tbody");
  for (const row of rows) {
    const tr = node("tr");
    for (const [index, value] of row.entries()) {
      const td = index === 0 ? node("th") : node("td");
      if (td instanceof HTMLTableCellElement && index === 0) td.scope = "row";
      if (typeof value === "string") td.textContent = value;
      else td.append(value);
      tr.append(td);
    }
    body.append(tr);
  }
  result.append(head, body);
  wrap.append(result);
  return wrap;
}

function budgetMeter(pct: number): HTMLElement {
  const wrap = node("div", "spend-budget");
  const progress = node("progress");
  progress.max = 100;
  progress.value = Math.min(pct, 100);
  progress.setAttribute("aria-label", "Vyčerpání rozpočtu");
  wrap.append(progress, node("span", "", `${count(Math.round(pct * 10) / 10)} %`));
  return wrap;
}

function hourlyChart(data: Spend): HTMLElement {
  const figure = node("figure", "spend-chart");
  const title = node("figcaption", "", "Odhad nákladů za hodinu · posledních 24 hodin");
  const end = Math.floor(Date.parse(data.generatedAt) / 3600000) * 3600000;
  const points = Array.from({ length: 25 }, (_, index) => {
    const at = end - (24 - index) * 3600000;
    const rows = data.hourly.filter((row) => Date.parse(row.at) === at);
    return { at, team: rows.filter((row) => /^team\d{2}$/.test(row.team)).reduce((sum, row) => sum + row.costUsd, 0),
      other: rows.filter((row) => !/^team\d{2}$/.test(row.team)).reduce((sum, row) => sum + row.costUsd, 0) };
  });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 800 230");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Hodinové náklady: modrá pro týmy, červená pro ostatní subscriptions. Číselné hodnoty jsou v tabulce pod grafem.");
  const maximum = Math.max(...points.map((point) => point.team + point.other), 0.01);
  function shape(tag: "rect" | "text", attributes: Record<string, string>, textValue?: string) {
    const item = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) item.setAttribute(key, value);
    if (textValue) item.textContent = textValue;
    svg.append(item);
    return item;
  }
  shape("text", { x: "8", y: "18", class: "spend-chart-label" }, usd(maximum));
  points.forEach((point, index) => {
    const teamHeight = point.team / maximum * 150;
    const otherHeight = point.other / maximum * 150;
    shape("rect", { x: String(80 + index * 27), y: String(190 - teamHeight), width: "20", height: String(teamHeight), class: "spend-chart-team" });
    shape("rect", { x: String(80 + index * 27), y: String(190 - teamHeight - otherHeight), width: "20", height: String(otherHeight), class: "spend-chart-other" });
    if (index % 4 === 0) shape("text", { x: String(80 + index * 27), y: "217", class: "spend-chart-label" },
      new Date(point.at).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }));
  });
  const legend = node("p", "spend-legend");
  legend.append(node("span", "spend-legend-team", "Týmy"), node("span", "spend-legend-other", "Ostatní subscriptions"));
  figure.append(title, svg, legend);
  const details = node("details", "portal-guide");
  details.append(node("summary", "", "Číselné hodnoty hodinového grafu"),
    table("Hodinový odhad (USD)", ["Hodina", "Týmy", "Ostatní"], points.map((point) => [when(new Date(point.at).toISOString()), usd(point.team), usd(point.other)])));
  figure.append(details);
  return figure;
}

function renderSpend(data: Spend): HTMLElement {
  const content = node("div", "spend-content");
  const summary = node("dl", "spend-summary");
  for (const [label, value] of [
    ["Celkový odhad", usd(data.summary.costUsd)], ["Rozpočet akce", usd(data.summary.budgetUsd)],
    ["Týmová spotřeba", usd(data.summary.teamCostUsd)], ["Ostatní subscriptions", usd(data.summary.otherCostUsd)],
    ["Práh celkové blokace", usd(data.summary.revokeAtUsd)],
  ]) {
    const pair = node("div");
    pair.append(node("dt", "", label), node("dd", "", value));
    summary.append(pair);
  }
  const totalMeter = budgetMeter(data.summary.pct);
  totalMeter.classList.add("spend-overall-meter");
  content.append(summary, totalMeter);
  if (data.summary.budgetExceeded) content.append(node("p", "spend-warning", "Dosažen celkový práh pro blokaci. Skutečný stav přístupu je uveden u jednotlivých týmů."));
  if (!data.enforcementEnabled) content.append(node("p", "spend-warning", "Automatické blokování je vypnuté. Překročení rozpočtu samo přístup nezablokuje."));
  const stale = !data.lastSnapshotAt || Date.parse(data.generatedAt) - Date.parse(data.lastSnapshotAt) > 20 * 60000;
  if (stale) content.append(node("p", "spend-warning", "Job řízení nákladů nemá aktuální snapshot (více než 20 minut nebo žádný záznam). Ověřte Logic App; přehled není potvrzením jejího běhu."));
  content.append(node("p", "spend-freshness",
    `Rozpočtové okno od ${when(data.windowStart)}. Načteno ${when(data.generatedAt)}. Poslední zaznamenaná spotřeba: ${when(data.lastUsageAt)}. Snapshot jobu: ${when(data.lastSnapshotAt)}.`));
  const stateLabels: Record<string, string> = { active: "Aktivní", suspended: "Pozastaveno", cancelled: "Zrušeno", submitted: "Čeká na schválení", rejected: "Odmítnuto", expired: "Vypršelo", unavailable: "Stav nedostupný" };
  if (data.teams.length) content.append(table("Týmy · rozpočet a skutečný stav APIM",
    ["Tým", "Odhad USD", "Rozpočet USD", "Vyčerpání", "Rozpočtový stav", "Přístup APIM"],
    data.teams.map((team) => [
      team.team, usd(team.costUsd), usd(team.budgetUsd), budgetMeter(team.pct),
      team.budgetExceeded ? "Týmový limit dosažen" : team.blockedByOverall ? "Celkový práh dosažen" : team.warning ? "Varování" : "Pod limitem",
      stateLabels[team.state] ?? `Jiný stav: ${team.state}`,
    ])));
  else content.append(node("p", "empty-state", "Žádné týmové subscriptions ani týmová spotřeba."));
  if (data.models.length) content.append(table("Modely · odhad za celé rozpočtové okno",
    ["Deployment", "Odhad USD", "Z toho týmy", "Ostatní", "Požadavky", "Vstupní tokeny", "Výstupní tokeny", "Obrázky"],
    data.models.map((model) => [
      model.deployment, usd(model.costUsd), usd(model.teamCostUsd), usd(model.otherCostUsd),
      count(model.requests), count(model.promptTokens), count(model.completionTokens), count(model.images),
    ])));
  else content.append(node("p", "empty-state", "V rozpočtovém okně zatím není zaznamenaná spotřeba modelů."));
  const details = node("details", "portal-guide");
  details.append(node("summary", "", "Rozpad tým × deployment"));
  if (data.usage.length) details.append(table("Spotřeba podle subscription a deploymentu",
    ["Subscription", "Deployment", "Odhad USD", "Požadavky", "Vstupní tokeny", "Výstupní tokeny", "Obrázky"],
    data.usage.map((row) => [row.team, row.deployment, usd(row.costUsd), count(row.requests), count(row.promptTokens), count(row.completionTokens), count(row.images)])));
  else details.append(node("p", "empty-state", "Zatím bez zaznamenané spotřeby."));
  content.append(details, hourlyChart(data));
  return content;
}

export function spendSection(): HTMLElement {
  const section = node("section", "content-section spend-section");
  section.id = "spend";
  section.setAttribute("aria-labelledby", "spend-heading");
  const header = node("div", "section-heading");
  const title = node("div");
  const heading = node("h2", "", "Odhad nákladů modelů");
  heading.id = "spend-heading";
  title.append(heading, node("p", "section-description", "Přehled pro účty mimo teamNN. Rozpočty od začátku akce; graf pouze za posledních 24 hodin."));
  const refresh = node("button", "button file-action spend-refresh", "Obnovit přehled");
  refresh.type = "button";
  header.append(title, refresh);
  const caveat = node("p", "section-description spend-caveat",
    "Odhad z úspěšných požadavků přes APIM, nikoli fakturovaná cena Azure. Nezahrnuje hosting APIM, další infrastrukturu ani volání mimo gateway. Cache slevy nejsou započtené; obrázky jsou odhadnuté po požadavcích. Logy mají zpoždění několika minut, job běží každých pět minut.");
  const message = node("p", "spend-message", "Přehled se načte při zobrazení této sekce.");
  const body = node("div");
  section.append(header, caveat, message, body);
  let active = false;
  let busy = false;
  let lastAttempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    clearTimeout(timer);
    if (active && !document.hidden) timer = setTimeout(() => { void update(); }, 120000);
  }
  async function update() {
    if (busy) return;
    busy = true;
    lastAttempt = Date.now();
    refresh.disabled = true;
    body.setAttribute("aria-busy", "true");
    message.hidden = false;
    message.classList.remove("is-error");
    message.removeAttribute("role");
    message.textContent = "Načítání nákladů…";
    try {
      body.replaceChildren(renderSpend(await loadSpend()));
      message.hidden = true;
    } catch (error) {
      message.classList.add("is-error");
      message.setAttribute("role", "alert");
      message.textContent = `${error instanceof Error ? error.message : "Načtení nákladů selhalo. Obnovte přehled."}${body.childElementCount ? " Níže zůstává poslední úspěšně načtený přehled; není aktuální." : ""}`;
    } finally {
      busy = false;
      refresh.disabled = false;
      body.setAttribute("aria-busy", "false");
      schedule();
    }
  }
  refresh.addEventListener("click", () => { void update(); });
  const observer = new IntersectionObserver(([entry]) => {
    active = entry?.isIntersecting ?? false;
    if (active && !document.hidden && Date.now() - lastAttempt >= 120000) void update();
    else schedule();
  });
  observer.observe(section);
  document.addEventListener("visibilitychange", () => {
    if (active && !document.hidden && Date.now() - lastAttempt >= 120000) void update();
    else schedule();
  });
  window.addEventListener("pagehide", () => { clearTimeout(timer); observer.disconnect(); }, { once: true });
  return section;
}
