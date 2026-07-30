import type { AgentActionResult } from './agent';
import type { DiagnosticReport } from './diagnostics';
import type { HardwareSnapshot, SensorSummary } from './sensors';
import { summarizeHardware } from './sensors';

export type EvidenceTone = 'success' | 'warning' | 'error' | 'info';
export type ToolId = 'overview' | 'temperature' | 'network' | 'security' | 'startup' | 'optimizer' | 'remote';
export type EvidenceRow = { label: string; value: string; tone?: EvidenceTone };
export type ToolRecord = {
  id: ToolId;
  checkedAt: string;
  ok: boolean;
  title: string;
  summary: string;
  rows: EvidenceRow[];
  raw?: unknown;
};
export type CleanupCategory = { name?: string; path?: string; files?: number; bytes?: number; deleted?: number; freedBytes?: number; failed?: number };
export type CleanupPayload = {
  generatedAt?: string;
  totalFiles?: number;
  totalBytes?: number;
  totalMb?: number;
  deletedFiles?: number;
  freedBytes?: number;
  freedMb?: number;
  failedFiles?: number;
  categories?: CleanupCategory[];
  exclusions?: string[];
};

export const FRESH_MS = 5 * 60 * 1000;

export function parseDetail<T>(result: AgentActionResult): T | null {
  const candidate = result.details.find((detail) => detail.trim().startsWith('{') || detail.trim().startsWith('['));
  if (!candidate) return null;
  try { return JSON.parse(candidate) as T; }
  catch { return null; }
}

export function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function ageLabel(iso?: string | null) {
  if (!iso) return 'Sin analizar';
  const elapsed = Math.max(0, Date.now() - Date.parse(iso));
  if (elapsed < 60_000) return 'Ahora';
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 60) return `Hace ${minutes} min`;
  return `Hace ${Math.round(minutes / 60)} h`;
}

export function isFresh(iso?: string | null) {
  return Boolean(iso && Number.isFinite(Date.parse(iso)) && Date.now() - Date.parse(iso) < FRESH_MS);
}

export function overviewRecord(report: DiagnosticReport, summary: SensorSummary | null): ToolRecord {
  const ramUsed = report.ramTotalGb > 0 ? Math.round((1 - report.ramFreeGb / report.ramTotalGb) * 100) : 0;
  const diskFreeRatio = report.systemDriveTotalGb > 0 ? report.systemDriveFreeGb / report.systemDriveTotalGb : 1;
  const temperatures = [summary?.cpuTemperatureC, summary?.gpuTemperatureC, summary?.storageTemperatureC, summary?.systemTemperatureC]
    .filter((value): value is number => value != null);
  const hottest = temperatures.length ? Math.round(Math.max(...temperatures)) : null;
  const issues = [ramUsed >= 88, diskFreeRatio < .12, report.defenderStatus !== 'Activo', report.pendingReboot, (hottest ?? 0) >= 88].filter(Boolean).length;
  const title = issues ? `${issues} ${issues === 1 ? 'punto para revisar' : 'puntos para revisar'}` : 'Sin problemas importantes';
  return {
    id: 'overview',
    checkedAt: report.generatedAt,
    ok: issues === 0,
    title,
    summary: [`RAM ${ramUsed}% usada`, `${Math.round(report.systemDriveFreeGb)} GB libres`, `Defender ${report.defenderStatus.toLowerCase()}`, hottest != null ? `temperatura máxima ${hottest} °C` : 'temperatura sin lectura'].join(' · '),
    rows: [
      { label: 'Memoria', value: `${ramUsed}% usada`, tone: ramUsed >= 88 ? 'warning' : 'success' },
      { label: 'Disco', value: `${Math.round(report.systemDriveFreeGb)} GB libres`, tone: diskFreeRatio < .12 ? 'warning' : 'success' },
      { label: 'Seguridad', value: report.defenderStatus, tone: report.defenderStatus === 'Activo' ? 'success' : 'warning' },
      { label: 'Inicio', value: `${report.startupItems} programas`, tone: report.startupItems > 20 ? 'warning' : 'info' },
      { label: 'Reinicio pendiente', value: report.pendingReboot ? 'Sí' : 'No', tone: report.pendingReboot ? 'warning' : 'success' },
      { label: 'Temperatura', value: hottest != null ? `${hottest} °C` : 'Sin lectura', tone: hottest != null && hottest >= 88 ? 'warning' : hottest != null ? 'success' : 'info' }
    ],
    raw: report
  };
}

export function temperatureRecord(snapshot: HardwareSnapshot): ToolRecord {
  const summary = summarizeHardware(snapshot);
  const rows: EvidenceRow[] = [];
  const pushTemperature = (label: string, value: number | null) => {
    if (value == null) return;
    rows.push({ label, value: `${Math.round(value)} °C`, tone: value >= 88 ? 'warning' : 'success' });
  };
  pushTemperature('CPU', summary.cpuTemperatureC);
  pushTemperature('GPU', summary.gpuTemperatureC);
  pushTemperature('Disco', summary.storageTemperatureC);
  pushTemperature('Sistema', summary.systemTemperatureC);
  if (summary.fanRpm != null) rows.push({ label: 'Ventilador', value: `${Math.round(summary.fanRpm)} RPM`, tone: 'info' });
  const thermalValues = [summary.cpuTemperatureC, summary.gpuTemperatureC, summary.storageTemperatureC, summary.systemTemperatureC]
    .filter((value): value is number => value != null);
  const hottest = thermalValues.length ? Math.round(Math.max(...thermalValues)) : null;
  return {
    id: 'temperature',
    checkedAt: snapshot.generatedAt,
    ok: summary.temperatureAvailable,
    title: hottest != null ? `${hottest} °C máximo` : snapshot.permissionRequired ? 'Falta autorización' : 'Sin sensor compatible',
    summary: summary.temperatureAvailable ? `${summary.sourceLabel}. ${snapshot.note}` : snapshot.note || 'Windows no entregó una lectura térmica utilizable.',
    rows,
    raw: snapshot
  };
}

export function networkRecord(result: AgentActionResult): ToolRecord {
  const data = parseDetail<{ adapter?: { Name?: string; InterfaceDescription?: string; LinkSpeed?: string }; gateway?: string; dns?: boolean; internet?: boolean }>(result);
  const internet = Boolean(data?.internet);
  const dns = Boolean(data?.dns);
  const ok = internet && dns;
  return {
    id: 'network', checkedAt: new Date().toISOString(), ok,
    title: ok ? 'Internet funciona correctamente' : 'La conexión necesita revisión',
    summary: ok ? 'La salida a Internet y la resolución DNS respondieron.' : 'Alguna de las comprobaciones de red no respondió.',
    rows: [
      { label: 'Adaptador', value: data?.adapter?.Name || data?.adapter?.InterfaceDescription || 'No detectado', tone: data?.adapter ? 'success' : 'warning' },
      { label: 'Velocidad de enlace', value: data?.adapter?.LinkSpeed || 'Sin dato', tone: 'info' },
      { label: 'Gateway', value: data?.gateway || 'No detectado', tone: data?.gateway ? 'success' : 'warning' },
      { label: 'DNS', value: dns ? 'Responde' : 'No responde', tone: dns ? 'success' : 'warning' },
      { label: 'Salida a Internet', value: internet ? 'Disponible' : 'No disponible', tone: internet ? 'success' : 'warning' }
    ], raw: data
  };
}

export function securityRecord(result: AgentActionResult): ToolRecord {
  const data = parseDetail<{ service?: boolean; antivirus?: boolean; realtime?: boolean; quickScanAge?: number; fullScanAge?: number }>(result);
  const ok = Boolean(data?.service && data?.antivirus && data?.realtime);
  return {
    id: 'security', checkedAt: new Date().toISOString(), ok,
    title: ok ? 'Protección activa' : 'Defender necesita atención',
    summary: ok ? 'Servicio, antivirus y protección en tiempo real están activos.' : 'Una o más capas de Microsoft Defender están desactivadas.',
    rows: [
      { label: 'Servicio', value: data?.service ? 'Activo' : 'Inactivo', tone: data?.service ? 'success' : 'warning' },
      { label: 'Antivirus', value: data?.antivirus ? 'Activo' : 'Inactivo', tone: data?.antivirus ? 'success' : 'warning' },
      { label: 'Tiempo real', value: data?.realtime ? 'Activo' : 'Inactivo', tone: data?.realtime ? 'success' : 'warning' },
      { label: 'Último análisis rápido', value: data?.quickScanAge == null ? 'Sin dato' : `Hace ${data.quickScanAge} días`, tone: 'info' }
    ], raw: data
  };
}

export function startupRecord(result: AgentActionResult): ToolRecord {
  const data = parseDetail<{ count?: number; items?: Array<{ Name?: string }> }>(result);
  const count = data?.count ?? data?.items?.length ?? 0;
  return {
    id: 'startup', checkedAt: new Date().toISOString(), ok: count <= 20,
    title: `${count} programas al iniciar`,
    summary: count > 20 ? 'Hay muchas aplicaciones cargando con Windows. NEXO no desactivó ninguna.' : 'La cantidad de programas de inicio es razonable. NEXO no modificó nada.',
    rows: (data?.items || []).slice(0, 8).map((item, index) => ({ label: `${index + 1}`, value: item.Name || 'Programa sin nombre', tone: 'info' })),
    raw: data
  };
}

export function optimizerRecord(result: AgentActionResult, cleaned = false): ToolRecord {
  const data = parseDetail<CleanupPayload>(result) || {};
  const bytes = cleaned ? data.freedBytes ?? 0 : data.totalBytes ?? 0;
  const files = cleaned ? data.deletedFiles ?? 0 : data.totalFiles ?? 0;
  return {
    id: 'optimizer',
    checkedAt: data.generatedAt || new Date().toISOString(),
    ok: true,
    title: cleaned ? `${formatBytes(bytes)} liberados` : `${formatBytes(bytes)} disponibles`,
    summary: cleaned
      ? `Se eliminaron ${files} archivos temporales seguros. Las sesiones, cookies, perfiles y contraseñas de navegadores no se tocaron.`
      : `Encontré ${files} archivos dentro de ubicaciones temporales autorizadas. Antes de borrar podés revisar el detalle.`,
    rows: (data.categories || []).map((category) => ({
      label: category.name || 'Temporales',
      value: cleaned ? `${category.deleted ?? 0} archivos · ${formatBytes(category.freedBytes ?? 0)}` : `${category.files ?? 0} archivos · ${formatBytes(category.bytes ?? 0)}`,
      tone: 'info'
    })),
    raw: data
  };
}

export function recordChatText(record: ToolRecord) {
  const evidence = record.rows.slice(0, 6).map((row) => `${row.label}: ${row.value}`).join('\n');
  return `${record.title}. ${record.summary}${evidence ? `\n\n${evidence}` : ''}\n\nDatos: ${ageLabel(record.checkedAt)}.`;
}
