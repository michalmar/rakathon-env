# APIM BasicV2 před sdílenými Foundry modely – zjištění

AI Gateway tier (preview) byl opuštěn (runtime vracel 404). Používáme klasické APIM **BasicV2_1** (GA), `apim-rakathon-q7146n`, swedencentral, v `rg-rakathon-shared`. Všech 8 deploymentů ověřeno.

## Architektura
- Klientský base URL: `https://apim-rakathon-q7146n.azure-api.net/openai/v1` (výstup `apim_url`), `model` v těle = název deploymentu.
- API `openai-v1` (path `openai/v1`), hlavička subscription klíče **`api-key`** (i query `api-key`). Produkt `hackathon` (subscription required, bez schvalování).
- Backend `https://ais-rakathon-q7146n.openai.azure.com/openai/v1`, auth `authentication-managed-identity` (MI APIM má roli `Foundry User`). Příchozí `api-key` a `Authorization` se před odesláním do Foundry **mažou** (Foundry by jinak použil APIM klíč → 401).
- Operace: `POST /chat/completions`, `POST /responses` (obě `llm-token-limit`), `POST /images/generations` (`rate-limit-by-key`), `GET /models`, wildcard GET/POST/DELETE `/*`.
- **Image model (MAI)** neběží na `/openai/v1`, ale na `/mai/v1/images/generations` – politika operace přepisuje URI. Tělo MAI: `{"model":"mai-image-2-5-global","prompt":"...","width":1024,"height":1024}` (bez `n`).
- Politiky v `shared/policies/*.tftpl`; limity z proměnných `apim_tokens_per_minute` (200000), `apim_token_quota` (20000000), `apim_token_quota_period` (Daily), `apim_image_calls_per_minute` (30). Counter-key = `@(context.Subscription.Id)` (tj. limit per tým), `estimate-prompt-tokens=false`.
- OpenAI SDK posílá klíč jako `Authorization: Bearer`, což APIM jako subscription klíč nepřijme. Klient:
  ```python
  OpenAI(base_url=".../openai/v1", api_key="unused", default_headers={"api-key": KEY})
  ```
  Bearer by šel akceptovat jen vlastní politikou (nepřidáno).

## Smoke test (ověřeno)
- chat/completions: všech 7 textových deploymentů 200. responses: gpt-6-1-sol-dz-eu, gpt-6-luna-dz-eu, gpt-6-astra-global 200. Streaming s `stream_options.include_usage` 200 (usage v posledním chunku). Image 200 (b64_json). `GET /models` 200.
- Po vytvoření subscription trvá ~1 min, než klíč začne platit (prvních pár volání 401).
- Odpověď llm-token-limit nese hlavičky `remaining-tokens`, `consumed-tokens`.

## Logování
Diagnostic setting `to-law` (kategorie `GatewayLogs`, `GatewayLlmLogs`, Dedicated → resource-specific tabulky) + `Microsoft.ApiManagement/service/diagnostics/azuremonitor` s `largeLanguageModel.logs=enabled` (azapi_update_resource; diagnostika `azuremonitor` v APIM už existuje; hodnota `messages:"none"` je odmítnuta, vynechat). **Na BasicV2 funguje**: `ApiManagementGatewayLogs` i `ApiManagementGatewayLlmLog` se plní, StandardV2 není potřeba.
- **Lag: ~2–2,5 min** (obě tabulky; měřeno s granularitou ~10 s).
- `ApimSubscriptionId` = **název** subscription (např. `ops-test`, tedy `teamNN`).
- `ModelName` v LLM logu = název deploymentu (pro Kimi/Mai by `model` v odpovědi byl jiný, proto používat `DeploymentName`).
- `TotalTokens` zahrnuje reasoning tokeny (může být > prompt+completion).
- LLM log vzniká i pro image (tokeny 0) a pro neúspěšné požadavky (tokeny 0, prázdná subscription) – filtrovat.

## KQL – tokeny per tým × model
```kusto
let gw = ApiManagementGatewayLogs
  | where ApimSubscriptionId != "" and ResponseCode == "200"
  | summarize Team = any(ApimSubscriptionId) by CorrelationId;
ApiManagementGatewayLlmLog
| where DeploymentName != ""
| summarize Prompt = max(toint(PromptTokens)), Completion = max(toint(CompletionTokens)), Total = max(toint(TotalTokens)) by CorrelationId, DeploymentName
| join kind=inner gw on CorrelationId
| summarize Prompt = sum(Prompt), Completion = sum(Completion), Total = sum(Total), Requests = count() by Team, DeploymentName
| order by Team asc, DeploymentName asc
```
Image požadavky per tým:
```kusto
ApiManagementGatewayLogs
| where Url has "/images/generations" and ResponseCode == "200"
| summarize ImageRequests = count() by Team = ApimSubscriptionId
```
(Pozn.: sloupce LLM logu jsou typu string – `toint()`.) Dotaz z CLI: `az monitor log-analytics query -w <customerId> --analytics-query "..."`.

## Limity (ověřeno, per subscription)
- Překročení tokenů/min: **429** `Token limit is exceeded`, `Retry-After`, `remaining-tokens: 0`.
- Překročení kvóty (Daily): **403 Quota Exceeded**, `Retry-After` = sekundy do resetu (UTC půlnoc).
- Izolace: vyčerpání limitu `ops-test` neovlivnilo `ops-test2`.
- Suspend subscription: **401** `Access denied due to invalid subscription key` (účinné do ~10 s); `active` obnoví (do ~10 s), klíč zůstává stejný.

## Příkazy pro subscription
```bash
export AZURE_CONFIG_DIR="$HOME/.azure-rak"
B=https://management.azure.com/subscriptions/83ae1511-eee9-469a-8c48-b9a9069b92e4/resourceGroups/rg-rakathon-shared/providers/Microsoft.ApiManagement/service/apim-rakathon-q7146n
V=api-version=2024-05-01
# create
az rest --method put --url "$B/subscriptions/team01?$V" --body "{\"properties\":{\"scope\":\"$B/products/hackathon\",\"displayName\":\"team01\",\"state\":\"active\"}}"
# list
az rest --method get --url "$B/subscriptions?$V" --query "value[].{n:name,s:properties.state}" -o table
# show key
az rest --method post --url "$B/subscriptions/team01/listSecrets?$V" --query primaryKey -o tsv
# suspend / activate
az rest --method patch --url "$B/subscriptions/team01?$V" --body '{"properties":{"state":"suspended"}}'
az rest --method patch --url "$B/subscriptions/team01?$V" --body '{"properties":{"state":"active"}}'
# regenerate / delete
az rest --method post --url "$B/subscriptions/team01/regeneratePrimaryKey?$V"
az rest --method delete --url "$B/subscriptions/team01?$V"
```
`master` je vestavěná all-access subscription – nepoužívat pro týmy.

## Stav
`ops-test` ponechána **suspended** (klíč v tomto repu není; získat přes `listSecrets` a před testem `active`). `ops-test2` smazána. Foundry `local_auth_enabled` zůstává `true` (cutover dělá S4). Pozor: `terraform apply` také přináší již existující drift `network_rules` úložiště.
