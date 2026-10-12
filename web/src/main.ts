import "./styles.css";
import { parseUser } from "./auth";
import { blobUrl, loadDataLink } from "./data";
import { curlExample, loadTeamKey, maskKey, pythonExample, type KeyResult, type TeamKey } from "./key";
import {
  environment, formatDate, formatSize, parseCatalog,
  type Catalog, type DataFile, type ModelDeployment,
} from "./catalog";

const app = document.getElementById("app");
const notification = document.getElementById("notification");
if (!app || !notification) throw new Error("Chybí kořen aplikace.");
const root = app;
const notice = notification;
let noticeTimeout: ReturnType<typeof setTimeout> | undefined;

const githubEnrollmentUrl = "https://polite-glacier-0ea2cfe0f.7.azurestaticapps.net/#token=eyJ2IjoyLCJpc3N1ZSI6NTQwLCJvcmciOiJoYWNrYXRob24tZ3JlZW4tc25haWwtNzciLCJldmVudCI6IlJha2F0aG9uIDIwMjYiLCJkYXRlIjoiMjAyNi0xMC0xNiIsIm9yZ2FuaXplcnMiOlsibWFjaHYiLCJtaWNoYWxtYXIiLCJtc3VjaGFyZGEiXSwiZXhwIjoxNzkyMzY4MDAwfQ.tyLHxXawYCtMnXRn2KokxxcrLE9eO_cnYh_oqcX5zn8";

const icons = {
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  external: '<path d="M14 3h7v7M21 3 10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  models: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  files: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z"/>',
  zone: '<path d="M12 3 4.5 6v5.2c0 4.6 3.2 8.1 7.5 9.8 4.3-1.7 7.5-5.2 7.5-9.8V6L12 3Z"/><path d="M8.5 12h7M12 8.5v7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  code: '<path d="m8 5-7 7 7 7m8-14 7 7-7 7m-3-16-2 18"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 21h14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
} as const;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = "", text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name: keyof typeof icons): SVGElement {
  const wrapper = element("span");
  wrapper.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
  const svg = wrapper.querySelector("svg");
  if (!svg) throw new Error("Chybí ikona.");
  return svg;
}

function notify(message: string, error = false): void {
  clearTimeout(noticeTimeout);
  notice.textContent = message;
  notice.classList.toggle("is-error", error);
  notice.setAttribute("role", error ? "alert" : "status");
  notice.hidden = false;
  noticeTimeout = setTimeout(() => { notice.hidden = true; }, 6000);
}

async function json(path: string): Promise<unknown> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", redirect: "error" });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Přihlášení vypršelo nebo nemáte přístup. Přihlaste se znovu.");
    }
    if (response.status === 404) {
      if (path === "/.auth/me") {
        throw new Error("Easy Auth není dostupné. Tento build musí běžet v Azure Static Web Apps s nakonfigurovaným přihlášením.");
      }
      throw new Error("Katalog není připravený. Správce musí načíst Azure údaje a znovu publikovat aplikaci.");
    }
    throw new Error(`Katalog se nepodařilo načíst (HTTP ${response.status}). Zkuste stránku načíst znovu.`);
  }
  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    throw new Error("Server nevrátil katalog. Přihlaste se znovu nebo kontaktujte správce.");
  }
  return response.json();
}

function action(label: string, iconName: keyof typeof icons, handler: () => void): HTMLButtonElement {
  const button = element("button", "icon-button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(icon(iconName));
  button.addEventListener("click", handler);
  return button;
}

async function copy(value: string, label: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Schránka není dostupná. Označte údaj a zkopírujte jej ručně.");
  }
  await navigator.clipboard.writeText(value);
  notify(`${label} zkopírován do schránky.`);
}

function copyField(label: string, value: string, accessibleLabel: string): HTMLElement {
  const field = element("div", "connection-field");
  const row = element("div", "connection-value");
  row.append(element("code", "copy-value", value), action(accessibleLabel, "copy", () => {
    copy(value, label).catch(() => notify("Kopírování se nezdařilo. Označte údaj a zkopírujte jej ručně.", true));
  }));
  field.append(element("span", "field-label", label), row);
  return field;
}

function externalLink(label: string, href: string, primary = false): HTMLAnchorElement {
  const link = element("a", primary ? "button primary-button" : "text-link", label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.append(icon("external"));
  link.setAttribute("aria-label", `${label} (otevře novou kartu)`);
  return link;
}

function plural(count: number, one: string, few: string, many: string): string {
  const form = new Intl.PluralRules("cs-CZ").select(count);
  return `${count} ${form === "one" ? one : form === "few" ? few : many}`;
}

const providerPresentation: Record<ModelDeployment["format"], { name: string; logo?: string; wordmark?: string }> = {
  OpenAI: { name: "OpenAI", logo: "/provider-openai.svg" },
  xAI: { name: "xAI", wordmark: "xAI" },
  DeepSeek: { name: "DeepSeek", logo: "/provider-deepseek.svg" },
  Microsoft: { name: "Microsoft AI", logo: "/microsoft-logo.png" },
  MoonshotAI: { name: "Moonshot AI / Kimi", logo: "/provider-kimi.ico" },
};

function providerMark(format: ModelDeployment["format"]): HTMLElement {
  const provider = providerPresentation[format];
  const mark = element("span", `provider-mark provider-${format.toLowerCase()}`);
  mark.title = provider.name;
  mark.setAttribute("aria-label", provider.name);
  if (provider.logo) {
    const image = element("img", "provider-logo");
    image.src = provider.logo;
    image.alt = "";
    mark.append(image);
  } else {
    mark.append(element("span", "provider-wordmark", provider.wordmark));
  }
  return mark;
}

function deploymentType(model: ModelDeployment): HTMLElement {
  const global = model.sku === "GlobalStandard";
  const badge = element("span", `deployment-type ${global ? "deployment-global" : "deployment-zone"}`);
  badge.append(icon(global ? "globe" : "zone"), document.createTextNode(global ? "Global" : "EU Data Zone"));
  badge.title = global
    ? "Global Standard: požadavky mohou být zpracované v libovolném podporovaném Azure regionu."
    : "Data Zone Standard: zpracování zůstává v evropské datové zóně.";
  return badge;
}

function throughput(model: ModelDeployment): string {
  if (model.model.startsWith("MAI-Image")) return `${model.capacity} image RPM`;
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(model.capacity / 1000)}M TPM`;
}

function modelCard(model: ModelDeployment, catalog: Catalog): HTMLElement {
  const card = element("details", "model-card");
  const summary = element("summary", "model-summary");
  const heading = element("div", "model-heading");
  const name = element("div");
  const title = element("div", "model-title");
  title.append(providerMark(model.format), element("h3", "", model.model));
  name.append(title, element("p", "model-version", `Verze ${model.version}`), deploymentType(model));
  const state = element("span", model.state === "Succeeded" ? "status-tag" : "status-tag status-pending",
    model.state === "Succeeded" ? "Nasazený" : model.state);
  const summaryStatus = element("span", "model-summary-status");
  const toggle = element("span", "model-toggle");
  toggle.setAttribute("aria-hidden", "true");
  summaryStatus.append(state, toggle);
  heading.append(name, summaryStatus);
  summary.append(heading);
  const body = element("div", "model-body");
  const metadata = element("p", "model-metadata", `${catalog.foundry.location} · ${throughput(model)}`);
  metadata.title = `Kapacita deploymentu: ${model.capacity}`;
  body.append(metadata);
  body.append(
    copyField("Deployment / model v SDK", model.deployment, `Kopírovat deployment ${model.model}`),
    copyField("APIM gateway (OpenAI v1)", catalog.gateway.endpoint, `Kopírovat endpoint ${model.model}`),
  );

  const keyField = element("div", "connection-field key-field");
  keyField.append(element("span", "field-label", "API klíč"));
  const keyNote = element("p", "key-unavailable", "Klíč vašeho týmu najdete výše v sekci „Váš API klíč“ (hlavička api-key).");
  keyNote.prepend(icon("lock"));
  keyField.append(keyNote);
  body.append(keyField);
  card.append(summary, body);
  return card;
}

function keyStateBadge(state: TeamKey["state"]): HTMLElement {
  if (state === "active") return element("span", "status-tag", "aktivní");
  if (state === "suspended") return element("span", "status-tag status-blocked", "zablokováno – rozpočet");
  return element("span", "status-tag status-pending", "neznámý stav");
}

function keyMessage(text: string, iconName: keyof typeof icons = "lock"): HTMLElement {
  const note = element("div", "auth-notice key-message");
  note.append(icon(iconName), element("p", "", text));
  return note;
}

function keyCard(team: TeamKey): HTMLElement {
  const card = element("div", "key-card");
  const head = element("div", "key-card-head");
  head.append(element("h3", "", `Tým ${team.team}`), keyStateBadge(team.state));
  card.append(head);
  if (team.state === "suspended") {
    card.append(keyMessage("Přístup týmu je zablokovaný, protože byl vyčerpán rozpočet. Klíč zůstává stejný; po odblokování organizátory začne znovu fungovat.", "zone"));
  }
  let revealed = false;
  const field = element("div", "connection-field");
  const row = element("div", "connection-value");
  const value = element("code", "copy-value key-value", maskKey(team.key));
  value.setAttribute("aria-label", "API klíč (skrytý)");
  const reveal = action("Zobrazit API klíč", "eye", () => {
    revealed = !revealed;
    value.textContent = revealed ? team.key : maskKey(team.key);
    value.setAttribute("aria-label", revealed ? "API klíč" : "API klíč (skrytý)");
    reveal.setAttribute("aria-label", revealed ? "Skrýt API klíč" : "Zobrazit API klíč");
    reveal.title = reveal.getAttribute("aria-label") ?? "";
  });
  row.append(value, reveal, action("Kopírovat API klíč", "copy", () => {
    copy(team.key, "API klíč").catch(() => notify("Kopírování se nezdařilo. Klíč zobrazte a zkopírujte jej ručně.", true));
  }));
  field.append(element("span", "field-label", "API klíč (hlavička api-key)"), row);
  card.append(field, copyField("Base URL (OpenAI v1)", team.baseUrl, "Kopírovat base URL"));
  const example = element("details", "portal-guide");
  example.append(element("summary", "", "Příklad volání (curl / Python)"));
  example.append(element("p", "guide-note", "Do proměnné prostředí API_KEY vložte svůj klíč; <deployment> nahraďte názvem nasazeného modelu."));
  example.append(element("pre", "code-example", curlExample(team.baseUrl)), element("pre", "code-example", pythonExample(team.baseUrl)));
  card.append(example);
  return card;
}

function keySection(): HTMLElement {
  const section = element("section", "content-section");
  section.id = "klic";
  section.setAttribute("aria-labelledby", "key-heading");
  const header = element("div", "section-heading");
  const title = element("div");
  const heading = element("h2", "", "Váš API klíč");
  heading.id = "key-heading";
  title.append(heading, element("p", "section-description", "Klíč je vázaný na váš tým a platí pro všechny modely přes APIM gateway."));
  header.append(title);
  const content = element("div", "key-content");
  content.setAttribute("aria-live", "polite");
  content.append(element("p", "key-unavailable", "Načítám klíč vašeho týmu…"));
  section.append(header, content);
  const fallback = "Klíč týmu najdete také v předaném souboru teamNN.md.";
  function show(result: KeyResult): void {
    if (result.status === "ok") {
      content.replaceChildren(keyCard(result.key));
    } else if (result.status === "no-team") {
      content.replaceChildren(keyMessage(`Tento účet není týmový, proto pro něj klíč neexistuje. ${fallback}`));
    } else if (result.status === "unauthenticated") {
      content.replaceChildren(keyMessage("Přihlášení vypršelo. Přihlaste se znovu a stránku načtěte znovu."));
    } else {
      const retry = element("button", "button primary-button", "Zkusit znovu");
      retry.type = "button";
      retry.addEventListener("click", load);
      content.replaceChildren(keyMessage(`Klíč se nepodařilo načíst. ${fallback}`), retry);
    }
  }
  function load(): void {
    loadTeamKey().then(show).catch(() => show({ status: "error" }));
  }
  load();
  return section;
}

function fileAction(label: string, iconName: keyof typeof icons, handler: (button: HTMLButtonElement) => Promise<void>): HTMLButtonElement {
  const button = element("button", "file-action");
  button.type = "button";
  button.append(icon(iconName), element("span", "", label));
  button.addEventListener("click", () => {
    button.disabled = true;
    handler(button).finally(() => { button.disabled = false; });
  });
  return button;
}

function fileRow(file: DataFile): HTMLTableRowElement {
  const row = element("tr");
  const nameCell = element("td");
  const name = element("div", "file-name");
  name.append(icon("files"), element("span", "", file.name));
  nameCell.append(name);
  const extension = file.name.split(".").at(-1);
  const kind = extension && extension.length <= 8 ? extension.toUpperCase() : "BLOB";
  const kindCell = element("td", "file-kind");
  kindCell.append(element("span", "file-type", kind));
  kindCell.title = file.contentType;
  const sizeCell = element("td", "file-size", formatSize(file.size));
  const modifiedCell = element("td", "file-modified", formatDate(file.lastModified));
  modifiedCell.title = file.lastModified;
  const actionsCell = element("td", "file-actions");
  const actions = element("div", "file-action-group");
  actions.append(
    fileAction("Stáhnout", "download", async () => {
      const result = await loadDataLink(file.name);
      if (result.status === "ok") {
        const link = element("a");
        link.href = result.link.downloadUrl;
        link.rel = "noopener noreferrer";
        link.download = file.name.split("/").at(-1) || "download";
        document.body.append(link);
        link.click();
        link.remove();
        notify(`Stahování souboru ${file.name} bylo zahájeno.`);
      } else if (result.status === "not-found") {
        notify("Soubor už ve storage není. Správce musí obnovit katalog.", true);
      } else if (result.status === "unauthenticated") {
        notify("Přihlášení vypršelo nebo tento účet není týmový. Přihlaste se znovu.", true);
      } else {
        notify("Odkaz ke stažení se nepodařilo vytvořit. Zkuste to znovu.", true);
      }
    }),
    fileAction("Kopírovat URL", "link", async () => {
      try {
        await copy(blobUrl(file.name), "URL souboru");
      } catch {
        notify("Kopírování URL se nezdařilo. Zkuste to znovu.", true);
      }
    }),
  );
  actionsCell.append(actions);
  row.append(nameCell, kindCell, sizeCell, modifiedCell, actionsCell);
  return row;
}

function storageSection(catalog: Catalog): HTMLElement {
  const section = element("section", "content-section");
  section.id = "data";
  section.setAttribute("aria-labelledby", "data-heading");
  const header = element("div", "section-heading");
  const title = element("div");
  const heading = element("h2", "", "Datové podklady pouze pro výzvy VZP");
  heading.id = "data-heading";
  title.append(heading, element("p", "section-description", `${catalog.storage.name} / ${catalog.storage.container}`));
  header.append(title);
  section.append(header);

  const toolbar = element("div", "file-toolbar");
  const count = element("p", "file-count", plural(catalog.storage.files.length, "soubor", "soubory", "souborů"));
  count.setAttribute("aria-live", "polite");
  const searchLabel = element("label", "search-label");
  searchLabel.append(element("span", "sr-only", "Najít soubor podle názvu"));
  const search = element("input", "search-input");
  search.type = "search";
  search.placeholder = "Najít soubor…";
  searchLabel.append(search);
  toolbar.append(count, searchLabel);
  section.append(toolbar);

  const tableWrap = element("div", "file-table-wrap");
  const table = element("table", "file-table");
  table.setAttribute("aria-label", "Soubory v containeru data");
  table.innerHTML = '<thead><tr><th scope="col">Soubor</th><th scope="col" class="file-kind">Typ</th><th scope="col" class="file-size">Velikost</th><th scope="col" class="file-modified">Změněno</th><th scope="col" class="file-actions">Akce</th></tr></thead>';
  const body = element("tbody");
  table.append(body);
  tableWrap.append(table);
  section.append(tableWrap);
  function renderFiles(): void {
    const query = search.value.trim().toLocaleLowerCase("cs-CZ");
    const files = catalog.storage.files.filter((file) => file.name.toLocaleLowerCase("cs-CZ").includes(query));
    body.replaceChildren(...files.map(fileRow));
    if (files.length === 0) {
      const cell = element("td", "empty-state", query
        ? "Žádný soubor neodpovídá hledání. Změňte nebo vymažte hledaný název."
        : "Container data byl v době exportu prázdný.");
      cell.colSpan = 5;
      const row = element("tr");
      row.append(cell);
      body.append(row);
    }
    count.textContent = query
      ? `${files.length} z ${catalog.storage.files.length} souborů`
      : plural(files.length, "soubor", "soubory", "souborů");
  }
  search.addEventListener("input", renderFiles);
  renderFiles();

  const guide = element("details", "portal-guide");
  guide.open = true;
  guide.append(element("summary", "", "Jak data použít v projektu"));
  const steps = element("ol", "guide-steps");
  const step1 = element("li");
  step1.append(document.createTextNode("Tlačítko Stáhnout vytvoří krátkodobý odkaz a stáhne soubor přímo z portálu."));
  const step2 = element("li");
  step2.append(document.createTextNode("Tlačítko Kopírovat URL vloží stabilní adresu blobu pro SDK, notebook nebo aplikaci."));
  const step3 = element("li");
  step3.append(document.createTextNode("Při použití URL v projektu se přihlaste přes Microsoft Entra ID; storage zůstává privátní a anonymní URL nefunguje."));
  steps.append(step1, step2, step3);
  guide.append(steps, element("p", "guide-note",
    "Týmový účet potřebuje roli Storage Blob Data Reader. Odkaz ke stažení z portálu je pouze pro čtení a vyprší za pět minut."));
  section.append(guide);
  return section;
}

function githubSection(): HTMLElement {
  const section = element("section", "content-section");
  section.id = "github";
  section.setAttribute("aria-labelledby", "github-heading");
  const header = element("div", "section-heading");
  const title = element("div");
  const heading = element("h2", "", "GitHub pro hackathon");
  heading.id = "github-heading";
  title.append(heading, element("p", "section-description",
    "Připojte svůj účet GitHub.com k organizaci akce. Registrace je oddělená od přihlášení do Azure."));
  header.append(title);
  section.append(header);

  const layout = element("div", "enrollment-layout");
  const instructions = element("div", "enrollment-instructions");
  instructions.append(externalLink("Registrovat se do GitHub hackathonu", githubEnrollmentUrl, true));
  const steps = element("ol", "guide-steps enrollment-steps");
  steps.append(
    element("li", "", "Otevřete registrační stránku tlačítkem nebo naskenujte QR kód. Ověřte, že se zobrazuje akce Rakathon 2026."),
    element("li", "", "Zvolte Sign in with GitHub a přihlaste se osobním účtem GitHub.com, který chcete používat během akce. Pokud účet nemáte, zvolte Create a GitHub account. Enterprise Managed User (EMU) účty nejsou podporované."),
    element("li", "", "Přečtěte si Participation Agreement včetně dopadu na licenci Copilotu. Pokud s podmínkami souhlasíte, potvrďte je a zvolte Request organization invitation."),
    element("li", "", "Dokončete přijetí pozvánky podle pokynů registrační stránky. Pokud odkaz vypršel nebo pozvánka nepřijde, kontaktujte organizátory."),
  );
  instructions.append(steps, element("p", "enrollment-account-note",
    "Použijte GitHub účet, nikoli týmový Azure účet. Do registrační stránky nevkládejte TAP ani API klíč."));
  const qr = element("figure", "enrollment-qr");
  const qrLink = externalLink("Otevřít registraci z QR kódu", githubEnrollmentUrl);
  qrLink.className = "enrollment-qr-link";
  qrLink.replaceChildren();
  const qrImage = element("img");
  qrImage.src = "/github-enrollment-qr.png";
  qrImage.alt = "QR kód s úplným registračním odkazem na GitHub hackathon Rakathon 2026";
  qrImage.width = 600;
  qrImage.height = 600;
  qrLink.append(qrImage);
  qr.append(qrLink, element("figcaption", "", "Naskenujte pro registraci"));
  layout.append(instructions, qr);
  section.append(layout);

  const warning = element("div", "auth-notice enrollment-warning");
  warning.append(icon("zone"), element("p", "",
    "Podmínky registrace upozorňují na zrušení stávajícího individuálního předplatného Copilotu při připojení; zvažte samostatný GitHub účet pro akci. Organizace je veřejná a po akci se smaže: nezveřejňujte citlivá data ani klíče a včas si uložte svou práci. U firemní licence postupujte podle pokynů k nastavení Usage billed to na registrační stránce."));
  section.append(warning);
  const preview = element("figure", "enrollment-preview");
  const screenshot = element("img");
  screenshot.src = "/github-enrollment.png";
  screenshot.alt = "Registrační stránka Rakathon 2026 s tlačítky Sign in with GitHub a Create a GitHub account";
  screenshot.width = 2690;
  screenshot.height = 1660;
  screenshot.loading = "lazy";
  const screenshotLink = externalLink("Otevřít náhled registrace v plné velikosti", "/github-enrollment.png");
  screenshotLink.className = "enrollment-preview-link";
  screenshotLink.replaceChildren(screenshot);
  preview.append(screenshotLink, element("figcaption", "", "Náhled registrační stránky; kliknutím otevřete plnou velikost. Aktuální stav akce a podmínky ověřte po otevření registračního odkazu."));
  section.append(preview);
  return section;
}

function render(catalog: Catalog, user: string): void {
  root.replaceChildren();
  root.className = "app-layout";
  const sidebar = element("header", "sidebar");
  sidebar.innerHTML = '<a class="brand" href="#main" aria-label="Rakathon podporují VZP a Microsoft, začátek stránky"><span class="brand-logos" aria-hidden="true"><img class="supporter-logo supporter-logo-vzp" src="/vzp-logo.png" alt=""><span class="brand-divider"></span><img class="supporter-logo supporter-logo-microsoft" src="/microsoft-logo.png" alt=""></span></a><p class="sidebar-description">Modely, přístupové údaje a sdílená data pro soutěžní týmy</p>';
  const nav = element("nav", "navigation");
  nav.setAttribute("aria-label", "Sekce katalogu");
  const modelsLink = element("a", "nav-link", "Modely");
  modelsLink.href = "#modely";
  modelsLink.prepend(icon("models"));
  modelsLink.append(element("span", "nav-count", String(catalog.foundry.models.length)));
  const dataLink = element("a", "nav-link", "Datové podklady pouze pro výzvy VZP");
  dataLink.href = "#data";
  dataLink.prepend(icon("files"));
  dataLink.append(element("span", "nav-count", String(catalog.storage.files.length)));
  const keyLink = element("a", "nav-link", "Váš API klíč");
  keyLink.href = "#klic";
  keyLink.prepend(icon("lock"));
  const githubLink = element("a", "nav-link", "GitHub");
  githubLink.href = "#github";
  githubLink.prepend(icon("code"));
  nav.append(keyLink, modelsLink, dataLink, githubLink);
  sidebar.append(nav);
  const access = element("div", "sidebar-access");
  access.append(icon("lock"), element("p", "", "Jen pro Rakathon tenant"));
  const tenant = element("code", "tenant-id", environment.tenantId);
  tenant.title = "ID Microsoft Entra tenantu";
  access.append(tenant);
  sidebar.append(access);

  const main = element("main", "main-content");
  main.id = "main";
  const topbar = element("div", "topbar");
  topbar.append(element("span", "snapshot-label", "Statický katalog"));
  const identity = element("div", "identity");
  identity.append(element("span", "identity-name", user));
  if (!import.meta.env.DEV) {
    const logout = element("a", "logout-link", "Odhlásit");
    logout.href = "/.auth/logout?post_logout_redirect_uri=%2F";
    identity.append(logout);
  }
  const topbarActions = element("div", "topbar-actions");
  const azurePortal = externalLink("Azure Portal", "https://portal.azure.com/", true);
  azurePortal.classList.add("azure-portal-button");
  const azureLogo = element("img", "azure-portal-logo");
  azureLogo.src = "/azure-logo.svg";
  azureLogo.alt = "";
  azureLogo.width = 24;
  azureLogo.height = 24;
  azurePortal.prepend(azureLogo);
  topbarActions.append(azurePortal, identity);
  topbar.append(topbarActions);
  const intro = element("header", "page-intro");
  intro.append(element("h1", "", "Modely a datové podklady"),
    element("p", "intro-description", "Endpointy pro váš kód. Sdílená data pro vaše nápady."));
  const date = element("time", "snapshot-date", `Stav k ${formatDate(catalog.generatedAt)}`);
  date.dateTime = catalog.generatedAt;
  date.title = "Údaje se mění až při novém exportu a publikování aplikace.";
  intro.append(date);
  main.append(topbar, intro);
  if (import.meta.env.DEV) {
    main.append(element("p", "local-warning", "Lokální náhled bez Easy Auth. Omezení na tenant se uplatní až v Azure Static Web Apps."));
  }

  const models = element("section", "content-section");
  models.id = "modely";
  models.setAttribute("aria-labelledby", "models-heading");
  const header = element("div", "section-heading");
  const title = element("div");
  const heading = element("h2", "", "Nasazené modely");
  heading.id = "models-heading";
  title.append(heading, element("p", "section-description", "V SDK použijte název deploymentu jako hodnotu model."));
  header.append(title, element("span", "snapshot-label", catalog.gateway.name));
  models.append(header);
  const message = element("div", "auth-notice");
  message.append(icon("lock"), element("p", "",
    "Modely volejte přes APIM gateway. Každý tým má vlastní klíč (viz „Váš API klíč“ výše, záloha: soubor teamNN.md); pošlete jej v hlavičce api-key. Tým má rozpočet 1 000 USD – při 90 % upozornění, při 100 % se přístup zablokuje."));
  models.append(message);
  const cards = element("div", "models-grid");
  cards.append(...catalog.foundry.models.map((model) => modelCard(model, catalog)));
  if (catalog.foundry.models.length === 0) cards.append(element("p", "empty-state", "V době exportu nebyl nasazený žádný model."));
  models.append(cards);
  main.append(keySection(), models, storageSection(catalog), githubSection());
  const footer = element("footer", "footer");
  footer.append(element("span", "", "Rakathon · sdílené prostředí"),
    element("span", "", "Privátní data · krátkodobé odkazy pouze pro přihlášené týmy"));
  main.append(footer);
  root.append(sidebar, main);
  root.setAttribute("aria-busy", "false");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Načtení selhalo. Zkuste stránku načíst znovu.";
}

function renderError(error: unknown): void {
  root.className = "";
  const main = element("main", "loading-screen error-screen");
  main.id = "main";
  const brand = element("span", "brand brand-loading");
  brand.setAttribute("aria-label", "Rakathon podporují VZP a Microsoft");
  brand.innerHTML = '<span class="brand-logos" aria-hidden="true"><img class="supporter-logo supporter-logo-vzp" src="/vzp-logo.png" alt=""><span class="brand-divider"></span><img class="supporter-logo supporter-logo-microsoft" src="/microsoft-logo.png" alt=""></span>';
  main.append(brand, element("h1", "", "Katalog se nepodařilo otevřít"),
    element("p", "error-message", errorMessage(error)));
  const retry = element("button", "button primary-button", "Načíst znovu");
  retry.type = "button";
  retry.addEventListener("click", () => window.location.reload());
  main.append(retry);
  if (!import.meta.env.DEV) {
    const login = element("a", "text-link", "Přihlásit přes Microsoft Entra ID");
    login.href = "/.auth/login/aad?post_login_redirect_uri=%2F";
    main.append(login);
  }
  root.replaceChildren(main);
  root.setAttribute("aria-busy", "false");
}

async function start(): Promise<void> {
  const user = import.meta.env.DEV ? "Lokální náhled" : parseUser(await json("/.auth/me"));
  const catalog = parseCatalog(await json("/catalog.json"));
  render(catalog, user);
}

start().catch(renderError);
