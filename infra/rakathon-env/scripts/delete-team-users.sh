#!/usr/bin/env bash

set -euo pipefail

: "${AZURE_TENANT_ID:?Nastavte proměnnou prostředí AZURE_TENANT_ID.}"
: "${SHARED_RESOURCE_GROUP:?Nastavte proměnnou prostředí SHARED_RESOURCE_GROUP.}"

CONTRIBUTOR_ROLE_ID="b24988ac-6180-42a0-ab88-20f7382dd24c"
STORAGE_BLOB_DATA_READER_ROLE_ID="2a2b9908-6ea1-4ae2-8e65-a410df84e7d1"
APIM_API_VERSION="2024-05-01"

delete_all=false
skip_confirmation=false
delete_resource_groups=false

for argument in "$@"; do
  case "${argument}" in
    --all)
      delete_all=true
      ;;
    --yes)
      skip_confirmation=true
      ;;
    --delete-resource-groups)
      delete_resource_groups=true
      ;;
    *)
      echo "Použití: $0 --all [--delete-resource-groups] [--yes]" >&2
      exit 1
      ;;
  esac
done

if [[ "${delete_all}" != "true" ]]; then
  echo "Bulk mazání vyžaduje explicitní přepínač --all." >&2
  echo "Použití: $0 --all [--delete-resource-groups] [--yes]" >&2
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

azure_subscription_id="$(az account show --query id --output tsv)"
apim_name="${APIM_NAME:-$(az apim list \
  --resource-group "${SHARED_RESOURCE_GROUP}" \
  --query '[0].name' --output tsv --only-show-errors)}"
if [[ -z "${apim_name}" || "${apim_name}" == "null" ]]; then
  echo "APIM instance nenalezena v ${SHARED_RESOURCE_GROUP}. Nastavte APIM_NAME." >&2
  exit 1
fi
apim_base="https://management.azure.com/subscriptions/${azure_subscription_id}/resourceGroups/${SHARED_RESOURCE_GROUP}/providers/Microsoft.ApiManagement/service/${apim_name}"

shared_rg_id="$(az group show \
  --name "${SHARED_RESOURCE_GROUP}" \
  --query id \
  --output tsv \
  --only-show-errors)"

if ! existing_users="$(az ad user list \
  --filter "startswith(userPrincipalName, 'team')" \
  --query '[].{id:id,upn:userPrincipalName}' \
  --output tsv \
  --only-show-errors)"; then
  echo "Nelze načíst týmové uživatele. Přihlášená identita potřebuje oprávnění číst uživatele v Microsoft Entra ID." >&2
  exit 1
fi

user_ids=()
user_upns=()
while IFS=$'\t' read -r user_id user_upn; do
  [[ -z "${user_id}" || -z "${user_upn}" ]] && continue

  local_part="${user_upn%@*}"
  domain_part="${user_upn#*@}"
  if [[ "${domain_part}" == "${tenant_domain}" && "${local_part}" =~ ^team[0-9]+$ ]]; then
    user_ids+=("${user_id}")
    user_upns+=("${user_upn}")
  fi
done <<<"${existing_users}"

if ((${#user_ids[@]} == 0)); then
  echo "Nebyli nalezeni žádní uživatelé teamXX@${tenant_domain}."
  exit 0
fi

echo "Budou odstraněni následující uživatelé:"
printf '  - %s\n' "${user_upns[@]}"
echo
if [[ "${delete_resource_groups}" == "true" ]]; then
  echo "Budou odstraněny také odpovídající resource groups rg-teamXX."
else
  echo "Resource groups odstraněny nebudou."
fi
echo "Budou odstraněny také jejich APIM subscriptions (klíče přestanou platit)."
echo "TAP Markdown soubory odstraněny nebudou."

if [[ "${skip_confirmation}" != "true" ]]; then
  read -r -p "Pro potvrzení napište DELETE: " confirmation
  if [[ "${confirmation}" != "DELETE" ]]; then
    echo "Mazání zrušeno."
    exit 1
  fi
fi

delete_role_assignment() {
  local principal_id="$1"
  local role_id="$2"
  local scope="$3"
  local description="$4"
  local assignment_ids

  assignment_ids="$(az role assignment list \
    --assignee-object-id "${principal_id}" \
    --role "${role_id}" \
    --scope "${scope}" \
    --query '[].id' \
    --output tsv \
    --only-show-errors)"

  if [[ -z "${assignment_ids}" ]]; then
    return
  fi

  while IFS= read -r assignment_id; do
    [[ -z "${assignment_id}" ]] && continue
    az role assignment delete \
      --ids "${assignment_id}" \
      --output none \
      --only-show-errors
  done <<<"${assignment_ids}"

  echo "  Odstraněna role: ${description}"
}

for index in "${!user_ids[@]}"; do
  user_id="${user_ids[${index}]}"
  user_upn="${user_upns[${index}]}"
  team_name="${user_upn%@*}"
  resource_group_name="rg-${team_name}"

  echo "Odstraňuji ${user_upn}..."

  if [[ "$(az group exists --name "${resource_group_name}" --output tsv)" == "true" ]]; then
    team_rg_id="$(az group show \
      --name "${resource_group_name}" \
      --query id \
      --output tsv \
      --only-show-errors)"
    delete_role_assignment \
      "${user_id}" \
      "${CONTRIBUTOR_ROLE_ID}" \
      "${team_rg_id}" \
      "Contributor na ${resource_group_name}"
  fi

  delete_role_assignment \
    "${user_id}" \
    "${STORAGE_BLOB_DATA_READER_ROLE_ID}" \
    "${shared_rg_id}" \
    "Storage Blob Data Reader na ${SHARED_RESOURCE_GROUP}"
  az rest --method delete \
    --url "${apim_base}/subscriptions/${team_name}?api-version=${APIM_API_VERSION}" \
    --output none --only-show-errors 2>/dev/null \
    && echo "  Odstraněna APIM subscription ${team_name}." \
    || echo "  APIM subscription ${team_name} neexistovala nebo ji nelze smazat."

  az ad user delete \
    --id "${user_id}" \
    --only-show-errors
  echo "  Uživatel odstraněn."

  if [[ "${delete_resource_groups}" == "true" ]] \
    && [[ "$(az group exists --name "${resource_group_name}" --output tsv)" == "true" ]]; then
    az group delete \
      --name "${resource_group_name}" \
      --yes \
      --output none \
      --only-show-errors
    echo "  Resource group ${resource_group_name} odstraněna."
  fi
done

echo "Hotovo: odstraněno ${#user_ids[@]} uživatelů."
