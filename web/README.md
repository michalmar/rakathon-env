# Rakathon účastnický portál

Statická SPA v TypeScriptu a Vite, bez MSAL a bez volání Azure z prohlížeče.
Zobrazuje deploymenty Foundry, kopírovatelný APIM gateway endpoint (OpenAI v1)
a názvy deploymentů. Jediné dynamické volání je `GET /api/my-key` (Function
v `infra/rakathon-env/functions/my-key`, připojená k SWA), která přihlášenému
týmu (`teamNN@…`) vrátí jeho vlastní APIM klíč; statický katalog klíče
neobsahuje. Záloha: handoff soubor `teamNN.md`. Karty
rozlišují Global Standard a EU Data Zone a zobrazují poskytovatele modelu. Dále
zobrazuje seznam souborů v `strakathondataq7146n/data` a návod ke stažení
v Azure Portalu. Soubory nestahuje a SAS odkazy negeneruje.

Údaje jsou **snapshot**, nikoli živý přehled. Na stránce je datum exportu.
Exportér pouze čte Azure; nemění infrastrukturu, role, firewall ani autentizaci.
`public/catalog.json` obsahuje při vývoji načtené modely a metadata souborů,
bez klíčů (APIM gateway endpoint místo Foundry endpointu). Je součástí zdrojů, takže aplikaci lze sestavit i bez Azure CLI
a přístupu do Azure.

## Lokální spuštění

Vyžaduje Node.js 22.18+. Azure CLI je potřeba jen pro aktualizaci snapshotu.
Každý terminál nejprve nastavte na správnou Azure konfiguraci:

```bash
export AZURE_CONFIG_DIR="$HOME/.azure-rak"
cd web
npm ci
npm run dev
```

Pro aktualizaci údajů spusťte z adresáře `web` `npm run catalog:refresh`.
Pokud Azure CLI vyžaduje nové přihlášení:

```bash
export AZURE_CONFIG_DIR="$HOME/.azure-rak"
az login --tenant 7f0c84c5-bbea-48b2-bad1-6baf63d0c73c
```

Tenant, subscription a resource names jsou v `src/catalog.ts`. Exportér je
ověří a všechny příkazy explicitně omezí na cílovou subscription. Pro výpis
blobů používá Entra ID, nikoli Storage access key. Načte všechny aktuální
bloby; jejich obsah nestahuje.

`npm run dev` naslouchá pouze na localhostu a zřetelně označuje náhled
**bez Easy Auth**. Není to bezpečný produkční hosting. Produkční build
neobsahuje tento development bypass.

## API klíče a přístup týmů

Katalog klíče **neexportuje ani nepublikuje**. Klíč týmu se po přihlášení
načítá za běhu z `/api/my-key` (UPN `teamNN@…` → APIM subscription `teamNN`),
drží se jen v paměti stránky, je maskovaný (zobrazit/kopírovat) a odpověď má
`Cache-Control: no-store`. Účty mimo týmy dostanou hlášku bez klíče; při
zablokování rozpočtem se ukáže stav „zablokováno – rozpočet“. Dříve sdílený klíč Foundry se do
katalogu nedostává a soubor `public/catalog-keys.json` už neexistuje (export jej
při spuštění smaže a build selže, pokud se objeví). Modely se volají přes APIM
gateway `https://apim-rakathon-q7146n.azure-api.net/openai/v1`; `model` v těle
je název deploymentu. Každý tým má vlastní APIM subscription `teamNN` a klíč,
který vidí v portálu a také dostane v handoff souboru
`team-user-access/teamNN.md` vygenerovaném skriptem `create-team-users`. Klíč se posílá v hlavičce `api-key`
(OpenAI SDK: `default_headers={"api-key": KEY}`).

Rozpočet týmu je 1 000 USD: při 90 % přijde upozornění, při 100 % se přístup
zablokuje (suspend subscription). Správce přístup týmu vypne/obnoví příkazem
`infra/rakathon-env/scripts/set-team-access.sh teamNN on|off` (viz README
infrastruktury). Portál přístup nemění, jen zobrazuje stav subscription.
Backend `my-key` se nasazuje zvlášť (`infra/rakathon-env/scripts/deploy-my-key.sh`).

## Azure Static Web Apps a Easy Auth

Tenant-specific vlastní Entra provider vyžaduje **SWA Standard**. Soubor
`public/staticwebapp.config.json` se při buildu zkopíruje do kořene `dist`.

Infrastrukturu spravuje `infra/rakathon-env/shared/portal.tf`: SWA Standard v
East US 2, single-tenant Entra registraci, enterprise application, Web
callback a secret v SWA application settings. Foundry a Storage zůstávají ve
Sweden Central. Registrace používá `AzureADMyOrg`; frontend nepotřebuje
SPA/MSAL redirect URI ani oprávnění k Azure API.

Nasazující identita potřebuje také Entra oprávnění vytvářet aplikace, například
roli **Application Developer**. Azure RBAC Contributor nebo Owner samotný
nestačí. Secret `RAKATHON_AUTH_CLIENT_SECRET` je jen v Azure nastavení a
citlivém remote Terraform state; nikdy ve Vite proměnných nebo zdrojích.
Přihlašovací secret má platnost 90 dní. Rotaci proveďte před datem v outputu
`portal_auth_secret_expires_at` explicitním nahrazením
`azuread_application_password.portal` v zkontrolovaném Terraform plánu.

Po úspěšném Terraform apply publikujte z adresáře `web`:

```bash
export AZURE_CONFIG_DIR="$HOME/.azure-rak"
cd web
npm run deploy
```

Příkaz obnoví snapshot (bez klíčů), sestaví aplikaci a publikuje obsah `dist`
do **production** prostředí. SWA deployment token načte pouze do paměti procesu;
neukládá ho do konfigurace ani keychainu.

Na Apple Silicon nemá Azure Static Web Apps deployment client nativní macOS
ARM64 build. Deploy skript proto použije již spuštěný Docker a oficiální Azure
image `mcr.microsoft.com/appsvc/staticappsclient:stable`; token předá pouze
proměnnou prostředí. GitHub Actions ani propojení repository nejsou potřeba.

Po prvním nasazení ověřte anonymní ochranu `/`, `/catalog.json` a assetů
a správný tenant přihlašovacího redirectu. Samotný lokální build nepřítomnost
anonymního přístupu na živém hostingu neprokazuje.

Celý web, včetně JSON katalogu a assetů, vyžaduje roli `authenticated`.
Issuer obsahuje konkrétní tenant, nikoli `common` nebo `organizations`.
Vlastní provider vypíná předkonfigurované identity providery. Nepřidávejte
anonymní výjimku pro `/catalog*.json` ani `navigationFallback`, který by mohl
obejít route authorization. Aplikace používá jen kotvy, takže fallback
nepotřebuje. Odpovědi mají `Cache-Control: private, no-store`.

Přihlášení do webu poskytuje přístup ke snapshotu, nikoli oprávnění k Azure
resources. Účastníci pro práci s modely přes Entra a pro stažení dat potřebují
své Azure role. Jednotlivé storage soubory se stahují v Portalu přes
Containers → `data` → vybraný soubor → Download; je třeba `Reader`,
`Storage Blob Data Reader` a povolená síť.

Single-tenant registrace umožňuje i hosty, kteří mají účet v tomto tenantu.
Přístup pouze pro vybrané účastníky lze navíc omezit přiřazováním uživatelů
v Entra enterprise application.

## Aktualizace a ověření

Po změně deploymentů nebo souborů znovu spusťte export a build a znovu
publikujte `dist`. Export klíče nečte (klíč týmu čte až Function `my-key`); účastníci nepotřebují žádná oprávnění
k Foundry ani APIM.

```bash
export AZURE_CONFIG_DIR="$HOME/.azure-rak"
cd web
npm run test
npm run build
npm run test:e2e
```

Pro první spuštění browser testů může být potřeba `npx playwright install chromium`.

Dokumentace:
[SWA custom authentication](https://learn.microsoft.com/azure/static-web-apps/authentication-custom),
[SWA route authorization](https://learn.microsoft.com/azure/static-web-apps/configuration).
