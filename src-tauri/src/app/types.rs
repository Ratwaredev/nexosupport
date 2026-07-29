use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub generated_at: String,
    pub computer_name: String,
    pub user_name: String,
    pub os: String,
    pub cpu: String,
    pub ram_total_gb: f64,
    pub ram_free_gb: f64,
    pub system_drive_total_gb: f64,
    pub system_drive_free_gb: f64,
    pub startup_items: i64,
    pub defender_status: String,
    pub pending_reboot: bool,
    pub max_temperature_c: Option<f64>,
    pub temperature_note: String,
    pub thermal_zones: Vec<ThermalZoneReading>,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalZoneReading {
    pub name: String,
    pub temperature_c: Option<f64>,
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSession {
    pub code: String,
    pub expires_in_minutes: u8,
    pub instructions: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteToolStatus {
    pub installed: bool,
    pub name: String,
    pub path: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub mode: String,
    pub monitoring: bool,
    pub version: String,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActionResult {
    pub action: String,
    pub ok: bool,
    pub message: String,
    pub details: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSensor {
    pub hardware_type: String,
    pub hardware_name: String,
    pub sensor_type: String,
    pub sensor_name: String,
    pub value: f64,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSnapshot {
    pub generated_at: String,
    pub source: String,
    pub elevated: bool,
    pub permission_required: bool,
    pub note: String,
    pub sensors: Vec<HardwareSensor>,
}
