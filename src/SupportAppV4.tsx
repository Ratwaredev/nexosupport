import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Gauge,
  HardDrive,
  Headphones,
  LayoutGrid,
  Menu,
  MessageCircle,
  Minus,
  Power,
  RefreshCw,
  Rocket,
  Send,
  Settings2,
  ShieldCheck,
  Thermometer,
  Wifi,
  Wrench,
  X
} from 'lucide-react';
import { appBackend, backendConfig } from './lib/backend';
import type { AppSession, ClientDashboard, UpdateConsentInput } from './lib/domain';
import { APP_VERSION } from './lib/domain';
import { runQuickDiagnostic } from './lib/diagnostics';
import type { DiagnosticReport } from './lib/diagnostics';
import { runAgentAction } from './lib/agent';
import type { AgentActionResult } from './lib/agent';
import { requestAssistant, TOOL_CATALOG } from './lib/assistant';
import type { AssistantToolId, ProviderMessage } from './lib/assistant';
import { readHardwareSensors, summarizeHardware } from './lib/sensors';
import type { HardwareSnapshot, SensorSummary } from './lib/sensors';
import { getRemoteToolStatus, openRemoteTool } from './lib/support';
import type { RemoteToolStatus } from './lib/support';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type Mode = 'protected' | 'local';
type View = 'assistant' | 'tools';
type Tone = 'success' | 'warning' | 'error' | 'info';
type ToolId = 'overview' | 'temperature' | 'network' | 'security' | 'startup' | 'optimizer' | 'remote';
type Notice = { tone: Tone; title: string; detail?: string };
type ChatMessage = { id: string; role: 'assistant' | 'user'; text: string; tone?: Tone };
type DataRow = { label: string; value: string; tone?: Tone };
type ToolRecord = {
  id: ToolId;
  checkedAt: string;
  ok: boolean;
  title: string;
  summary: string;
  rows: DataRow[];
  raw?: unknown;
};
type PendingAction = {
  id: 'clean_temp_files' | 'repair_network' | 'defender_quick_scan' | 'windows_update';
  title: string;
  description: string;
  callId?: string;
  providerHistory?: ProviderMessage[];
};
type CleanupCategory = { name?: string; path?: string; files?: number; bytes?: number; deleted?: number; freedBytes?: number; failed?: number };
type CleanupPayload = {
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

const FRESH_MS = 5 * 60 * 1000;
const protectedConsent: UpdateConsentInput = { assistantEnabled: true, shareDiagnostics: true, automaticChecks: false, hardwareSensors: true, elevatedSensors: false };
const localConsent: UpdateConsentInput = { assistantEnabled: false, shareDiagnostics: false, automaticChecks: false, hardwareSensors: true, elevatedSensors: false };

const quickPrompts = ['Revisá mi PC', '¿Qué está usando recursos?', 'Revisá Internet', 'Quiero optimizar'];

const toolDefinitions: Array<{ id: ToolId; title: string; detail: string; icon: ReactNode }> = [
  { id: 'overview', title: 'Estado general', detail: 'RAM, disco, seguridad y reinicio', icon: <Gauge /> },
  { id: 'temperature', title: 'Temperatura', detail: 'CPU, GPU, disco y placa madre', icon: <Thermometer /> },
  { id: 'network', title: 'Internet', detail: 'Adaptador, DNS, gateway y salida', icon: <Wifi /> },
  { id: 'security', title: 'Seguridad', detail: 'Defender y protección en tiempo real', icon: <ShieldCheck /> },
  { id: 'startup', title: 'Inicio de Windows', detail: 'Programas que cargan al encender', icon: <RefreshCw /> },
  { id: 'optimizer', title: 'Optimizar', detail: 'Limpieza segura con análisis previo', icon: <Rocket /> },
  { id: 'remote', title: 'Soporte remoto', detail: 'Detectar y abrir RustDesk', icon: <Headphones /> }
];

const withTimeout = async <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), ms); });
  try { return await Promise.race([promise, timeout]); }
  finally { window.clearTimeout(timer); }
};

function NexoMark({ size = 24 }: { size?: number }) {
  const gradientId = `nexo-v4-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 62 54" aria-hidden="true">
      <defs><linearGradient id={gradientId} x1="4" y1="4" x2="58" y2="50" gradientUnits="userSpaceOnUse"><stop stopColor="#7557ff" /><stop offset=".55" stopColor="#5e5eea" /><stop offset="1" stopColor="#2d88df" /></linearGradient></defs>
      <path d="M4 4h13.4L31 20.8 44.6 4H58L38.1 27 58 50H44.6L31 33.2 17.4 50H4l19.9-23z" fill={`url(#${gradientId})`} />
    </svg>
  );
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/tard[oó] demasiado|timeout|tiempo de espera/i.test(message)) return 'La tarea tardó demasiado y se detuvo. Probá nuevamente.';
  if (/permission|denied|rechaz|autorización/i.test(message)) return 'La autorización fue cancelada o Windows bloqueó el acceso.';
  if (/fetch|network|internet|supabase|rpc/i.test(message)) return 'El servicio conectado no está disponible. Las herramientas locales siguen funcionando.';
  return message || fallback;
}

function parseDetail<T>(result: AgentActionResult): T | null {
  const candidate = result.details.find((detail) => detail.trim().startsWith('{') || detail.trim().startsWith('['));
  if (!candidate) return null;
  try { return JSON.parse(candidate) as T; }
  catch { return null; }
}

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`;
}

function ageLabel(iso?: string | null) {
  if (!iso) return 'Sin analizar';
  const elapsed = Math.max(0, Date.now() - Date.parse(iso));
  if (elapsed < 60_000) return 'Ahora';
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 60) return `Hace ${minutes} min`;
  return `Hace ${Math.round(minutes / 60)} h`;
}

function isFresh(iso?: string | null) {
  return Boolean(iso && Date.now() - Date.parse(iso) < FRESH_MS);
}

function chatMessage(role: ChatMessage['role'], text: string, tone?: Tone): ChatMessage {
  return { id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`, role, text, tone };
}

function overviewRecord(report: DiagnosticReport, summary: SensorSummary | null): ToolRecord {
  const ramUsed = report.ramTotalGb > 0 ? Math.round((1 - report.ramFreeGb / report.ramTotalGb) * 100) : 0;
  const diskFreeRatio = report.systemDriveTotalGb > 0 ? report.systemDriveFreeGb / report.systemDriveTotalGb : 1;
  const temperatures = [summary?.cpuTemperatureC, summary?.gpuTemperatureC, summary?.storageTemperatureC, summary?.systemTemperatureC].filter((value): value is number => value != null);
  const hottest = temperatures.length ? Math.round(Math.max(...temperatures)) : null;
  const issues = [ramUsed >= 88, diskFreeRatio < .12, report.defenderStatus !== 'Activo', report.pendingReboot, (hottest ?? 0) >= 88].filter(Boolean).length;
  const title = issues ? `${issues} ${issues === 1 ? 'punto para revisar' : 'puntos para revisar'}` : 'Sin problemas importantes';
  const summaryText = [
    `RAM ${ramUsed}% usada`,
    `${Math.round(report.systemDriveFreeGb)} GB libres`,
    `Defender ${report.defenderStatus.toLowerCase()}`,
    hottest != null ? `temperatura máxima ${hottest} °C` : 'temperatura sin lectura'
  ].join(' · ');
  return {
    id: 'overview', checkedAt: report.generatedAt, ok: issues === 0, title, summary: summaryText,
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

function temperatureRecord(snapshot: HardwareSnapshot): ToolRecord {
  const summary = summarizeHardware(snapshot);
  const rows: DataRow[] = [
    ['CPU', summary.cpuTemperatureC], ['GPU', summary.gpuTemperatureC], ['Disco', summary.storageTemperatureC], ['Sistema', summary.systemTemperatureC]
  ].filter((entry): entry is [string, number] => entry[1] != null).map(([label, value]) => ({ label, value: `${Math.round(value)} °C`, tone: value >= 88 ? 'warning' : 'success' }));
  if (summary.fanRpm != null) rows.push({ label: 'Ventilador', value: `${Math.round(summary.fanRpm)} RPM`, tone: 'info' });
  const hottest = rows.filter((row) => row.value.includes('°C')).map((row) => Number(row.value.replace(/[^0-9.-]/g, ''))).filter(Number.isFinite).sort((a, b) => b - a)[0];
  return {
    id: 'temperature', checkedAt: snapshot.generatedAt, ok: summary.temperatureAvailable,
    title: summary.temperatureAvailable ? `${hottest} °C máximo` : snapshot.permissionRequired ? 'Falta autorización' : 'Sin sensor compatible',
    summary: summary.temperatureAvailable ? `${summary.sourceLabel}. ${snapshot.note}` : snapshot.note || 'Windows no entregó una lectura térmica utilizable.',
    rows,
    raw: snapshot
  };
}

function networkRecord(result: AgentActionResult): ToolRecord {
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

function securityRecord(result: AgentActionResult): ToolRecord {
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

function startupRecord(result: AgentActionResult): ToolRecord {
  const data = parseDetail<{ count?: number; items?: Array<{ Name?: string }> }>(result);
  const count = data?.count ?? data?.items?.length ?? 0;
  return {
    id: 'startup', checkedAt: new Date().toISOString(), ok: count <= 20,
    title: `${count} programas al iniciar`,
    summary: count > 20 ? 'Hay muchas aplicaciones cargando con Windows. NEXO no desactivó ninguna.' : 'La cantidad de programas de inicio es razonable. NEXO no modificó nada.',
    rows: (data?.items || []).slice(0, 8).map((item, index) => ({ label: `${index + 1}`, value: item.Name || 'Programa sin nombre', tone: 'info' })), raw: data
  };
}

function optimizerRecord(result: AgentActionResult, cleaned = false): ToolRecord {
  const data = parseDetail<CleanupPayload>(result) || {};
  const bytes = cleaned ? data.freedBytes ?? 0 : data.totalBytes ?? 0;
  const files = cleaned ? data.deletedFiles ?? 0 : data.totalFiles ?? 0;
  return {
    id: 'optimizer', checkedAt: data.generatedAt || new Date().toISOString(), ok: true,
    title: cleaned ? `${formatBytes(bytes)} liberados` : `${formatBytes(bytes)} disponibles`,
    summary: cleaned
      ? `Se eliminaron ${files} archivos temporales seguros. Las sesiones, cookies, perfiles y contraseñas de navegadores no se tocaron.`
      : `Encontré ${files} archivos dentro de ubicaciones temporales autorizadas. Antes de borrar podés revisar el detalle.`,
    rows: (data.categories || []).map((category) => ({
      label: category.name || 'Temporales',
      value: cleaned ? `${category.deleted ?? 0} archivos · ${formatBytes(category.freedBytes ?? 0)}` : `${category.files ?? 0} archivos · ${formatBytes(category.bytes ?? 0)}`,
      tone: 'info'
    })), raw: data
  };
}

function recordChatText(record: ToolRecord) {
  const evidence = record.rows.slice(0, 6).map((row) => `${row.label}: ${row.value}`).join('\n');
  return `${record.title}. ${record.summary}${evidence ? `\n\n${evidence}` : ''}\n\nDatos: ${ageLabel(record.checkedAt)}.`;
}

export default function SupportAppV4() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [dashboard, setDashboard] = useState<ClientDashboard | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null);
  const [remoteTool, setRemoteTool] = useState<RemoteToolStatus | null>(null);
  const [records, setRecords] = useState<Partial<Record<ToolId, ToolRecord>>>({});
  const [view, setView] = useState<View>('assistant');
  const [selectedTool, setSelectedTool] = useState<ToolId | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [input, setInput] = useState('');
  const [code, setCode] = useState(backendConfig.backendKind === 'local' ? 'DEMO-PAIR' : '');
  const [pendingCode, setPendingCode] = useState('');
  const [modeOpen, setModeOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [providerMessages, setProviderMessages] = useState<ProviderMessage[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([chatMessage('assistant', 'Hola. Soy NEXO. Contame qué pasa con tu PC. Voy a revisar datos reales y te voy a mostrar qué encontré antes de cambiar nada.')]);
  const [optimizerPhase, setOptimizerPhase] = useState<'idle' | 'scanning' | 'ready' | 'cleaning' | 'done'>('idle');
  const threadRef = useRef<HTMLDivElement | null>(null);

  const device = dashboard?.device ?? null;
  const consent = dashboard?.consent ?? null;
  const active = Boolean(session?.deviceToken && device);
  const hardwareSummary = useMemo(() => hardware ? summarizeHardware(hardware) : null, [hardware]);
  const currentOverview = records.overview || (report ? overviewRecord(report, hardwareSummary) : null);

  function pushMessage(role: ChatMessage['role'], text: string, tone?: Tone) {
    setMessages((current) => [...current, chatMessage(role, text, tone)]);
  }

  function saveRecord(record: ToolRecord) {
    setRecords((current) => ({ ...current, [record.id]: record }));
    return record;
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [restored, status] = await Promise.all([
          withTimeout(appBackend.bootstrap('client'), 7000, 'NEXO tardó demasiado en abrir.'),
          getRemoteToolStatus().catch(() => null)
        ]);
        if (!mounted) return;
        setRemoteTool(status);
        setSession(restored);
        if (!restored?.deviceToken) return;
        const data = await withTimeout(appBackend.getClientDashboard(restored.deviceToken), 8000, 'NEXO tardó demasiado en cargar esta PC.');
        if (!mounted) return;
        setDashboard(data);
        const latest = data.diagnostics[0]?.payload as unknown as (DiagnosticReport & { hardware?: HardwareSnapshot }) | undefined;
        if (latest?.generatedAt) {
          setReport(latest);
          const summary = latest.hardware ? summarizeHardware(latest.hardware) : null;
          saveRecord(overviewRecord(latest, summary));
        }
        if (latest?.hardware?.generatedAt) {
          setHardware(latest.hardware);
          saveRecord(temperatureRecord(latest.hardware));
        }
      } catch (error) {
        if (mounted) setNotice({ tone: 'error', title: 'No se pudo abrir NEXO', detail: friendlyError(error, 'Cerrá la app y volvé a abrirla.') });
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.tone === 'error' ? 9000 : 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (view !== 'assistant') return;
    const timer = window.setTimeout(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' }), 30);
    return () => window.clearTimeout(timer);
  }, [messages, pendingAction, busy, view]);

  async function runOverview(force = false) {
    const cached = records.overview;
    if (!force && cached && isFresh(cached.checkedAt)) return cached;
    if (!session?.deviceToken || !device) throw new Error('Esta PC todavía no está conectada.');
    setBusy('Analizando el equipo');
    try {
      const [diagnosticResult, sensorResult] = await Promise.allSettled([
        withTimeout(runQuickDiagnostic(), 30000, 'El diagnóstico tardó demasiado.'),
        withTimeout(readHardwareSensors(false), 60000, 'La lectura de sensores tardó demasiado.')
      ]);
      if (diagnosticResult.status === 'rejected') throw diagnosticResult.reason;
      const nextReport = diagnosticResult.value;
      const nextHardware = sensorResult.status === 'fulfilled' ? sensorResult.value : hardware;
      const summary = nextHardware ? summarizeHardware(nextHardware) : null;
      setReport(nextReport);
      if (nextHardware) {
        setHardware(nextHardware);
        saveRecord(temperatureRecord(nextHardware));
      }
      const record = saveRecord(overviewRecord(nextReport, summary));
      if (consent?.shareDiagnostics) void appBackend.saveDiagnostic({ deviceId: device.id, payload: { ...nextReport, hardware: nextHardware } }, session.deviceToken).catch(() => undefined);
      return record;
    } finally { setBusy(''); }
  }

  async function runTemperature(elevated = false, force = false) {
    const cached = records.temperature;
    if (!force && !elevated && cached && isFresh(cached.checkedAt)) return cached;
    setBusy(elevated ? 'Esperando autorización de Windows' : 'Leyendo sensores');
    try {
      const snapshot = await withTimeout(readHardwareSensors(elevated), elevated ? 150000 : 60000, 'La lectura térmica tardó demasiado.');
      setHardware(snapshot);
      return saveRecord(temperatureRecord(snapshot));
    } finally { setBusy(''); }
  }

  async function runNativeTool(id: 'network' | 'security' | 'startup', force = false) {
    const cached = records[id];
    if (!force && cached && isFresh(cached.checkedAt)) return cached;
    const action = id === 'network' ? 'network_check' : id === 'security' ? 'defender_status' : 'startup_review';
    const label = id === 'network' ? 'Revisando Internet' : id === 'security' ? 'Revisando seguridad' : 'Revisando inicio';
    setBusy(label);
    try {
      const result = await withTimeout(runAgentAction(action), 45000, `${label} tardó demasiado.`);
      const record = id === 'network' ? networkRecord(result) : id === 'security' ? securityRecord(result) : startupRecord(result);
      return saveRecord(record);
    } finally { setBusy(''); }
  }

  async function scanOptimizer(force = false) {
    const cached = records.optimizer;
    if (!force && cached && optimizerPhase !== 'done' && isFresh(cached.checkedAt)) return cached;
    setOptimizerPhase('scanning');
    setBusy('Buscando basura segura');
    try {
      const result = await withTimeout(runAgentAction('temp_scan'), 60000, 'El análisis de temporales tardó demasiado.');
      const record = saveRecord(optimizerRecord(result, false));
      setOptimizerPhase('ready');
      return record;
    } finally { setBusy(''); }
  }

  async function cleanOptimizer() {
    setPendingAction(null);
    setOptimizerPhase('cleaning');
    setBusy('NEXO está optimizando');
    const started = Date.now();
    try {
      const result = await withTimeout(runAgentAction('clean_temp_files'), 120000, 'La optimización tardó demasiado.');
      const wait = Math.max(0, 2600 - (Date.now() - started));
      if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait));
      const record = saveRecord(optimizerRecord(result, true));
      setOptimizerPhase('done');
      return record;
    } finally { setBusy(''); }
  }

  async function refreshRemote() {
    setBusy('Buscando RustDesk');
    try {
      const status = await getRemoteToolStatus();
      setRemoteTool(status);
      return status;
    } finally { setBusy(''); }
  }

  async function openRemote() {
    setBusy('Abriendo RustDesk');
    try {
      const status = await openRemoteTool();
      setRemoteTool(status);
      setNotice({ tone: status.installed ? 'success' : 'warning', title: status.installed ? 'RustDesk abierto' : 'RustDesk no está instalado', detail: status.message });
    } finally { setBusy(''); }
  }

  async function executeConfirmedAction(action: PendingAction) {
    if (action.id === 'clean_temp_files') {
      const record = await cleanOptimizer();
      pushMessage('assistant', recordChatText(record), 'success');
      return record;
    }
    setPendingAction(null);
    setBusy(action.title);
    try {
      const result = await withTimeout(runAgentAction(action.id), 90000, `${action.title} tardó demasiado.`);
      const text = result.message || 'Acción terminada.';
      pushMessage('assistant', text, result.ok ? 'success' : 'warning');
      return { ok: result.ok, text };
    } finally { setBusy(''); }
  }

  async function explainRecord(record: ToolRecord) {
    setView('assistant');
    setSelectedTool(null);
    pushMessage('assistant', recordChatText(record), record.ok ? 'success' : 'warning');
  }

  async function runToolForChat(name: AssistantToolId) {
    if (name === 'run_quick_diagnostic') return runOverview(false);
    if (name === 'network_check') return runNativeTool('network', false);
    if (name === 'defender_status') return runNativeTool('security', false);
    if (name === 'startup_review') return runNativeTool('startup', false);
    if (name === 'scan_temp_files') return scanOptimizer(false);
    if (name === 'remote_support') {
      const status = await refreshRemote();
      const text = status.installed ? `RustDesk está instalado en ${status.path || 'este equipo'} y listo para abrirse con tu autorización.` : 'RustDesk no está instalado en este equipo.';
      return { id: 'remote' as ToolId, checkedAt: new Date().toISOString(), ok: status.installed, title: status.installed ? 'RustDesk detectado' : 'RustDesk no instalado', summary: text, rows: [], raw: status } satisfies ToolRecord;
    }
    if (name === 'clean_temp_files') {
      setPendingAction({ id: 'clean_temp_files', title: 'Optimizar ahora', description: 'Borra únicamente temporales de ubicaciones autorizadas. No toca perfiles, cookies, sesiones ni contraseñas de navegador.' });
      return null;
    }
    if (name === 'repair_network') {
      setPendingAction({ id: 'repair_network', title: 'Reparar Internet', description: 'Limpia la caché DNS de Windows. No cambia el router ni la contraseña Wi‑Fi.' });
      return null;
    }
    if (name === 'defender_quick_scan') {
      setPendingAction({ id: 'defender_quick_scan', title: 'Iniciar análisis rápido', description: 'Inicia el análisis oficial de Microsoft Defender.' });
      return null;
    }
    if (name === 'open_windows_update') {
      setPendingAction({ id: 'windows_update', title: 'Abrir Windows Update', description: 'Abre la configuración oficial; NEXO no instala actualizaciones por su cuenta.' });
      return null;
    }
    return null;
  }

  async function handleToolCall(name: AssistantToolId, callId: string, history: ProviderMessage[]) {
    const definition = TOOL_CATALOG[name];
    if (definition.mode === 'confirm') {
      const mapped = name === 'clean_temp_files' ? 'clean_temp_files' : name === 'repair_network' ? 'repair_network' : name === 'defender_quick_scan' ? 'defender_quick_scan' : 'windows_update';
      setPendingAction({ id: mapped, title: definition.label, description: definition.description, callId, providerHistory: history });
      pushMessage('assistant', `${definition.description}\n\nAntes de cambiar Windows necesito tu confirmación.`);
      return;
    }
    const record = await runToolForChat(name);
    if (!record) return;
    const text = recordChatText(record);
    pushMessage('assistant', text, record.ok ? 'success' : 'warning');
    if (name === 'scan_temp_files' && (record.raw as CleanupPayload | undefined)?.totalBytes) {
      setPendingAction({ id: 'clean_temp_files', title: 'Optimizar ahora', description: 'La limpieza usa una lista blanca de temporales y excluye datos de navegadores.' });
    }
    const toolMessage: ProviderMessage = { role: 'tool', name, tool_call_id: callId, content: JSON.stringify({ ok: record.ok, message: text, data: record.raw }) };
    setProviderMessages([...history, toolMessage, { role: 'assistant', content: text }]);
  }

  async function sendText(value: string) {
    const trimmed = value.trim();
    if (!trimmed || busy || !session?.deviceToken) return;
    setInput('');
    setView('assistant');
    pushMessage('user', trimmed);
    const userMessage: ProviderMessage = { role: 'user', content: trimmed };
    const history = [...providerMessages, userMessage];
    setProviderMessages(history);
    setBusy('Pensando');
    try {
      const response = await requestAssistant({ deviceToken: session.deviceToken, messages: history, diagnostic: consent?.shareDiagnostics ? report : null, hardware: consent?.shareDiagnostics ? hardwareSummary : null, appVersion: APP_VERSION });
      const withAssistant = [...history, response.message];
      setProviderMessages(withAssistant);
      const call = response.message.tool_calls?.[0];
      if (call) {
        setBusy('');
        await handleToolCall(call.function.name, call.id, withAssistant);
      } else {
        pushMessage('assistant', response.message.content || 'Decime qué querés revisar.');
      }
    } catch (error) {
      pushMessage('assistant', friendlyError(error, 'No pude responder ahora.'), 'warning');
    } finally { setBusy(''); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    await sendText(input);
  }

  async function activate(mode: Mode) {
    if (!pendingCode || busy) return;
    setBusy('Activando');
    try {
      const identity = await withTimeout(runQuickDiagnostic(), 25000, 'La identificación del equipo tardó demasiado.').catch(() => null);
      const registered = await withTimeout(appBackend.registerClient({ pairingCode: pendingCode, deviceName: identity?.computerName || 'Mi PC', issue: 'Activación', computerName: identity?.computerName || 'Equipo Windows', userName: identity?.userName || 'Usuario', os: identity?.os || 'Windows', platform: 'windows' }), 10000, 'NEXO tardó demasiado en validar el código.');
      if (!registered.session.deviceToken) throw new Error('No se creó la sesión.');
      const savedConsent = await appBackend.saveConsents(registered.session.deviceToken, mode === 'protected' ? protectedConsent : localConsent);
      const data = await appBackend.getClientDashboard(registered.session.deviceToken);
      setSession(registered.session);
      setDashboard({ ...data, consent: savedConsent });
      setModeOpen(false);
      setPendingCode('');
      setNotice({ tone: 'success', title: 'PC conectada', detail: 'NEXO está listo. No va a analizar ni modificar nada sin que lo pidas.' });
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo activar', detail: friendlyError(error, 'Revisá el código y probá otra vez.') });
    } finally { setBusy(''); }
  }

  async function openAdmin() {
    setMenuOpen(false);
    try {
      if (!isTauriRuntime()) throw new Error('NEXO Control se abre desde la aplicación de Windows.');
      await safeInvoke('open_admin_window');
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo abrir Administración', detail: friendlyError(error, 'Probá nuevamente.') });
    }
  }

  if (booting) return <main className="nx-app nx-loading"><NexoMark size={42} /><b>Abriendo NEXO</b><i /></main>;

  return (
    <main className="nx-app">
      <header className="nx-topbar" data-tauri-drag-region>
        <div className="nx-brand" data-tauri-drag-region><NexoMark size={23} /><span><b>NEXO</b><small>Support</small></span></div>
        <span className="nx-presence" data-tauri-drag-region><i />{active ? 'LISTO' : 'SIN ACTIVAR'}</span>
        <div className="nx-window-actions">
          <button aria-label="Menú" onClick={() => setMenuOpen((value) => !value)}><Menu size={16} /></button>
          <button aria-label="Minimizar" onClick={() => void safeInvoke('minimize_main_window')}><Minus size={15} /></button>
          <button aria-label="Cerrar NEXO" onClick={() => void safeInvoke('exit_app')}><X size={15} /></button>
        </div>
        {menuOpen && <nav className="nx-menu"><button onClick={() => void openAdmin()}><Settings2 size={16} /> Administración <ChevronRight size={15} /></button><button onClick={() => { setMenuOpen(false); window.dispatchEvent(new Event('nexo:check-update')); }}><RefreshCw size={16} /> Buscar actualización</button><button className="danger" onClick={() => void safeInvoke('exit_app')}><Power size={16} /> Cerrar NEXO</button></nav>}
      </header>

      {active && <nav className="nx-switch" aria-label="Secciones"><button className={view === 'assistant' ? 'active' : ''} onClick={() => { setView('assistant'); setSelectedTool(null); }}><MessageCircle size={16} /> Asistente</button><button className={view === 'tools' ? 'active' : ''} onClick={() => setView('tools')}><LayoutGrid size={16} /> Herramientas</button></nav>}
      {busy && <div className="nx-progress" role="status"><i /><span>{busy}</span></div>}
      {notice && <div className={`nx-toast ${notice.tone}`}><span>{notice.tone === 'error' || notice.tone === 'warning' ? <AlertTriangle size={17} /> : <Check size={17} />}</span><div><b>{notice.title}</b>{notice.detail && <small>{notice.detail}</small>}</div><button aria-label="Cerrar aviso" onClick={() => setNotice(null)}><X size={14} /></button></div>}

      {!active ? (
        <section className="nx-activate"><NexoMark size={52} /><h1>Conectá esta PC</h1><p>Ingresá el código de NEXO. Nada se analiza ni se modifica automáticamente.</p><form onSubmit={(event) => { event.preventDefault(); const value = code.trim().toUpperCase(); if (value.length >= 4) { setPendingCode(value); setModeOpen(true); } }}><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Código de activación" autoComplete="off" /><button disabled={code.trim().length < 4 || Boolean(busy)}>Continuar</button></form></section>
      ) : view === 'assistant' ? (
        <section className="nx-chat">
          <header className="nx-chat-head"><span><Bot size={19} /></span><div><b>NEXO</b><small>{currentOverview ? `${currentOverview.title} · ${ageLabel(currentOverview.checkedAt)}` : 'Esperando tu consulta'}</small></div></header>
          <div className="nx-thread" ref={threadRef}>
            {messages.map((message) => <article key={message.id} className={`nx-message ${message.role} ${message.tone || ''}`}>{message.role === 'assistant' && <span><NexoMark size={15} /></span>}<p>{message.text}</p></article>)}
            {messages.length === 1 && !busy && <div className="nx-prompts">{quickPrompts.map((prompt) => <button key={prompt} onClick={() => void sendText(prompt)}>{prompt}</button>)}</div>}
            {pendingAction && <section className="nx-confirm"><div><Wrench size={18} /><span><b>{pendingAction.title}</b><small>{pendingAction.description}</small></span></div><footer><button onClick={() => { setPendingAction(null); pushMessage('assistant', 'No hice ningún cambio.', 'info'); }}>Cancelar</button><button onClick={() => void executeConfirmedAction(pendingAction)}>Confirmar</button></footer></section>}
            {busy && <article className="nx-message assistant nx-typing"><span><NexoMark size={15} /></span><p><i /><i /><i /></p></article>}
          </div>
          <form className="nx-composer" onSubmit={(event) => void send(event)}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Contame qué pasa con tu PC…" disabled={Boolean(busy)} /><button aria-label="Enviar" disabled={!input.trim() || Boolean(busy)}><Send size={18} /></button></form>
        </section>
      ) : (
        <section className="nx-tools">
          {!selectedTool ? (
            <><header className="nx-tools-head"><div><small>HERRAMIENTAS</small><h1>Revisar y resolver</h1><p>Primero ves el estado guardado. El análisis solo corre cuando lo pedís.</p></div></header><div className="nx-tool-list">{toolDefinitions.map((tool) => { const record = records[tool.id]; const remoteLabel = tool.id === 'remote' ? remoteTool?.installed ? 'Instalado' : 'No instalado' : null; return <button key={tool.id} className={tool.id === 'optimizer' ? 'featured' : ''} onClick={() => setSelectedTool(tool.id)}><span>{tool.icon}</span><div><b>{tool.title}</b><small>{tool.detail}</small></div><em>{remoteLabel || (record ? ageLabel(record.checkedAt) : 'Sin analizar')}</em><ChevronRight size={16} /></button>; })}</div><footer className="nx-tools-note"><ShieldCheck size={15} /><span>NEXO no ejecuta limpiezas ni cambios sin confirmación.</span><b>v{APP_VERSION}</b></footer></>
          ) : (
            <ToolDetail
              id={selectedTool}
              record={records[selectedTool]}
              remoteTool={remoteTool}
              optimizerPhase={optimizerPhase}
              busy={Boolean(busy)}
              hardware={hardware}
              onBack={() => setSelectedTool(null)}
              onAnalyze={async (elevated = false) => {
                try {
                  if (selectedTool === 'overview') await runOverview(true);
                  if (selectedTool === 'temperature') await runTemperature(elevated, true);
                  if (selectedTool === 'network' || selectedTool === 'security' || selectedTool === 'startup') await runNativeTool(selectedTool, true);
                  if (selectedTool === 'optimizer') await scanOptimizer(true);
                  if (selectedTool === 'remote') await refreshRemote();
                } catch (error) { setNotice({ tone: 'error', title: 'No se pudo completar', detail: friendlyError(error, 'Probá nuevamente.') }); }
              }}
              onExplain={() => { const record = records[selectedTool]; if (record) void explainRecord(record); }}
              onOptimize={() => setPendingAction({ id: 'clean_temp_files', title: 'Optimizar ahora', description: 'Se borrarán solo temporales de la lista blanca. Navegadores, sesiones, cookies, perfiles y contraseñas quedan excluidos.' })}
              onOpenRemote={() => void openRemote()}
            />
          )}
        </section>
      )}

      {modeOpen && <div className="nx-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModeOpen(false); }}><section className="nx-dialog"><header><div><small>CONFIGURACIÓN INICIAL</small><h2>¿Cómo querés usar NEXO?</h2></div><button aria-label="Cerrar" onClick={() => setModeOpen(false)}><X size={18} /></button></header><div className="nx-mode-actions"><button onClick={() => void activate('protected')}><ShieldCheck /><span><b>Proteger esta PC</b><small>Asistente conectado, diagnósticos y soporte técnico.</small></span><ChevronRight /></button><button onClick={() => void activate('local')}><Gauge /><span><b>Solo herramientas locales</b><small>Todo queda guardado en este equipo.</small></span><ChevronRight /></button></div></section></div>}
    </main>
  );
}

function ToolDetail({ id, record, remoteTool, optimizerPhase, busy, hardware, onBack, onAnalyze, onExplain, onOptimize, onOpenRemote }: {
  id: ToolId;
  record?: ToolRecord;
  remoteTool: RemoteToolStatus | null;
  optimizerPhase: 'idle' | 'scanning' | 'ready' | 'cleaning' | 'done';
  busy: boolean;
  hardware: HardwareSnapshot | null;
  onBack: () => void;
  onAnalyze: (elevated?: boolean) => Promise<void>;
  onExplain: () => void;
  onOptimize: () => void;
  onOpenRemote: () => void;
}) {
  const definition = toolDefinitions.find((tool) => tool.id === id)!;
  const temperatureNeedsAdmin = id === 'temperature' && hardware?.permissionRequired && !record?.ok;
  const optimizerData = id === 'optimizer' ? record?.raw as CleanupPayload | undefined : undefined;
  const canOptimize = id === 'optimizer' && optimizerPhase === 'ready' && (optimizerData?.totalBytes ?? 0) > 0;

  return (
    <div className="nx-detail">
      <header><button aria-label="Volver" onClick={onBack}><ArrowLeft size={17} /></button><span>{definition.icon}</span><div><small>{ageLabel(record?.checkedAt)}</small><h1>{definition.title}</h1><p>{definition.detail}</p></div></header>

      {id === 'optimizer' && (optimizerPhase === 'scanning' || optimizerPhase === 'cleaning') ? (
        <RocketStage cleaning={optimizerPhase === 'cleaning'} />
      ) : id === 'remote' ? (
        <section className="nx-remote-card"><span className={remoteTool?.installed ? 'ready' : 'missing'}><Headphones size={24} /></span><div><small>CLIENTE REMOTO</small><h2>{remoteTool?.installed ? 'RustDesk detectado' : 'RustDesk no está instalado'}</h2><p>{remoteTool?.message || 'Todavía no se comprobó el cliente remoto.'}</p>{remoteTool?.path && <code>{remoteTool.path}</code>}</div></section>
      ) : record ? (
        <><section className={`nx-result ${record.ok ? 'success' : 'warning'}`}><span>{record.ok ? <Check size={20} /> : <AlertTriangle size={20} />}</span><div><h2>{record.title}</h2><p>{record.summary}</p></div></section>{record.rows.length > 0 && <div className="nx-data-list">{record.rows.map((row, index) => <div key={`${row.label}-${index}`}><span>{row.label}</span><b className={row.tone || ''}>{row.value}</b></div>)}</div>}</>
      ) : (
        <section className="nx-empty"><span>{definition.icon}</span><h2>Todavía no hay datos</h2><p>NEXO no va a inventar un estado. Ejecutá el análisis cuando quieras comprobarlo.</p></section>
      )}

      {id === 'optimizer' && record && <section className="nx-exclusions"><ShieldCheck size={17} /><div><b>Navegadores protegidos</b><p>No se borran cookies, sesiones, perfiles, historial, extensiones, contraseñas ni datos de formularios.</p></div></section>}

      <footer className="nx-detail-actions">
        {id === 'remote' ? <><button className="secondary" onClick={() => void onAnalyze()} disabled={busy}>Volver a detectar</button><button onClick={onOpenRemote} disabled={busy || !remoteTool?.installed}>Abrir RustDesk</button></> : id === 'optimizer' ? <><button className="secondary" onClick={() => void onAnalyze()} disabled={busy}>{record ? 'Analizar de nuevo' : 'Analizar basura'}</button><button onClick={onOptimize} disabled={busy || !canOptimize}>{optimizerPhase === 'done' ? 'Optimización terminada' : 'Optimizar ahora'}</button></> : <><button className="secondary" onClick={() => void onAnalyze(temperatureNeedsAdmin)} disabled={busy}>{temperatureNeedsAdmin ? 'Reintentar como administrador' : record ? 'Actualizar análisis' : 'Analizar ahora'}</button><button onClick={onExplain} disabled={!record || busy}>Explicarlo en el chat</button></>}
      </footer>
    </div>
  );
}

function RocketStage({ cleaning }: { cleaning: boolean }) {
  return <section className="nx-rocket-stage"><div className="nx-stars"><i /><i /><i /><i /><i /></div><div className="nx-planet" /><div className="nx-rocket"><Rocket size={48} /><span /></div><div className="nx-rocket-copy"><small>{cleaning ? 'OPTIMIZANDO' : 'ANALIZANDO'}</small><h2>{cleaning ? 'Limpiando basura segura' : 'Calculando qué se puede limpiar'}</h2><p>{cleaning ? 'La nave está eliminando únicamente temporales autorizados.' : 'Nada se borra durante este paso.'}</p></div></section>;
}
