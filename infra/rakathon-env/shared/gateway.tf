# AI Gateway (APIM tier AIGateway, preview) před sdílenými Foundry modely.
# Runtime API klíče (jeden na tým) se zakládají skripty, ne Terraformem.

locals {
  ai_gateway_name = var.ai_gateway_name != "" ? var.ai_gateway_name : "aigw-${var.project_name_compact}-${random_string.storage_suffix.result}"
  gateway_policies = [
    { type = "tokenLimit", period = "minute", count = var.ai_gateway_tokens_per_minute, counterKey = ["identity"] },
    { type = "tokenLimit", period = "day", count = var.ai_gateway_tokens_per_day, counterKey = ["identity"] },
  ]
}

resource "azurerm_log_analytics_workspace" "gateway" {
  name                = "log-${var.project_name_compact}-${random_string.storage_suffix.result}"
  location            = azurerm_resource_group.shared.location
  resource_group_name = azurerm_resource_group.shared.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = var.tags
}

resource "azapi_resource" "gateway_appinsights" {
  type      = "Microsoft.Insights/components@2020-02-02"
  name      = "appi-${var.project_name_compact}-${random_string.storage_suffix.result}"
  parent_id = azurerm_resource_group.shared.id
  location  = azurerm_resource_group.shared.location
  tags      = var.tags

  schema_validation_enabled = false

  body = {
    kind = "web"
    properties = {
      Application_Type                   = "web"
      WorkspaceResourceId                = azurerm_log_analytics_workspace.gateway.id
      AzureMonitorWorkspaceIngestionMode = "Enabled"
    }
  }

  response_export_values = [
    "properties.OTLPLogsEndpoint",
    "properties.OTLPMetricsEndpoint",
    "properties.OTLPTracesEndpoint",
    "properties.AppId",
    "properties.DataCollectionRuleResourceId",
  ]
}

resource "azapi_resource" "gateway" {
  type      = "Microsoft.ApiManagement/service@${var.ai_gateway_api_version}"
  name      = local.ai_gateway_name
  parent_id = azurerm_resource_group.shared.id
  location  = azurerm_resource_group.shared.location
  tags      = var.tags

  schema_validation_enabled = false

  identity {
    type = "SystemAssigned"
  }

  body = {
    sku = {
      name     = "AIGateway"
      capacity = 1
    }
    properties = {
      publisherEmail = var.ai_gateway_publisher_email
      publisherName  = "Rakathon"
    }
  }

  response_export_values = ["properties.gatewayUrl"]
}

resource "azapi_resource" "gateway_connector_namespace" {
  type      = "Microsoft.Web/connectorGateways@2026-05-01-preview"
  name      = local.ai_gateway_name
  parent_id = azurerm_resource_group.shared.id
  location  = azurerm_resource_group.shared.location

  schema_validation_enabled = false

  body       = { properties = {} }
  depends_on = [azapi_resource.gateway]
}

resource "azurerm_role_assignment" "gateway_foundry_user" {
  scope                = azurerm_cognitive_account.foundry.id
  role_definition_name = "Foundry User"
  principal_id         = azapi_resource.gateway.identity[0].principal_id
}

resource "azurerm_role_assignment" "gateway_metrics_publisher" {
  scope                = azapi_resource.gateway_appinsights.id
  role_definition_name = "Monitoring Metrics Publisher"
  principal_id         = azapi_resource.gateway.identity[0].principal_id
}

# Managed DCR leží v chráněné RG; role assignment (stejně jako v portálu) funguje.
resource "azurerm_role_assignment" "gateway_dcr_publisher" {
  scope                = azapi_resource.gateway_appinsights.output.properties.DataCollectionRuleResourceId
  role_definition_name = "Monitoring Metrics Publisher"
  principal_id         = azapi_resource.gateway.identity[0].principal_id
}

resource "azapi_resource" "gateway_telemetry" {
  type      = "Microsoft.ApiManagement/service/workspaces/telemetryExporters@${var.ai_gateway_api_version}"
  name      = "appinsights"
  parent_id = "${azapi_resource.gateway.id}/workspaces/default"

  schema_validation_enabled = false

  body = {
    properties = {
      kind           = "OpenTelemetry"
      payloadCapture = false
      applicationInsights = {
        resourceId = azapi_resource.gateway_appinsights.id
      }
      openTelemetry = {
        logsEndpoint    = azapi_resource.gateway_appinsights.output.properties.OTLPLogsEndpoint
        metricsEndpoint = azapi_resource.gateway_appinsights.output.properties.OTLPMetricsEndpoint
        tracesEndpoint  = azapi_resource.gateway_appinsights.output.properties.OTLPTracesEndpoint
      }
    }
  }

  depends_on = [azurerm_role_assignment.gateway_metrics_publisher, azurerm_role_assignment.gateway_dcr_publisher]
}

resource "azapi_resource" "gateway_foundry_provider" {
  type      = "Microsoft.ApiManagement/service/workspaces/modelProviders@${var.ai_gateway_api_version}"
  name      = azurerm_cognitive_account.foundry.name
  parent_id = "${azapi_resource.gateway.id}/workspaces/default"

  schema_validation_enabled = false

  body = {
    properties = {
      kind        = "Foundry"
      displayName = azurerm_cognitive_account.foundry.name
      description = "Foundry provider pro ${azurerm_cognitive_account.foundry.name}"
      foundry = {
        endpoint    = azurerm_cognitive_account.foundry.endpoint
        resourceIds = [azurerm_cognitive_account.foundry.id]
        authentication = {
          kind = "ManagedIdentity"
          managedIdentity = {
            resource = "https://cognitiveservices.azure.com/"
          }
        }
      }
    }
  }

  depends_on = [azurerm_role_assignment.gateway_foundry_user]
}

data "azapi_resource" "deployment_capabilities" {
  for_each = var.foundry_model_deployments

  type        = "Microsoft.CognitiveServices/accounts/deployments@2025-06-01"
  resource_id = azurerm_cognitive_deployment.models[each.key].id

  response_export_values = ["properties.capabilities"]
}

locals {
  gateway_model_endpoints = {
    for k, d in data.azapi_resource.deployment_capabilities : k => concat(
      try(d.output.properties.capabilities.chatCompletion, "false") == "true" ? ["/openai/v1/chat/completions"] : [],
      try(d.output.properties.capabilities.responses, "false") == "true" ? ["/openai/v1/responses"] : [],
      try(d.output.properties.capabilities.imageGenerations, "false") == "true" ? ["/openai/v1/images/generations"] : [],
    )
  }
}

resource "azapi_resource" "gateway_models" {
  for_each = var.foundry_model_deployments

  type      = "Microsoft.ApiManagement/service/workspaces/modelProviders/models@${var.ai_gateway_api_version}"
  name      = each.key
  parent_id = azapi_resource.gateway_foundry_provider.id

  schema_validation_enabled = false

  body = {
    properties = {
      displayName        = each.key
      apiFormat          = each.value.model_format
      supportedEndpoints = local.gateway_model_endpoints[each.key]
      deployment = {
        resourceId   = azurerm_cognitive_deployment.models[each.key].id
        modelName    = each.value.model_name
        modelVersion = each.value.model_version
      }
      policies = local.gateway_policies
    }
  }
}
