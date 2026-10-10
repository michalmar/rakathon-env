# APIM BasicV2 (GA) před sdílenými Foundry modely. Jedna APIM subscription na tým;
# subscription (teamNN) zakládají skripty, ne Terraform.

locals {
  apim_name = var.apim_name != "" ? var.apim_name : "apim-${var.project_name_compact}-${random_string.storage_suffix.result}"
  # Endpoint s custom subdoménou, OpenAI v1 povrch
  foundry_openai_v1_url = "https://${azurerm_cognitive_account.foundry.custom_subdomain_name}.openai.azure.com/openai/v1"
}

resource "azurerm_log_analytics_workspace" "gateway" {
  name                = "log-${var.project_name_compact}-${random_string.storage_suffix.result}"
  location            = azurerm_resource_group.shared.location
  resource_group_name = azurerm_resource_group.shared.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = var.tags
}

resource "azurerm_api_management" "gateway" {
  name                = local.apim_name
  location            = azurerm_resource_group.shared.location
  resource_group_name = azurerm_resource_group.shared.name
  publisher_name      = "Rakathon"
  publisher_email     = var.apim_publisher_email
  sku_name            = "BasicV2_1"
  tags                = var.tags

  identity {
    type = "SystemAssigned"
  }
}

resource "azurerm_role_assignment" "apim_foundry_user" {
  scope                = azurerm_cognitive_account.foundry.id
  role_definition_name = "Foundry User"
  principal_id         = azurerm_api_management.gateway.identity[0].principal_id
}

resource "azurerm_api_management_api" "openai" {
  name                  = "openai-v1"
  resource_group_name   = azurerm_resource_group.shared.name
  api_management_name   = azurerm_api_management.gateway.name
  revision              = "1"
  display_name          = "Foundry OpenAI v1"
  path                  = "openai/v1"
  protocols             = ["https"]
  subscription_required = true

  subscription_key_parameter_names {
    header = "api-key"
    query  = "api-key"
  }
}

resource "azurerm_api_management_api_policy" "openai" {
  api_name            = azurerm_api_management_api.openai.name
  api_management_name = azurerm_api_management.gateway.name
  resource_group_name = azurerm_resource_group.shared.name
  xml_content         = templatefile("${path.module}/policies/api.xml.tftpl", { backend_url = local.foundry_openai_v1_url })
}

locals {
  apim_operations = {
    chat      = { method = "POST", url = "/chat/completions", policy = "llm", params = [] }
    responses = { method = "POST", url = "/responses", policy = "llm", params = [] }
    images    = { method = "POST", url = "/images/generations", policy = "image", params = [] }
    models    = { method = "GET", url = "/models", policy = null, params = [] }
    # Jen explicitní operace: žádný wildcard, takže jakákoli jiná cesta (včetně POST) skončí 404 už na APIM.
    response_get    = { method = "GET", url = "/responses/{response_id}", policy = null, params = ["response_id"] }
    response_delete = { method = "DELETE", url = "/responses/{response_id}", policy = null, params = ["response_id"] }
  }
}

resource "azurerm_api_management_api_operation" "ops" {
  for_each = local.apim_operations

  operation_id        = replace(each.key, "_", "-")
  api_name            = azurerm_api_management_api.openai.name
  api_management_name = azurerm_api_management.gateway.name
  resource_group_name = azurerm_resource_group.shared.name
  display_name        = "${each.value.method} ${each.value.url}"
  method              = each.value.method
  url_template        = each.value.url

  dynamic "template_parameter" {
    for_each = each.value.params
    content {
      name     = template_parameter.value
      required = true
      type     = "string"
    }
  }

  response {
    status_code = 200
  }
}

resource "azurerm_api_management_api_operation_policy" "ops" {
  for_each = { for k, v in local.apim_operations : k => v if v.policy != null }

  api_name            = azurerm_api_management_api.openai.name
  api_management_name = azurerm_api_management.gateway.name
  resource_group_name = azurerm_resource_group.shared.name
  operation_id        = azurerm_api_management_api_operation.ops[each.key].operation_id

  xml_content = each.value.policy == "llm" ? templatefile("${path.module}/policies/llm.xml.tftpl", {
    tokens_per_minute  = var.apim_tokens_per_minute
    token_quota        = var.apim_token_quota
    token_quota_period = var.apim_token_quota_period
    force_stream_usage = each.key == "chat"
    }) : templatefile("${path.module}/policies/image.xml.tftpl", {
    calls_per_minute = var.apim_image_calls_per_minute
    foundry_base_url = "https://${azurerm_cognitive_account.foundry.custom_subdomain_name}.openai.azure.com"
  })
}

resource "azurerm_api_management_product" "hackathon" {
  product_id            = "hackathon"
  api_management_name   = azurerm_api_management.gateway.name
  resource_group_name   = azurerm_resource_group.shared.name
  display_name          = "Hackathon"
  subscription_required = true
  approval_required     = false
  published             = true
}

resource "azurerm_api_management_product_api" "hackathon" {
  api_name            = azurerm_api_management_api.openai.name
  product_id          = azurerm_api_management_product.hackathon.product_id
  api_management_name = azurerm_api_management.gateway.name
  resource_group_name = azurerm_resource_group.shared.name
}

# Logy gateway do LAW (resource-specific tabulky)
resource "azurerm_monitor_diagnostic_setting" "apim" {
  name                           = "to-law"
  target_resource_id             = azurerm_api_management.gateway.id
  log_analytics_workspace_id     = azurerm_log_analytics_workspace.gateway.id
  log_analytics_destination_type = "Dedicated"

  enabled_log {
    category = "GatewayLogs"
  }

  enabled_log {
    category = "GatewayLlmLogs"
  }
}

# LLM logy (tokeny) zapíná až diagnostika služby – azurerm to neumí; diagnostika azuremonitor v APIM už existuje
resource "azapi_update_resource" "apim_diagnostic" {
  type        = "Microsoft.ApiManagement/service/diagnostics@2024-06-01-preview"
  resource_id = "${azurerm_api_management.gateway.id}/diagnostics/azuremonitor"

  body = {
    properties = {
      loggerId    = "${azurerm_api_management.gateway.id}/loggers/azuremonitor"
      logClientIp = true
      sampling = {
        samplingType = "fixed"
        percentage   = 100
      }
      largeLanguageModel = {
        logs = "enabled"
      }
    }
  }
}
