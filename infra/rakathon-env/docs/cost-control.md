# Řízení nákladů a rozpočtů (APIM + Foundry)

Spotřeba každého týmu (APIM subscription `teamNN`) se z logů APIM přepočítává na USD podle pevného ceníku. Při dosažení limitu se subscription automaticky **suspenduje** (klíč přestane platit do ~10 s, obnovení je vratné).

## Limity (výchozí hodnoty)

| Co | Hodnota | Akce |
|---|---|---|
| Celý event | 5 000 USD (`overall_budget_usd`) | varování od 90 % (4 500 USD) e-mailem; **revoke všech týmů** při `5000 − 200` USD (`overall_revoke_safety_margin_usd`) |
| Jeden tým | 1 000 USD (`team_budget_usd`) | varování od 90 % (900 USD); revoke týmu při 100 % |

Součet týmových rozpočtů smí být vyšší než 5 000 USD – platí limit, který padne dřív. Rezerva 200 USD kryje zpoždění (logy ~2,5 min + job po 5 min + zápis) – během ~8 min může tým při 200 000 tokenů/min utratit nejhůře desítky USD.

Rozpočtové okno začíná v `budget_window_start` (UTC); starší spotřeba se nepočítá.

## Kde se co nastavuje (Terraform, `infra/rakathon-env/shared`)

| Proměnná | Význam |
|---|---|
| `model_prices` | ceník USD / 1M vstupních a výstupních tokenů, USD / obrázek, per deployment; deployment mimo mapu se účtuje **nejvyšší** cenou |
| `overall_budget_usd`, `team_budget_usd`, `team_budget_overrides` | rozpočty (`{ team05 = 1500 }` zvedne jednomu týmu limit) |
| `budget_warn_ratio` | 0.9 |
| `overall_revoke_safety_margin_usd` | rezerva pro celkový revoke |
| `budget_window_start` | začátek počítání |
| `budget_alert_emails` | příjemci alertů |
| `apim_enforce_budget` | `false` = jen měření + alerty, bez suspendování |
| `apim_token_quota`, `apim_tokens_per_minute` | tvrdé limity v APIM (viz níže) |

Změna = `terraform apply` v `shared/` (ceník i rozpočty se promítnou do KQL funkcí v LAW, jobu, workbooku i skriptu).

Ceny jsou z Azure Retail Prices API (`serviceName=Foundry Models`, swedencentral, Standard, krátký kontext, bez slevy za cache → lehce nadsazené). **Odhad**: `mai-image-2-5-global` – cena za obrázek 0,20 USD (účtuje se tokeny; předpoklad ~4 000 výstupních tokenů × 0,047 USD/1K). Reasoning tokeny se účtují jako výstupní (`max(completion, total − prompt)`).

## Jak to funguje

1. **KQL funkce v LAW** (`HackathonRequests`, `HackathonUsage`, `HackathonCostStatus`) – spojí `ApiManagementGatewayLogs` a `ApiManagementGatewayLlmLog` (podle `CorrelationId`, jen HTTP 200, `ApimSubscriptionId` = název subscription) a vynásobí ceníkem. Obrázky se počítají po požadavcích.
2. **Logic App `logic-rakathon-costjob`** (každých 5 min, system MI): načte `HackathonCostStatus()`, zapíše snapshot do tabulky `CostControl_CL` (Scope, Team, CostUsd, LimitUsd, Pct, Action=`status`) a pro každou **aktivní** subscription `team*` s překročeným limitem (nebo při překročení celkového limitu pro všechny) udělá `PATCH state=suspended` a zapíše záznam `Action=revoked`. Subscription `ops-*` se nikdy nesuspendují. Role MI: API Management Service Contributor (APIM), Log Analytics Reader (LAW), Monitoring Metrics Publisher (DCR).
3. **Alerty** (Action group `ag-rakathon-budget`, 3 e-maily; scheduled query rules nad `CostControl_CL`, každých 5 min, per tým = jedna notifikace dokud se stav nezmění): `team-warn`, `overall-warn`, `team-revoked`, `overall-revoked`, plus `job-stalled` (job 20 min nezapsal nic → fail-open, zkontrolujte Logic App).
4. **Workbook** „Hackathon – náklady a rozpočty“ (odkaz: `terraform output cost_workbook_url`): celkem vs. 5 000 USD, týmy vs. 1 000 USD se stavem (OK / VAROVÁNÍ / REVOKED), tým × deployment, náklady a tokeny v čase, obrázky, poslední akce jobu.

Zpoždění od požadavku po revoke: logy ~2,5 min + běh jobu (až 5 min) → typicky 3–8 min.

## Provozní runbook

```bash
export AZURE_CONFIG_DIR="$HOME/.azure-rak"
infra/rakathon-env/scripts/team-usage.sh        # tým × deployment, součty a % rozpočtů
```

**Restore týmu po revoke** – job je tvrdý strop: ručně obnovená subscription by byla do 5 min znovu suspendována, dokud je spotřeba ≥ limit. Postup:

1. zvedněte rozpočet: v `terraform.tfvars` `team_budget_overrides = { team05 = 1500 }` (nebo `team_budget_usd` / `overall_budget_usd`) a `terraform apply`,
2. aktivujte subscription: `infra/rakathon-env/scripts/set-team-access.sh` (nebo
   `az rest --method patch --url "$B/subscriptions/team05?api-version=2024-05-01" --body '{"properties":{"state":"active"}}'`, viz `apim-findings.md`).

Po celkovém revoke musí organizátor zvednout `overall_budget_usd` (nebo zkrátit rezervu) a aktivovat týmy. Dočasné vypnutí vynucování: `apim_enforce_budget = false` + apply (měření a alerty zůstanou).

**Omezení**: job při výpadku LAW selže bez revoke (fail-open) – hlídá `job-stalled`. Logic App čte max. 100 subscription.

## Ochrana proti „runaway“ nákladům

- **Metering**: API má jen explicitní operace (`POST /chat/completions`, `/responses`, `/images/generations`, `GET /models`, `GET|DELETE /responses/{id}`); wildcard `/*` byl odstraněn, ostatní cesty vrací 404. Všechny nákladné POST mají `llm-token-limit` / `rate-limit-by-key` a logují se.
- **Denní kvóta** `apim_token_quota` = 4 000 000 tokenů / tým / den (součet přes modely, reset UTC půlnoc). Nejhorší případ (výhradně výstupní tokeny nejdražšího modelu `gpt-6-astra-global`, 50 USD/1M) = ~200 USD/den, tj. týmový rozpočet 1 000 USD nelze spálit dříve než za 5 dní; realistický mix vychází řádově na 10–30 USD/den.
- **TPM** `apim_tokens_per_minute` = 200 000 (sdílená kapacita deploymentů se nemění).
- Obrázky: `apim_image_calls_per_minute` = 30 / tým (≈ 6 USD/min nejhůře).

## Workbook a testování

- Workbook: https://portal.azure.com/#@7f0c84c5-bbea-48b2-bad1-6baf63d0c73c/resource/subscriptions/83ae1511-eee9-469a-8c48-b9a9069b92e4/resourceGroups/rg-rakathon-shared/providers/Microsoft.Insights/workbooks/f5920510-b0d4-8016-9769-62d82c9f5c51/workbook
- Ověřeno end-to-end s malými rozpočty (týmové 2 USD, celkový 2 USD): varování 90 % (alert + e-mail), suspend týmu při 100 %, suspend všech `team*` při překročení celkového limitu, ruční reaktivace. Po reaktivaci může gateway ještě 1–2 minuty vracet 401 (cache stavu subscription).
- Job je fail-open: když dotaz do LAW selže, nic se neblokuje; hlídá to alert `job-stalled`.
- Streaming: policy na `chat/completions` při `stream=true` vynutí `stream_options.include_usage=true` (ověřeno 2026-10-10: streamovaný požadavek bez volby je v `ApiManagementGatewayLlmLog` s tokeny). `/responses` nemá `stream_options`; usage je součástí události `response.completed`.
- Testovací alerty rozeslaly e-maily na produkční adresy.
- `apim-findings.md` popisuje starý stav: wildcard operace `/*` byly odstraněny a denní kvóta je nyní 4 M tokenů.
