# Self-service API klíč: Function app (my-key) připojená k SWA jako vlastní backend.
# Čte APIM subscription přihlášeného týmu (teamNN z UPN) přes managed identity
# s minimální custom rolí. Kód funkce: ../functions/my-key (nasazení: scripts/deploy-my-key.sh).

locals {
  my_key_storage_name = "stfn${var.project_name_compact}${random_string.storage_suffix.result}"
  my_key_app_name     = "func-${var.project_name_compact}-key-${random_string.storage_suffix.result}"
}

# Function runtime na Consumption plánu potřebuje vlastní účet se sdíleným klíčem;
# datový účet s vypnutými klíči to neumožňuje, proto je oddělený a bez uživatelských dat.
resource "azurerm_storage_account" "my_key" {
  name                            = local.my_key_storage_name
  resource_group_name             = azurerm_resource_group.shared.name
  location                        = azurerm_resource_group.shared.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  tags                            = merge(var.tags, { service = "rakathon-my-key" })
}

resource "azurerm_service_plan" "my_key" {
  name                = "asp-${var.project_name_compact}-key-${random_string.storage_suffix.result}"
  resource_group_name = azurerm_resource_group.shared.name
  location            = azurerm_resource_group.shared.location
  os_type             = "Linux"
  sku_name            = "Y1"
  tags                = merge(var.tags, { service = "rakathon-my-key" })
}

resource "azurerm_linux_function_app" "my_key" {
  name                          = local.my_key_app_name
  resource_group_name           = azurerm_resource_group.shared.name
  location                      = azurerm_resource_group.shared.location
  service_plan_id               = azurerm_service_plan.my_key.id
  storage_account_name          = azurerm_storage_account.my_key.name
  storage_account_access_key    = azurerm_storage_account.my_key.primary_access_key
  https_only                    = true
  public_network_access_enabled = true

  identity {
    type = "SystemAssigned"
  }

  site_config {
    minimum_tls_version = "1.2"
    ftps_state          = "Disabled"

    application_stack {
      node_version = "22"
    }
  }

  app_settings = {
    APIM_ID       = azurerm_api_management.gateway.id
    APIM_PRODUCT  = azurerm_api_management_product.hackathon.product_id
    APIM_BASE_URL = "${azurerm_api_management.gateway.gateway_url}/openai/v1"
    TENANT_ID     = data.azurerm_client_config.current.tenant_id
  }

  tags = merge(var.tags, { service = "rakathon-my-key" })

  lifecycle {
    ignore_changes = [
      tags["hidden-link: /app-insights-resource-id"],
      auth_settings_v2,
      # nastavuje zip deploy (scripts/deploy-my-key.sh)
      app_settings["WEBSITE_RUN_FROM_PACKAGE"],
    ]
  }
}

resource "azurerm_role_definition" "my_key_reader" {
  name        = "Rakathon APIM Team Key Reader"
  scope       = azurerm_api_management.gateway.id
  description = "Čtení APIM subscriptions a jejich klíčů (pouze pro Function my-key)."

  permissions {
    actions = [
      "Microsoft.ApiManagement/service/subscriptions/read",
      "Microsoft.ApiManagement/service/subscriptions/listSecrets/action",
    ]
    not_actions = []
  }

  assignable_scopes = [azurerm_api_management.gateway.id]
}

resource "azurerm_role_assignment" "my_key_apim" {
  scope              = azurerm_api_management.gateway.id
  role_definition_id = azurerm_role_definition.my_key_reader.role_definition_resource_id
  principal_id       = azurerm_linux_function_app.my_key.identity[0].principal_id
}

resource "azurerm_static_web_app_function_app_registration" "my_key" {
  static_web_app_id = azurerm_static_web_app.portal.id
  function_app_id   = azurerm_linux_function_app.my_key.id
}
