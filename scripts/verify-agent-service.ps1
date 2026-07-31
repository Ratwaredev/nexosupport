param(
  [int]$Attempts = 60,
  [int]$DelaySeconds = 5
)

$ErrorActionPreference = 'Stop'
$explicit = [string]$env:VITE_NEXO_API_URL
$supabase = [string]$env:VITE_SUPABASE_URL
if (-not [string]::IsNullOrWhiteSpace($explicit)) {
  $base = $explicit.TrimEnd('/')
  $url = if ($base -match '/(api/assistant|functions/v1/nexo-assistant)$') { $base } else { "$base/api/assistant" }
} elseif (-not [string]::IsNullOrWhiteSpace($supabase)) {
  $url = "$($supabase.TrimEnd('/'))/functions/v1/nexo-assistant"
} else {
  throw 'Release has no NEXO agent endpoint.'
}

$lastError = $null
for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
  try {
    $response = Invoke-RestMethod -Uri $url -Method Get -Headers @{ 'User-Agent' = 'NEXO-Release-Check' } -TimeoutSec 20
    if ($response.ok -eq $true -and $response.service -eq 'nexo-assistant') {
      Write-Host "NEXO agent verified at $url"
      exit 0
    }
    $lastError = "Agent health response was not ready: $($response | ConvertTo-Json -Compress)"
  } catch {
    $lastError = $_.Exception.Message
  }
  if ($attempt -lt $Attempts) { Start-Sleep -Seconds $DelaySeconds }
}

throw "NEXO agent is not ready after $Attempts attempts. $lastError"
