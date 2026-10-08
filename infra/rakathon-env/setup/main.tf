data "azurerm_client_config" "current" {}

resource "random_string" "storage_suffix" {
  length  = 6
  special = false
  upper   = false
}

locals {
  storage_account_name = "st${var.project_name_compact}tf${random_string.storage_suffix.result}"
}

resource "azurerm_resource_group" "setup" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

resource "azurerm_storage_account" "tfstate" {
  name                            = local.storage_account_name
  resource_group_name             = azurerm_resource_group.setup.name
  location                        = azurerm_resource_group.setup.location
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

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"
}

resource "azurerm_role_assignment" "deployer_blob_data" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_role_assignment" "deployer_queue_data" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Queue Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}
