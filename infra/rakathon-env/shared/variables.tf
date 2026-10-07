variable "subscription_id" {
  description = "ID cílového Azure subscription."
  type        = string
  nullable    = false
}

variable "location" {
  description = "Azure region pro shared resources."
  type        = string
  default     = "swedencentral"
}

variable "resource_group_name" {
  description = "Název sdílené resource group."
  type        = string
  default     = "rg-rakathon-shared"
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
  description = "Replikace sdíleného Storage účtu."
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
  description = "Veřejné IPv4 CIDR rozsahy povolené Storage firewallem. Prázdný seznam povolí všechny sítě."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for cidr in var.allowed_ip_ranges : can(cidrhost(cidr, 0))])
    error_message = "Každá položka allowed_ip_ranges musí být platný CIDR rozsah."
  }
}

variable "customer_data_contributor_object_ids" {
  description = "Object ID uživatelů nebo skupin, které mohou nahrávat a měnit data v containeru data."
  type        = set(string)
  default     = []
}

variable "team_data_reader_object_ids" {
  description = "Object ID budoucích týmových skupin s read-only přístupem ke sdíleným datům."
  type        = set(string)
  default     = []
}

variable "foundry_project_name" {
  description = "Název veřejného Microsoft Foundry projektu."
  type        = string
  default     = "rakathon-project"

  validation {
    condition     = can(regex("^[a-zA-Z0-9][a-zA-Z0-9-]{1,62}[a-zA-Z0-9]$", var.foundry_project_name))
    error_message = "foundry_project_name musí mít 3 až 64 alfanumerických znaků nebo pomlček."
  }
}

variable "foundry_model_deployments" {
  description = "Model deploymenty spravované v Microsoft Foundry resource."
  type = map(object({
    model_name    = string
    model_version = string
    sku_name      = string
    capacity      = number
  }))

  default = {
    gpt-6-1-sol-dz-eu = {
      model_name    = "gpt-6.1-sol"
      model_version = "2026-09-29"
      sku_name      = "DataZoneStandard"
      capacity      = 3333
    }
    gpt-6-luna-dz-eu = {
      model_name    = "gpt-6-luna"
      model_version = "2026-09-22"
      sku_name      = "DataZoneStandard"
      capacity      = 3333
    }
  }

  validation {
    condition = alltrue([
      for deployment in values(var.foundry_model_deployments) :
      deployment.capacity > 0 && floor(deployment.capacity) == deployment.capacity
    ])
    error_message = "Kapacita každého model deploymentu musí být kladné celé číslo."
  }
}

variable "tags" {
  description = "Tagy aplikované na shared resources."
  type        = map(string)
  default = {
    environment = "hackathon"
    managed-by  = "terraform"
    scope       = "shared"
  }
}
