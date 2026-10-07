#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SETUP_DIR="${ROOT_DIR}/setup"
SHARED_DIR="${ROOT_DIR}/shared"

for command in az terraform; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Chybí požadovaný příkaz: ${command}" >&2
    exit 1
  fi
done

if ! az account show >/dev/null 2>&1; then
  echo "Nejprve se přihlaste příkazem: az login" >&2
  exit 1
fi

if [[ ! -f "${SETUP_DIR}/terraform.tfvars" ]]; then
  echo "Chybí ${SETUP_DIR}/terraform.tfvars. Zkopírujte terraform.tfvars.example a doplňte subscription_id." >&2
  exit 1
fi

if [[ ! -f "${SHARED_DIR}/terraform.tfvars" ]]; then
  echo "Chybí ${SHARED_DIR}/terraform.tfvars. Zkopírujte terraform.tfvars.example a doplňte subscription_id." >&2
  exit 1
fi

echo "Inicializuji a nasazuji setup s dočasným lokálním state..."
terraform -chdir="${SETUP_DIR}" init
terraform -chdir="${SETUP_DIR}" apply \
  -var='storage_use_azuread=false' \
  -var='shared_access_key_enabled=true'

resource_group_name="$(terraform -chdir="${SETUP_DIR}" output -raw resource_group_name)"
storage_account_name="$(terraform -chdir="${SETUP_DIR}" output -raw storage_account_name)"
container_name="$(terraform -chdir="${SETUP_DIR}" output -raw state_container_name)"

cat >"${SETUP_DIR}/backend.hcl" <<EOF
resource_group_name  = "${resource_group_name}"
storage_account_name = "${storage_account_name}"
container_name       = "${container_name}"
key                  = "setup.tfstate"
use_azuread_auth     = true
EOF

cat >"${SHARED_DIR}/backend.hcl" <<EOF
resource_group_name  = "${resource_group_name}"
storage_account_name = "${storage_account_name}"
container_name       = "${container_name}"
key                  = "shared.tfstate"
use_azuread_auth     = true
EOF

echo "Čekám na propagaci role Storage Blob Data Contributor..."
backend_ready=false
for _ in {1..18}; do
  if az storage blob list \
    --account-name "${storage_account_name}" \
    --container-name "${container_name}" \
    --auth-mode login \
    --num-results 1 \
    --only-show-errors \
    --output none; then
    backend_ready=true
    break
  fi
  sleep 10
done

if [[ "${backend_ready}" != "true" ]]; then
  echo "Data-plane role ještě není aktivní. Počkejte několik minut a spusťte skript znovu." >&2
  exit 1
fi

echo "Přepínám Storage na Entra ID autentizaci a vypínám shared access keys..."
terraform -chdir="${SETUP_DIR}" apply

cat >"${SETUP_DIR}/backend_override.tf" <<'EOF'
terraform {
  backend "azurerm" {}
}
EOF

echo "Migruji setup state do Azure Storage..."
terraform -chdir="${SETUP_DIR}" init \
  -migrate-state \
  -force-copy \
  -backend-config="${SETUP_DIR}/backend.hcl"

echo "Inicializuji shared deployment s odděleným remote state..."
terraform -chdir="${SHARED_DIR}" init \
  -backend-config="${SHARED_DIR}/backend.hcl"

echo
echo "Bootstrap je dokončen."
echo "Další krok: terraform -chdir=${SHARED_DIR} plan"
