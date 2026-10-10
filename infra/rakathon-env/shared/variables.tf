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

variable "apim_name" {
  description = "Název APIM. Prázdné = apim-<project>-<suffix>."
  type        = string
  default     = ""
}

variable "apim_publisher_email" {
  description = "Publisher e-mail pro APIM."
  type        = string
  default     = "noreply@microsoft.com"
}

variable "apim_tokens_per_minute" {
  description = "Limit tokenů za minutu na subscription (tým)."
  type        = number
  default     = 200000
}

variable "apim_token_quota" {
  description = "Token kvóta na subscription (tým) za periodu apim_token_quota_period (všechny modely dohromady). 4M/den = nejhůře ~200 USD/den při výhradně výstupních tokenech nejdražšího modelu (astra 50 USD/1M)."
  type        = number
  default     = 4000000
}

variable "apim_token_quota_period" {
  description = "Perioda kvóty: Hourly, Daily, Weekly, Monthly, Yearly."
  type        = string
  default     = "Daily"
}

variable "apim_image_calls_per_minute" {
  description = "Limit požadavků na generování obrázků za minutu na subscription (tým)."
  type        = number
  default     = 30
}

variable "apim_enforce_budget" {
  description = "Zapnutí automatického suspendování subscription při překročení rozpočtu (false = jen měření a alerty)."
  type        = bool
  default     = true
}

variable "model_prices" {
  description = <<-EOT
    Ceník v USD podle názvu deploymentu: input_per_1m / output_per_1m = cena za 1M tokenů, per_image = cena za jeden obrázek.
    Zdroj: Azure Retail Prices API (serviceName 'Foundry Models', swedencentral, Standard, krátký kontext, bez cache slevy) k 2026-10-10.
    Deployment mimo mapu se účtuje nejvyšší cenou z mapy (konzervativně).
  EOT
  type = map(object({
    input_per_1m  = number
    output_per_1m = number
    per_image     = number
  }))

  default = {
    # Azure OpenAI GPT6, '6.1-sol ShortCo Inp/Opt Std DZ'
    gpt-6-1-sol-dz-eu = { input_per_1m = 2.4, output_per_1m = 12.0, per_image = 0 }
    # Azure OpenAI GPT6, '6-luna ShortCo Inp/Opt Std DZ'
    gpt-6-luna-dz-eu = { input_per_1m = 0.12, output_per_1m = 0.6, per_image = 0 }
    # Azure Grok Models, '4.7 Inp/Outp glbl'
    grok-4-7-global = { input_per_1m = 2.0, output_per_1m = 6.0, per_image = 0 }
    # Azure OpenAI GPT6, '6-astra ShortCo Inp/Opt Std Gl'
    gpt-6-astra-global = { input_per_1m = 10.0, output_per_1m = 50.0, per_image = 0 }
    # Azure Deepseek Models, 'V4 Pro Inp/Outp glbl' (0.00174 / 0.00348 USD za 1K)
    deepseek-v4-pro-global = { input_per_1m = 1.74, output_per_1m = 3.48, per_image = 0 }
    # Azure Kimi, 'K2.7 Code Inp/Outp glbl' (0.00095 / 0.004 USD za 1K)
    kimi-k2-7-code-global = { input_per_1m = 0.95, output_per_1m = 4.0, per_image = 0 }
    # MAI Models, 'MAI-Thinking-1 Inp/Opt glbl'
    mai-thinking-1-global = { input_per_1m = 2.0, output_per_1m = 8.0, per_image = 0 }
    # ODHAD: MAI Image 2.5 se účtuje tokeny (image output 0.047 USD/1K tokenů); cena za obrázek předpokládá ~4 000 výstupních tokenů (horní odhad pro 1024x1024) => ~0.19 USD, zaokrouhleno na 0.20
    mai-image-2-5-global = { input_per_1m = 0, output_per_1m = 0, per_image = 0.20 }
  }
}

variable "overall_budget_usd" {
  description = "Celkový rozpočet celé akce (všechny týmy) v USD."
  type        = number
  default     = 5000
}

variable "team_budget_usd" {
  description = "Výchozí rozpočet jednoho týmu v USD. Součet týmových rozpočtů smí být vyšší než overall_budget_usd."
  type        = number
  default     = 1000
}

variable "team_budget_overrides" {
  description = "Výjimky z týmového rozpočtu: název subscription (teamNN) => rozpočet v USD."
  type        = map(number)
  default     = {}
}

variable "budget_warn_ratio" {
  description = "Podíl rozpočtu, od kterého se posílá varování (0.9 = 90 %)."
  type        = number
  default     = 0.9
}

variable "overall_revoke_safety_margin_usd" {
  description = "Rezerva: všechny týmy se suspendují už při dosažení overall_budget_usd mínus tato částka (logy mají ~2,5 min zpoždění + job běží po 5 min)."
  type        = number
  default     = 200
}

variable "budget_window_start" {
  description = "Začátek rozpočtového okna (UTC ISO 8601); spotřeba se počítá od tohoto okamžiku."
  type        = string
  default     = "2026-10-10T00:00:00Z"
}

variable "budget_alert_emails" {
  description = "E-maily příjemců alertů o rozpočtu."
  type        = list(string)
  default = [
    "azure.otp@vzp.cz",
    "michal.marusan@microsoft.com",
    "Vladimir.Vasicek@microsoft.com",
  ]
}
