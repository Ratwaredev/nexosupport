import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  AlertTriangle,
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
  Trash2,
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
import { requestAssistant, TOOL_CATALOG } from './lib/assistant';
import type { AssistantToolId, ProviderMessage } from './lib/assistant';
import { readHardwareSensors, summarizeHardware } from './lib/sensors';
import type { HardwareSnapshot, SensorSummary } from './lib/sensors';
import { getRemoteToolStatus, openRemoteTool } from './lib/support';
import type { RemoteToolStatus } from './lib/support';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type Mode = 'protected' | 'local';
type Tone = 'success' | 'warning' | 'error' | 'info';
type View = 'assistant' | 'tools';
type Panel = 'details' | 'temperature' | 'support' | null;
type Notice = { tone: Tone; title: string; detail?: string };
type ToolResult = { ok: boolean; message: string };
type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  tone?: Tone;
};
type PendingChatAction = {
  id: AssistantToolId;
  callId: string;
  providerHistory?: ProviderMessage[];
};

const protectedConsent: UpdateConsentInput = {
  assistantEnabled: true,
  shareDiagnostics: true,
  automaticChecks: false,
  hardwareSensors: true,
  elevatedSensors: false
};

const localConsent: UpdateConsentInput = {
  assistantEnabled: false,
  shareDiagnostics: false,
  automaticChecks: false,
  hardwareSensors: true,
  elevatedSensors: false
};

const quickPrompts = [
  'Revisá mi PC',
  '¿Por qué está lenta?',
  'Revisá Internet',
  '¿Está muy caliente?'
];

const toolGroups: Array<{
  title: string;
  items: Array<{
    id: AssistantToolId | 'temperature';
    title: string;
    detail: string;
    icon: ReactNode;
  }>;
}> = [
  {
    title: 'Revisar',
    items: [
      { id: 'run_quick_diagnostic', title: 'Estado general', detail: 'Rendimiento, disco y seguridad', icon: <Gauge /> },
      { id: 'temperature', title: 'Temperatura', detail: 'CPU, GPU, disco y sistema', icon: <Thermometer /> },
      { id: 'network_check', title: 'Internet', detail: 'Conexión, DNS y puerta de enlace', icon: <Wifi /> },
      { id: 'defender_status', title: 'Seguridad', detail: 'Estado de Microsoft Defender', icon: <ShieldCheck /> },
      { id: 'startup_review', title: 'Inicio', detail: 'Programas que arrancan con Windows', icon: <Rocket /> },
      { id: 'scan_temp_files', title: 'Temporales', detail: 'Calcula cuánto espacio ocupan', icon: <HardDrive /> }
    ]
  },
  {
    title: 'Resolver',
    items: [
      { id: 'clean_temp_files', title: 'Liberar espacio', detail: 'Borra temporales antiguos', icon: <Trash2 /> },
      { id: 'repair_network', title: 'Reparar Internet', detail: 'Limpia la caché DNS', icon: <Wifi /> },
      { id: 'defender_quick_scan', title: 'Análisis rápido', detail: 'Usa Microsoft Defender', icon: <ShieldCheck /> },
      { id: 'open_windows_update', title: 'Windows Update', detail: 'Abre las actualizaciones', icon: <RefreshCw /> },
      { id: 'remote_support', title: 'Pedir un técnico', detail: 'Prepara soporte remoto autorizado', icon: <Headphones /> }
    ]
  }
];

const withTimeout = async <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
};

function NexoMark({ size = 24 }: { size?: number }) {
  const gradientId = `nexo-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 62 54" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="4" y1="4" x2="58" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7557ff" />
          <stop offset=".55" stopColor="#5e5eea" />
          <stop offset="1" stopColor="#2d88df" />
        </linearGradient>
      </defs>
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

function lastCheckLabel(report: DiagnosticReport | null) {
  if (!report?.generatedAt) return 'Todavía sin revisar';
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(report.generatedAt)) / 60000));
  if (minutes < 60) return `Revisada hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `Revisada hace ${hours} h` : 'Revisada hoy';
}

function healthState(report: DiagnosticReport | null, summary: SensorSummary | null) {
  if (!report) return { title: 'Lista para ayudarte', detail: 'Contame qué pasa o ejecutá una revisión completa.', tone: 'info' as Tone };
  const diskRatio = report.systemDriveTotalGb > 0 ? report.systemDriveFreeGb / report.systemDriveTotalGb : 1;
  const ramRatio = report.ramTotalGb > 0 ? report.ramFreeGb / report.ramTotalGb : 1;
  const hot = [summary?.cpuTemperatureC, summary?.gpuTemperatureC, summary?.storageTemperatureC, summary?.systemTemperatureC]
    .some((value) => (value ?? 0) >= 88);
  const issues = [diskRatio < .12, ramRatio < .12, report.defenderStatus !== 'Activo', report.pendingReboot, hot].filter(Boolean).length;
  if (issues) return { title: `${issues} ${issues === 1 ? 'punto para revisar' : 'puntos para revisar'}`, detail: 'NEXO encontró algo que merece atención.', tone: 'warning' as Tone };
  if (!summary?.temperatureAvailable) return { title: 'Sin alertas críticas', detail: 'Rendimiento y seguridad están bien; falta confirmar temperatura.', tone: 'info' as Tone };
  if (!summary.temperatureTrusted) return { title: 'Sin alertas críticas', detail: 'La lectura térmica disponible es aproximada.', tone: 'info' as Tone };
  return { title: 'Tu PC está en orden', detail: 'No encontramos problemas importantes.', tone: 'success' as Tone };
}

function temperatureState(snapshot: HardwareSnapshot | null, summary: SensorSummary | null) {
  const values = [summary?.cpuTemperatureC, summary?.gpuTemperatureC, summary?.storageTemperatureC, summary?.systemTemperatureC]
    .filter((value): value is number => value != null);
  if (values.length) {
    const hottest = Math.round(Math.max(...values));
    if (!summary?.temperatureTrusted) return { value: `${hottest}°`, label: 'Aproximada', tone: 'info' as Tone };
    return { value: `${hottest}°`, label: hottest >= 88 ? 'Alta' : 'Normal', tone: hottest >= 88 ? 'warning' as Tone : 'success' as Tone };
  }
  if (snapshot?.permissionRequired) return { value: 'Sin lectura', label: 'Reintentar como admin', tone: 'warning' as Tone };
  if (snapshot) return { value: 'No detectada', label: 'Sin sensor compatible', tone: 'info' as Tone };
  return { value: 'Sin leer', label: 'Todavía no revisada', tone: 'info' as Tone };
}

function createChatMessage(role: ChatMessage['role'], text: string, tone?: Tone): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    text,
    tone
  };
}

export default function SupportAppV3() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [dashboard, setDashboard] = useState<ClientDashboard | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null);
  const [remoteTool, setRemoteTool] = useState<RemoteToolStatus | null>(null);
  const [supportCode, setSupportCode] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [view, setView] = useState<View>('assistant');
  const [panel, setPanel] = useState<Panel>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [input, setInput] = useState('');
  const [code, setCode] = useState(backendConfig.backendKind === 'local' ? 'DEMO-PAIR' : '');
  const [pendingCode, setPendingCode] = useState('');
  const [modeOpen, setModeOpen] = useState(false);
  const [providerMessages, setProviderMessages] = useState<ProviderMessage[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    createChatMessage('assistant', 'Hola. Soy NEXO. Contame qué pasa con tu PC y lo reviso por vos.')
  ]);
  const [pendingAction, setPendingAction] = useState<PendingChatAction | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const device = dashboard?.device ?? null;
  const consent = dashboard?.consent ?? null;
  const active = Boolean(session?.deviceToken && device);
  const summary = useMemo(() => hardware ? summarizeHardware(hardware) : null, [hardware]);
  const health = useMemo(() => healthState(report, summary), [report, summary]);
  const temperature = useMemo(() => temperatureState(hardware, summary), [hardware, summary]);
  const ramUsed = report?.ramTotalGb ? Math.round((1 - report.ramFreeGb / report.ramTotalGb) * 100) : null;
  const diskFree = report?.systemDriveFreeGb != null ? Math.round(report.systemDriveFreeGb) : null;
  const runtimeLabel = appBackend.kind === 'local' ? 'LOCAL' : 'CONECTADO';

  const temperatureReadings = [
    { label: 'CPU', value: summary?.cpuTemperatureC },
    { label: 'GPU', value: summary?.gpuTemperatureC },
    { label: 'Disco', value: summary?.storageTemperatureC },
    { label: 'Sistema', value: summary?.systemTemperatureC }
  ].filter((item): item is { label: string; value: number } => item.value != null);

  function pushMessage(role: ChatMessage['role'], text: string, tone?: Tone) {
    setMessages((current) => [...current, createChatMessage(role, text, tone)]);
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [restored, tool] = await Promise.all([
          withTimeout(appBackend.bootstrap('client'), 7000, 'NEXO tardó demasiado en abrir.'),
          getRemoteToolStatus().catch(() => null)
        ]);
        if (!mounted) return;
        setRemoteTool(tool);
        setSession(restored);
        if (!restored?.deviceToken) return;
        const data = await withTimeout(appBackend.getClientDashboard(restored.deviceToken), 8000, 'NEXO tardó demasiado en cargar esta PC.');
        if (!mounted) return;
        setDashboard(data);
        const latestPayload = data.diagnostics[0]?.payload as unknown as (DiagnosticReport & { hardware?: HardwareSnapshot }) | undefined;
        if (latestPayload?.generatedAt) setReport(latestPayload);
        if (latestPayload?.hardware?.generatedAt) setHardware(latestPayload.hardware);
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
    const duration = notice.tone === 'error' || notice.tone === 'warning' ? 8000 : 4200;
    const timer = window.setTimeout(() => setNotice(null), duration);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (view !== 'assistant') return;
    const timer = window.setTimeout(() => {
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
    }, 20);
    return () => window.clearTimeout(timer);
  }, [messages, busy, pendingAction, view]);

  async function captureSensors(allowElevation: boolean) {
    const first = await withTimeout(readHardwareSensors(false), 55000, 'La lectura de sensores tardó demasiado.');
    const firstSummary = summarizeHardware(first);
    if (!allowElevation || firstSummary.temperatureAvailable || !first.permissionRequired) return first;

    setBusy('Esperando autorización');
    try {
      return await withTimeout(readHardwareSensors(true), 150000, 'La lectura con autorización tardó demasiado.');
    } catch {
      return first;
    }
  }

  async function inspect(showNotice = true): Promise<ToolResult> {
    if (!session?.deviceToken || !device || busy) return { ok: false, message: 'Ahora mismo hay otra tarea en curso.' };
    setBusy('Revisando equipo');
    setNotice(null);
    try {
      const [diagnosticResult, sensorResult] = await Promise.allSettled([
        withTimeout(runQuickDiagnostic(), 25000, 'La revisión tardó demasiado.'),
        captureSensors(true)
      ]);
      if (diagnosticResult.status === 'rejected') throw diagnosticResult.reason;

      const nextReport = diagnosticResult.value;
      const nextHardware = sensorResult.status === 'fulfilled' ? sensorResult.value : null;
      const nextSummary = nextHardware ? summarizeHardware(nextHardware) : null;
      const nextHealth = healthState(nextReport, nextSummary);
      setReport(nextReport);
      if (nextHardware) setHardware(nextHardware);

      if (consent?.shareDiagnostics) {
        void appBackend.saveDiagnostic({ deviceId: device.id, payload: { ...nextReport, hardware: nextHardware } }, session.deviceToken).catch(() => undefined);
      }

      const thermalText = nextSummary?.temperatureTrusted
        ? 'También pude leer la temperatura.'
        : nextSummary?.temperatureAvailable
          ? 'La temperatura disponible es aproximada.'
          : 'El equipo no entregó una temperatura utilizable.';
      const message = `${nextHealth.title}. ${nextHealth.detail} ${thermalText}`;

      if (showNotice) setNotice({ tone: nextHealth.tone, title: 'Revisión terminada', detail: message });
      return { ok: true, message };
    } catch (error) {
      const message = friendlyError(error, 'No pude completar la revisión.');
      if (showNotice) setNotice({ tone: 'error', title: 'No se pudo revisar', detail: message });
      return { ok: false, message };
    } finally {
      setBusy('');
    }
  }

  async function runSimpleAction(action: string, working: string, showNotice = true): Promise<ToolResult> {
    if (busy) return { ok: false, message: 'Ahora mismo hay otra tarea en curso.' };
    setBusy(working);
    setNotice(null);
    try {
      const result = await withTimeout(runAgentAction(action), 30000, `${working} tardó demasiado.`);
      if (showNotice) {
        setNotice({
          tone: result.ok ? 'success' : 'error',
          title: result.ok ? 'Acción completada' : 'No se pudo completar',
          detail: result.message
        });
      }
      return { ok: result.ok, message: result.message };
    } catch (error) {
      const message = friendlyError(error, 'La acción no pudo completarse.');
      if (showNotice) setNotice({ tone: 'error', title: 'No se pudo completar', detail: message });
      return { ok: false, message };
    } finally {
      setBusy('');
    }
  }

  async function readTemperature(elevated = false, showNotice = true): Promise<ToolResult> {
    if (busy) return { ok: false, message: 'Ahora mismo hay otra tarea en curso.' };
    setBusy(elevated ? 'Esperando autorización' : 'Buscando sensores');
    setNotice(null);
    try {
      const snapshot = await withTimeout(readHardwareSensors(elevated), elevated ? 150000 : 55000, 'La lectura tardó demasiado.');
      setHardware(snapshot);
      const next = summarizeHardware(snapshot);
      const values = [
        next.cpuTemperatureC,
        next.gpuTemperatureC,
        next.storageTemperatureC,
        next.systemTemperatureC
      ].filter((value): value is number => value != null);
      const hottest = values.length ? Math.round(Math.max(...values)) : null;
      const message = hottest != null
        ? next.temperatureTrusted
          ? `La temperatura más alta es ${hottest} °C y la lectura es directa.`
          : `La temperatura general es de aproximadamente ${hottest} °C.`
        : snapshot.permissionRequired
          ? 'No pude acceder a los sensores internos sin autorización. Podés reintentar como administrador.'
          : snapshot.note || 'El equipo no expone una temperatura compatible.';

      if (showNotice) {
        setNotice({
          tone: next.temperatureTrusted ? 'success' : next.temperatureAvailable ? 'info' : snapshot.permissionRequired ? 'warning' : 'info',
          title: next.temperatureAvailable ? 'Temperatura revisada' : 'Sin lectura térmica',
          detail: message
        });
      }
      return { ok: next.temperatureAvailable, message };
    } catch (error) {
      const message = friendlyError(error, 'El equipo no expone un sensor compatible.');
      if (showNotice) setNotice({ tone: 'info', title: 'No se pudo leer la temperatura', detail: message });
      return { ok: false, message };
    } finally {
      setBusy('');
    }
  }

  async function requestSupport(showNotice = true): Promise<ToolResult> {
    if (!session?.deviceToken || !device || busy) return { ok: false, message: 'Ahora mismo no puedo preparar soporte.' };
    setBusy('Preparando soporte');
    setNotice(null);
    try {
      const ticket = await appBackend.createTicket({
        deviceId: device.id,
        issue: input.trim() || 'Solicita asistencia técnica',
        clientName: device.displayName,
        priority: 'normal'
      }, session.deviceToken);
      const remote = await appBackend.createRemoteSession({ deviceId: device.id, ticketId: ticket.id }, session.deviceToken);
      setSupportCode(remote.code);

      let status = await getRemoteToolStatus();
      if (status.installed) status = await openRemoteTool();
      setRemoteTool(status);

      const message = status.installed
        ? `La solicitud quedó creada con el código ${remote.code} y abrí RustDesk.`
        : `La solicitud quedó creada con el código ${remote.code}. RustDesk no está instalado.`;
      if (showNotice) {
        setNotice({
          tone: status.installed ? 'success' : 'warning',
          title: status.installed ? 'RustDesk abierto' : 'Solicitud creada',
          detail: message
        });
      }
      return { ok: true, message };
    } catch (error) {
      const message = friendlyError(error, 'No pude preparar el soporte.');
      if (showNotice) setNotice({ tone: 'error', title: 'No se pudo abrir soporte', detail: message });
      return { ok: false, message };
    } finally {
      setBusy('');
    }
  }

  async function openRemoteNow() {
    if (busy) return;
    setBusy('Abriendo RustDesk');
    try {
      const status = await openRemoteTool();
      setRemoteTool(status);
      setNotice({
        tone: status.installed ? 'success' : 'warning',
        title: status.installed ? 'RustDesk abierto' : 'RustDesk no está instalado',
        detail: status.message
      });
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo abrir RustDesk', detail: friendlyError(error, 'Probá nuevamente.') });
    } finally {
      setBusy('');
    }
  }

  async function executeTool(name: AssistantToolId, showNotice = false): Promise<ToolResult> {
    if (name === 'run_quick_diagnostic') return inspect(showNotice);
    if (name === 'network_check') return runSimpleAction('network_check', 'Revisando Internet', showNotice);
    if (name === 'defender_status') return runSimpleAction('defender_status', 'Revisando seguridad', showNotice);
    if (name === 'scan_temp_files') return runSimpleAction('temp_scan', 'Buscando temporales', showNotice);
    if (name === 'startup_review') return runSimpleAction('startup_review', 'Revisando inicio', showNotice);
    if (name === 'clean_temp_files') return runSimpleAction('clean_temp_files', 'Liberando espacio', showNotice);
    if (name === 'repair_network') return runSimpleAction('repair_network', 'Reparando Internet', showNotice);
    if (name === 'defender_quick_scan') return runSimpleAction('defender_quick_scan', 'Iniciando análisis', showNotice);
    if (name === 'open_windows_update') return runSimpleAction('open_windows_update', 'Abriendo Windows Update', showNotice);
    if (name === 'remote_support') return requestSupport(showNotice);
    return { ok: false, message: 'Esa herramienta todavía no está disponible.' };
  }

  async function completeToolInChat(
    name: AssistantToolId,
    callId: string,
    providerHistory?: ProviderMessage[]
  ) {
    const result = await executeTool(name, false);
    pushMessage('assistant', result.message, result.ok ? 'success' : 'warning');

    if (providerHistory) {
      const toolMessage: ProviderMessage = {
        role: 'tool',
        name,
        tool_call_id: callId,
        content: JSON.stringify(result)
      };
      const finalMessage: ProviderMessage = { role: 'assistant', content: result.message };
      setProviderMessages([...providerHistory, toolMessage, finalMessage]);
    }
  }

  async function confirmPendingAction() {
    if (!pendingAction || busy) return;
    const action = pendingAction;
    setPendingAction(null);
    await completeToolInChat(action.id, action.callId, action.providerHistory);
  }

  function cancelPendingAction() {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    const message = 'Perfecto. No hice ningún cambio.';
    pushMessage('assistant', message, 'info');
    if (action.providerHistory) {
      setProviderMessages([
        ...action.providerHistory,
        {
          role: 'tool',
          name: action.id,
          tool_call_id: action.callId,
          content: JSON.stringify({ ok: false, message: 'Acción cancelada por el usuario.' })
        },
        { role: 'assistant', content: message }
      ]);
    }
  }

  async function handleAssistantTool(
    name: AssistantToolId,
    callId: string,
    providerHistory: ProviderMessage[]
  ) {
    const definition = TOOL_CATALOG[name];
    if (definition.mode === 'confirm') {
      pushMessage('assistant', `${definition.description} Necesito que lo confirmes antes de continuar.`);
      setPendingAction({ id: name, callId, providerHistory });
      return;
    }
    await completeToolInChat(name, callId, providerHistory);
  }

  async function sendText(value: string) {
    const trimmed = value.trim();
    if (!trimmed || busy || !session?.deviceToken) return;
    setInput('');
    setView('assistant');
    pushMessage('user', trimmed);

    const userMessage: ProviderMessage = { role: 'user', content: trimmed };
    const nextHistory = [...providerMessages, userMessage];
    setProviderMessages(nextHistory);
    setBusy('Pensando');

    try {
      const response = await requestAssistant({
        deviceToken: session.deviceToken,
        messages: nextHistory,
        diagnostic: consent?.shareDiagnostics ? report : null,
        hardware: consent?.shareDiagnostics ? summary : null,
        appVersion: APP_VERSION
      });
      const withAssistant = [...nextHistory, response.message];
      setProviderMessages(withAssistant);
      const call = response.message.tool_calls?.[0];

      if (call) {
        setBusy('');
        await handleAssistantTool(call.function.name, call.id, withAssistant);
      } else {
        const content = response.message.content || 'Decime qué querés resolver.';
        pushMessage('assistant', content);
      }
    } catch (error) {
      pushMessage('assistant', friendlyError(error, 'No pude responder ahora. Las herramientas locales siguen disponibles.'), 'warning');
    } finally {
      setBusy('');
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    await sendText(input);
  }

  async function launchTool(id: AssistantToolId | 'temperature') {
    if (busy) return;
    setView('assistant');
    const title = id === 'temperature' ? 'Revisar temperatura' : TOOL_CATALOG[id].label;
    pushMessage('user', title);

    if (id === 'temperature') {
      const result = await readTemperature(false, false);
      pushMessage('assistant', result.message, result.ok ? 'success' : 'info');
      return;
    }

    const definition = TOOL_CATALOG[id];
    if (definition.mode === 'confirm') {
      pushMessage('assistant', `${definition.description} Necesito que lo confirmes antes de continuar.`);
      setPendingAction({ id, callId: `ui-${Date.now()}` });
      return;
    }

    const result = await executeTool(id, false);
    pushMessage('assistant', result.message, result.ok ? 'success' : 'warning');
  }

  async function activate(mode: Mode) {
    if (!pendingCode || busy) return;
    setBusy('Activando');
    try {
      const identity = await withTimeout(runQuickDiagnostic(), 25000, 'La identificación del equipo tardó demasiado.').catch(() => null);
      const registered = await withTimeout(appBackend.registerClient({
        pairingCode: pendingCode,
        deviceName: identity?.computerName || 'Mi PC',
        issue: 'Activación',
        computerName: identity?.computerName || 'Equipo Windows',
        userName: identity?.userName || 'Usuario',
        os: identity?.os || 'Windows',
        platform: 'windows'
      }), 10000, 'NEXO tardó demasiado en validar el código.');
      if (!registered.session.deviceToken) throw new Error('No se creó la sesión.');
      const savedConsent = await appBackend.saveConsents(registered.session.deviceToken, mode === 'protected' ? protectedConsent : localConsent);
      const data = await appBackend.getClientDashboard(registered.session.deviceToken);
      setSession(registered.session);
      setDashboard({ ...data, consent: savedConsent });
      setModeOpen(false);
      setPendingCode('');
      setNotice({ tone: 'success', title: 'PC conectada', detail: 'Ya podés hablar con NEXO o abrir Herramientas.' });
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo activar', detail: friendlyError(error, 'Revisá el código y probá otra vez.') });
    } finally {
      setBusy('');
    }
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

  if (booting) return <main className="nc-app nc-loading"><NexoMark size={42} /><b>Abriendo NEXO</b><i /></main>;

  return (
    <main className="nc-app">
      <header className="nc-topbar" data-tauri-drag-region>
        <div className="nc-brand" data-tauri-drag-region>
          <NexoMark size={23} />
          <span><b>NEXO</b><small>Support</small></span>
        </div>
        <span className={`nc-live ${health.tone}`} data-tauri-drag-region><i />{active ? runtimeLabel : 'SIN ACTIVAR'}</span>
        <div className="nc-window-actions">
          <button aria-label="Menú" onClick={() => setMenuOpen((value) => !value)}><Menu size={16} /></button>
          <button aria-label="Minimizar" onClick={() => void safeInvoke('minimize_main_window')}><Minus size={15} /></button>
          <button aria-label="Cerrar NEXO" onClick={() => void safeInvoke('exit_app')}><X size={15} /></button>
        </div>
        {menuOpen && (
          <nav className="nc-menu">
            <button onClick={() => void openAdmin()}><Settings2 size={16} /> Administración <ChevronRight size={15} /></button>
            <button onClick={() => { setMenuOpen(false); window.dispatchEvent(new Event('nexo:check-update')); }}><RefreshCw size={16} /> Buscar actualización</button>
            <button className="danger" onClick={() => void safeInvoke('exit_app')}><Power size={16} /> Cerrar NEXO</button>
          </nav>
        )}
      </header>

      {active && (
        <nav className="nc-view-switch" aria-label="Secciones">
          <button className={view === 'assistant' ? 'active' : ''} onClick={() => setView('assistant')}>
            <MessageCircle size={16} /> Asistente
          </button>
          <button className={view === 'tools' ? 'active' : ''} onClick={() => setView('tools')}>
            <LayoutGrid size={16} /> Herramientas
          </button>
        </nav>
      )}

      {busy && <div className="nc-progress" role="status"><i /><span>{busy}</span></div>}

      {notice && (
        <div className={`nc-toast ${notice.tone}`} role="status" aria-live="polite">
          {notice.tone === 'error' || notice.tone === 'warning' ? <AlertTriangle size={17} /> : <Check size={17} />}
          <span><b>{notice.title}</b>{notice.detail && <small>{notice.detail}</small>}</span>
          <button aria-label="Cerrar aviso" onClick={() => setNotice(null)}><X size={14} /></button>
        </div>
      )}

      {!active ? (
        <section className="nc-activate">
          <NexoMark size={52} />
          <h1>Conectá esta PC</h1>
          <p>Ingresá el código de NEXO para activar el asistente y las herramientas locales.</p>
          <form onSubmit={(event) => {
            event.preventDefault();
            const value = code.trim().toUpperCase();
            if (value.length >= 4) {
              setPendingCode(value);
              setModeOpen(true);
            }
          }}>
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Código de activación" autoComplete="off" />
            <button disabled={code.trim().length < 4 || Boolean(busy)}>Continuar</button>
          </form>
        </section>
      ) : view === 'assistant' ? (
        <section className="nc-chat-view">
          <header className="nc-chat-status">
            <span className={`nc-avatar ${health.tone}`}><Bot size={19} /></span>
            <div>
              <b>NEXO está listo</b>
              <small>{health.title} · {lastCheckLabel(report)}</small>
            </div>
            <button aria-label="Revisar esta PC" title="Revisar esta PC" onClick={() => void launchTool('run_quick_diagnostic')} disabled={Boolean(busy)}>
              <Gauge size={17} />
            </button>
          </header>

          <div className="nc-thread" ref={threadRef}>
            {messages.map((message) => (
              <article key={message.id} className={`nc-message ${message.role} ${message.tone || ''}`}>
                {message.role === 'assistant' && <span className="nc-message-avatar"><NexoMark size={15} /></span>}
                <p>{message.text}</p>
              </article>
            ))}

            {messages.length === 1 && !busy && (
              <div className="nc-quick-prompts">
                {quickPrompts.map((prompt) => <button key={prompt} onClick={() => void sendText(prompt)}>{prompt}</button>)}
              </div>
            )}

            {pendingAction && (
              <section className="nc-chat-confirm">
                <div><Wrench size={17} /><span><b>{TOOL_CATALOG[pendingAction.id].label}</b><small>Esta acción modifica el sistema y requiere tu autorización.</small></span></div>
                <footer>
                  <button onClick={cancelPendingAction}>Cancelar</button>
                  <button onClick={() => void confirmPendingAction()}>Confirmar</button>
                </footer>
              </section>
            )}

            {busy && (
              <article className="nc-message assistant nc-typing">
                <span className="nc-message-avatar"><NexoMark size={15} /></span>
                <p><i /><i /><i /></p>
              </article>
            )}
          </div>

          <form className="nc-composer" onSubmit={(event) => void send(event)}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Escribí qué pasa con tu PC…"
              disabled={Boolean(busy)}
            />
            <button aria-label="Enviar" disabled={!input.trim() || Boolean(busy)}><Send size={18} /></button>
          </form>
        </section>
      ) : (
        <section className="nc-tools-view">
          <header className="nc-tools-summary">
            <div>
              <small>ESTADO ACTUAL</small>
              <b>{health.title}</b>
              <span>{health.detail}</span>
            </div>
            <button onClick={() => setPanel('details')}>Ver estado</button>
          </header>

          <div className="nc-tool-groups">
            {toolGroups.map((group) => (
              <section key={group.title} className="nc-tool-group">
                <h2>{group.title}</h2>
                <div>
                  {group.items.map((item) => (
                    <ToolButton
                      key={item.id}
                      icon={item.icon}
                      title={item.title}
                      detail={item.detail}
                      onClick={() => void launchTool(item.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <footer className="nc-tools-footer">
            <button onClick={() => setPanel('temperature')}><Thermometer size={15} /> Ver sensores</button>
            <button onClick={() => setPanel('support')}><Headphones size={15} /> Soporte remoto</button>
            <span>v{APP_VERSION}</span>
          </footer>
        </section>
      )}

      {modeOpen && (
        <div className="nc-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModeOpen(false); }}>
          <section className="nc-sheet nc-mode-sheet">
            <header><div><small>CONFIGURACIÓN INICIAL</small><h2>¿Cómo querés usar NEXO?</h2></div><button aria-label="Cerrar" onClick={() => setModeOpen(false)}><X size={18} /></button></header>
            <div className="nc-mode-actions">
              <button onClick={() => void activate('protected')}><ShieldCheck /><span><b>Proteger esta PC</b><small>Asistente conectado, diagnósticos y soporte técnico.</small></span><ChevronRight /></button>
              <button onClick={() => void activate('local')}><Gauge /><span><b>Solo herramientas locales</b><small>Las revisiones quedan guardadas en este equipo.</small></span><ChevronRight /></button>
            </div>
          </section>
        </div>
      )}

      {panel && (
        <div className="nc-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPanel(null); }}>
          <section className={`nc-sheet nc-${panel}-sheet`}>
            <header>
              <div>
                <small>{panel === 'temperature' ? 'SENSORES' : panel === 'support' ? 'ESCRITORIO REMOTO' : 'ESTADO'}</small>
                <h2>{panel === 'temperature' ? 'Temperatura del equipo' : panel === 'support' ? 'Soporte remoto' : 'Estado completo'}</h2>
              </div>
              <button aria-label="Cerrar" onClick={() => setPanel(null)}><X size={18} /></button>
            </header>

            {panel === 'temperature' && (
              <div className="nc-temperature-panel">
                <div className={`nc-temperature-value ${temperature.tone}`}>
                  <span className="nc-temperature-icon"><Thermometer /></span>
                  <div><small>LECTURA MÁS ALTA</small><strong>{temperature.value}</strong><p>{temperature.label}</p></div>
                </div>

                {temperatureReadings.length ? (
                  <div className="nc-temperature-grid">
                    {temperatureReadings.map((item) => <Value key={item.label} label={item.label} value={`${Math.round(item.value)} °C`} />)}
                    {summary?.fanRpm != null && <Value label="Ventilador" value={`${Math.round(summary.fanRpm)} RPM`} />}
                  </div>
                ) : (
                  <div className="nc-empty-state">
                    <Thermometer size={22} />
                    <div>
                      <b>{hardware?.permissionRequired ? 'Falta autorización para algunos sensores' : hardware ? 'No encontramos una temperatura compatible' : 'Todavía no se hizo una lectura'}</b>
                      <p>{hardware?.note || 'NEXO puede revisar CPU, GPU, discos y placa madre.'}</p>
                    </div>
                  </div>
                )}

                <div className="nc-source-row"><span>Método</span><b>{summary?.sourceLabel || 'Todavía sin lectura'}</b></div>
                <button className="nc-primary" onClick={() => void readTemperature(Boolean(hardware?.permissionRequired))} disabled={Boolean(busy)}>
                  {hardware?.permissionRequired ? 'Reintentar como administrador' : 'Buscar sensores'}
                </button>
              </div>
            )}

            {panel === 'support' && (
              <div className="nc-support-panel">
                <div className={`nc-remote-state ${remoteTool?.installed ? 'ready' : 'missing'}`}>
                  <Headphones size={21} />
                  <div><b>{remoteTool?.installed ? 'RustDesk detectado' : 'RustDesk no está instalado'}</b><p>{remoteTool?.message || 'NEXO comprueba si el cliente está instalado.'}</p></div>
                </div>
                {supportCode && <div className="nc-support-code"><span>Código de solicitud</span><strong>{supportCode}</strong><small>Compartilo con el técnico.</small></div>}
                <button className="nc-primary" onClick={() => void openRemoteNow()} disabled={Boolean(busy) || !remoteTool?.installed}>{remoteTool?.installed ? 'Abrir RustDesk' : 'RustDesk no disponible'}</button>
                <p className="nc-panel-note">La conexión nunca empieza sola: vos aceptás el acceso desde RustDesk.</p>
              </div>
            )}

            {panel === 'details' && (
              <div className="nc-detail-list">
                <Value label="Sistema" value={report?.os || 'Sin dato'} />
                <Value label="Procesador" value={report?.cpu || 'Sin dato'} />
                <Value label="Memoria usada" value={ramUsed != null ? `${ramUsed}%` : 'Sin dato'} />
                <Value label="Espacio libre" value={diskFree != null ? `${diskFree} GB` : 'Sin dato'} />
                <Value label="Programas al iniciar" value={report ? String(report.startupItems) : 'Sin dato'} />
                <Value label="Reinicio pendiente" value={report?.pendingReboot ? 'Sí' : 'No'} />
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function ToolButton({ icon, title, detail, onClick }: { icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button className="nc-tool-button" onClick={onClick}>
      <span>{icon}</span>
      <div><b>{title}</b><small>{detail}</small></div>
      <ChevronRight size={15} />
    </button>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><b>{value}</b></div>;
}
