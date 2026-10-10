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

variable "portal_location" {
  description = "Azure region pro Static Web Apps; evropský West Europe aktuálně nepřijímá nové zákazníky."
  type        = string
  default     = "eastus2"
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

variable "foundry_public_network_access_enabled" {
  description = "Zda je Microsoft Foundry dostupné přes veřejnou síť."
  type        = bool
  default     = false
}

variable "foundry_outbound_network_access_restricted" {
  description = "Zda Microsoft Foundry omezuje odchozí síťový provoz."
  type        = bool
  default     = true
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
    model_format  = string
    model_name    = string
    model_version = string
    sku_name      = string
    capacity      = number
  }))

  default = {
    gpt-6-1-sol-dz-eu = {
      model_format  = "OpenAI"
      model_name    = "gpt-6.1-sol"
      model_version = "2026-09-29"
      sku_name      = "DataZoneStandard"
      capacity      = 3333
    }
    gpt-6-luna-dz-eu = {
      model_format  = "OpenAI"
      model_name    = "gpt-6-luna"
      model_version = "2026-09-22"
      sku_name      = "DataZoneStandard"
      capacity      = 3333
    }
    grok-4-7-global = {
      model_format  = "xAI"
      model_name    = "grok-4.7"
      model_version = "1"
      sku_name      = "GlobalStandard"
      capacity      = 10000
    }
    gpt-6-astra-global = {
      model_format  = "OpenAI"
      model_name    = "gpt-6-astra"
      model_version = "2026-09-03"
      sku_name      = "GlobalStandard"
      capacity      = 10000
    }
    mai-image-2-5-global = {
      model_format  = "Microsoft"
      model_name    = "MAI-Image-2.5"
      model_version = "2026-06-02"
      sku_name      = "GlobalStandard"
      capacity      = 10
    }
    deepseek-v4-pro-global = {
      model_format  = "DeepSeek"
      model_name    = "DeepSeek-V4-Pro"
      model_version = "2026-04-23"
      sku_name      = "GlobalStandard"
      capacity      = 10000
    }
    mai-thinking-1-global = {
      model_format  = "Microsoft"
      model_name    = "MAI-Thinking-1"
      model_version = "2026-06-01"
      sku_name      = "GlobalStandard"
      capacity      = 1500
    }
    kimi-k2-7-code-global = {
      model_format  = "MoonshotAI"
      model_name    = "Kimi-K2.7-Code"
      model_version = "2026-06-12"
      sku_name      = "GlobalStandard"
      capacity      = 2000
    }
  }

  validation {
    condition = alltrue([
      for deployment in values(var.foundry_model_deployments) :
      deployment.capacity > 0 &&
      floor(deployment.capacity) == deployment.capacity &&
      contains(["OpenAI", "xAI", "DeepSeek", "Microsoft", "MoonshotAI"], deployment.model_format) &&
      contains(["DataZoneStandard", "GlobalStandard"], deployment.sku_name)
    ])
    error_message = "Deployment musí mít podporovaný model format/SKU a kladnou celočíselnou kapacitu."
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

variable "ai_gateway_name" {
  description = "Název APIM AI Gateway. Prázdné = aigw-<project>-<suffix>."
  type        = string
  default     = ""
}

variable "ai_gateway_api_version" {
  description = "API verze Microsoft.ApiManagement (AI Gateway tier je preview)."
  type        = string
  default     = "2025-09-01-preview"
}

variable "ai_gateway_publisher_email" {
  description = "Publisher e-mail pro APIM."
  type        = string
  default     = "noreply@microsoft.com"
}

variable "ai_gateway_tokens_per_minute" {
  description = "Limit tokenů za minutu na klíč (tým) a model."
  type        = number
  default     = 200000
}

variable "ai_gateway_tokens_per_day" {
  description = "Limit tokenů za den na klíč (tým) a model."
  type        = number
  default     = 20000000
}
