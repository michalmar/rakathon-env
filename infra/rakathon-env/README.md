# Azure prostředí pro hackathon

Aktuální rozsah tvoří dva oddělené Terraform deploymenty:

- `setup` vytvoří resource group a Storage pro Terraform state.
- `shared` vytvoří sdílenou resource group, Storage, container `data`,
  veřejný Microsoft Foundry resource, Foundry project a model deploymenty.

Týmové resource groups ani Entra ID uživatelé se zatím nevytvářejí.
Budoucí model počítá s jednou Entra security group na tým, rolí `Contributor`
jen na vlastní týmové resource group a rolí `Storage Blob Data Reader` na
sdíleném containeru `data`.

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
- `gpt-6-luna` verze `2026-09-22` jako `DataZoneStandard`.

Oba modely používají kapacitu `3333`, což při přípravě deploymentu odpovídalo
maximální dostupné subscription quota i platform capacity ve Sweden Central.
`gpt-6-astra` není nasazený, protože v tomto regionu aktuálně nepodporuje
`DataZoneStandard`. Foundry local/key autentizace je vypnutá; používejte Entra
ID a RBAC.
Veřejný síťový přístup k Foundry je standardně vypnutý a odchozí provoz je
omezený. Případné povolení nastavte explicitně v `shared/terraform.tfvars`.

## Požadavky

- Terraform 1.6 nebo novější
- Azure CLI
- oprávnění vytvářet resource groups, Storage účty a role assignments
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

```bash
export AZURE_TENANT_ID="<tenant-id>"
export SHARED_RESOURCE_GROUP="rg-rakathon-shared"

./scripts/create-team-users.sh      # vytvoří 1 uživatele
./scripts/create-team-users.sh 5    # vytvoří 5 dalších uživatelů
```

Stejná funkcionalita je dostupná také pro PowerShell 7:

```powershell
$env:AZURE_TENANT_ID = "<tenant-id>"
$env:SHARED_RESOURCE_GROUP = "rg-rakathon-shared"

./scripts/create-team-users.ps1           # vytvoří 1 uživatele
./scripts/create-team-users.ps1 -Count 5  # vytvoří 5 dalších uživatelů
```

Pro každého uživatele skript:

- vytvoří `rg-teamNN` ve stejné lokaci jako `rg-rakathon-shared`,
- přidělí `Contributor` pouze na `rg-teamNN`,
- přidělí `Storage Blob Data Reader` na `rg-rakathon-shared`,
- přidělí roli `Foundry User` na `rg-rakathon-shared`; jde o aktuální název
  původní role `Azure AI User`.

Skript respektuje existující nastavení `AZURE_CONFIG_DIR`. Cílový tenant čte
z `AZURE_TENANT_ID` a název sdílené resource group z
`SHARED_RESOURCE_GROUP`. Vypíše jednorázové dočasné heslo, které musí uživatel
při prvním přihlášení změnit. Spouštějící identita potřebuje oprávnění vytvářet
Entra ID uživatele, resource groups a RBAC role assignments. Skript nepřiděluje
žádnou roli na subscription scope; případná širší oprávnění zděděná z jiných
role assignments ale neodebírá.

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
