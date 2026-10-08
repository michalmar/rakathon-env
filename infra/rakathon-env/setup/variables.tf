variable "subscription_id" {
  description = "ID cílového Azure subscription."
  type        = string
  nullable    = false
}

variable "location" {
  description = "Azure region pro setup resources."
  type        = string
  default     = "swedencentral"
}

variable "resource_group_name" {
  description = "Název resource group pro Terraform state a setup resources."
  type        = string
  default     = "rg-rakathon-setup"
}

variable "project_name_compact" {
  description = "Krátký lowercase alfanumerický prefix pro globálně unikátní Storage name."
  type        = string
  default     = "rakathon"

  validation {
    condition     = can(regex("^[a-z0-9]{3,12}$", var.project_name_compact))
    error_message = "project_name_compact musí obsahovat 3 až 12 lowercase písmen nebo číslic."
  }
}

variable "account_replication_type" {
  description = "Replikace setup Storage účtu."
  type        = string
  default     = "LRS"

  validation {
    condition     = contains(["LRS", "ZRS", "GRS", "RAGRS", "GZRS", "RAGZRS"], var.account_replication_type)
    error_message = "Použijte podporovaný typ replikace Azure Storage."
  }
}

variable "storage_use_azuread" {
  description = "Zda má AzureRM provider používat Entra ID pro Storage data-plane operace."
  type        = bool
  default     = true
}

variable "shared_access_key_enabled" {
  description = "Zda jsou povolené Storage account access keys. Finální hodnota má být false."
  type        = bool
  default     = false
}

variable "allowed_ip_ranges" {
  description = "Veřejné IPv4 CIDR rozsahy povolené Storage firewallem. Prázdný seznam standardně blokuje všechny sítě."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for cidr in var.allowed_ip_ranges : can(cidrhost(cidr, 0))])
    error_message = "Každá položka allowed_ip_ranges musí být platný CIDR rozsah."
  }
}

variable "allow_all_networks" {
  description = "Explicitní opt-in pro zpřístupnění Storage ze všech veřejných sítí."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tagy aplikované na setup resources."
  type        = map(string)
  default = {
    environment = "hackathon"
    managed-by  = "terraform"
    scope       = "setup"
  }
}
