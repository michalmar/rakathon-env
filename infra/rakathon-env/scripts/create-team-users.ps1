[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateRange(1, [int]::MaxValue)]
    [int]$Count = 1
)

$ErrorActionPreference = 'Stop'
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$ContributorRoleId = 'b24988ac-6180-42a0-ab88-20f7382dd24c'
$StorageBlobDataReaderRoleId = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
$ApimApiVersion = '2024-05-01'
$ApimProduct = 'hackathon'
$TeamBudgetUsd = if ($env:TEAM_BUDGET_USD) { $env:TEAM_BUDGET_USD } else { '1000' }

if (-not $env:TAP_START_DATETIME) {
    throw 'Nastavte TAP_START_DATETIME ve formátu YYYY-MM-DDTHH:MM:SSZ.'
}

if (-not $env:TAP_END_DATETIME) {
    throw 'Nastavte TAP_END_DATETIME ve formátu YYYY-MM-DDTHH:MM:SSZ.'
}

$dateTimeFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
$dateTimeStyles = [Globalization.DateTimeStyles]::AssumeUniversal -bor
    [Globalization.DateTimeStyles]::AdjustToUniversal
$tapStartDateTime = [DateTimeOffset]::MinValue
$tapEndDateTime = [DateTimeOffset]::MinValue

if (-not [DateTimeOffset]::TryParseExact(
    $env:TAP_START_DATETIME,
    $dateTimeFormat,
    [Globalization.CultureInfo]::InvariantCulture,
    $dateTimeStyles,
    [ref]$tapStartDateTime
)) {
    throw 'TAP_START_DATETIME musí obsahovat platné UTC datum a čas ve formátu YYYY-MM-DDTHH:MM:SSZ.'
}

if (-not [DateTimeOffset]::TryParseExact(
    $env:TAP_END_DATETIME,
    $dateTimeFormat,
    [Globalization.CultureInfo]::InvariantCulture,
    $dateTimeStyles,
    [ref]$tapEndDateTime
)) {
    throw 'TAP_END_DATETIME musí obsahovat platné UTC datum a čas ve formátu YYYY-MM-DDTHH:MM:SSZ.'
}

$tapDuration = $tapEndDateTime - $tapStartDateTime
if ($tapDuration -le [TimeSpan]::Zero) {
    throw 'TAP_END_DATETIME musí být později než TAP_START_DATETIME.'
}

if ($tapDuration.Ticks % [TimeSpan]::TicksPerMinute -ne 0) {
    throw 'Rozdíl mezi TAP_START_DATETIME a TAP_END_DATETIME musí být celé minuty.'
}

$tapLifetimeMinutes = [int]$tapDuration.TotalMinutes
if ($tapLifetimeMinutes -lt 10 -or $tapLifetimeMinutes -gt 43200) {
    throw 'Platnost TAP musí být od 10 do 43200 minut.'
}

if ($env:TAP_IS_USABLE_ONCE) {
    if ($env:TAP_IS_USABLE_ONCE -notin @('true', 'false')) {
        throw 'TAP_IS_USABLE_ONCE musí mít hodnotu true nebo false.'
    }
    $tapIsUsableOnce = $env:TAP_IS_USABLE_ONCE -eq 'true'
}
else {
    $tapIsUsableOnce = $true
}

$outputDirectory = if ($env:TEAM_USER_OUTPUT_DIR) {
    $env:TEAM_USER_OUTPUT_DIR
}
else {
    Join-Path (Get-Location) 'team-user-access'
}

function Invoke-AzCli {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    $output = & az @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Příkaz az selhal: az $($Arguments -join ' ')"
    }

    return $output
}

function Add-RoleAssignment {
    param(
        [Parameter(Mandatory)]
        [string]$PrincipalId,

        [Parameter(Mandatory)]
        [string]$RoleId,

        [Parameter(Mandatory)]
        [string]$Scope,

        [Parameter(Mandatory)]
        [string]$Description
    )

    $existingAssignment = Invoke-AzCli -Arguments @(
        'role', 'assignment', 'list',
        '--assignee-object-id', $PrincipalId,
        '--role', $RoleId,
        '--scope', $Scope,
        '--query', '[0].id',
        '--output', 'tsv',
        '--only-show-errors'
    )

    if ($existingAssignment) {
        Write-Host "  Role již existuje: $Description"
        return
    }

    foreach ($attempt in 1..6) {
        & az role assignment create `
            --assignee-object-id $PrincipalId `
            --assignee-principal-type User `
            --role $RoleId `
            --scope $Scope `
            --output none `
            --only-show-errors

        if ($LASTEXITCODE -eq 0) {
            Write-Host "  Přidělena role: $Description"
            return
        }

        if ($attempt -lt 6) {
            Write-Host '  Role zatím není možné přidělit, čekám na propagaci identity...'
            Start-Sleep -Seconds 10
        }
    }

    throw "Nepodařilo se přidělit roli $Description."
}

function Ensure-ApimSubscription {
    param(
        [Parameter(Mandatory)]
        [string]$Team
    )

    $subscriptionUrl = "$script:apimBase/subscriptions/${Team}?api-version=$ApimApiVersion"
    $putBody = @{ properties = @{
        scope = "$script:apimBase/products/$ApimProduct"
        displayName = $Team
        state = 'active'
    } } | ConvertTo-Json -Compress -Depth 5
    Invoke-AzCli -Arguments @(
        'rest', '--method', 'put', '--url', $subscriptionUrl,
        '--body', $putBody, '--output', 'none', '--only-show-errors'
    ) | Out-Null

    $state = ''
    foreach ($attempt in 1..12) {
        $state = Invoke-AzCli -Arguments @(
            'rest', '--method', 'get', '--url', $subscriptionUrl,
            '--query', 'properties.state', '--output', 'tsv', '--only-show-errors'
        )
        if ($state -eq 'active') { break }
        Start-Sleep -Seconds 5
    }
    if ($state -ne 'active') {
        throw "APIM subscription $Team není aktivní (stav: $state)."
    }

    $key = Invoke-AzCli -Arguments @(
        'rest', '--method', 'post',
        '--url', "$script:apimBase/subscriptions/${Team}/listSecrets?api-version=$ApimApiVersion",
        '--query', 'primaryKey', '--output', 'tsv', '--only-show-errors'
    )
    if (-not $key -or $key -eq 'null') {
        throw "Nepodařilo se načíst klíč APIM subscription $Team."
    }
    Write-Host "  APIM subscription $Team je aktivní (produkt $ApimProduct)."
    return $key
}

function New-BootstrapPassword {
    $randomBytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(12)
    $randomPart = [Convert]::ToHexString($randomBytes)
    return "Rk!${randomPart}Aa9"
}

if (-not $env:AZURE_TENANT_ID) {
    throw 'Nastavte proměnnou prostředí AZURE_TENANT_ID.'
}

if (-not $env:SHARED_RESOURCE_GROUP) {
    throw 'Nastavte proměnnou prostředí SHARED_RESOURCE_GROUP.'
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Chybí požadovaný příkaz: az'
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

& az account show --output none 2>$null
if ($LASTEXITCODE -ne 0) {
    throw 'Nejprve se přihlaste příkazem: az login'
}

$tenantId = Invoke-AzCli -Arguments @(
    'account', 'show',
    '--query', 'tenantId',
    '--output', 'tsv'
)
if ($tenantId -ne $env:AZURE_TENANT_ID) {
    throw "Požadovaný tenant je $($env:AZURE_TENANT_ID), ale aktivní tenant je $tenantId."
}

$sharedResourceGroupId = Invoke-AzCli -Arguments @(
    'group', 'show',
    '--name', $env:SHARED_RESOURCE_GROUP,
    '--query', 'id',
    '--output', 'tsv',
    '--only-show-errors'
)
$sharedResourceGroupLocation = Invoke-AzCli -Arguments @(
    'group', 'show',
    '--name', $env:SHARED_RESOURCE_GROUP,
    '--query', 'location',
    '--output', 'tsv',
    '--only-show-errors'
)

$azureSubscriptionId = Invoke-AzCli -Arguments @('account', 'show', '--query', 'id', '--output', 'tsv')
$apimName = if ($env:APIM_NAME) { $env:APIM_NAME } else {
    Invoke-AzCli -Arguments @(
        'apim', 'list', '--resource-group', $env:SHARED_RESOURCE_GROUP,
        '--query', '[0].name', '--output', 'tsv', '--only-show-errors'
    )
}
if (-not $apimName -or $apimName -eq 'null') {
    throw "APIM instance nenalezena v $($env:SHARED_RESOURCE_GROUP). Nastavte APIM_NAME."
}
$apimBase = "https://management.azure.com/subscriptions/$azureSubscriptionId/resourceGroups/$($env:SHARED_RESOURCE_GROUP)/providers/Microsoft.ApiManagement/service/$apimName"
$apimGatewayUrl = Invoke-AzCli -Arguments @(
    'apim', 'show', '--name', $apimName, '--resource-group', $env:SHARED_RESOURCE_GROUP,
    '--query', 'gatewayUrl', '--output', 'tsv', '--only-show-errors'
)
$apimOpenAiUrl = if ($env:APIM_URL) { $env:APIM_URL } else { "$($apimGatewayUrl.TrimEnd('/'))/openai/v1" }

$modelList = ''
$foundryName = & az cognitiveservices account list --resource-group $env:SHARED_RESOURCE_GROUP `
    --query "[?kind=='AIServices'] | [0].name" --output tsv --only-show-errors 2>$null
if ($LASTEXITCODE -eq 0 -and $foundryName) {
    $deploymentNames = & az cognitiveservices account deployment list --name $foundryName `
        --resource-group $env:SHARED_RESOURCE_GROUP --query '[].name' --output tsv --only-show-errors 2>$null
    if ($LASTEXITCODE -eq 0 -and $deploymentNames) {
        $modelList = (@($deploymentNames) | ForEach-Object { '- `' + $_ + '`' }) -join "`n"
    }
}
if (-not $modelList) {
    $modelList = "- (seznam nasazených modelů zjistíte přes GET $apimOpenAiUrl/models)"
}

$tenantDomain = Invoke-AzCli -Arguments @(
    'rest',
    '--method', 'get',
    '--url', 'https://graph.microsoft.com/v1.0/domains?$select=id,isDefault',
    '--query', 'value[?isDefault].id | [0]',
    '--output', 'tsv',
    '--only-show-errors'
)
if (-not $tenantDomain -or $tenantDomain -eq 'null') {
    throw 'Nepodařilo se zjistit výchozí ověřenou doménu tenantu.'
}

try {
    $existingUserUpns = @(Invoke-AzCli -Arguments @(
        'ad', 'user', 'list',
        '--filter', "startswith(userPrincipalName, 'team')",
        '--query', '[].userPrincipalName',
        '--output', 'tsv',
        '--only-show-errors'
    ))
}
catch {
    throw 'Nelze načíst existující týmové uživatele. Přihlášená identita potřebuje oprávnění číst uživatele v Microsoft Entra ID.'
}

$maxTeamNumber = 0
foreach ($existingUpn in $existingUserUpns) {
    if ($existingUpn -match '^team([0-9]+)@(.+)$' -and $Matches[2] -eq $tenantDomain) {
        $teamNumber = [int]$Matches[1]
        if ($teamNumber -gt $maxTeamNumber) {
            $maxTeamNumber = $teamNumber
        }
    }
}

$createdCount = 0
$candidateNumber = $maxTeamNumber + 1

while ($createdCount -lt $Count) {
    $teamName = 'team{0:D2}' -f $candidateNumber
    $userPrincipalName = "$teamName@$tenantDomain"
    $resourceGroupName = "rg-$teamName"

    $existingUserId = & az ad user show `
        --id $userPrincipalName `
        --query id `
        --output tsv `
        --only-show-errors 2>$null

    if ($LASTEXITCODE -eq 0 -and $existingUserId) {
        Write-Host "Uživatel $userPrincipalName již existuje; beze změny, pokračuji dalším číslem."
        $candidateNumber++
        continue
    }

    # Azure CLI vyžaduje při vytvoření cloudového uživatele password profile.
    # Náhodné bootstrap heslo se nikde nevypisuje ani neukládá; předává se pouze TAP.
    $bootstrapPassword = New-BootstrapPassword

    Write-Host "Vytvářím $userPrincipalName..."
    $userObjectId = Invoke-AzCli -Arguments @(
        'ad', 'user', 'create',
        '--display-name', $teamName,
        '--user-principal-name', $userPrincipalName,
        '--password', $bootstrapPassword,
        '--force-change-password-next-sign-in', 'false',
        '--query', 'id',
        '--output', 'tsv',
        '--only-show-errors'
    )

    $resourceGroupExists = Invoke-AzCli -Arguments @(
        'group', 'exists',
        '--name', $resourceGroupName,
        '--output', 'tsv'
    )
    if ($resourceGroupExists -eq 'true') {
        Write-Host "  Resource group $resourceGroupName již existuje; beze změny."
    }
    else {
        Invoke-AzCli -Arguments @(
            'group', 'create',
            '--name', $resourceGroupName,
            '--location', $sharedResourceGroupLocation,
            '--output', 'none',
            '--only-show-errors'
        ) | Out-Null
        Write-Host "  Vytvořena resource group: $resourceGroupName"
    }

    $teamResourceGroupId = Invoke-AzCli -Arguments @(
        'group', 'show',
        '--name', $resourceGroupName,
        '--query', 'id',
        '--output', 'tsv',
        '--only-show-errors'
    )

    Add-RoleAssignment `
        -PrincipalId $userObjectId `
        -RoleId $ContributorRoleId `
        -Scope $teamResourceGroupId `
        -Description "Contributor na $resourceGroupName"
    Add-RoleAssignment `
        -PrincipalId $userObjectId `
        -RoleId $StorageBlobDataReaderRoleId `
        -Scope $sharedResourceGroupId `
        -Description "Storage Blob Data Reader na $($env:SHARED_RESOURCE_GROUP)"
    # Týmy nemají Foundry portál ani Agent Service; modely volají jen přes APIM klíč.

    $teamApimKey = Ensure-ApimSubscription -Team $teamName

    $tapRequestBody = @{
        startDateTime = $tapStartDateTime.ToString($dateTimeFormat)
        lifetimeInMinutes = $tapLifetimeMinutes
        isUsableOnce = $tapIsUsableOnce
    } | ConvertTo-Json -Compress
    $temporaryAccessPass = Invoke-AzCli -Arguments @(
        'rest',
        '--method', 'post',
        '--url', "https://graph.microsoft.com/v1.0/users/$userObjectId/authentication/temporaryAccessPassMethods",
        '--headers', 'Content-Type=application/json',
        '--body', $tapRequestBody,
        '--query', 'temporaryAccessPass',
        '--output', 'tsv',
        '--only-show-errors'
    )
    if (-not $temporaryAccessPass -or $temporaryAccessPass -eq 'null') {
        throw "Microsoft Graph nevytvořil Temporary Access Pass pro $userPrincipalName."
    }

    $tapUsage = if ($tapIsUsableOnce) { 'Ano' } else { 'Ne' }
    $outputFile = Join-Path $outputDirectory "$teamName.md"
    $markdown = @"
# Přístup uživatele $teamName

- **Jméno:** $teamName
- **UPN:** $userPrincipalName
- **Temporary Access Pass (TAP):** $temporaryAccessPass
- **Začátek platnosti TAP:** $($tapStartDateTime.ToString($dateTimeFormat))
- **Konec platnosti TAP:** $($tapEndDateTime.ToString($dateTimeFormat))
- **Jednorázový TAP:** $tapUsage

## Přístup k AI modelům (APIM gateway)

- **Base URL:** $apimOpenAiUrl
- **API klíč týmu:** $teamApimKey
- Stejný klíč uvidíte po přihlášení tímto účtem i v portálu (sekce „Váš API klíč“).
- **Hlavička:** ``api-key: <klíč>`` (``Authorization: Bearer`` gateway nepřijímá)
- **Rozpočet:** $TeamBudgetUsd USD na tým. Při 90 % dostanete upozornění, při 100 % se přístup zablokuje (HTTP 401).
- Klíč začne platit přibližně do 1 minuty po vytvoření. V ``model`` uvádějte název deploymentu.

Dostupné deploymenty:

$modelList

Obrazové deploymenty (např. MAI) volejte na ``/images/generations`` (tělo: model, prompt, width, height).

Python:

``````python
from openai import OpenAI

client = OpenAI(
    base_url="$apimOpenAiUrl",
    api_key="unused",
    default_headers={"api-key": "<klíč týmu>"},
)
r = client.chat.completions.create(
    model="<název deploymentu>",
    messages=[{"role": "user", "content": "Ahoj!"}],
)
print(r.choices[0].message.content)
``````

curl:

``````bash
curl -s "$apimOpenAiUrl/chat/completions" \
  -H "api-key: <klíč týmu>" -H "Content-Type: application/json" \
  -d '{"model":"<název deploymentu>","messages":[{"role":"user","content":"Ahoj!"}]}'
``````

Při streamování (``stream: true``) gateway sama zapne ``stream_options.include_usage``, takže spotřeba se započítá vždy.

Tento soubor obsahuje citlivé přihlašovací údaje. Sdílejte jej pouze s určeným uživatelem a po předání jej bezpečně odstraňte.
"@
    [System.IO.File]::WriteAllText(
        $outputFile,
        $markdown,
        [System.Text.UTF8Encoding]::new($false)
    )
    if (-not $IsWindows) {
        [System.IO.File]::SetUnixFileMode(
            $outputFile,
            [System.IO.UnixFileMode]::UserRead -bor [System.IO.UnixFileMode]::UserWrite
        )
    }

    Write-Host
    Write-Host "Vytvořen uživatel: $userPrincipalName"
    Write-Host "Vlastní RG:         $resourceGroupName"
    Write-Host "TAP soubor:         $outputFile"
    Write-Host

    $createdCount++
    $candidateNumber++
}

Write-Host "Hotovo: vytvořeno $createdCount nových uživatelů."
