output "resource_group_name" {
  description = "Název sdílené resource group."
  value       = azurerm_resource_group.shared.name
}

output "storage_account_name" {
  description = "Název sdíleného Storage účtu."
  value       = azurerm_storage_account.shared.name
}

output "data_container_name" {
  description = "Název containeru pro hackathon data."
  value       = azurerm_storage_container.data.name
}

output "data_container_id" {
  description = "ARM ID containeru data pro další role assignments."
  value       = azurerm_storage_container.data.id
}

output "foundry_resource_name" {
  description = "Název Microsoft Foundry resource."
  value       = azurerm_cognitive_account.foundry.name
}

output "foundry_endpoint" {
  description = "Veřejný endpoint Microsoft Foundry resource."
  value       = azurerm_cognitive_account.foundry.endpoint
}

output "foundry_project_id" {
  description = "ARM ID Microsoft Foundry projektu."
  value       = azurerm_cognitive_account_project.foundry.id
}

output "foundry_model_deployments" {
  description = "Nasazené modely a jejich Data Zone kapacity."
  value = {
    for name, deployment in var.foundry_model_deployments :
    name => {
      model    = deployment.model_name
      version  = deployment.model_version
      sku      = deployment.sku_name
      capacity = deployment.capacity
    }
  }
}
