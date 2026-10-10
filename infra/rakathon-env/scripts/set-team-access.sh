#!/usr/bin/env bash
# Zapnutí/vypnutí přístupu týmů k AI gateway (suspend/activate APIM subscription).
# Použití: set-team-access.sh teamNN|--all on|off
#          set-team-access.sh status

set -euo pipefail

: "${SHARED_RESOURCE_GROUP:?Nastavte proměnnou prostředí SHARED_RESOURCE_GROUP.}"

APIM_API_VERSION="2024-05-01"
APIM_PRODUCT="hackathon"
usage="Použití: $0 teamNN|--all on|off | status"

if ! az account show >/dev/null 2>&1; then
  echo "Nejprve se přihlaste příkazem: az login" >&2
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

# Týmové subscriptions produktu hackathon; ops-* (provozní) se vynechávají.
list_team_subscriptions() {
  az rest --method get \
    --url "${apim_base}/products/${APIM_PRODUCT}/subscriptions?api-version=${APIM_API_VERSION}" \
    --query "value[?!starts_with(name, 'ops-')].[name, properties.state]" \
    --output tsv --only-show-errors
}

target="${1:-}"
action="${2:-}"

if [[ "${target}" == "status" ]]; then
  printf '%-12s %s\n' "SUBSCRIPTION" "STAV"
  while IFS=$'\t' read -r name state; do
    [[ -z "${name}" ]] && continue
    printf '%-12s %s\n' "${name}" "${state}"
  done < <(list_team_subscriptions)
  exit 0
fi

case "${action}" in
  on) new_state="active" ;;
  off) new_state="suspended" ;;
  *) echo "${usage}" >&2; exit 1 ;;
esac

if [[ "${target}" == "--all" ]]; then
  teams=()
  while IFS=$'\t' read -r name _; do
    [[ -n "${name}" ]] && teams+=("${name}")
  done < <(list_team_subscriptions)
elif [[ "${target}" =~ ^team[0-9]+$ ]]; then
  teams=("${target}")
else
  echo "${usage}" >&2
  exit 1
fi

if ((${#teams[@]} == 0)); then
  echo "Žádné týmové subscriptions nenalezeny."
  exit 0
fi

for team in "${teams[@]}"; do
  az rest --method patch \
    --url "${apim_base}/subscriptions/${team}?api-version=${APIM_API_VERSION}" \
    --body "{\"properties\":{\"state\":\"${new_state}\"}}" \
    --output none --only-show-errors
  echo "${team}: ${new_state}"
done
