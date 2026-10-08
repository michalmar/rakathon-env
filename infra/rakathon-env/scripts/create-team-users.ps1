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
# Původní role "Azure AI User" se nyní jmenuje "Foundry User".
$FoundryUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

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

function New-InitialPassword {
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

    $initialPassword = New-InitialPassword

    Write-Host "Vytvářím $userPrincipalName..."
    $userObjectId = Invoke-AzCli -Arguments @(
        'ad', 'user', 'create',
        '--display-name', $teamName,
        '--user-principal-name', $userPrincipalName,
        '--password', $initialPassword,
        '--force-change-password-next-sign-in', 'true',
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
    Add-RoleAssignment `
        -PrincipalId $userObjectId `
        -RoleId $FoundryUserRoleId `
        -Scope $sharedResourceGroupId `
        -Description "Foundry User (dříve Azure AI User) na $($env:SHARED_RESOURCE_GROUP)"

    Write-Host
    Write-Host "Vytvořen uživatel: $userPrincipalName"
    Write-Host "Dočasné heslo:     $initialPassword"
    Write-Host "Vlastní RG:         $resourceGroupName"
    Write-Host 'Při prvním přihlášení musí uživatel heslo změnit.'
    Write-Host

    $createdCount++
    $candidateNumber++
}

Write-Host "Hotovo: vytvořeno $createdCount nových uživatelů."
