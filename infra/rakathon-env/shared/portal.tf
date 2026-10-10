resource "azuread_application_registration" "portal" {
  display_name                       = "rakathon-portal"
  sign_in_audience                   = "AzureADMyOrg"
  requested_access_token_version     = 2
  implicit_id_token_issuance_enabled = true
}

resource "azuread_service_principal" "portal" {
  client_id                    = azuread_application_registration.portal.client_id
  app_role_assignment_required = false
}

resource "azuread_application_password" "portal" {
  application_id = azuread_application_registration.portal.id
  display_name   = "Static Web Apps Easy Auth"
  end_date       = timeadd(plantimestamp(), "2160h")

  lifecycle {
    ignore_changes = [end_date]
  }
}

resource "azurerm_static_web_app" "portal" {
  name                         = "swa-${var.project_name_compact}-${random_string.storage_suffix.result}"
  resource_group_name          = azurerm_resource_group.shared.name
  location                     = var.portal_location
  sku_tier                     = "Standard"
  sku_size                     = "Standard"
  preview_environments_enabled = false

  app_settings = {
    RAKATHON_AUTH_CLIENT_ID     = azuread_application_registration.portal.client_id
    RAKATHON_AUTH_CLIENT_SECRET = azuread_application_password.portal.value
  }

  tags = merge(var.tags, {
    service = "rakathon-portal"
  })
}

resource "azuread_application_redirect_uris" "portal" {
  application_id = azuread_application_registration.portal.id
  type           = "Web"
  redirect_uris  = ["https://${azurerm_static_web_app.portal.default_host_name}/.auth/login/aad/callback"]
}
