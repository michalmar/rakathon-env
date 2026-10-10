# Rakathon účastnický portál

Jednoduchá statická SPA v TypeScriptu a Vite, bez Functions, MSAL, serverového
API nebo volání Azure z prohlížeče. Zobrazuje deploymenty Foundry, kopírovatelné
OpenAI v1 endpointy a názvy deploymentů, případně skryté API klíče. Karty
rozlišují Global Standard a EU Data Zone a zobrazují poskytovatele modelu. Dále
zobrazuje seznam souborů v `strakathondataq7146n/data` a návod ke stažení
v Azure Portalu. Soubory nestahuje a SAS odkazy negeneruje.

Údaje jsou **snapshot**, nikoli živý přehled. Na stránce je datum exportu.
Exportér pouze čte Azure; nemění infrastrukturu, role, firewall ani autentizaci.
`public/catalog.json` obsahuje při vývoji načtené modely a metadata souborů,
bez klíčů. Je součástí zdrojů, takže aplikaci lze sestavit i bez Azure CLI
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

## API klíče

Foundry `ais-rakathon-q7146n` má autentizaci API klíčem povolenou Terraformem
(`local_auth_enabled = true`). Microsoft Entra ID autentizace zůstává funkční.
Samotná SPA nastavení infrastruktury nemění. Správce může vytvořit nový
snapshot včetně primárního klíče:

```bash
export AZURE_CONFIG_DIR="$HOME/.azure-rak"
cd web
npm run catalog:refresh:keys
npm run build
```

Klíč se načte až při explicitní žádosti o zobrazení nebo kopírování. Zobrazený
klíč se znovu skryje při opuštění karty nebo okna. Nezapisuje se do browser
storage, URL ani logů.

Pouze `public/catalog-keys.json` je secret-bearing soubor, ignorovaný Gitem.
Exportér zapisuje snapshoty s lokálními právy `0600`; klíč nevkládá do
zdrojového kódu ani metadata katalogu. Každý úspěšný export přepíše i soubor
klíče, takže export bez klíčů odstraní dříve zahrnutý klíč. Build kontroluje
shodu generace katalogu a klíče. Soubor klíče není potřeba, pokud snapshot
uvádí `keyIncluded: false`; pokud existuje, musí odpovídat snapshotu a nesmí
obsahovat starý klíč.

**Skrytí klíče v UI není zabezpečení.** Každý přihlášený uživatel tohoto tenantu
může přečíst chráněný statický soubor. To odpovídá účelu sdílení údajů mezi
účastníky. Pokud klíče nejsou určené všem uživatelům tenantu, do katalogu je
nezahrnujte. Build artefakt s klíčem nepublikujte do veřejných CI artefaktů,
GitHub Pages ani nechráněného static website hostingu.

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

Příkaz obnoví snapshot včetně klíče, sestaví aplikaci a publikuje obsah `dist`
do **production** prostředí. SWA deployment token načte pouze do paměti procesu;
neukládá ho do konfigurace ani keychainu.

Na Apple Silicon nemá Azure Static Web Apps deployment client nativní macOS
ARM64 build. Deploy skript proto použije již spuštěný Docker a oficiální Azure
image `mcr.microsoft.com/appsvc/staticappsclient:stable`; token předá pouze
proměnnou prostředí. GitHub Actions ani propojení repository nejsou potřeba.

Při prvním nasazení nejprve publikujte build bez klíče
(`npm run catalog:refresh && npm run build && node scripts/deploy.mjs`).
Ověřte anonymní ochranu `/`, `/catalog.json`, `/catalog-keys.json` a assetů
a správný tenant přihlašovacího redirectu. Teprve potom použijte
`npm run deploy` pro katalog s klíčem. Samotný lokální build nepřítomnost
anonymního přístupu na živém hostingu neprokazuje.

Celý web, včetně JSON katalogu, klíče a assetů, vyžaduje roli `authenticated`.
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

Po změně deploymentů, souborů nebo rotaci klíče znovu spusťte export a build
a znovu publikujte `dist`. Není nutné přidělovat účastníkům oprávnění k výpisu
Foundry klíčů; ty případně načítá jen správce při exportu.

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
