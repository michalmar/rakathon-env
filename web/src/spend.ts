import type { ModelDeployment } from "./catalog";
import { providerMark } from "./providers";

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

export function filterSpend(data: Spend, selectedTeam: string | null): Spend {
  if (selectedTeam === null) return data;
  const team = data.teams.find((item) => item.team === selectedTeam);
  if (!team) throw new Error("Vybraný tým není v aktuálním přehledu.");
  const usage = data.usage.filter((item) => item.team === selectedTeam);
  const models = new Map<string, SpendModel>();
  for (const row of usage) {
    let model = models.get(row.deployment);
    if (!model) {
      model = { deployment: row.deployment, costUsd: 0, teamCostUsd: 0, otherCostUsd: 0,
        requests: 0, promptTokens: 0, completionTokens: 0, images: 0 };
      models.set(row.deployment, model);
    }
    for (const key of ["costUsd", "requests", "promptTokens", "completionTokens", "images"] as const) model[key] += row[key];
    model.teamCostUsd += row.costUsd;
  }
  return {
    ...data, teams: [team], usage, models: [...models.values()].sort((a, b) => b.costUsd - a.costUsd),
    hourly: data.hourly.filter((item) => item.team === selectedTeam),
    summary: { costUsd: team.costUsd, teamCostUsd: team.costUsd, otherCostUsd: 0,
      budgetUsd: team.budgetUsd, revokeAtUsd: team.budgetUsd, pct: team.pct, budgetExceeded: team.budgetExceeded },
  };
}

interface SortState { column: number; direction: "ascending" | "descending" }
interface DashboardState {
  selectedTeam: string | null;
  sorts: Map<string, SortState>;
  openDetails: Set<string>;
}
interface Column<T> {
  label: string;
  value: (row: T) => string | number;
  render?: (row: T) => string | HTMLElement;
}

export function compareValues(a: string | number, b: string | number): number {
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "cs", { numeric: true });
}

function table<T>(id: string, title: string, columns: Column<T>[], rows: T[], state: DashboardState, initialSort: SortState): HTMLElement {
  const wrap = node("div", "spend-table-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", `${title} · tabulku lze posouvat vodorovně`);
  const result = node("table", "file-table spend-table");
  result.append(node("caption", "", title));
  const head = node("thead");
  const header = node("tr");
  const sort = state.sorts.get(id) ?? initialSort;
  state.sorts.set(id, sort);
  const headers = columns.map((column, index) => {
    const cell = node("th");
    cell.scope = "col";
    const button = node("button", "spend-sort");
    button.type = "button";
    button.append(node("span", "", column.label), node("span", "spend-sort-arrow"));
    button.addEventListener("click", () => {
      sort.direction = sort.column === index && sort.direction === "ascending" ? "descending" :
        sort.column === index ? "ascending" : rows.length > 0 && typeof columns[index]!.value(rows[0]!) === "number" ? "descending" : "ascending";
      sort.column = index;
      renderRows();
    });
    cell.append(button);
    header.append(cell);
    return cell;
  });
  head.append(header);
  const body = node("tbody");
  function renderRows() {
    headers.forEach((cell, index) => {
      cell.setAttribute("aria-sort", index === sort.column ? sort.direction : "none");
      const button = cell.querySelector("button")!;
      button.setAttribute("aria-label", `Seřadit podle ${columns[index]!.label}`);
      button.lastElementChild!.textContent = index === sort.column ? sort.direction === "ascending" ? "↑" : "↓" : "↕";
    });
    const sorted = [...rows].sort((a, b) => {
      const result = compareValues(columns[sort.column]!.value(a), columns[sort.column]!.value(b));
      return sort.direction === "ascending" ? result : -result;
    });
    body.replaceChildren(...sorted.map((row) => {
      const tr = node("tr");
      for (const [index, column] of columns.entries()) {
        const td = index === 0 ? node("th") : node("td");
        if (index === 0) td.scope = "row";
        const value = column.render?.(row) ?? String(column.value(row));
        if (typeof value === "string") td.textContent = value;
        else td.append(value);
        tr.append(td);
      }
      return tr;
    }));
  }
  renderRows();
  result.append(head, body);
  wrap.append(result);
  return wrap;
}

function disclosure(id: string, label: string, state: DashboardState): HTMLDetailsElement {
  const details = node("details", "portal-guide");
  details.open = state.openDetails.has(id);
  details.append(node("summary", "", label));
  details.addEventListener("toggle", () => {
    if (details.open) state.openDetails.add(id);
    else state.openDetails.delete(id);
  });
  return details;
}

function modelName(deployment: string, catalog: Map<string, ModelDeployment>): HTMLElement {
  const label = node("span", "spend-model-name");
  const model = catalog.get(deployment);
  if (model) label.append(providerMark(model.format));
  else {
    const mark = node("span", "spend-model-unknown", "◇");
    mark.title = "Deployment není v aktuálním katalogu";
    mark.setAttribute("aria-label", "Neznámý poskytovatel");
    label.append(mark);
  }
  label.append(node("span", "", deployment));
  return label;
}

function teamButton(team: string, state: DashboardState, selectTeam: (team: string | null) => void, location: string): HTMLButtonElement {
  const button = node("button", "spend-team-select", team);
  button.type = "button";
  button.dataset.spendFocus = `${location}-${team}`;
  button.setAttribute("aria-label", `Filtrovat tým ${team}`);
  button.setAttribute("aria-pressed", String(state.selectedTeam === team));
  button.addEventListener("click", () => { selectTeam(team); });
  return button;
}

function teamBudgetChart(data: Spend, state: DashboardState, selectTeam: (team: string | null) => void): HTMLElement {
  const figure = node("figure", "spend-rank-chart spend-team-chart");
  figure.append(node("figcaption", "", "Týmy nejblíže limitu"),
    node("p", "section-description", `Seřazeno podle vyčerpání. Značky: varování ${count(data.warnPct)} % a limit 100 %. Kliknutím vyberte tým.`));
  const ranked = [...data.teams].sort((a, b) => b.pct - a.pct || a.team.localeCompare(b.team));
  const maximum = Math.max(100, ...ranked.map((team) => team.pct));
  const list = node("ol", "spend-rank-list");
  for (const team of ranked) {
    const row = node("li", "spend-rank-row");
    row.classList.toggle("is-selected", state.selectedTeam === team.team);
    const button = teamButton(team.team, state, selectTeam, "chart");
    const plot = node("span", "spend-rank-track");
    const bar = node("span", `spend-rank-fill ${team.budgetExceeded ? "is-danger" : team.warning ? "is-warning" : ""}`);
    bar.style.width = `${team.pct / maximum * 100}%`;
    plot.append(bar);
    for (const [pct, className] of [[data.warnPct, "is-warning"], [100, "is-limit"]] as const) {
      const marker = node("span", `spend-rank-marker ${className}`);
      marker.style.left = `${Math.min(pct / maximum * 100, 100)}%`;
      plot.append(marker);
    }
    plot.setAttribute("aria-hidden", "true");
    button.append(plot, node("span", "spend-rank-value", `${count(Math.round(team.pct * 10) / 10)} %`));
    const remaining = team.budgetUsd - team.costUsd;
    const note = remaining < 0 ? `Přes limit o ${usd(-remaining)}` : `Zbývá ${usd(remaining)}`;
    row.append(button, node("span", "spend-rank-note", note));
    list.append(row);
  }
  figure.append(list);
  if (!ranked.length) figure.append(node("p", "empty-state", "Žádné týmy k porovnání."));
  return figure;
}

function modelCostChart(data: Spend, catalog: Map<string, ModelDeployment>): HTMLElement {
  const figure = node("figure", "spend-rank-chart spend-model-chart");
  figure.append(node("figcaption", "", "Největší nákladové položky"),
    node("p", "section-description", "Podíl modelů na dosavadních nákladech vybraného přehledu. Úplný rozpad je v tabulce."));
  const ranked = [...data.models].sort((a, b) => b.costUsd - a.costUsd);
  const total = ranked.reduce((sum, model) => sum + model.costUsd, 0);
  const largest = ranked[0]?.costUsd ?? 0;
  const list = node("ol", "spend-rank-list");
  for (const model of ranked.slice(0, 6)) {
    const row = node("li", "spend-model-rank");
    const label = modelName(model.deployment, catalog);
    const plot = node("span", "spend-rank-track");
    const bar = node("span", "spend-rank-fill");
    bar.style.width = `${largest > 0 ? 100 * model.costUsd / largest : 0}%`;
    plot.append(bar);
    plot.setAttribute("aria-hidden", "true");
    row.append(label, node("span", "spend-rank-value", usd(model.costUsd)), plot,
      node("span", "spend-rank-note", `${count(Math.round((total > 0 ? model.costUsd / total * 100 : 0) * 10) / 10)} % nákladů`));
    list.append(row);
  }
  figure.append(list);
  if (ranked.length > 6) figure.append(node("p", "section-description",
    `Dalších ${count(ranked.length - 6)} modelů: ${usd(ranked.slice(6).reduce((sum, model) => sum + model.costUsd, 0))}. Všechny modely najdete v tabulce.`));
  if (!ranked.length) figure.append(node("p", "empty-state", "Žádná zaznamenaná spotřeba modelů pro tento výběr."));
  return figure;
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

function hourlyChart(data: Spend, state: DashboardState): HTMLElement {
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
  const actualMaximum = Math.max(...points.map((point) => point.team + point.other));
  const maximum = Math.max(actualMaximum, 0.01);
  function shape(tag: "rect" | "text", attributes: Record<string, string>, textValue?: string) {
    const item = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) item.setAttribute(key, value);
    if (textValue) item.textContent = textValue;
    svg.append(item);
    return item;
  }
  shape("text", { x: "8", y: "18", class: "spend-chart-label" }, usd(actualMaximum));
  const peak = points.reduce((best, point) => point.team + point.other > best.team + best.other ? point : best, points[0]!);
  points.forEach((point, index) => {
    const teamHeight = point.team / maximum * 150;
    const otherHeight = point.other / maximum * 150;
    const description = `${when(new Date(point.at).toISOString())}: ${usd(point.team + point.other)}`;
    for (const rect of [
      shape("rect", { x: String(80 + index * 27), y: String(190 - teamHeight), width: "20", height: String(teamHeight), class: "spend-chart-team" }),
      shape("rect", { x: String(80 + index * 27), y: String(190 - teamHeight - otherHeight), width: "20", height: String(otherHeight), class: "spend-chart-other" }),
    ]) {
      const tooltip = document.createElementNS("http://www.w3.org/2000/svg", "title");
      tooltip.textContent = description;
      rect.append(tooltip);
    }
    if (index % 4 === 0) shape("text", { x: String(80 + index * 27), y: "217", class: "spend-chart-label" },
      new Date(point.at).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }));
  });
  const legend = node("p", "spend-legend");
  legend.append(node("span", "spend-legend-team", state.selectedTeam ?? "Týmy"));
  if (!state.selectedTeam) legend.append(node("span", "spend-legend-other", "Ostatní subscriptions"));
  figure.append(title, node("p", "section-description",
    peak.team + peak.other > 0 ? `Nejvyšší hodinový odhad: ${usd(peak.team + peak.other)} · ${when(new Date(peak.at).toISOString())}. Aktuální hodina ještě není úplná.` :
      "Za posledních 24 hodin není pro tento výběr zaznamenaná spotřeba."), svg, legend);
  const details = disclosure("hourly", "Číselné hodnoty hodinového grafu", state);
  details.append(table("hourly", "Hodinový odhad (USD)", [
    { label: "Hodina", value: (point) => point.at, render: (point) => when(new Date(point.at).toISOString()) },
    { label: state.selectedTeam ?? "Týmy", value: (point) => point.team, render: (point) => usd(point.team) },
    { label: "Ostatní", value: (point) => point.other, render: (point) => usd(point.other) },
  ], points, state, { column: 0, direction: "ascending" }));
  figure.append(details);
  return figure;
}

function renderSpend(all: Spend, state: DashboardState, catalog: Map<string, ModelDeployment>, selectTeam: (team: string | null) => void): HTMLElement {
  const data = filterSpend(all, state.selectedTeam);
  const content = node("div", "spend-content");
  const controls = node("div", "spend-filter-bar");
  const filterLabel = node("label", "spend-filter-label", "Tým");
  const filter = node("select", "search-input spend-team-filter");
  filter.setAttribute("aria-label", "Filtrovat přehled podle týmu");
  filter.dataset.spendFocus = "filter";
  const allOption = node("option", "", "Všechny subscriptions");
  allOption.value = "";
  filter.append(allOption);
  for (const team of [...all.teams].sort((a, b) => a.team.localeCompare(b.team))) {
    const option = node("option", "", team.team);
    option.value = team.team;
    filter.append(option);
  }
  filter.value = state.selectedTeam ?? "";
  filter.addEventListener("change", () => { selectTeam(filter.value || null); });
  filterLabel.append(filter);
  const clear = node("button", "button file-action spend-refresh", "Zobrazit vše");
  clear.type = "button";
  clear.dataset.spendFocus = "clear";
  clear.disabled = !state.selectedTeam;
  clear.addEventListener("click", () => { selectTeam(null); });
  const status = node("p", "spend-filter-status", state.selectedTeam ?
    `${state.selectedTeam}: souhrn, modely, rozpad i hodinový graf jsou filtrované. Seznam týmů zůstává pro porovnání.` :
    "Všechny subscriptions včetně provozních účtů. Vyberte tým v tabulce nebo grafu.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  controls.append(filterLabel, clear, status);
  content.append(controls);
  const summary = node("dl", "spend-summary");
  const values = state.selectedTeam ? [
    [`Dosavadní náklady ${state.selectedTeam}`, usd(data.summary.costUsd)], ["Rozpočet týmu", usd(data.summary.budgetUsd)],
    ["Zbývá do týmového limitu", usd(Math.max(0, data.summary.budgetUsd - data.summary.costUsd))],
    ["Celá akce (nefiltrovaná)", usd(all.summary.costUsd)],
  ] : [
    ["Celkový odhad", usd(data.summary.costUsd)], ["Rozpočet akce", usd(data.summary.budgetUsd)],
    ["Týmová spotřeba", usd(data.summary.teamCostUsd)], ["Ostatní subscriptions", usd(data.summary.otherCostUsd)],
    ["Práh celkové blokace", usd(data.summary.revokeAtUsd)],
  ];
  for (const [label, value] of values) {
    const pair = node("div");
    pair.append(node("dt", "", label), node("dd", "", value));
    summary.append(pair);
  }
  const totalMeter = budgetMeter(data.summary.pct);
  totalMeter.classList.add("spend-overall-meter");
  content.append(summary, totalMeter);
  if (all.summary.budgetExceeded) content.append(node("p", "spend-warning", "Dosažen celkový práh pro blokaci. Skutečný stav přístupu je uveden u jednotlivých týmů."));
  if (!data.enforcementEnabled) content.append(node("p", "spend-warning", "Automatické blokování je vypnuté. Překročení rozpočtu samo přístup nezablokuje."));
  const stale = !data.lastSnapshotAt || Date.parse(data.generatedAt) - Date.parse(data.lastSnapshotAt) > 20 * 60000;
  if (stale) content.append(node("p", "spend-warning", "Job řízení nákladů nemá aktuální snapshot (více než 20 minut nebo žádný záznam). Ověřte Logic App; přehled není potvrzením jejího běhu."));
  content.append(node("p", "spend-freshness",
    `Rozpočtové okno od ${when(data.windowStart)}. Načteno ${when(data.generatedAt)}. Poslední zaznamenaná spotřeba celého prostředí: ${when(data.lastUsageAt)}. Snapshot jobu: ${when(data.lastSnapshotAt)}.`));
  const stateLabels: Record<string, string> = { active: "Aktivní", suspended: "Pozastaveno", cancelled: "Zrušeno", submitted: "Čeká na schválení", rejected: "Odmítnuto", expired: "Vypršelo", unavailable: "Stav nedostupný" };
  const budgetLabel = (team: SpendTeam) => team.budgetExceeded ? "Týmový limit dosažen" :
    team.blockedByOverall ? "Celkový práh dosažen" : team.warning ? "Varování" : "Pod limitem";
  const insights = node("div", "spend-insights");
  const scopeTeams = data.teams;
  const breached = scopeTeams.filter((team) => team.budgetExceeded).length;
  const warning = scopeTeams.filter((team) => team.warning && !team.budgetExceeded).length;
  const awaiting = scopeTeams.filter((team) => team.state === "active" && (team.budgetExceeded || team.blockedByOverall)).length;
  insights.append(node("p", breached || warning ? "spend-warning" : "section-description",
    `${count(breached)} týmů na limitu nebo nad ním · ${count(warning)} ve varovném pásmu.`));
  if (awaiting) insights.append(node("p", "spend-warning",
    `${count(awaiting)} týmů dosáhlo prahu, ale APIM přístup je stále aktivní.${all.enforcementEnabled ? " Ověřte poslední běh jobu." : " Automatická blokace je vypnutá."}`));
  const charts = node("div", "spend-overview-charts");
  charts.append(teamBudgetChart(all, state, selectTeam), modelCostChart(data, catalog));
  content.append(insights, charts);
  if (all.teams.length) content.append(table("teams", "Týmy · rozpočet a skutečný stav APIM", [
    { label: "Tým", value: (team) => team.team, render: (team) => teamButton(team.team, state, selectTeam, "table") },
    { label: "Odhad USD", value: (team) => team.costUsd, render: (team) => usd(team.costUsd) },
    { label: "Rozpočet USD", value: (team) => team.budgetUsd, render: (team) => usd(team.budgetUsd) },
    { label: "Vyčerpání", value: (team) => team.pct, render: (team) => budgetMeter(team.pct) },
    { label: "Rozpočtový stav", value: budgetLabel },
    { label: "Přístup APIM", value: (team) => stateLabels[team.state] ?? `Jiný stav: ${team.state}` },
  ], all.teams, state, { column: 3, direction: "descending" }));
  else content.append(node("p", "empty-state", "Žádné týmové subscriptions ani týmová spotřeba."));
  if (data.models.length) content.append(table("models", "Modely · odhad za celé rozpočtové okno", [
    { label: "Deployment", value: (model) => model.deployment, render: (model) => modelName(model.deployment, catalog) },
    { label: "Odhad USD", value: (model) => model.costUsd, render: (model) => usd(model.costUsd) },
    { label: "Z toho týmy", value: (model) => model.teamCostUsd, render: (model) => usd(model.teamCostUsd) },
    { label: "Ostatní", value: (model) => model.otherCostUsd, render: (model) => usd(model.otherCostUsd) },
    { label: "Požadavky", value: (model) => model.requests, render: (model) => count(model.requests) },
    { label: "Vstupní tokeny", value: (model) => model.promptTokens, render: (model) => count(model.promptTokens) },
    { label: "Výstupní tokeny", value: (model) => model.completionTokens, render: (model) => count(model.completionTokens) },
    { label: "Obrázky", value: (model) => model.images, render: (model) => count(model.images) },
  ], data.models, state, { column: 1, direction: "descending" }));
  else content.append(node("p", "empty-state", "V rozpočtovém okně zatím není zaznamenaná spotřeba modelů."));
  const details = disclosure("usage", "Rozpad tým × deployment", state);
  if (data.usage.length) details.append(table("usage", "Spotřeba podle subscription a deploymentu", [
    { label: "Subscription", value: (row) => row.team },
    { label: "Deployment", value: (row) => row.deployment, render: (row) => modelName(row.deployment, catalog) },
    { label: "Odhad USD", value: (row) => row.costUsd, render: (row) => usd(row.costUsd) },
    { label: "Požadavky", value: (row) => row.requests, render: (row) => count(row.requests) },
    { label: "Vstupní tokeny", value: (row) => row.promptTokens, render: (row) => count(row.promptTokens) },
    { label: "Výstupní tokeny", value: (row) => row.completionTokens, render: (row) => count(row.completionTokens) },
    { label: "Obrázky", value: (row) => row.images, render: (row) => count(row.images) },
  ], data.usage, state, { column: 2, direction: "descending" }));
  else details.append(node("p", "empty-state", "Zatím bez zaznamenané spotřeby."));
  content.append(details, hourlyChart(data, state));
  return content;
}

export function spendSection(models: ModelDeployment[] = []): HTMLElement {
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
  let data: Spend | undefined;
  const state: DashboardState = { selectedTeam: null, sorts: new Map(), openDetails: new Set() };
  const catalog = new Map(models.map((model) => [model.deployment, model]));
  function render() {
    if (!data) return;
    const focusKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.spendFocus : undefined;
    body.replaceChildren(renderSpend(data, state, catalog, (team) => {
      state.selectedTeam = team;
      render();
    }));
    if (focusKey) {
      const target = [...body.querySelectorAll<HTMLElement>("[data-spend-focus]")].find((item) => item.dataset.spendFocus === focusKey);
      (target ?? body.querySelector<HTMLElement>(".spend-team-filter"))?.focus({ preventScroll: true });
    }
  }
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
      data = await loadSpend();
      if (state.selectedTeam && !data.teams.some((team) => team.team === state.selectedTeam)) state.selectedTeam = null;
      render();
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
