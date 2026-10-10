#!/usr/bin/env bash
# Tabulka spotřeby tým × deployment a součty vůči rozpočtům. Ceník a rozpočty jsou v KQL funkcích
# HackathonUsage()/HackathonCostStatus() v LAW (generuje je Terraform), takže čísla odpovídají cost jobu.
# Použití: team-usage.sh [LAW_CUSTOMER_ID]   (jinak z `terraform output apim_law_customer_id`)
set -euo pipefail

export AZURE_CONFIG_DIR="${AZURE_CONFIG_DIR:-$HOME/.azure-rak}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS="${1:-${LAW_CUSTOMER_ID:-}}"
if [[ -z "$WS" ]]; then
  WS="$(terraform -chdir="${SCRIPT_DIR}/../shared" output -raw apim_law_customer_id)"
fi

usage="$(az monitor log-analytics query -w "$WS" --analytics-query "HackathonUsage() | order by Team asc, DeploymentName asc" -o json)"
status="$(az monitor log-analytics query -w "$WS" --analytics-query "HackathonCostStatus()" -o json)"

USAGE="$usage" STATUS="$status" python3 - <<'PY'
import json, os
usage = json.loads(os.environ["USAGE"])
status = json.loads(os.environ["STATUS"])
f = lambda v: float(v or 0)
n = lambda v: f"{int(float(v or 0)):,}"
cols = ["Team", "Deployment", "Prompt tok", "Completion tok", "Images", "Cost USD"]
rows = [[u["Team"], u["DeploymentName"], n(u["PromptTokens"]), n(u["CompletionTokens"]), n(u["Images"]), f"{f(u['CostUsd']):.2f}"] for u in usage]
w = [max(len(str(x)) for x in [c] + [r[i] for r in rows]) for i, c in enumerate(cols)]
line = lambda r: "  ".join(str(x).ljust(w[i]) if i < 2 else str(x).rjust(w[i]) for i, x in enumerate(r))
print(line(cols)); print("  ".join("-" * x for x in w))
for r in rows: print(line(r))
print("\nSoučty týmů")
hdr = ["Team", "Cost USD", "Budget USD", "% budget", "Stav"]
body = []
overall = None
for s in status:
    if s["Scope"] == "overall":
        overall = s
    else:
        st = "REVOKE" if s["Revoke"] in (True, "True", "true") else ("VAROVÁNÍ" if f(s["Pct"]) >= 90 else "OK")
        body.append([s["Team"], f"{f(s['CostUsd']):.2f}", f"{f(s['LimitUsd']):.0f}", f"{f(s['Pct']):.1f}", st])
w2 = [max(len(x) for x in [h] + [b[i] for b in body]) for i, h in enumerate(hdr)]
fmt = lambda r: "  ".join(x.ljust(w2[i]) if i in (0, 4) else x.rjust(w2[i]) for i, x in enumerate(r))
print(fmt(hdr)); print("  ".join("-" * x for x in w2))
for b in body: print(fmt(b))
if overall:
    print(f"\nCELKEM: {f(overall['CostUsd']):.2f} USD z {f(overall['LimitUsd']):.0f} USD ({f(overall['Pct']):.1f} %)")
PY
