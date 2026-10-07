provider "azurerm" {
  subscription_id     = var.subscription_id
  storage_use_azuread = var.storage_use_azuread

  features {}
}
