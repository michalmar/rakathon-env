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
  description = "Nasazené modely, formáty, deployment typy a kapacity."
  value = {
    for name, deployment in var.foundry_model_deployments :
    name => {
      format   = deployment.model_format
      model    = deployment.model_name
      version  = deployment.model_version
      sku      = deployment.sku_name
      capacity = deployment.capacity
    }
  }
}

output "portal_name" {
  description = "Název Azure Static Web App pro publikování statického katalogu."
  value       = azurerm_static_web_app.portal.name
}

output "portal_url" {
  description = "HTTPS adresa účastnického portálu chráněného tenant-specific Easy Auth."
  value       = "https://${azurerm_static_web_app.portal.default_host_name}"
}

output "portal_auth_client_id" {
  description = "Client ID single-tenant Entra registrace; nejde o secret."
  value       = azuread_application_registration.portal.client_id
}

output "portal_auth_secret_expires_at" {
  description = "Expirace přihlašovacího secretu; před tímto datem proveďte rotaci Terraformem."
  value       = azuread_application_password.portal.end_date
}

output "ai_gateway_name" {
  description = "Název APIM AI Gateway."
  value       = azapi_resource.gateway.name
}

output "ai_gateway_id" {
  description = "ARM ID APIM AI Gateway."
  value       = azapi_resource.gateway.id
}

output "ai_gateway_url" {
  description = "Klientský base URL (OpenAI-kompatibilní) přes AI Gateway."
  value       = "${azapi_resource.gateway.output.properties.gatewayUrl}/default/models/openai/v1"
}

output "ai_gateway_appinsights_id" {
  description = "ARM ID Application Insights s telemetrií gateway."
  value       = azapi_resource.gateway_appinsights.id
}

output "ai_gateway_law_id" {
  description = "ARM ID Log Analytics workspace."
  value       = azurerm_log_analytics_workspace.gateway.id
}
