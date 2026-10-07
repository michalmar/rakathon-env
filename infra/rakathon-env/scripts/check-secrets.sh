#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "${ROOT_DIR}"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "Gitleaks není nainstalovaný. Nainstalujte jej příkazem 'brew install gitleaks'." >&2
  exit 1
fi

if [[ "${1:-}" == "--staged" ]]; then
  gitleaks git --staged --redact --no-banner .
  exit 0
fi

gitleaks dir --redact --no-banner .
gitleaks git --redact --no-banner .
