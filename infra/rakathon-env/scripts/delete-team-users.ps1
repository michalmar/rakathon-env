[CmdletBinding()]
param(
    [switch]$All,
    [switch]$DeleteResourceGroups,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$ContributorRoleId = 'b24988ac-6180-42a0-ab88-20f7382dd24c'
$StorageBlobDataReaderRoleId = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
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

function Remove-TeamRoleAssignment {
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

    $assignmentIds = @(Invoke-AzCli -Arguments @(
        'role', 'assignment', 'list',
        '--assignee-object-id', $PrincipalId,
        '--role', $RoleId,
        '--scope', $Scope,
        '--query', '[].id',
        '--output', 'tsv',
        '--only-show-errors'
    ))

    foreach ($assignmentId in $assignmentIds) {
        if (-not $assignmentId) {
            continue
        }

        Invoke-AzCli -Arguments @(
            'role', 'assignment', 'delete',
            '--ids', $assignmentId,
            '--output', 'none',
            '--only-show-errors'
        ) | Out-Null
    }

    if ($assignmentIds.Count -gt 0 -and $assignmentIds[0]) {
        Write-Host "  Odstraněna role: $Description"
    }
}

if (-not $All) {
    throw 'Bulk mazání vyžaduje explicitní přepínač -All.'
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

$sharedResourceGroupId = Invoke-AzCli -Arguments @(
    'group', 'show',
    '--name', $env:SHARED_RESOURCE_GROUP,
    '--query', 'id',
    '--output', 'tsv',
    '--only-show-errors'
)

try {
    $usersJson = Invoke-AzCli -Arguments @(
        'ad', 'user', 'list',
        '--filter', "startswith(userPrincipalName, 'team')",
        '--query', '[].{id:id,upn:userPrincipalName}',
        '--output', 'json',
        '--only-show-errors'
    )
}
catch {
    throw 'Nelze načíst týmové uživatele. Přihlášená identita potřebuje oprávnění číst uživatele v Microsoft Entra ID.'
}

$domainPattern = [regex]::Escape($tenantDomain)
$teamUsers = @(($usersJson -join [Environment]::NewLine) |
    ConvertFrom-Json |
    Where-Object { $_.upn -match "^team[0-9]+@$domainPattern$" })

if ($teamUsers.Count -eq 0) {
    Write-Host "Nebyli nalezeni žádní uživatelé teamXX@$tenantDomain."
    exit 0
}

Write-Host 'Budou odstraněni následující uživatelé:'
foreach ($user in $teamUsers) {
    Write-Host "  - $($user.upn)"
}
Write-Host
if ($DeleteResourceGroups) {
    Write-Host 'Budou odstraněny také odpovídající resource groups rg-teamXX.'
}
else {
    Write-Host 'Resource groups odstraněny nebudou.'
}
Write-Host 'TAP Markdown soubory odstraněny nebudou.'

if (-not $Force) {
    $confirmation = Read-Host 'Pro potvrzení napište DELETE'
    if ($confirmation -cne 'DELETE') {
        throw 'Mazání zrušeno.'
    }
}

foreach ($user in $teamUsers) {
    $teamName = $user.upn.Split('@')[0]
    $resourceGroupName = "rg-$teamName"

    Write-Host "Odstraňuji $($user.upn)..."

    $resourceGroupExists = Invoke-AzCli -Arguments @(
        'group', 'exists',
        '--name', $resourceGroupName,
        '--output', 'tsv'
    )
    if ($resourceGroupExists -eq 'true') {
        $teamResourceGroupId = Invoke-AzCli -Arguments @(
            'group', 'show',
            '--name', $resourceGroupName,
            '--query', 'id',
            '--output', 'tsv',
            '--only-show-errors'
        )
        Remove-TeamRoleAssignment `
            -PrincipalId $user.id `
            -RoleId $ContributorRoleId `
            -Scope $teamResourceGroupId `
            -Description "Contributor na $resourceGroupName"
    }

    Remove-TeamRoleAssignment `
        -PrincipalId $user.id `
        -RoleId $StorageBlobDataReaderRoleId `
        -Scope $sharedResourceGroupId `
        -Description "Storage Blob Data Reader na $($env:SHARED_RESOURCE_GROUP)"
    Remove-TeamRoleAssignment `
        -PrincipalId $user.id `
        -RoleId $FoundryUserRoleId `
        -Scope $sharedResourceGroupId `
        -Description "Foundry User na $($env:SHARED_RESOURCE_GROUP)"

    Invoke-AzCli -Arguments @(
        'ad', 'user', 'delete',
        '--id', $user.id,
        '--only-show-errors'
    ) | Out-Null
    Write-Host '  Uživatel odstraněn.'

    if ($DeleteResourceGroups -and $resourceGroupExists -eq 'true') {
        Invoke-AzCli -Arguments @(
            'group', 'delete',
            '--name', $resourceGroupName,
            '--yes',
            '--output', 'none',
            '--only-show-errors'
        ) | Out-Null
        Write-Host "  Resource group $resourceGroupName odstraněna."
    }
}

Write-Host "Hotovo: odstraněno $($teamUsers.Count) uživatelů."
