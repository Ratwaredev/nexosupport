use super::types::AgentActionResult;

#[cfg(target_os = "windows")]
use std::{os::windows::process::CommandExt, process::Command, time::Duration};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub async fn read_disk_health() -> Result<AgentActionResult, String> {
    tauri::async_runtime::spawn_blocking(read_disk_health_blocking)
        .await
        .map_err(|error| format!("La revisión del disco se interrumpió: {error}"))?
}

fn read_disk_health_blocking() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"
$ErrorActionPreference='SilentlyContinue'
$disks=@()
try {
  $disks=@(Get-PhysicalDisk -ErrorAction Stop | ForEach-Object {
    $disk=$_
    $reliability=$null
    try{$reliability=$disk | Get-StorageReliabilityCounter -ErrorAction Stop}catch{}
    [PSCustomObject]@{
      friendlyName=$disk.FriendlyName
      mediaType=[string]$disk.MediaType
      busType=[string]$disk.BusType
      healthStatus=[string]$disk.HealthStatus
      operationalStatus=@($disk.OperationalStatus | ForEach-Object {[string]$_})
      sizeGb=[Math]::Round($disk.Size/1GB,1)
      temperature=if($reliability){$reliability.Temperature}else{$null}
      wear=if($reliability){$reliability.Wear}else{$null}
      readErrorsTotal=if($reliability){$reliability.ReadErrorsTotal}else{$null}
      writeErrorsTotal=if($reliability){$reliability.WriteErrorsTotal}else{$null}
      powerOnHours=if($reliability){$reliability.PowerOnHours}else{$null}
    }
  })
}catch{}
$predicted=$false
try {
  $predicted=[bool](@(Get-CimInstance -Namespace root/wmi -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction Stop | Where-Object PredictFailure).Count -gt 0)
}catch{}
[PSCustomObject]@{
  generatedAt=(Get-Date).ToUniversalTime().ToString('o')
  disks=$disks
  failurePredicted=$predicted
  source='Windows Storage Management'
} | ConvertTo-Json -Compress -Depth 6
"#;

        let mut command = Command::new("powershell.exe");
        command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ])
            .creation_flags(CREATE_NO_WINDOW);
        let output = super::diagnostics::run_command_with_timeout(
            command,
            Duration::from_secs(35),
            "la salud del disco",
        )?;
        if !output.status.success() {
            return Err("Windows no pudo leer la salud del disco.".to_string());
        }
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if raw.is_empty() {
            return Err("Windows no devolvió datos del disco.".to_string());
        }
        Ok(AgentActionResult {
            action: "disk_health".to_string(),
            ok: true,
            message: "Revisión del disco terminada.".to_string(),
            details: vec![raw],
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(AgentActionResult {
            action: "disk_health".to_string(),
            ok: false,
            message: "Disponible solamente en Windows.".to_string(),
            details: vec![],
        })
    }
}
