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

output "apim_name" {
  description = "Název APIM (BasicV2) před sdílenými Foundry modely."
  value       = azurerm_api_management.gateway.name
}

output "apim_id" {
  description = "ARM ID APIM."
  value       = azurerm_api_management.gateway.id
}

output "apim_url" {
  description = "Klientský base URL (OpenAI v1); `model` v těle = název deploymentu."
  value       = "${azurerm_api_management.gateway.gateway_url}/openai/v1"
}

output "apim_product_id" {
  description = "ID produktu hackathon (pro zakládání subscription týmů)."
  value       = azurerm_api_management_product.hackathon.product_id
}

output "apim_law_id" {
  description = "ARM ID Log Analytics workspace s logy APIM."
  value       = azurerm_log_analytics_workspace.gateway.id
}

output "cost_job_name" {
  description = "Logic App, která každých 5 min vyhodnocuje rozpočty a suspenduje týmy."
  value       = azapi_resource.cost_job.name
}

output "apim_law_customer_id" {
  description = "Workspace (customer) ID LAW pro `az monitor log-analytics query -w`."
  value       = azurerm_log_analytics_workspace.gateway.workspace_id
}

output "cost_workbook_url" {
  description = "Odkaz na Azure Monitor Workbook s náklady (vyžaduje přístup do Azure Portal tenantu)."
  value       = "https://portal.azure.com/#@7f0c84c5-bbea-48b2-bad1-6baf63d0c73c/resource${azurerm_application_insights_workbook.costs.id}/workbook"
}

output "my_key_function_name" {
  description = "Function app (my-key), která vrací API klíč přihlášeného týmu; kód nasazuje scripts/deploy-my-key.sh."
  value       = azurerm_linux_function_app.my_key.name
}
