#!/usr/bin/env bash

set -euo pipefail

: "${AZURE_TENANT_ID:?Nastavte proměnnou prostředí AZURE_TENANT_ID.}"
: "${SHARED_RESOURCE_GROUP:?Nastavte proměnnou prostředí SHARED_RESOURCE_GROUP.}"

CONTRIBUTOR_ROLE_ID="b24988ac-6180-42a0-ab88-20f7382dd24c"
STORAGE_BLOB_DATA_READER_ROLE_ID="2a2b9908-6ea1-4ae2-8e65-a410df84e7d1"
# Původní role "Azure AI User" se nyní jmenuje "Foundry User".
FOUNDRY_USER_ROLE_ID="53ca6127-db72-4b80-b1b0-d745d6d5456d"

requested_count="${1:-1}"

if [[ ! "${requested_count}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Použití: $0 [počet_nových_uživatelů]" >&2
  echo "Počet musí být kladné celé číslo. Výchozí hodnota je 1." >&2
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

generate_password() {
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

  initial_password="$(generate_password)"

  echo "Vytvářím ${user_principal_name}..."
  user_object_id="$(az ad user create \
    --display-name "${team_name}" \
    --user-principal-name "${user_principal_name}" \
    --password "${initial_password}" \
    --force-change-password-next-sign-in true \
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

  echo
  echo "Vytvořen uživatel: ${user_principal_name}"
  echo "Dočasné heslo:     ${initial_password}"
  echo "Vlastní RG:         ${resource_group_name}"
  echo "Při prvním přihlášení musí uživatel heslo změnit."
  echo

  created_count=$((created_count + 1))
  candidate_number=$((candidate_number + 1))
done

echo "Hotovo: vytvořeno ${created_count} nových uživatelů."
