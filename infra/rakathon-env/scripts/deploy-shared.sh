#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SHARED_DIR="${ROOT_DIR}/shared"

if [[ ! -f "${SHARED_DIR}/backend.hcl" ]]; then
  echo "Chybí ${SHARED_DIR}/backend.hcl. Nejdřív spusťte scripts/bootstrap.sh." >&2
  exit 1
fi

terraform -chdir="${SHARED_DIR}" init \
  -backend-config="${SHARED_DIR}/backend.hcl"

echo "Nasazuji shared resources s dočasně povolenými access keys..."
terraform -chdir="${SHARED_DIR}" apply \
  -var='storage_use_azuread=false' \
  -var='shared_access_key_enabled=true'

storage_account_name="$(terraform -chdir="${SHARED_DIR}" output -raw storage_account_name)"

echo "Čekám na propagaci Storage data-plane rolí..."
roles_ready=false
for _ in {1..18}; do
  if az storage blob list \
    --account-name "${storage_account_name}" \
    --container-name data \
    --auth-mode login \
    --num-results 1 \
    --only-show-errors \
    --output none; then
    roles_ready=true
    break
  fi
  sleep 10
done

if [[ "${roles_ready}" != "true" ]]; then
  echo "Data-plane role ještě není aktivní. Počkejte několik minut a spusťte skript znovu." >&2
  exit 1
fi

echo "Přepínám Storage na Entra ID autentizaci a vypínám shared access keys..."
terraform -chdir="${SHARED_DIR}" apply
