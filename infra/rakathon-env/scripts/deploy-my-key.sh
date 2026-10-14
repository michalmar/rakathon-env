#!/usr/bin/env bash
# Nasadí backend portálu (GET /api/my-key, /api/data-link a /api/spend) zip deploy balíčkem.
# Vyžaduje: az (přihlášený do správného tenantu), terraform, npm, zip.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SHARED_DIR="${ROOT_DIR}/shared"
FUNC_DIR="${ROOT_DIR}/functions/my-key"

app_name="$(terraform -chdir="${SHARED_DIR}" output -raw my_key_function_name)"
resource_group="$(terraform -chdir="${SHARED_DIR}" output -raw resource_group_name)"

build_dir="$(mktemp -d)"
trap 'rm -rf "${build_dir}"' EXIT

cp -R "${FUNC_DIR}/host.json" "${FUNC_DIR}/package.json" "${FUNC_DIR}/package-lock.json" "${FUNC_DIR}/src" "${build_dir}/"
(cd "${build_dir}" && npm ci --omit=dev --no-audit --no-fund --silent && zip -qr package.zip .)

az functionapp deployment source config-zip \
  --name "${app_name}" \
  --resource-group "${resource_group}" \
  --src "${build_dir}/package.zip" \
  --only-show-errors \
  --output none

app_id="$(az functionapp show --name "${app_name}" --resource-group "${resource_group}" --query id --only-show-errors --output tsv)"
az rest \
  --method post \
  --url "https://management.azure.com${app_id}/syncfunctiontriggers?api-version=2024-04-01" \
  --only-show-errors \
  --output none

echo "Function ${app_name} nasazena. Endpointy /api/my-key, /api/data-link, /api/spend a /api/azure-cost vyžadují hlavičku identity ze SWA."
