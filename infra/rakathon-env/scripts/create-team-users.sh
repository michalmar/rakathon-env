#!/usr/bin/env bash

set -euo pipefail
umask 077

: "${AZURE_TENANT_ID:?Nastavte proměnnou prostředí AZURE_TENANT_ID.}"
: "${SHARED_RESOURCE_GROUP:?Nastavte proměnnou prostředí SHARED_RESOURCE_GROUP.}"
: "${TAP_START_DATETIME:?Nastavte TAP_START_DATETIME ve formátu YYYY-MM-DDTHH:MM:SSZ.}"
: "${TAP_END_DATETIME:?Nastavte TAP_END_DATETIME ve formátu YYYY-MM-DDTHH:MM:SSZ.}"

CONTRIBUTOR_ROLE_ID="b24988ac-6180-42a0-ab88-20f7382dd24c"
STORAGE_BLOB_DATA_READER_ROLE_ID="2a2b9908-6ea1-4ae2-8e65-a410df84e7d1"
# Původní role "Azure AI User" se nyní jmenuje "Foundry User".
FOUNDRY_USER_ROLE_ID="53ca6127-db72-4b80-b1b0-d745d6d5456d"

requested_count="${1:-1}"
tap_is_usable_once="${TAP_IS_USABLE_ONCE:-true}"
output_directory="${TEAM_USER_OUTPUT_DIR:-${PWD}/team-user-access}"

if [[ ! "${requested_count}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Použití: $0 [počet_nových_uživatelů]" >&2
  echo "Počet musí být kladné celé číslo. Výchozí hodnota je 1." >&2
  exit 1
fi

if [[ ! "${TAP_START_DATETIME}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || [[ ! "${TAP_END_DATETIME}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
  echo "TAP_START_DATETIME a TAP_END_DATETIME musí být v UTC formátu YYYY-MM-DDTHH:MM:SSZ." >&2
  exit 1
fi

if [[ "${tap_is_usable_once}" != "true" && "${tap_is_usable_once}" != "false" ]]; then
  echo "TAP_IS_USABLE_ONCE musí mít hodnotu true nebo false." >&2
  exit 1
fi

parse_utc_datetime() {
  local value="$1"

  if date --version >/dev/null 2>&1; then
    date -u -d "${value}" +%s
  else
    date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "${value}" +%s
  fi
}

if ! tap_start_epoch="$(parse_utc_datetime "${TAP_START_DATETIME}" 2>/dev/null)" \
  || ! tap_end_epoch="$(parse_utc_datetime "${TAP_END_DATETIME}" 2>/dev/null)"; then
  echo "TAP_START_DATETIME nebo TAP_END_DATETIME neobsahuje platné datum a čas." >&2
  exit 1
fi

tap_lifetime_seconds=$((tap_end_epoch - tap_start_epoch))
if ((tap_lifetime_seconds <= 0)); then
  echo "TAP_END_DATETIME musí být později než TAP_START_DATETIME." >&2
  exit 1
fi

if ((tap_lifetime_seconds % 60 != 0)); then
  echo "Rozdíl mezi TAP_START_DATETIME a TAP_END_DATETIME musí být celé minuty." >&2
  exit 1
fi

tap_lifetime_minutes=$((tap_lifetime_seconds / 60))
if ((tap_lifetime_minutes < 10 || tap_lifetime_minutes > 43200)); then
  echo "Platnost TAP musí být od 10 do 43200 minut." >&2
  exit 1
fi

if ! command -v az >/dev/null 2>&1; then
  echo "Chybí požadovaný příkaz: az" >&2
  exit 1
fi

if ! az account show >/dev/null 2>&1; then
  echo "Nejprve se přihlaste příkazem: az login" >&2
  exit 1
fi

mkdir -p "${output_directory}"
if [[ ! -w "${output_directory}" ]]; then
  echo "Výstupní adresář není zapisovatelný: ${output_directory}" >&2
  exit 1
fi

tenant_id="$(az account show --query tenantId --output tsv)"
if [[ "${tenant_id}" != "${AZURE_TENANT_ID}" ]]; then
  echo "Požadovaný tenant je ${AZURE_TENANT_ID}, ale aktivní tenant je ${tenant_id}." >&2
  exit 1
fi

shared_rg_id="$(az group show \
  --name "${SHARED_RESOURCE_GROUP}" \
  --query id \
  --output tsv \
  --only-show-errors)"
shared_rg_location="$(az group show \
  --name "${SHARED_RESOURCE_GROUP}" \
  --query location \
  --output tsv \
  --only-show-errors)"

tenant_domain="$(az rest \
  --method get \
  --url "https://graph.microsoft.com/v1.0/domains?\$select=id,isDefault" \
  --query 'value[?isDefault].id | [0]' \
  --output tsv \
  --only-show-errors)"

if [[ -z "${tenant_domain}" || "${tenant_domain}" == "null" ]]; then
  echo "Nepodařilo se zjistit výchozí ověřenou doménu tenantu." >&2
  exit 1
fi

ensure_role_assignment() {
  local principal_id="$1"
  local role_id="$2"
  local scope="$3"
  local description="$4"
  local existing_assignment

  existing_assignment="$(az role assignment list \
    --assignee-object-id "${principal_id}" \
    --role "${role_id}" \
    --scope "${scope}" \
    --query '[0].id' \
    --output tsv \
    --only-show-errors)"

  if [[ -n "${existing_assignment}" ]]; then
    echo "  Role již existuje: ${description}"
    return
  fi

  for attempt in {1..6}; do
    if az role assignment create \
      --assignee-object-id "${principal_id}" \
      --assignee-principal-type User \
      --role "${role_id}" \
      --scope "${scope}" \
      --output none \
      --only-show-errors; then
      echo "  Přidělena role: ${description}"
      return
    fi

    if [[ "${attempt}" -lt 6 ]]; then
      echo "  Role zatím není možné přidělit, čekám na propagaci identity..."
      sleep 10
    fi
  done

  echo "Nepodařilo se přidělit roli ${description}." >&2
  exit 1
}

generate_bootstrap_password() {
  local random_part=""
  local random_character

  exec 3</dev/urandom
  while ((${#random_part} < 24)); do
    if IFS= read -r -n 1 random_character <&3 \
      && [[ "${random_character}" =~ [A-Za-z0-9] ]]; then
      random_part+="${random_character}"
    fi
  done
  exec 3<&-

  printf 'Rk!%sAa9' "${random_part}"
}

max_team_number=0
if ! existing_user_upns="$(az ad user list \
  --filter "startswith(userPrincipalName, 'team')" \
  --query '[].userPrincipalName' \
  --output tsv \
  --only-show-errors)"; then
  echo "Nelze načíst existující týmové uživatele. Přihlášená identita potřebuje oprávnění číst uživatele v Microsoft Entra ID." >&2
  exit 1
fi

while IFS= read -r existing_upn; do
  local_part="${existing_upn%@*}"
  domain_part="${existing_upn#*@}"

  if [[ "${domain_part}" == "${tenant_domain}" && "${local_part}" =~ ^team([0-9]+)$ ]]; then
    team_number=$((10#${BASH_REMATCH[1]}))
    if ((team_number > max_team_number)); then
      max_team_number="${team_number}"
    fi
  fi
done <<<"${existing_user_upns}"

created_count=0
candidate_number=$((max_team_number + 1))

while ((created_count < requested_count)); do
  printf -v team_name 'team%02d' "${candidate_number}"
  user_principal_name="${team_name}@${tenant_domain}"
  resource_group_name="rg-${team_name}"

  existing_user_id="$(az ad user show \
    --id "${user_principal_name}" \
    --query id \
    --output tsv \
    --only-show-errors 2>/dev/null || true)"

  if [[ -n "${existing_user_id}" ]]; then
    echo "Uživatel ${user_principal_name} již existuje; beze změny, pokračuji dalším číslem."
    candidate_number=$((candidate_number + 1))
    continue
  fi

  # Azure CLI vyžaduje při vytvoření cloudového uživatele password profile.
  # Náhodné bootstrap heslo se nikde nevypisuje ani neukládá; předává se pouze TAP.
  bootstrap_password="$(generate_bootstrap_password)"

  echo "Vytvářím ${user_principal_name}..."
  user_object_id="$(az ad user create \
    --display-name "${team_name}" \
    --user-principal-name "${user_principal_name}" \
    --password "${bootstrap_password}" \
    --force-change-password-next-sign-in false \
    --query id \
    --output tsv \
    --only-show-errors)"

  if [[ "$(az group exists --name "${resource_group_name}" --output tsv)" == "true" ]]; then
    echo "  Resource group ${resource_group_name} již existuje; beze změny."
  else
    az group create \
      --name "${resource_group_name}" \
      --location "${shared_rg_location}" \
      --output none \
      --only-show-errors
    echo "  Vytvořena resource group: ${resource_group_name}"
  fi

  team_rg_id="$(az group show \
    --name "${resource_group_name}" \
    --query id \
    --output tsv \
    --only-show-errors)"

  ensure_role_assignment \
    "${user_object_id}" \
    "${CONTRIBUTOR_ROLE_ID}" \
    "${team_rg_id}" \
    "Contributor na ${resource_group_name}"
  ensure_role_assignment \
    "${user_object_id}" \
    "${STORAGE_BLOB_DATA_READER_ROLE_ID}" \
    "${shared_rg_id}" \
    "Storage Blob Data Reader na ${SHARED_RESOURCE_GROUP}"
  ensure_role_assignment \
    "${user_object_id}" \
    "${FOUNDRY_USER_ROLE_ID}" \
    "${shared_rg_id}" \
    "Foundry User (dříve Azure AI User) na ${SHARED_RESOURCE_GROUP}"

  temporary_access_pass="$(az rest \
    --method post \
    --url "https://graph.microsoft.com/v1.0/users/${user_object_id}/authentication/temporaryAccessPassMethods" \
    --headers 'Content-Type=application/json' \
    --body "{\"startDateTime\":\"${TAP_START_DATETIME}\",\"lifetimeInMinutes\":${tap_lifetime_minutes},\"isUsableOnce\":${tap_is_usable_once}}" \
    --query temporaryAccessPass \
    --output tsv \
    --only-show-errors)"

  if [[ -z "${temporary_access_pass}" || "${temporary_access_pass}" == "null" ]]; then
    echo "Microsoft Graph nevytvořil Temporary Access Pass pro ${user_principal_name}." >&2
    exit 1
  fi

  output_file="${output_directory}/${team_name}.md"
  if [[ "${tap_is_usable_once}" == "true" ]]; then
    tap_usage="Ano"
  else
    tap_usage="Ne"
  fi

  cat >"${output_file}" <<EOF
# Přístup uživatele ${team_name}

- **Jméno:** ${team_name}
- **UPN:** ${user_principal_name}
- **Temporary Access Pass (TAP):** ${temporary_access_pass}
- **Začátek platnosti TAP:** ${TAP_START_DATETIME}
- **Konec platnosti TAP:** ${TAP_END_DATETIME}
- **Jednorázový TAP:** ${tap_usage}

Tento soubor obsahuje citlivé přihlašovací údaje. Sdílejte jej pouze s určeným uživatelem a po předání jej bezpečně odstraňte.
EOF

  echo
  echo "Vytvořen uživatel: ${user_principal_name}"
  echo "Vlastní RG:         ${resource_group_name}"
  echo "TAP soubor:         ${output_file}"
  echo

  created_count=$((created_count + 1))
  candidate_number=$((candidate_number + 1))
done

echo "Hotovo: vytvořeno ${created_count} nových uživatelů."
