#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "${ROOT_DIR}"

GITLEAKS_BIN="$(command -v gitleaks || true)"
if [[ -z "${GITLEAKS_BIN}" ]]; then
  for candidate in /opt/homebrew/bin/gitleaks /usr/local/bin/gitleaks; do
    if [[ -x "${candidate}" ]]; then
      GITLEAKS_BIN="${candidate}"
      break
    fi
  done
fi

if [[ -z "${GITLEAKS_BIN}" ]]; then
  echo "Gitleaks není nainstalovaný. Nainstalujte jej příkazem 'brew install gitleaks'." >&2
  exit 1
fi

if [[ "${1:-}" == "--staged" ]]; then
  "${GITLEAKS_BIN}" git --staged --redact --no-banner .
  exit 0
fi

"${GITLEAKS_BIN}" dir --redact --no-banner .
"${GITLEAKS_BIN}" git --redact --no-banner .
