# Zapnutí/vypnutí přístupu týmů k AI gateway (suspend/activate APIM subscription).
# Použití: ./set-team-access.ps1 -Team teamNN|all -State on|off
#          ./set-team-access.ps1 -Status
[CmdletBinding()]
param(
    [string]$Team,
    [ValidateSet('on', 'off')]
    [string]$State,
    [switch]$Status
)

$ErrorActionPreference = 'Stop'
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$ApimApiVersion = '2024-05-01'
$ApimProduct = 'hackathon'

if (-not $env:SHARED_RESOURCE_GROUP) {
    throw 'Nastavte proměnnou prostředí SHARED_RESOURCE_GROUP.'
}

function Invoke-AzCli {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & az @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Příkaz az selhal: az $($Arguments -join ' ')"
    }
    return $output
}

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

# Týmové subscriptions produktu hackathon; ops-* (provozní) se vynechávají.
$subscriptions = @(Invoke-AzCli -Arguments @(
    'rest', '--method', 'get',
    '--url', "$apimBase/products/$ApimProduct/subscriptions?api-version=$ApimApiVersion",
    '--query', "value[?!starts_with(name, 'ops-')].{name:name,state:properties.state}",
    '--output', 'json', '--only-show-errors'
) | ConvertFrom-Json)

if ($Status) {
    $subscriptions | Format-Table @{ Label = 'SUBSCRIPTION'; Expression = { $_.name } }, @{ Label = 'STAV'; Expression = { $_.state } }
    return
}

if (-not $State -or -not $Team) {
    throw 'Použití: set-team-access.ps1 -Team teamNN|all -State on|off | -Status'
}
$newState = if ($State -eq 'on') { 'active' } else { 'suspended' }

if ($Team -eq 'all') {
    $teams = @($subscriptions | ForEach-Object { $_.name })
}
elseif ($Team -match '^team[0-9]+$') {
    $teams = @($Team)
}
else {
    throw 'Použití: set-team-access.ps1 -Team teamNN|all -State on|off | -Status'
}

if ($teams.Count -eq 0) {
    Write-Host 'Žádné týmové subscriptions nenalezeny.'
    return
}

foreach ($name in $teams) {
    $body = @{ properties = @{ state = $newState } } | ConvertTo-Json -Compress -Depth 5
    Invoke-AzCli -Arguments @(
        'rest', '--method', 'patch',
        '--url', "$apimBase/subscriptions/${name}?api-version=$ApimApiVersion",
        '--body', $body, '--output', 'none', '--only-show-errors'
    ) | Out-Null
    Write-Host "${name}: $newState"
}
