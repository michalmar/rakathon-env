# Azure prostředí pro hackathon

Aktuální rozsah tvoří dva oddělené Terraform deploymenty:

- `setup` vytvoří resource group a Storage pro Terraform state.
- `shared` vytvoří sdílenou resource group, Storage, container `data`,
  veřejný Microsoft Foundry resource, Foundry project a model deploymenty;
  také obsahuje Static Web Apps Standard a Entra autentizaci účastnického portálu.

Týmy vznikají skripty `create-team-users` (Entra uživatel `teamNN`, resource
group `rg-teamNN`, role `Contributor` na vlastní RG, `Storage Blob Data Reader`
na sdílené RG a APIM subscription `teamNN`). Modely se volají výhradně přes
Azure API Management gateway; týmy nemají žádný přístup přímo do Foundry.
Rozpočty, měření a blokace viz [`docs/cost-control.md`](docs/cost-control.md).

## Validace návrhu

- Role na týmové resource group zajistí, že tým nebude spravovat prostředky
  jiných týmů. Nepřiřazujte týmům role na subscription ani na nadřazeném scope.
- Pro Blob data nestačí role `Reader` nebo `Contributor` na management plane.
  Čtení dat vyžaduje samostatnou data-plane roli `Storage Blob Data Reader`.
- Přístup přes Azure Portal navíc vyžaduje management-plane roli `Reader`.
  Shared deployment proto pro budoucí týmové skupiny připravuje obě role.
- Externí anonymní přístup, shared keys a HTTP jsou vypnuté. Storage firewall
  standardně odmítá všechny veřejné sítě; autentizace probíhá přes Microsoft
  Entra ID.
- `allowed_ip_ranges` musí zahrnovat veřejnou IP počítače, ze kterého běží
  Terraform. Zpřístupnění ze všech sítí vyžaduje explicitní nastavení
  `allow_all_networks = true`.
- `Standard_LRS` je nákladově úsporná volba pro hackathon, ale nechrání před
  výpadkem celé availability zone. Pro vyšší odolnost změňte replikaci na ZRS.

Architektonický diagram je v
[`05_arch_diagram_update_result.html`](05_arch_diagram_update_result.html).

## Microsoft Foundry

Shared deployment vytváří:

- Foundry resource `ais-rakathon-<suffix>` se SKU `S0`,
- veřejný project `rakathon-project`,
- `gpt-6.1-sol` verze `2026-09-29` jako `DataZoneStandard`,
- `gpt-6-luna` verze `2026-09-22` jako `DataZoneStandard`,
- `grok-4.7`, `gpt-6-astra`, `DeepSeek-V4-Pro`, `Kimi-K2.7-Code`,
  `MAI-Thinking-1` a `MAI-Image-2.5` jako `GlobalStandard`.

Data Zone modely používají kapacitu `3333`. Global deploymenty používají
subscription maxima ověřená 2026-10-09: `10000` pro grok, Astra a DeepSeek,
`2000` pro Kimi a `1500` pro MAI-Thinking, tedy po 1000 TPM na jednotku.
`MAI-Image-2.5` používá maximum `10` image requests/minute; nejde o tokenový
model. Foundry local/key autentizace je **vypnutá** (`local_auth_enabled =
false`): žádný sdílený Foundry klíč neexistuje a přímé volání Foundry vrací
401. Jediná cesta k modelům je APIM gateway (managed identity APIM má
na Foundry roli). Storage shared keys také nejsou povolené.
Veřejný síťový přístup k Foundry je standardně vypnutý a odchozí provoz je
omezený. Případné povolení nastavte explicitně v `shared/terraform.tfvars`.

## Požadavky

- Terraform 1.6 nebo novější
- Azure CLI
- oprávnění vytvářet resource groups, Storage účty a role assignments
- Entra oprávnění vytvářet vlastní app registrations a enterprise applications,
  například role `Application Developer` v cílovém tenantu
- přihlášení pomocí `az login`

Storage names jsou globálně unikátní. Terraform k prefixu přidá náhodný suffix,
například `strakathontf4f8k2m` a `strakathondata9p3x7q`.

## 1. Konfigurace

```bash
cp setup/terraform.tfvars.example setup/terraform.tfvars
cp shared/terraform.tfvars.example shared/terraform.tfvars
```

Upravte zejména `subscription_id`, případně `allowed_ip_ranges`. Volitelné
seznamy principal object ID v `shared/terraform.tfvars` mohou zůstat prázdné,
dokud nebudou připravené identity zákazníka a týmové skupiny.

## 2. Setup a remote state

První běh musí setup Storage vytvořit s lokálním state. Skript potom:

1. vytvoří setup infrastrukturu s dočasně povolenými access keys,
2. přidělí lokálnímu správci potřebné Entra data-plane role,
3. počká na propagaci rolí a access keys opět vypne,
4. vygeneruje ignorované `backend.hcl`,
5. migruje setup state do containeru `tfstate`,
6. inicializuje shared deployment s odděleným state klíčem.

```bash
./scripts/bootstrap.sh
```

Setup používá state key `setup.tfstate`, shared používá `shared.tfstate`.
Backend se autentizuje přes Azure CLI a Microsoft Entra ID; Storage access keys
nejsou potřeba ani povolené.

## 3. Shared deployment

Shared Storage používá stejné dvoufázové pořadí, aby mohl AzureRM provider po
prvním vytvoření přejít ze Storage key na Entra ID autentizaci:

```bash
./scripts/deploy-shared.sh
```

Pro aktualizaci existující infrastruktury používejte přímo zkontrolovaný
`terraform plan` a `terraform apply`; bootstrap skript dočasně povoluje Storage
shared keys a pro běžné aktualizace není vhodný.

Portál používá `portal_location = "eastus2"`. Sweden Central SWA nepodporuje
a West Europe aktuálně odmítá nové zákazníky. Statický obsah SWA je globálně
distribuovaný. Jeho public URL, název, client ID a expiraci přihlašovacího secretu
vracejí outputs `portal_url`, `portal_name`, `portal_auth_client_id` a
`portal_auth_secret_expires_at`. Publikování aplikace popisuje
[`web/README.md`](../../web/README.md).

### Self-service API klíč (Function `my-key`)

Přihlášený tým vidí svůj APIM klíč v portálu (sekce „Váš API klíč“). Zajišťuje
to Function app `func-rakathon-key-<suffix>` (Linux Consumption, Node 22,
`shared/my_key.tf`), připojená k SWA jako vlastní backend
(`azurerm_static_web_app_function_app_registration`), endpoint `GET /api/my-key`:

- SWA předá `x-ms-client-principal`; funkce z UPN vezme část před `@`, musí
  odpovídat `^team\d{2}$` (jinak `404 {"error":"no-team"}`, bez principalu `401`)
  a přes managed identity přečte APIM subscription téhož jména (musí patřit do
  produktu `hackathon`) a její `primaryKey`. Odpověď
  `{team, key, state, baseUrl}` má `Cache-Control: no-store`, klíč se nelogují.
- Managed identity má jen custom roli „Rakathon APIM Team Key Reader“ na APIM
  (`subscriptions/read`, `subscriptions/listSecrets/action`), žádnou širší.
- Přímé volání `https://func-…azurewebsites.net/api/my-key` mimo SWA vrací `401`
  (Easy Auth nastavený registrací backendu), takže cizí `x-ms-client-principal`
  nelze podvrhnout. Portál (`/*`) zůstává jen pro přihlášené.
- Kód nasazujte po `terraform apply` (a po změně kódu) příkazem
  `./scripts/deploy-my-key.sh` (zip deploy; vyžaduje `az`, `npm`, `zip`).
  `WEBSITE_RUN_FROM_PACKAGE` nastavuje deploy, Terraform ho ignoruje.
- Testy: `cd functions/my-key && npm install && npm test`.
- Náklady v klidu: Consumption plán ≈ $0 (platí se za volání) plus drobný
  storage účet `stfn…` (centavy); funkce má vlastní storage, protože datový účet
  má vypnuté sdílené klíče, které Consumption runtime vyžaduje.

Při přidávání portálu úplný plán ukázal i nesouvisející změnu Storage
`network_rules`. Pro tuto konkrétní aktualizaci je připravený cílený plán pro
`azurerm_cognitive_account.foundry`, `azuread_application_redirect_uris.portal`
a `azuread_service_principal.portal`, který zahrne i závislosti portálu.
Storage ani modelové deploymenty tento plán nemění. `-target` není určené pro
běžné deploymenty; před budoucím úplným apply nejprve prověřte síťový drift.

Pokud později změníte identity:

- `customer_data_contributor_object_ids` dostanou `Reader` na shared Storage a
  `Storage Blob Data Contributor` na container `data`.
- `team_data_reader_object_ids` dostanou `Reader` na shared Storage a
  `Storage Blob Data Reader` na container `data`.

## 4. Týmoví uživatelé

Skript vytvoří nové interní uživatele `team01@<výchozí-doména>`,
`team02@<výchozí-doména>` a navazující čísla. Jako argument přijímá počet nových
uživatelů; bez argumentu vytvoří jednoho. Existující uživatele nemění a při
dalším spuštění pokračuje za nejvyšším nalezeným číslem.

### Bash

```bash
export AZURE_TENANT_ID="<tenant-id>"
export SHARED_RESOURCE_GROUP="rg-rakathon-shared"
export TAP_START_DATETIME="2026-10-09T08:00:00Z"
export TAP_END_DATETIME="2026-10-09T18:00:00Z"

# Volitelné nastavení:
export TAP_IS_USABLE_ONCE=true
export TEAM_USER_OUTPUT_DIR="$PWD/team-user-access"

./scripts/create-team-users.sh      # vytvoří 1 uživatele
./scripts/create-team-users.sh 5    # vytvoří 5 dalších uživatelů
```

### PowerShell 7

```powershell
$env:AZURE_TENANT_ID = "<tenant-id>"
$env:SHARED_RESOURCE_GROUP = "rg-rakathon-shared"
$env:TAP_START_DATETIME = "2026-10-09T08:00:00Z"
$env:TAP_END_DATETIME = "2026-10-09T18:00:00Z"

# Volitelné nastavení:
$env:TAP_IS_USABLE_ONCE = "true"
$env:TEAM_USER_OUTPUT_DIR = Join-Path $PWD "team-user-access"

./scripts/create-team-users.ps1           # vytvoří 1 uživatele
./scripts/create-team-users.ps1 -Count 5  # vytvoří 5 dalších uživatelů
```

Pro každého uživatele skript:

- vytvoří `rg-teamNN` ve stejné lokaci jako `rg-rakathon-shared`,
- přidělí `Contributor` pouze na `rg-teamNN`,
- přidělí `Storage Blob Data Reader` na `rg-rakathon-shared`,
- **nepřiděluje** roli `Foundry User` – týmy nemají přístup do Foundry portálu
  ani Agent Service; modely volají výhradně přes APIM gateway,
- idempotentně vytvoří APIM subscription `teamNN` v produktu `hackathon`
  (`az rest`, api-version `2024-05-01`), počká na stav `active` a načte její klíč,
- vytvoří Temporary Access Pass platný od `TAP_START_DATETIME` do
  `TAP_END_DATETIME`,
- uloží jméno, UPN, TAP a údaje pro AI gateway (base URL, klíč týmu, seznam
  deploymentů, příklad v Pythonu a curl, upozornění na
  `stream_options: {include_usage: true}` a rozpočet týmu) do samostatného souboru
  `team-user-access/teamNN.md`.

Příklad vytvořených handoff souborů:

```text
team-user-access/
├── team01.md
├── team02.md
└── team03.md
```

Skript respektuje existující nastavení `AZURE_CONFIG_DIR`. Cílový tenant čte
z `AZURE_TENANT_ID` a název sdílené resource group z
`SHARED_RESOURCE_GROUP`. Začátek a konec platnosti TAP jsou povinné UTC hodnoty
`TAP_START_DATETIME` a `TAP_END_DATETIME` ve formátu
`YYYY-MM-DDTHH:MM:SSZ`. Rozdíl musí být celé minuty a musí být v rozsahu 10 až
43200 minut. Volitelně lze nastavit `TAP_IS_USABLE_ONCE` a
`TEAM_USER_OUTPUT_DIR`.

Název APIM instance skript zjistí v `SHARED_RESOURCE_GROUP` (nebo ji lze zadat
přes `APIM_NAME`); base URL lze přepsat proměnnou `APIM_URL`, rozpočet uvedený
v handoffu proměnnou `TEAM_BUDGET_USD` (výchozí 1000). Klíč nového subscription
začne platit zhruba do 1 minuty. Klient posílá klíč v hlavičce `api-key`
(`Authorization: Bearer` gateway nepřijímá); podrobnosti v
[`docs/apim-findings.md`](docs/apim-findings.md).

TAP handoff soubory jsou ve výchozím adresáři ignorované Gitem a obsahují
citlivé přihlašovací údaje. Každý soubor je určen k bezpečnému předání pouze
příslušnému uživateli a po předání by měl být odstraněn.

Azure CLI při založení cloudového uživatele technicky vyžaduje password profile;
skript proto vytvoří náhodné bootstrap heslo, ale nikde je nevypisuje ani
neukládá a administrátorovi předává pouze TAP.

Spouštějící identita potřebuje oprávnění vytvářet Entra ID uživatele, resource
groups a RBAC role assignments. Pro vytvoření TAP musí mít podporovanou Entra
roli, například `Authentication Administrator`, a odpovídající Microsoft Graph
oprávnění pro zápis TAP. Temporary Access Pass musí být v tenantovi povolený
authentication methods policy. Skript nepřiděluje žádnou roli na subscription
scope; případná širší oprávnění zděděná z jiných role assignments ale
neodebírá.

### Bulk odstranění týmových uživatelů

Mazací skripty vyberou pouze uživatele odpovídající přesnému vzoru
`teamXX@<výchozí-doména>` a před odstraněním zobrazí jejich seznam. Resource
groups `rg-teamXX` ani TAP Markdown soubory ve výchozím režimu nemažou. Odstraní
dva RBAC assignments vytvořené provisioning skriptem, APIM subscription
`teamXX` (klíč tím okamžitě přestane platit) a následně uživatelské účty.

Bash:

```bash
./scripts/delete-team-users.sh --all
```

PowerShell 7:

```powershell
./scripts/delete-team-users.ps1 -All
```

Pro odstranění odpovídajících resource groups použijte explicitní přepínač:

```bash
./scripts/delete-team-users.sh --all --delete-resource-groups
```

```powershell
./scripts/delete-team-users.ps1 -All -DeleteResourceGroups
```

Obě varianty vyžadují potvrzení zadáním přesného textu `DELETE`. Pro
neinteraktivní spuštění lze kontrolu přeskočit explicitním přepínačem:

```bash
./scripts/delete-team-users.sh --all --delete-resource-groups --yes
```

```powershell
./scripts/delete-team-users.ps1 -All -DeleteResourceGroups -Force
```

TAP Markdown soubory se nemažou ani při použití přepínače pro resource groups.

### Přidělený rozpočet, zablokování a obnovení přístupu týmu

Každý tým má rozpočet 1 000 USD, celá akce 5 000 USD. Při 90 % se posílá
upozornění, při 100 % se přístup zablokuje (suspend APIM subscription; klient
dostane HTTP 401). Blokaci řeší automatizovaná kontrola nákladů; ručně lze
přístup kdykoli vypnout nebo obnovit skriptem `set-team-access`. Suspend/activate
je vratné a klíč zůstává stejný (účinek do cca 10 s).

```bash
./scripts/set-team-access.sh status          # stav všech týmových subscriptions
./scripts/set-team-access.sh team03 off      # zablokovat tým
./scripts/set-team-access.sh team03 on       # obnovit tým
./scripts/set-team-access.sh --all off       # zablokovat všechny týmy (kromě ops-*)
```

```powershell
./scripts/set-team-access.ps1 -Status
./scripts/set-team-access.ps1 -Team team03 -State off
./scripts/set-team-access.ps1 -Team all -State on
```

`--all` / `all` zahrnuje všechny subscriptions produktu `hackathon` mimo
provozní `ops-*`. Skripty používají `SHARED_RESOURCE_GROUP` a volitelně
`APIM_NAME`.

## Provozní runbook (den akce)

Klient volá `https://apim-rakathon-q7146n.azure-api.net/openai/v1`
s hlavičkou `api-key: <klíč týmu>`; `model` je název deploymentu. Limity: $5 000
celkem (hard stop s rezervou), $1 000 na tým, 4 M tokenů denně na tým, TPM limit
na subscription. Podrobnosti v [`docs/cost-control.md`](docs/cost-control.md),
návrh a zjištěná omezení v [`docs/apim-findings.md`](docs/apim-findings.md).
Streamované požadavky gateway automaticky doplní `stream_options.include_usage`,
takže se spotřeba měří vždy.

### Checklist před akcí

1. `export AZURE_CONFIG_DIR="$HOME/.azure-rak"` a přihlášení do tenantu
   `7f0c84c5-bbea-48b2-bad1-6baf63d0c73c`.
2. V `shared/terraform.tfvars` nastavte `budget_window_start` na začátek akce
   (UTC, např. `2026-10-14T07:00:00Z`) – spotřeba před ním se nepočítá. Případně
   upravte `overall_budget_usd`/`team_budget_usd`. Poté `terraform apply`.
3. Vytvořte týmy (`create-team-users.sh N`, viz výše; TAP okno nastavte na dobu
   akce). Vyžaduje roli typu Authentication Administrator.
4. Ověřte `./scripts/set-team-access.sh status` (všechny týmy `active`) a jedno
   testovací volání klíčem z `teamNN.md`.
5. Rozdejte soubory `team-user-access/teamNN.md` (obsahují TAP i klíč; po předání
   je bezpečně smažte). Klíč týmu vidí po přihlášení UPN `teamNN@…` také
   portál (sekce „Váš API klíč“ – zobrazit/kopírovat, stav aktivní / zablokováno –
   rozpočet); `teamNN.md` je záloha. Účty mimo `teamNN` (organizátoři, `ops-*`)
   klíč v portálu nedostanou.
6. Po `terraform apply` nezapomeňte nasadit i funkci: `./scripts/deploy-my-key.sh`.

### Kde sledovat spotřebu

- Workbook „Hackathon – náklady a rozpočty“: odkaz je v
  `terraform -chdir=shared output cost_workbook_url`.
- Tabulka v terminálu: `./scripts/team-usage.sh` (tým × deployment, součty vůči
  rozpočtům; data mají zpoždění cca 3 min).
- E-maily na action group `ag-rakathon-budget` (3 příjemci): varování při 90 %,
  oznámení o blokaci při 100 % (tým i celek) a alert, když přestane běžet cost
  job (Logic App `logic-rakathon-costjob`, každých 5 min).

### Blokace, obnovení a navýšení rozpočtu

- Ruční blokace/obnova: `set-team-access.sh teamNN off|on`, `--all off|on`
  (viz výše). Klíč zůstává stejný.
- Automatická blokace při 100 % týmového rozpočtu i při dosažení celkového
  limitu (celkový limit mínus rezerva $200) – cost job suspenduje subscriptions.
- Hard cap: ručně znovu aktivovaný tým bude cost jobem opět zablokován, dokud
  nenavýšíte rozpočet. Navýšení týmu: do `team_budget_overrides` v
  `terraform.tfvars` přidejte `teamNN = <USD>`, nebo zvyšte `team_budget_usd` /
  `overall_budget_usd`, `terraform apply` a poté `set-team-access.sh teamNN on`.
- Nouzové vypnutí všeho: `set-team-access.sh --all off`.

### Náklady v klidu a ukončení

APIM BasicV2 stojí ≈ $0.27/h (≈ $6,5/den) i bez provozu, SWA Standard a Log
Analytics se platí také (Function `my-key` na Consumption plánu ≈ $0). Po akci proveďte:

1. `./scripts/delete-team-users.sh --all --delete-resource-groups`
   (smaže uživatele, RBAC, APIM subscriptions a `rg-teamNN`).
2. Smažte `team-user-access/*.md`.
3. `terraform -chdir=shared destroy` (odstraní APIM, Foundry s deploymenty,
   portál i monitoring). Pro krátkou pauzu lze alespoň zablokovat týmy
   (`set-team-access.sh --all off`), ale APIM se dál účtuje.

## Bootstrap omezení

Skript `bootstrap.sh` je určen pro první nasazení z tohoto pracovního počítače.
Po úspěšné migraci ponechte vygenerované soubory `setup/backend_override.tf`,
`setup/backend.hcl` a `shared/backend.hcl` na místě. Jsou ignorované Gitem.
Při přesunu na jiný počítač je nutné backend konfiguraci znovu vytvořit podle
výstupů setup deploymentu a provést `terraform init -reconfigure`.

## Ochrana před commitem secretů

Repository používá Gitleaks pro kontrolu pracovního stromu, Git historie a
staged změn:

```bash
./infra/rakathon-env/scripts/check-secrets.sh
git config core.hooksPath .githooks
```

Pre-commit hook commit zablokuje, pokud Gitleaks najde token, heslo, privátní
klíč nebo jiný známý typ secretu. Stejná kontrola běží v GitHub Actions.
Terraform state, backend konfigurace, `terraform.tfvars`, `.env` a běžné
credential/key soubory jsou ignorované Gitem.
