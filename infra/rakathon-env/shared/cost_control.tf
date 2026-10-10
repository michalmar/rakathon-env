# Řízení nákladů: ceník a rozpočty jako KQL funkce v LAW (jediný zdroj pravdy), Logic App (každých 5 min)
# vyhodnotí spotřebu a suspenduje APIM subscription týmů, výsledky zapisuje do tabulky CostControl_CL,
# alerty (Azure Monitor) posílají e-maily na varování 90 % a na revoke.

locals {
  cost_prices_rows = join(",\n  ", [
    for name, p in var.model_prices :
    format("\"%s\", real(%g), real(%g), real(%g)", name, p.input_per_1m, p.output_per_1m, p.per_image)
  ])

  cost_overrides_rows = join(",\n  ", concat(
    ["\"__none__\", real(0)"],
    [for team, budget in var.team_budget_overrides : format("\"%s\", real(%g)", team, budget)]
  ))

  kql_requests = <<-EOT
    let WindowStart = datetime(${var.budget_window_start});
    let Prices = datatable(DeploymentName:string, InPer1M:real, OutPer1M:real, PerImage:real) [
      ${local.cost_prices_rows}
    ];
    let MaxIn = toscalar(Prices | summarize max(InPer1M));
    let MaxOut = toscalar(Prices | summarize max(OutPer1M));
    let MaxImg = toscalar(Prices | summarize max(PerImage));
    let ImageDeployment = toscalar(Prices | top 1 by PerImage desc | project DeploymentName);
    let Gw = ApiManagementGatewayLogs
      | where TimeGenerated >= WindowStart and ApimSubscriptionId != "" and ResponseCode == "200"
      | summarize Time = min(TimeGenerated), Team = any(ApimSubscriptionId), Url = any(Url) by CorrelationId;
    let Tokens = ApiManagementGatewayLlmLog
      | where TimeGenerated >= WindowStart and DeploymentName != ""
      | summarize P = max(toint(PromptTokens)), C = max(toint(CompletionTokens)), T = max(toint(TotalTokens)) by CorrelationId, DeploymentName
      | where P + C + T > 0
      | join kind=inner Gw on CorrelationId
      | extend Billable = max_of(C, T - P)
      | join kind=leftouter Prices on DeploymentName
      | extend InPrice = coalesce(InPer1M, MaxIn), OutPrice = coalesce(OutPer1M, MaxOut)
      | project TimeGenerated = Time, Team, DeploymentName, PromptTokens = tolong(P), CompletionTokens = tolong(Billable), Images = long(0), CostUsd = (P * InPrice + Billable * OutPrice) / 1000000.0;
    let ImageRows = Gw
      | where Url has "/images/generations"
      | project TimeGenerated = Time, Team, DeploymentName = ImageDeployment, PromptTokens = long(0), CompletionTokens = long(0), Images = long(1), CostUsd = MaxImg;
    union Tokens, ImageRows
  EOT

  kql_usage = <<-EOT
    HackathonRequests()
    | summarize Requests = count(), PromptTokens = sum(PromptTokens), CompletionTokens = sum(CompletionTokens), Images = sum(Images), CostUsd = sum(CostUsd) by Team, DeploymentName
  EOT

  kql_status = <<-EOT
    let OverallBudget = real(${var.overall_budget_usd});
    let TeamBudget = real(${var.team_budget_usd});
    let OverallLimit = OverallBudget - real(${var.overall_revoke_safety_margin_usd});
    let Overrides = datatable(Team:string, Override:real) [
      ${local.cost_overrides_rows}
    ];
    let CostByTeam = HackathonUsage() | summarize TeamCost = sum(CostUsd) by Team;
    let OverallCost = coalesce(toscalar(CostByTeam | summarize sum(TeamCost)), real(0));
    let OverallBreach = round(OverallCost, 4) >= OverallLimit;
    let Teams = CostByTeam
      | join kind=leftouter Overrides on Team
      | extend Budget = coalesce(Override, TeamBudget)
      | project Scope = "team", Team, CostUsd = round(TeamCost, 2), LimitUsd = Budget, Pct = round(100 * TeamCost / Budget, 1), Revoke = (round(TeamCost, 4) >= Budget or OverallBreach);
    union Teams, (print Scope = "overall", Team = "*", CostUsd = round(OverallCost, 2), LimitUsd = OverallBudget, Pct = round(100 * OverallCost / OverallBudget, 1), Revoke = OverallBreach)
    | order by Scope asc, Team asc
  EOT

  cost_table  = "CostControl_CL"
  cost_stream = "Custom-CostControl_CL"
  warn_pct    = var.budget_warn_ratio * 100
}

resource "azurerm_log_analytics_saved_search" "requests" {
  name                       = "HackathonRequests"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.gateway.id
  category                   = "Hackathon"
  display_name               = "HackathonRequests"
  function_alias             = "HackathonRequests"
  query                      = local.kql_requests
}

resource "azurerm_log_analytics_saved_search" "usage" {
  name                       = "HackathonUsage"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.gateway.id
  category                   = "Hackathon"
  display_name               = "HackathonUsage"
  function_alias             = "HackathonUsage"
  query                      = local.kql_usage

  depends_on = [azurerm_log_analytics_saved_search.requests]
}

resource "azurerm_log_analytics_saved_search" "status" {
  name                       = "HackathonCostStatus"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.gateway.id
  category                   = "Hackathon"
  display_name               = "HackathonCostStatus"
  function_alias             = "HackathonCostStatus"
  query                      = local.kql_status

  depends_on = [azurerm_log_analytics_saved_search.usage]
}

# --- Výstupní sink: vlastní tabulka přes Logs Ingestion API ---

resource "azapi_resource" "cost_table" {
  type      = "Microsoft.OperationalInsights/workspaces/tables@2022-10-01"
  name      = local.cost_table
  parent_id = azurerm_log_analytics_workspace.gateway.id

  body = {
    properties = {
      plan            = "Analytics"
      retentionInDays = 30
      schema = {
        name = local.cost_table
        columns = [
          { name = "TimeGenerated", type = "datetime" },
          { name = "Scope", type = "string" },
          { name = "Team", type = "string" },
          { name = "CostUsd", type = "real" },
          { name = "LimitUsd", type = "real" },
          { name = "Pct", type = "real" },
          { name = "Action", type = "string" },
          { name = "Detail", type = "string" },
        ]
      }
    }
  }
}

resource "azurerm_monitor_data_collection_endpoint" "cost" {
  name                          = "dce-${var.project_name_compact}-cost"
  location                      = azurerm_resource_group.shared.location
  resource_group_name           = azurerm_resource_group.shared.name
  public_network_access_enabled = true
  tags                          = var.tags
}

resource "azurerm_monitor_data_collection_rule" "cost" {
  name                        = "dcr-${var.project_name_compact}-cost"
  location                    = azurerm_resource_group.shared.location
  resource_group_name         = azurerm_resource_group.shared.name
  data_collection_endpoint_id = azurerm_monitor_data_collection_endpoint.cost.id
  tags                        = var.tags

  destinations {
    log_analytics {
      workspace_resource_id = azurerm_log_analytics_workspace.gateway.id
      name                  = "law"
    }
  }

  stream_declaration {
    stream_name = local.cost_stream
    column {
      name = "TimeGenerated"
      type = "datetime"
    }
    column {
      name = "Scope"
      type = "string"
    }
    column {
      name = "Team"
      type = "string"
    }
    column {
      name = "CostUsd"
      type = "real"
    }
    column {
      name = "LimitUsd"
      type = "real"
    }
    column {
      name = "Pct"
      type = "real"
    }
    column {
      name = "Action"
      type = "string"
    }
    column {
      name = "Detail"
      type = "string"
    }
  }

  data_flow {
    streams       = [local.cost_stream]
    destinations  = ["law"]
    output_stream = local.cost_stream
    transform_kql = "source"
  }

  depends_on = [azapi_resource.cost_table]
}

# --- Logic App (Consumption, system MI): vyhodnocení a revoke ---

locals {
  apim_arm_url   = "https://management.azure.com${azurerm_api_management.gateway.id}"
  ingest_url     = "${azurerm_monitor_data_collection_endpoint.cost.logs_ingestion_endpoint}/dataCollectionRules/${azurerm_monitor_data_collection_rule.cost.immutable_id}/streams/${local.cost_stream}?api-version=2023-01-01"
  mi_arm         = { type = "ManagedServiceIdentity", audience = "https://management.azure.com" }
  mi_law         = { type = "ManagedServiceIdentity", audience = "https://api.loganalytics.io" }
  mi_ingest      = { type = "ManagedServiceIdentity", audience = "https://monitor.azure.com" }
  row_first      = "first(body('Team_row'))"
  overall_cost   = "first(body('Overall_row'))[2]"
  overall_limit  = "first(body('Overall_row'))[3]"
  overall_breach = "equals(first(body('Overall_row'))[5], true)"

  cost_job_definition = {
    "$schema"      = "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#"
    contentVersion = "1.0.0.0"
    parameters     = {}
    triggers = {
      Every_5_minutes = {
        type       = "Recurrence"
        recurrence = { frequency = "Minute", interval = 5 }
      }
    }
    actions = {
      Get_subscriptions = {
        type = "Http"
        inputs = {
          method         = "GET"
          uri            = "${local.apim_arm_url}/subscriptions?api-version=2024-05-01&$top=100"
          authentication = local.mi_arm
        }
        runAfter = {}
      }
      Query_cost = {
        type = "Http"
        inputs = {
          method         = "POST"
          uri            = "https://api.loganalytics.io/v1/workspaces/${azurerm_log_analytics_workspace.gateway.workspace_id}/query"
          headers        = { "Content-Type" = "application/json" }
          body           = { query = "HackathonCostStatus()" }
          authentication = local.mi_law
        }
        runAfter = {}
      }
      Rows = {
        type     = "Compose"
        inputs   = "@body('Query_cost')['tables'][0]['rows']"
        runAfter = { Query_cost = ["Succeeded"] }
      }
      Overall_row = {
        type     = "Query"
        inputs   = { from = "@outputs('Rows')", where = "@equals(item()[0], 'overall')" }
        runAfter = { Rows = ["Succeeded"] }
      }
      Active_team_subs = {
        type = "Query"
        inputs = {
          from  = "@body('Get_subscriptions')['value']"
          where = "@and(startsWith(item()['name'], 'team'), equals(item()['properties']['state'], 'active'))"
        }
        runAfter = { Get_subscriptions = ["Succeeded"] }
      }
      Snapshot = {
        type = "Select"
        inputs = {
          from = "@outputs('Rows')"
          select = {
            TimeGenerated = "@utcNow()"
            Scope         = "@item()[0]"
            Team          = "@item()[1]"
            CostUsd       = "@item()[2]"
            LimitUsd      = "@item()[3]"
            Pct           = "@item()[4]"
            Action        = "status"
            Detail        = ""
          }
        }
        runAfter = { Rows = ["Succeeded"] }
      }
      Write_snapshot = {
        type = "Http"
        inputs = {
          method         = "POST"
          uri            = local.ingest_url
          headers        = { "Content-Type" = "application/json" }
          body           = "@body('Snapshot')"
          authentication = local.mi_ingest
        }
        runAfter = { Snapshot = ["Succeeded"] }
      }
      Revoke_loop = {
        type    = "Foreach"
        foreach = "@body('Active_team_subs')"
        runtimeConfiguration = {
          concurrency = { repetitions = 1 }
        }
        runAfter = {
          Overall_row      = ["Succeeded"]
          Active_team_subs = ["Succeeded"]
        }
        actions = {
          Team_row = {
            type = "Query"
            inputs = {
              from  = "@outputs('Rows')"
              where = "@and(equals(item()[0], 'team'), equals(item()[1], items('Revoke_loop')['name']), equals(item()[5], true))"
            }
            runAfter = {}
          }
          Needs_revoke = {
            type = "If"
            expression = {
              and = [
                { equals = [var.apim_enforce_budget, true] },
                {
                  or = [
                    { equals = ["@${local.overall_breach}", true] },
                    { greater = ["@length(body('Team_row'))", 0] },
                  ]
                },
              ]
            }
            actions = {
              Suspend = {
                type = "Http"
                inputs = {
                  method         = "PATCH"
                  uri            = "${local.apim_arm_url}/subscriptions/@{items('Revoke_loop')['name']}?api-version=2024-05-01"
                  headers        = { "Content-Type" = "application/json", "If-Match" = "*" }
                  body           = { properties = { state = "suspended" } }
                  authentication = local.mi_arm
                }
                runAfter = {}
              }
              Write_revoke = {
                type = "Http"
                inputs = {
                  method  = "POST"
                  uri     = local.ingest_url
                  headers = { "Content-Type" = "application/json" }
                  body = [{
                    TimeGenerated = "@{utcNow()}"
                    Scope         = "@{if(${local.overall_breach}, 'overall', 'team')}"
                    Team          = "@{items('Revoke_loop')['name']}"
                    CostUsd       = "@if(greater(length(body('Team_row')), 0), first(body('Team_row'))[2], ${local.overall_cost})"
                    LimitUsd      = "@if(greater(length(body('Team_row')), 0), first(body('Team_row'))[3], ${local.overall_limit})"
                    Pct           = "@if(greater(length(body('Team_row')), 0), first(body('Team_row'))[4], first(body('Overall_row'))[4])"
                    Action        = "revoked"
                    Detail        = "subscription suspended"
                  }]
                  authentication = local.mi_ingest
                }
                runAfter = { Suspend = ["Succeeded"] }
              }
            }
            runAfter = { Team_row = ["Succeeded"] }
          }
        }
      }
    }
  }
}

resource "azapi_resource" "cost_job" {
  type      = "Microsoft.Logic/workflows@2019-05-01"
  name      = "logic-${var.project_name_compact}-costjob"
  location  = azurerm_resource_group.shared.location
  parent_id = azurerm_resource_group.shared.id
  tags      = var.tags

  identity {
    type = "SystemAssigned"
  }

  body = {
    properties = {
      state      = "Enabled"
      definition = local.cost_job_definition
    }
  }

  response_export_values = []
}

locals {
  cost_job_principal_id = azapi_resource.cost_job.identity[0].principal_id
}

resource "azurerm_role_assignment" "cost_job_apim" {
  scope                = azurerm_api_management.gateway.id
  role_definition_name = "API Management Service Contributor"
  principal_id         = local.cost_job_principal_id
}

resource "azurerm_role_assignment" "cost_job_law" {
  scope                = azurerm_log_analytics_workspace.gateway.id
  role_definition_name = "Log Analytics Reader"
  principal_id         = local.cost_job_principal_id
}

resource "azurerm_role_assignment" "cost_job_dcr" {
  scope                = azurerm_monitor_data_collection_rule.cost.id
  role_definition_name = "Monitoring Metrics Publisher"
  principal_id         = local.cost_job_principal_id
}

# --- Alerty ---

resource "azurerm_monitor_action_group" "budget" {
  name                = "ag-${var.project_name_compact}-budget"
  resource_group_name = azurerm_resource_group.shared.name
  short_name          = "hackbudget"
  tags                = var.tags

  dynamic "email_receiver" {
    for_each = { for i, e in var.budget_alert_emails : tostring(i) => e }
    content {
      name                    = "email-${email_receiver.key}"
      email_address           = email_receiver.value
      use_common_alert_schema = true
    }
  }
}

locals {
  budget_alerts = {
    team-warn = {
      display   = "Hackathon: tým dosáhl ${local.warn_pct} % rozpočtu"
      severity  = 2
      by_team   = true
      query     = "${local.cost_table} | where Action == 'status' and Scope == 'team' and Pct >= ${local.warn_pct} | summarize Pct = max(Pct), CostUsd = max(CostUsd), LimitUsd = max(LimitUsd) by Team"
      threshold = 0
      agg       = "Count"
      measure   = null
      operator  = "GreaterThan"
      window    = "PT15M"
    }
    overall-warn = {
      display   = "Hackathon: celková spotřeba dosáhla ${local.warn_pct} % rozpočtu"
      severity  = 1
      by_team   = false
      query     = "${local.cost_table} | where Action == 'status' and Scope == 'overall' and Pct >= ${local.warn_pct} | summarize Hits = count(), Pct = max(Pct), CostUsd = max(CostUsd), LimitUsd = max(LimitUsd)"
      threshold = 0
      agg       = "Maximum"
      measure   = "Hits"
      operator  = "GreaterThan"
      window    = "PT15M"
    }
    team-revoked = {
      display   = "Hackathon: tým byl zablokován (rozpočet vyčerpán)"
      severity  = 1
      by_team   = true
      query     = "${local.cost_table} | where Action == 'revoked' and Scope == 'team' | summarize Revoked = count(), CostUsd = max(CostUsd), LimitUsd = max(LimitUsd) by Team"
      threshold = 0
      agg       = "Count"
      measure   = null
      operator  = "GreaterThan"
      window    = "PT15M"
    }
    overall-revoked = {
      display   = "Hackathon: celkový rozpočet vyčerpán, všechny týmy zablokovány"
      severity  = 0
      by_team   = false
      query     = "${local.cost_table} | where Action == 'revoked' and Scope == 'overall' | summarize Hits = count(), Teams = dcount(Team), CostUsd = max(CostUsd), LimitUsd = max(LimitUsd)"
      threshold = 0
      agg       = "Maximum"
      measure   = "Hits"
      operator  = "GreaterThan"
      window    = "PT15M"
    }
    job-stalled = {
      display   = "Hackathon: cost job neběží (žádné záznamy 20 min)"
      severity  = 1
      by_team   = false
      query     = "${local.cost_table} | where TimeGenerated > ago(20m) | summarize Records = count()"
      threshold = 1
      agg       = "Maximum"
      measure   = "Records"
      operator  = "LessThan"
      window    = "PT30M"
    }
  }
}

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "budget" {
  for_each = local.budget_alerts

  name                 = "alert-${var.project_name_compact}-${each.key}"
  resource_group_name  = azurerm_resource_group.shared.name
  location             = azurerm_resource_group.shared.location
  display_name         = each.value.display
  description          = each.value.display
  severity             = each.value.severity
  enabled              = true
  scopes               = [azurerm_log_analytics_workspace.gateway.id]
  evaluation_frequency = "PT5M"
  window_duration      = each.value.window

  auto_mitigation_enabled          = true
  skip_query_validation            = true
  workspace_alerts_storage_enabled = false
  tags                             = var.tags

  criteria {
    query                   = each.value.query
    time_aggregation_method = each.value.agg
    metric_measure_column   = each.value.measure
    operator                = each.value.operator
    threshold               = each.value.threshold

    dynamic "dimension" {
      for_each = each.value.by_team ? [1] : []
      content {
        name     = "Team"
        operator = "Include"
        values   = ["*"]
      }
    }

    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.budget.id]
  }

  depends_on = [azapi_resource.cost_table]
}
