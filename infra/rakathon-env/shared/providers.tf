provider "azurerm" {
  subscription_id     = var.subscription_id
  tenant_id           = "7f0c84c5-bbea-48b2-bad1-6baf63d0c73c"
  storage_use_azuread = var.storage_use_azuread

  features {}
}

provider "azuread" {
  tenant_id = "7f0c84c5-bbea-48b2-bad1-6baf63d0c73c"
  use_cli   = true
}
