output "resource_group_name" {
  description = "Resource group obsahující Terraform backend."
  value       = azurerm_resource_group.setup.name
}

output "storage_account_name" {
  description = "Storage account používaný pro Terraform state."
  value       = azurerm_storage_account.tfstate.name
}

output "state_container_name" {
  description = "Blob container používaný pro Terraform state."
  value       = azurerm_storage_container.tfstate.name
}
