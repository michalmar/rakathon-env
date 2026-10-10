# AI Gateway tier (preview) – zjištění ze spiku

Stav: **NELZE OVĚŘIT / blokováno (runtime vrací 404)**. Control-plane (klíče) ověřen, data-plane (tokeny, telemetrie, limity) ne.

## Nasazení
- `Microsoft.ApiManagement/service` (`sku.name=AIGateway`, API `2025-09-01-preview`, jediná dostupná verze pro `service` ve swedencentral), `Microsoft.Web/connectorGateways@2026-05-01-preview` se stejným jménem, model provider Foundry (MI) + 8 modelů, telemetry exporter → App Insights.
- Navíc oproti zadání: registrace RP `Microsoft.Monitor`, role `Monitoring Metrics Publisher` pro MI také na managed DCR App Insights, App Insights s `AzureMonitorWorkspaceIngestionMode=Enabled`.
- Politiky modelu: `{"type":"tokenLimit","period":"minute|hour|day","count":N,"counterKey":["identity"]}` – `counterKey` musí být **pole** (řetězec z reference je odmítnut), `week` neplatí.
- Klasické APIM zdroje (apis, backends, products, subscriptions, loggers, diagnostics, policies) vrací `MethodNotAllowedInPricingTier`.

## Blokátor: runtime 404
`https://aigw-rakathon-q7146n.azure-api.net/default/models/openai/v1/{chat/completions,responses,models}` vrací pro platný, master i neplatný klíč `404 {"statusCode":404,"message":"Resource not found"}`; `/status-0123456789abcdef` vrací 200. Trvá >45 min. Vyzkoušeno: opětovné PUT modelů/provideru, prázdné politiky, role na DCR a **referenční Bicep z Azure-Samples/AI-Gateway nasazený beze změn do čistého RG** – stejné 404. Nezávislá zpráva (naveenneog/claude-code-foundry-gateway, `docs/AI-GATEWAY-TIER.md`) popisuje totéž 404 >6 h pro service-based nasazení. Hypotéza: gateway je nutné vytvořit přes portál ai.gateway.azure.com (typ `Microsoft.ApiManagement/aigateways`, API `2026-09-01-preview`), nebo jde o chybu služby. Nezkoušeno.

## a) Životní cyklus klíčů (ověřeno)
`B=https://management.azure.com/subscriptions/<sub>/resourceGroups/rg-rakathon-shared/providers/Microsoft.ApiManagement/service/aigw-rakathon-q7146n`, `V=api-version=2025-09-01-preview`

```bash
export AZURE_CONFIG_DIR="$HOME/.azure-rak"
az rest --method put    --url "$B/apiKeys/team01?$V" --body '{"properties":{"displayName":"team01"}}'   # create
az rest --method get    --url "$B/apiKeys?$V"                                                          # list (+ vestavěný master)
az rest --method post   --url "$B/apiKeys/team01/listSecrets?$V"                                       # primaryKey, secondaryKey
az rest --method post   --url "$B/apiKeys/team01/regeneratePrimaryKey?$V"                              # hodnota se změní
az rest --method patch  --url "$B/apiKeys/team01?$V" --body '{"properties":{"state":"suspended"}}'     # DISABLE (zpět "active")
az rest --method delete --url "$B/apiKeys/team01?$V"                                                   # delete
```
- **Suspend je podporován** (`state: suspended|active`), hodnota klíče se zachová → vhodné pro revoke/restore.
- Re-create po delete se stejným jménem vygeneruje **novou hodnotu**.
- Klíče jsou gateway-wide, bez omezení na model.
- Neověřeno: že suspendovaný klíč na runtime vrací 401/403 (blokováno 404).

## b–d) Telemetrie, per-key denní limit, image
**Neověřeno** (runtime 404). K ověření po odblokování: dimenze s identitou klíče v `AppMetrics`/`customDimensions`; `tokenLimit` s `counterKey=["identity"]` per klíč, blok = 429 + `Retry-After`; image požadavky pravděpodobně bez token metrik. KQL šablona nepotvrzena.

## Doporučení
GO/NO-GO: **nelze rozhodnout**. Další krok: vytvořit gateway přes portál ai.gateway.azure.com (nebo zdroj `aigateways`) a ověřit runtime; případně support ticket. Fallback (nestavěn): klasické APIM BasicV2.

Dočasné klíče a probe RG `rg-aigw-probe` byly smazány.
