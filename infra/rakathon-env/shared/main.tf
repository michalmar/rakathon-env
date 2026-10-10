data "azurerm_client_config" "current" {}

resource "random_string" "storage_suffix" {
  length  = 6
  special = false
  upper   = false
}

locals {
  storage_account_name  = "st${var.project_name_compact}data${random_string.storage_suffix.result}"
  foundry_resource_name = "ais-${var.project_name_compact}-${random_string.storage_suffix.result}"
}

resource "azurerm_resource_group" "shared" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

resource "azurerm_storage_account" "shared" {
  name                            = local.storage_account_name
  resource_group_name             = azurerm_resource_group.shared.name
  location                        = azurerm_resource_group.shared.location
  account_tier                    = "Standard"
  account_replication_type        = var.account_replication_type
  account_kind                    = "StorageV2"
  access_tier                     = "Hot"
  https_traffic_only_enabled      = true
  min_tls_version                 = "TLS1_2"
  public_network_access_enabled   = true
  shared_access_key_enabled       = var.shared_access_key_enabled
  allow_nested_items_to_be_public = false

  network_rules {
    default_action = var.allow_all_networks ? "Allow" : "Deny"
    ip_rules       = var.allowed_ip_ranges
    bypass         = []
  }

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 14
    }

    container_delete_retention_policy {
      days = 14
    }
  }

  tags = var.tags
}

resource "azurerm_storage_container" "data" {
  name                  = "data"
  storage_account_id    = azurerm_storage_account.shared.id
  container_access_type = "private"
}

resource "azurerm_cognitive_account" "foundry" {
  name                               = local.foundry_resource_name
  custom_subdomain_name              = local.foundry_resource_name
  location                           = azurerm_resource_group.shared.location
  resource_group_name                = azurerm_resource_group.shared.name
  kind                               = "AIServices"
  sku_name                           = "S0"
  project_management_enabled         = true
  public_network_access_enabled      = var.foundry_public_network_access_enabled
  local_auth_enabled                 = false
  outbound_network_access_restricted = var.foundry_outbound_network_access_restricted

  identity {
    type = "SystemAssigned"
  }

  tags = merge(var.tags, {
    service = "microsoft-foundry"
  })
}

resource "azurerm_cognitive_account_project" "foundry" {
  name                 = var.foundry_project_name
  display_name         = "Rakathon project"
  description          = "Microsoft Foundry project pro hackathon."
  location             = azurerm_resource_group.shared.location
  cognitive_account_id = azurerm_cognitive_account.foundry.id

  identity {
    type = "SystemAssigned"
  }

  tags = merge(var.tags, {
    service = "microsoft-foundry-project"
  })
}

resource "azurerm_cognitive_deployment" "models" {
  for_each = var.foundry_model_deployments

  name                   = each.key
  cognitive_account_id   = azurerm_cognitive_account.foundry.id
  rai_policy_name        = "Microsoft.DefaultV2"
  version_upgrade_option = "OnceNewDefaultVersionAvailable"

  model {
    format  = each.value.model_format
    name    = each.value.model_name
    version = each.value.model_version
  }

  sku {
    name     = each.value.sku_name
    capacity = each.value.capacity
  }

  depends_on = [azurerm_cognitive_account_project.foundry]
}

resource "azurerm_role_assignment" "deployer_blob_data" {
  scope                = azurerm_storage_account.shared.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_role_assignment" "deployer_queue_data" {
  scope                = azurerm_storage_account.shared.id
  role_definition_name = "Storage Queue Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_role_assignment" "customer_storage_reader" {
  for_each = var.customer_data_contributor_object_ids

  scope                = azurerm_storage_account.shared.id
  role_definition_name = "Reader"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "customer_data_contributor" {
  for_each = var.customer_data_contributor_object_ids

  scope                = azurerm_storage_container.data.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "team_storage_reader" {
  for_each = var.team_data_reader_object_ids

  scope                = azurerm_storage_account.shared.id
  role_definition_name = "Reader"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "team_data_reader" {
  for_each = var.team_data_reader_object_ids

  scope                = azurerm_storage_container.data.id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = each.value
}
