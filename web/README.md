# Rakathon účastnický portál

Statická SPA v TypeScriptu a Vite, bez MSAL a bez přímého volání Azure API
z prohlížeče.
Zobrazuje deploymenty Foundry, kopírovatelný APIM gateway endpoint (OpenAI v1)
a názvy deploymentů. Připojená Function v
`infra/rakathon-env/functions/my-key` poskytuje přihlášenému týmu jeho vlastní
APIM klíč přes `GET /api/my-key` a krátkodobý read-only odkaz ke stažení dat
přes `GET /api/data-link`; statický katalog neobsahuje klíče ani SAS odkazy.
Záloha API klíče: handoff soubor `teamNN.md`. Karty
rozlišují Global Standard a EU Data Zone a zobrazují poskytovatele modelu. Dále
zobrazuje seznam souborů v privátním containeru `data`. Každý soubor lze přímo
stáhnout nebo zkopírovat jeho stabilní Blob URL pro použití v projektu.

Tlačítko **Azure Portal** s logem Azure otevře `https://portal.azure.com/`
v nové kartě. Sekce **GitHub Copilot pro hackathon** na stejné stránce obsahuje návod,
tlačítko pro registraci, QR kód s úplným odkazem včetně event tokenu a náhled
registrační stránky. Účastníci použijí osobní GitHub.com účet, nikoli Azure
účet; EMU účty nejsou podporované. Podmínky registrace zahrnují dopad na Copilot licenci. Sekce GitHub Copilot
obsahuje zdroje z profilu privátní organizace
`hackathon-green-snail-77/.github-private/profile/README.md`,
GitHub Skills a návody pro IDE a prompt engineering. Upozorňuje na odstranění
organizace a jejího obsahu **19. října 2026**. Menu uvádí **GitHub Copilot**
a používá lokální GitHub logo.
Odkaz je uložený v `src/main.ts`, obrázky v `public/github-enrollment*.png`.
Při změně či expiraci event odkazu aktualizujte současně URL i QR kód.

Sekce **Examples** nabízí sbalené návody s kopírováním kódu: přihlášení Azure
CLI a výběr subscription, Python Hello world přes Responses API a týmový APIM
klíč, publikování vlastního statického frontendu do SWA a týmové ACA prostředí
pro web/backend a jednorázový job. ACA Sandbox zde znamená testovací Container
Apps prostředí v týmové resource group, nikoli bezplatnou sandbox službu.
Návody používají zástupné hodnoty, nenahrávají klíče a nic samy nenasazují.
Python ukázka vyžaduje GPT deployment podporující Responses API; ne každý model
v katalogu tento endpoint podporuje. SWA a ACA návody upozorňují na veřejné
endpointy, autentizaci, náklady a zacházení s tajemstvími.

Sekce **InterSystems IRIS pro váš tým** předvyplní z přihlášeného UPN
`teamNN@...` vlastní `rg-teamNN` a název kontejneru. První krok nabízí
kopírovatelné `az login` s pokynem přihlásit se týmovým účtem. Druhý krok
zobrazuje dynamický Bash / Azure CLI příkaz `az container create` pro připnutý
IRIS for Health Community image, s pevným regionem `swedencentral`. Příkazy
neobsahují osobní Azure konfiguraci, subscription ani kontrolní skript. Přihlášení,
volbu aktuální subscription, nepoužitý název a heslo řeší účastník.
Účet mimo tým dostane vysvětlení bez příkazu.
Portál infrastrukturu sám nevytváří a nevolá Azure API z prohlížeče.

Heslo vzniká na vyžádání přes Web Crypto, je maskované a zůstává pouze
v paměti stránky (bez storage či odesílání na backend); po obnovení zmizí.
Zkopírované heslo zůstává ve schránce uživatele. Účastník před spuštěním nastaví
Bash proměnnou `IRIS_PASSWORD`; příkaz na ni pouze odkazuje a předá její hodnotu
Azure jako secret volume pro inicializaci IRIS. Heslo se do zobrazeného ani
kopírovaného příkazu nevkládá a generování hesla není podmínkou kopírování.
Regenerování v prohlížeči heslo nasazené instance nemění.
Veřejné porty 52773 (HTTP Management Portal / REST) a 1972 (databázoví klienti)
jsou pouze pro necitlivá testovací data; nejsou chráněné TLS. Nasazení používá
2 vCPU / 2 GiB, restart policy Never a nemá persistentní datový disk.
Návod upozorňuje na ztrátu dat a průběžné účtování nezávislé na blokaci APIM.

Údaje katalogu jsou **snapshot**, nikoli živý přehled. Na stránce je datum exportu.
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
az login --tenant "<tenant-id>"
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

## Odhad nákladů pro účty mimo tým

Sekce **Náklady** a její menu jsou dostupné pouze přihlášeným Entra účtům,
jejichž UPN nemá lokální část přesně `teamNN` (bez ohledu na velikost písmen).
Týmové účty sekci nevidí a backend odmítá jejich `GET /api/spend` odpovědí
403 před dotazováním Azure. Přístup mají všechny ostatní účty povolené
stávajícím single-tenant přihlášením; nejde o samostatnou roli organizátora.
Lokální vývojový náhled bez ověřené identity sekci nezobrazuje.

API ve stávající připojené Function používá managed identity a pevné KQL
dotazy nad `HackathonRequests()`, `HackathonCostStatus()` a
`HackathonCostConfig()`. Ceník a rozpočty zůstávají v Terraform/KQL, nikoli
ve frontendu. Přehled doplňuje stránkovaný seznam APIM subscriptions:
zahrnuje týmy bez spotřeby a zobrazuje skutečný stav APIM odděleně od
překročení rozpočtu. Spotřeba mimo `teamNN` je vyčíslená samostatně, ale
zůstává součástí celkového rozpočtu stejně jako v cost jobu.

Jde o odhad ceny modelů z úspěšných požadavků gateway, ne o fakturované
náklady Azure. Nezahrnuje hosting APIM, další infrastrukturu ani volání
mimo gateway; neodečítá cache slevy a obrázky oceňuje odhadem po požadavcích.
Rozpočty a tabulky pokrývají celé rozpočtové okno, hodinový graf pouze
posledních 24 hodin. Graf má také rozbalitelnou číselnou tabulku.
Peněžní částky používají české číselné formátování, dvě desetinná místa
a označení `USD`; výpočet a data API si zachovávají plnou přesnost.

Kliknutí na tým v tabulce nebo grafu, případně výběr v poli **Tým**, filtruje
souhrn, modelové součty, rozpad subscription × deployment a hodinový graf
současně. **Zobrazit vše** filtr odstraní. Seznam týmů a graf jejich
vyčerpání zůstávají nefiltrované pro porovnání a přepnutí týmu; celková
spotřeba akce je ve vybraném týmovém souhrnu výslovně označená jako
nefiltrovaná. Výběr týmu i řazení se zachovávají při obnově dat.

Kliknutím na záhlaví lze všechny tabulky řadit vzestupně/sestupně;
číselné sloupce se řadí podle původních hodnot, ne zformátovaného textu.
Modely používají stejné ikony poskytovatelů jako katalog; historický
deployment chybějící v katalogu má neutrální ikonu bez odhadování značky.
Graf týmů řadí podle procenta vyčerpaného rozpočtu, ukazuje hranice
varování/limitu a zbývající částku. Graf nákladových položek ukazuje
šest nejdražších modelů, jejich podíl a součet zbývajících modelů;
všechny řádky zůstávají v tabulce. Hodinový graf uvádí nejvyšší hodinový
odhad a upozorňuje, že aktuální hodina je neúplná.

Data se načítají při zobrazení sekce a obnovují každé dvě minuty, pouze
při viditelné stránce a sekci. Tlačítko umožňuje ruční obnovu. Backend
sdílí úspěšný přehled v paměti instance nejvýše minutu, vždy až po ověření
identity; odpovědi mají `private, no-store`. Chyba ani částečný výsledek
Log Analytics se nevydává za nulovou spotřebu. Při chybě obnovy je
ponechaný přehled výslovně označen jako neaktuální.

Přehled uvádí čas dotazu, poslední zaznamenané spotřeby a snapshotu jobu.
Starý čas poslední spotřeby nemusí znamenat výpadek: prostředí může být
nečinné. Chybějící nebo více než 20 minut starý snapshot jobu vyvolá
varování. Logy mají zpoždění několika minut.

Pro aktivaci nejprve aplikujte Terraform v `infra/rakathon-env/shared`
(nová KQL funkce, nastavení workspace a workspace-scoped Log Analytics
Reader pro backend), potom nasaďte Function skriptem
`infra/rakathon-env/scripts/deploy-my-key.sh` a publikujte web. Není
potřeba nová služba, přímé Azure přihlášení prohlížeče ani další secret.
Skript po zip deploy synchronizuje Function triggery, aby se nové API
routes zaregistrovaly i při nasazení balíčku přes URL.

## Skutečné náklady Azure (billing)

Na začátku sekce **Náklady** je blok se skutečnými fakturovanými náklady
celé Azure subscription v USD proti maximálnímu rozpočtu akce
(`overall_budget_usd`, výchozí 5 000 USD) od začátku rozpočtového okna
(`budget_window_start`). Platí stejné omezení přístupu jako u odhadu:
`GET /api/azure-cost` odmítá účty `teamNN` odpovědí 403.

Zdrojem je Cost Management Query API (`ActualCost`, agregace `CostUSD`,
seskupení podle resource group). Timer `azure-cost-refresh` ve Function
`my-key` dotaz spouští každých 15 minut a výsledek ukládá jako snapshot
do kontejneru `portal-cache` v úložišti Function; HTTP endpoint čte jen
snapshot, takže počet diváků nezvyšuje počet dotazů na billing (výjimkou
je jednorázové naplnění, když snapshot ještě neexistuje). Dotaz posílá
vlastní hlavičku `ClientType`, aby nesdílel throttling kvótu s CLI/portálem.
Selhané obnovení (např. throttling) ponechá poslední úspěšná data a portál
zobrazí varování s kódem chyby; data starší než 40 minut také vyvolají
varování.

Billing Azure má zpoždění hodin až dnů. Portál proto uvádí datum, do
kterého jsou fakturovaná data k dispozici, a čas posledního dotazu.
Náklady týmu jsou náklady jeho resource group `rg-teamNN`; vše ostatní
(sdílená infrastruktura, APIM a volání modelů, která se fakturují do
sdílené resource group) je uvedeno jako sdílené. Graf týmů je seřazený
od největšího spendera a sčítá vlastní Azure zdroje týmu (billing) a
odhad spotřeby modelů přes APIM. Rozpad podle všech resource group je
v rozbalitelné tabulce. Billing a odhad se načítají nezávisle; výpadek
jednoho nezakryje druhý.

Aktivace: Terraform v `infra/rakathon-env/shared` přidá roli Cost
Management Reader na subscription pro managed identity Function a app
settings `AZURE_SUBSCRIPTION_ID`, `AZURE_COST_WINDOW_START`,
`AZURE_COST_BUDGET_USD`; potom nasaďte Function a web.

## Datové soubory

Tlačítko **Stáhnout** volá `/api/data-link` a obdrží read-only user-delegation
URL s platností pět minut. Backend přijímá pouze SWA identity týmových účtů
`teamNN@…`, ověří existenci blobu a odpověď neposílá do cache. Managed identity
backendu má na storage pouze čtení blobů a oprávnění vygenerovat user delegation
key; shared keys zůstávají vypnuté.

Tlačítko **Kopírovat URL** vrací stabilní privátní adresu
`https://<storage>.blob.core.windows.net/data/<blob>`. Tato adresa neobsahuje
SAS ani jiný credential. Aplikace, notebook nebo SDK se k ní musí přihlásit přes
Microsoft Entra ID účtem s rolí `Storage Blob Data Reader`.

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

Přihlášení do webu poskytuje přístup ke snapshotu a týmovým self-service
endpointům, nikoli obecná oprávnění k Azure resources. Stabilní Blob URL
použitá mimo portál vyžaduje `Storage Blob Data Reader` a povolenou síť.
Azure Portal navíc vyžaduje management-plane roli `Reader`.

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
