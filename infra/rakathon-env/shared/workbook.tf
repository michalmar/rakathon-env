# Azure Monitor Workbook pro organizátory; čte funkce HackathonUsage/HackathonRequests/HackathonCostStatus
# (ceník a rozpočty jsou tedy stejné jako v cost jobu a v team-usage.sh) a záznamy CostControl_CL.

resource "random_uuid" "workbook" {}

locals {
  wb_scope = [azurerm_log_analytics_workspace.gateway.id]

  wb_item = { for k, v in {
    overall = {
      title = "Celková spotřeba vs. rozpočet"
      viz   = "tiles"
      query = "HackathonCostStatus() | where Scope == 'overall' | project ['Spotřeba USD'] = CostUsd, ['Rozpočet USD'] = LimitUsd, ['% rozpočtu'] = Pct, ['Revoke všech týmů'] = Revoke"
      size  = 4
    }
    teams = {
      title = "Týmy: spotřeba vs. týmový rozpočet a stav"
      viz   = "table"
      query = <<-KQL
        let LastAction = CostControl_CL | where Action == 'revoked' | summarize ['Poslední revoke'] = max(TimeGenerated) by Team;
        HackathonCostStatus() | where Scope == 'team'
        | join kind=leftouter LastAction on Team
        | extend Stav = case(Revoke, 'REVOKED', Pct >= ${local.warn_pct}, 'VAROVÁNÍ', 'OK')
        | project Team, ['Spotřeba USD'] = CostUsd, ['Rozpočet USD'] = LimitUsd, ['%'] = Pct, Stav, ['Poslední revoke']
        | order by ['%'] desc
      KQL
      size  = 0
    }
    matrix = {
      title = "Náklady tým × deployment"
      viz   = "table"
      query = "HackathonUsage() | project Team, Deployment = DeploymentName, Requests, ['Prompt tokeny'] = PromptTokens, ['Completion tokeny'] = CompletionTokens, Images, ['Cena USD'] = round(CostUsd, 2) | order by Team asc, ['Cena USD'] desc"
      size  = 0
    }
    cost_team = {
      title = "Náklady v čase podle týmu (USD / hod)"
      viz   = "timechart"
      query = "HackathonRequests() | summarize CostUsd = sum(CostUsd) by bin(TimeGenerated, 1h), Team"
      size  = 0
    }
    cost_model = {
      title = "Náklady v čase podle modelu (USD / hod)"
      viz   = "timechart"
      query = "HackathonRequests() | summarize CostUsd = sum(CostUsd) by bin(TimeGenerated, 1h), DeploymentName"
      size  = 0
    }
    tokens_team = {
      title = "Tokeny v čase podle týmu (/ hod)"
      viz   = "timechart"
      query = "HackathonRequests() | summarize Tokens = sum(PromptTokens + CompletionTokens) by bin(TimeGenerated, 1h), Team"
      size  = 0
    }
    images = {
      title = "Počet obrázků podle týmu"
      viz   = "table"
      query = "HackathonRequests() | where Images > 0 | summarize Images = sum(Images), ['Cena USD'] = round(sum(CostUsd), 2) by Team | order by Images desc"
      size  = 0
    }
    actions = {
      title = "Poslední akce jobu (varování / revoke)"
      viz   = "table"
      query = "CostControl_CL | where Action == 'revoked' or (Action == 'status' and Pct >= ${local.warn_pct}) | summarize Poslední = max(TimeGenerated), Pct = max(Pct), CostUsd = max(CostUsd) by Scope, Team, Action | order by Poslední desc | take 50"
      size  = 0
    }
    } : k => {
    type = 3
    name = k
    content = {
      version                 = "KqlItem/1.0"
      query                   = v.query
      size                    = v.size
      title                   = v.title
      queryType               = 0
      resourceType            = "microsoft.operationalinsights/workspaces"
      crossComponentResources = local.wb_scope
      visualization           = v.viz
    }
  } }

  workbook_data = {
    version = "Notebook/1.0"
    items = concat(
      [{ type = 1, name = "header", content = { json = "## Hackathon – náklady a rozpočty\nOkno od `${var.budget_window_start}`. Rozpočet celkem ${var.overall_budget_usd} USD (revoke od ${var.overall_budget_usd - var.overall_revoke_safety_margin_usd} USD), na tým ${var.team_budget_usd} USD, varování od ${local.warn_pct} %. Data mají zpoždění ~3 min; stav/akce jobu se aktualizují každých 5 min." } }],
      [for k in ["overall", "teams", "matrix", "cost_team", "cost_model", "tokens_team", "images", "actions"] : local.wb_item[k]]
    )
    isLocked = false
  }
}

resource "azurerm_application_insights_workbook" "costs" {
  name                = random_uuid.workbook.result
  resource_group_name = azurerm_resource_group.shared.name
  location            = azurerm_resource_group.shared.location
  display_name        = "Hackathon – náklady a rozpočty"
  source_id           = lower(azurerm_log_analytics_workspace.gateway.id)
  data_json           = jsonencode(local.workbook_data)
  tags                = var.tags

  depends_on = [azurerm_log_analytics_saved_search.status]
}
