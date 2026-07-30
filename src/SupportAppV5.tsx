import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Gauge,
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
import { requestAssistant, TOOL_CATALOG } from './lib/assistant';
import type { AssistantToolId, ProviderMessage } from './lib/assistant';
import { readHardwareSensors, summarizeHardware } from './lib/sensors';
import type { HardwareSnapshot } from './lib/sensors';
import { getRemoteToolStatus, openRemoteTool } from './lib/support';
import type { RemoteToolStatus } from './lib/support';
import {
  ageLabel,
  isFresh,
  networkRecord,
  optimizerRecord,
  overviewRecord,
  recordChatText,
  securityRecord,
  startupRecord,
  temperatureRecord
} from './lib/tool-evidence';
import type { CleanupPayload, EvidenceTone, ToolId, ToolRecord } from './lib/tool-evidence';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type Mode = 'protected' | 'local';
type View = 'assistant' | 'tools';
type Notice = { tone: EvidenceTone; title: string; detail?: string };
type ChatMessage = { id: string; role: 'assistant' | 'user'; text: string; tone?: EvidenceTone };
type PendingAction = {
  id: 'clean_temp_files' | 'repair_network' | 'defender_quick_scan' | 'windows_update';
  title: string;
  description: string;
};
type DirectIntent = ToolId | 'clean' | 'repair' | null;

const protectedConsent: UpdateConsentInput = { assistantEnabled: true, shareDiagnostics: true, automaticChecks: false, hardwareSensors: true, elevatedSensors: false };
const localConsent: UpdateConsentInput = { assistantEnabled: false, shareDiagnostics: false, automaticChecks: false, hardwareSensors: true, elevatedSensors: false };
const quickPrompts = ['Revisá mi PC', '¿Qué está usando recursos?', 'Revisá la temperatura', 'Quiero optimizar'];

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
  const gradientId = `nexo-v5-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 62 54" aria-hidden="true">
      <defs><linearGradient id={gradientId} x1="4" y1="4" x2="58" y2="50" gradientUnits="userSpaceOnUse"><stop stopColor="#7557ff" /><stop offset=".55" stopColor="#5e5eea" /><stop offset="1" stopColor="#2d88df" /></linearGradient></defs>
      <path d="M4 4h13.4L31 20.8 44.6 4H58L38.1 27 58 50H44.6L31 33.2 17.4 50H4l19.9-23z" fill={`url(#${gradientId})`} />
    </svg>
  );
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/tard[oó] demasiado|timeout|tiempo de espera/i.test(message)) return 'La tarea tardó demasiado y fue detenida. Probá nuevamente.';
  if (/permission|denied|rechaz|autorización/i.test(message)) return 'La autorización fue cancelada o Windows bloqueó el acceso.';
  if (/fetch|network|internet|supabase|rpc/i.test(message)) return 'El servicio conectado no está disponible. Las herramientas locales siguen funcionando.';
  return message || fallback;
}

function createMessage(role: ChatMessage['role'], text: string, tone?: EvidenceTone): ChatMessage {
  return { id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`, role, text, tone };
}

function inferIntent(text: string): DirectIntent {
  const value = text.toLowerCase();
  if (/optimizar ahora|limpi(a|á|ar) ahora|borr(a|á|ar) temporales/.test(value)) return 'clean';
  if (/reparar (internet|red|conexi[oó]n)|arreglar (internet|red)/.test(value)) return 'repair';
  if (/temperatura|calor|caliente|sensores/.test(value)) return 'temperature';
  if (/internet|wifi|wi-fi|dns|gateway|conexi[oó]n|red/.test(value)) return 'network';
  if (/seguridad|defender|antivirus|malware|virus/.test(value)) return 'security';
  if (/inicio|arranca|encender|programas al iniciar/.test(value)) return 'startup';
  if (/optimizar|basura|temporales|liberar espacio|disco lleno|limpiar/.test(value)) return 'optimizer';
  if (/rustdesk|escritorio remoto|soporte remoto|t[eé]cnico|persona/.test(value)) return 'remote';
  if (/revis|diagn[oó]stico|rendimiento|recursos|ram|memoria|cpu|lenta|lento|colgada|congela|pc|equipo/.test(value)) return 'overview';
  return null;
}

export default function SupportAppV5() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [dashboard, setDashboard] = useState<ClientDashboard | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null);
  const [remoteTool, setRemoteTool] = useState<RemoteToolStatus | null>(null);
  const [supportCode, setSupportCode] = useState('');
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
  const [chatPending, setChatPending] = useState<PendingAction | null>(null);
  const [toolPending, setToolPending] = useState<PendingAction | null>(null);
  const [providerMessages, setProviderMessages] = useState<ProviderMessage[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    createMessage('assistant', 'Hola. Soy NEXO. Contame qué pasa con tu PC. Voy a usar datos reales y te voy a mostrar qué encontré antes de cambiar nada.')
  ]);
  const [optimizerPhase, setOptimizerPhase] = useState<'idle' | 'scanning' | 'ready' | 'cleaning' | 'done'>('idle');
  const threadRef = useRef<HTMLDivElement | null>(null);

  const device = dashboard?.device ?? null;
  const consent = dashboard?.consent ?? null;
  const active = Boolean(session?.deviceToken && device);
  const hardwareSummary = useMemo(() => hardware ? summarizeHardware(hardware) : null, [hardware]);
  const currentOverview = records.overview || (report ? overviewRecord(report, hardwareSummary) : null);

  function pushMessage(role: ChatMessage['role'], text: string, tone?: EvidenceTone) {
    setMessages((current) => [...current, createMessage(role, text, tone)]);
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
          saveRecord(overviewRecord(latest, latest.hardware ? summarizeHardware(latest.hardware) : null));
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
    const timer = window.setTimeout(() => setNotice(null), notice.tone === 'error' ? 9000 : 5200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (view !== 'assistant') return;
    const timer = window.setTimeout(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' }), 25);
    return () => window.clearTimeout(timer);
  }, [messages, chatPending, busy, view]);

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
      setReport(nextReport);
      if (nextHardware) {
        setHardware(nextHardware);
        saveRecord(temperatureRecord(nextHardware));
      }
      const record = saveRecord(overviewRecord(nextReport, nextHardware ? summarizeHardware(nextHardware) : null));
      if (consent?.shareDiagnostics) {
        void appBackend.saveDiagnostic({ deviceId: device.id, payload: { ...nextReport, hardware: nextHardware } }, session.deviceToken).catch(() => undefined);
      }
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

  async function runReadTool(id: 'network' | 'security' | 'startup', force = false) {
    const cached = records[id];
    if (!force && cached && isFresh(cached.checkedAt)) return cached;
    const action = id === 'network' ? 'network_check' : id === 'security' ? 'defender_status' : 'startup_review';
    const label = id === 'network' ? 'Revisando Internet' : id === 'security' ? 'Revisando seguridad' : 'Revisando inicio';
    setBusy(label);
    try {
      const result = await withTimeout(runAgentAction(action), 45000, `${label} tardó demasiado.`);
      return saveRecord(id === 'network' ? networkRecord(result) : id === 'security' ? securityRecord(result) : startupRecord(result));
    } finally { setBusy(''); }
  }

  async function scanOptimizer(force = false) {
    const cached = records.optimizer;
    if (!force && cached && optimizerPhase !== 'done' && isFresh(cached.checkedAt)) return cached;
    setOptimizerPhase('scanning');
    setBusy('Buscando basura segura');
    try {
      const result = await withTimeout(runAgentAction('temp_scan'), 90000, 'El análisis de temporales tardó demasiado.');
      const record = saveRecord(optimizerRecord(result, false));
      setOptimizerPhase('ready');
      return record;
    } finally { setBusy(''); }
  }

  async function cleanOptimizer() {
    setOptimizerPhase('cleaning');
    setBusy('NEXO está optimizando');
    const started = Date.now();
    try {
      const result = await withTimeout(runAgentAction('clean_temp_files'), 150000, 'La optimización tardó demasiado.');
      const remainingAnimation = Math.max(0, 2600 - (Date.now() - started));
      if (remainingAnimation) await new Promise((resolve) => window.setTimeout(resolve, remainingAnimation));
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

  async function prepareRemoteSupport() {
    if (!session?.deviceToken || !device) throw new Error('Esta PC todavía no está conectada.');
    setBusy('Preparando soporte remoto');
    try {
      const status = await getRemoteToolStatus();
      setRemoteTool(status);
      if (!status.installed) {
        setNotice({ tone: 'warning', title: 'RustDesk no está instalado', detail: 'NEXO no va a instalar una herramienta remota sin permiso.' });
        return;
      }
      const ticket = await appBackend.createTicket({ deviceId: device.id, issue: 'Soporte remoto solicitado desde NEXO', clientName: device.displayName, priority: 'normal' }, session.deviceToken);
      const remote = await appBackend.createRemoteSession({ deviceId: device.id, ticketId: ticket.id }, session.deviceToken);
      setSupportCode(remote.code);
      const opened = await openRemoteTool();
      setRemoteTool(opened);
      setNotice({ tone: 'success', title: 'RustDesk abierto', detail: `Solicitud ${remote.code} creada. Compartí el ID visible de RustDesk con el técnico y aceptá la conexión.` });
    } finally { setBusy(''); }
  }

  async function executePending(action: PendingAction, destination: 'chat' | 'tools') {
    if (destination === 'chat') setChatPending(null);
    else setToolPending(null);
    try {
      if (action.id === 'clean_temp_files') {
        const record = await cleanOptimizer();
        if (destination === 'chat') pushMessage('assistant', recordChatText(record), 'success');
        else setNotice({ tone: 'success', title: record.title, detail: record.summary });
        return;
      }
      setBusy(action.title);
      const result = await withTimeout(runAgentAction(action.id), 90000, `${action.title} tardó demasiado.`);
      if (destination === 'chat') pushMessage('assistant', result.message, result.ok ? 'success' : 'warning');
      else setNotice({ tone: result.ok ? 'success' : 'warning', title: result.ok ? 'Acción terminada' : 'No se pudo completar', detail: result.message });
    } catch (error) {
      const detail = friendlyError(error, 'No se pudo completar la acción.');
      if (destination === 'chat') pushMessage('assistant', detail, 'warning');
      else setNotice({ tone: 'error', title: 'No se pudo completar', detail });
    } finally { setBusy(''); }
  }

  async function getRecordForIntent(intent: ToolId) {
    if (intent === 'overview') return runOverview(false);
    if (intent === 'temperature') return runTemperature(false, false);
    if (intent === 'network' || intent === 'security' || intent === 'startup') return runReadTool(intent, false);
    if (intent === 'optimizer') return scanOptimizer(false);
    if (intent === 'remote') {
      const status = await refreshRemote();
      return {
        id: 'remote', checkedAt: new Date().toISOString(), ok: status.installed,
        title: status.installed ? 'RustDesk detectado' : 'RustDesk no instalado',
        summary: status.installed ? `Está instalado en ${status.path || 'este equipo'}. NEXO puede abrirlo, pero la conexión siempre requiere tu aceptación.` : 'No encontré RustDesk instalado. NEXO no instala herramientas remotas sin permiso.',
        rows: status.path ? [{ label: 'Ubicación', value: status.path, tone: 'info' as const }] : [], raw: status
      } satisfies ToolRecord;
    }
    throw new Error('Herramienta desconocida.');
  }

  async function handleDirectIntent(intent: DirectIntent) {
    if (!intent) return false;
    if (intent === 'clean') {
      const optimizer = records.optimizer;
      if (!optimizer || optimizerPhase !== 'ready' || !isFresh(optimizer.checkedAt)) {
        const scan = await scanOptimizer(false);
        pushMessage('assistant', `${recordChatText(scan)}\n\nAhora podés confirmar la optimización.`, 'info');
      }
      setChatPending({ id: 'clean_temp_files', title: 'Optimizar ahora', description: 'Se borrarán solo temporales de la lista blanca. Cookies, sesiones, perfiles, historial y contraseñas quedan excluidos.' });
      return true;
    }
    if (intent === 'repair') {
      setChatPending({ id: 'repair_network', title: 'Reparar Internet', description: 'Se limpiará la caché DNS. No se cambia el router ni la contraseña Wi‑Fi.' });
      return true;
    }
    const record = await getRecordForIntent(intent);
    pushMessage('assistant', recordChatText(record), record.ok ? 'success' : 'warning');
    if (intent === 'optimizer' && ((record.raw as CleanupPayload | undefined)?.totalBytes ?? 0) > 0) {
      setChatPending({ id: 'clean_temp_files', title: 'Optimizar ahora', description: 'La limpieza usa una lista blanca y excluye todos los datos de navegadores.' });
    }
    if (intent === 'temperature' && !record.ok && (hardware?.permissionRequired || (record.raw as HardwareSnapshot | undefined)?.permissionRequired)) {
      pushMessage('assistant', 'La lectura normal no alcanzó. En Herramientas → Temperatura podés reintentar como administrador; Windows va a mostrar la autorización antes de acceder.', 'info');
    }
    return true;
  }

  async function handleAssistantTool(name: AssistantToolId) {
    if (name === 'clean_temp_files') {
      setChatPending({ id: 'clean_temp_files', title: TOOL_CATALOG[name].label, description: TOOL_CATALOG[name].description });
      return;
    }
    if (name === 'repair_network') {
      setChatPending({ id: 'repair_network', title: TOOL_CATALOG[name].label, description: TOOL_CATALOG[name].description });
      return;
    }
    if (name === 'defender_quick_scan') {
      setChatPending({ id: 'defender_quick_scan', title: TOOL_CATALOG[name].label, description: TOOL_CATALOG[name].description });
      return;
    }
    if (name === 'open_windows_update') {
      setChatPending({ id: 'windows_update', title: TOOL_CATALOG[name].label, description: TOOL_CATALOG[name].description });
      return;
    }
    const mapped: ToolId = name === 'run_quick_diagnostic' ? 'overview' : name === 'network_check' ? 'network' : name === 'defender_status' ? 'security' : name === 'startup_review' ? 'startup' : name === 'scan_temp_files' ? 'optimizer' : 'remote';
    const record = await getRecordForIntent(mapped);
    pushMessage('assistant', recordChatText(record), record.ok ? 'success' : 'warning');
  }

  async function sendText(value: string) {
    const trimmed = value.trim();
    if (!trimmed || busy || !session?.deviceToken) return;
    setInput('');
    setView('assistant');
    pushMessage('user', trimmed);
    setBusy('Pensando');
    try {
      const intent = inferIntent(trimmed);
      if (intent) {
        setBusy('');
        await handleDirectIntent(intent);
        return;
      }
      const userMessage: ProviderMessage = { role: 'user', content: trimmed };
      const history = [...providerMessages, userMessage];
      setProviderMessages(history);
      const response = await requestAssistant({ deviceToken: session.deviceToken, messages: history, diagnostic: consent?.shareDiagnostics ? report : null, hardware: consent?.shareDiagnostics ? hardwareSummary : null, appVersion: APP_VERSION });
      setProviderMessages([...history, response.message]);
      const call = response.message.tool_calls?.[0];
      if (call) {
        setBusy('');
        await handleAssistantTool(call.function.name);
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
        <div className="nx-window-actions"><button aria-label="Menú" onClick={() => setMenuOpen((value) => !value)}><Menu size={16} /></button><button aria-label="Minimizar" onClick={() => void safeInvoke('minimize_main_window')}><Minus size={15} /></button><button aria-label="Cerrar NEXO" onClick={() => void safeInvoke('exit_app')}><X size={15} /></button></div>
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
            {chatPending && <InlineConfirmation action={chatPending} busy={Boolean(busy)} onCancel={() => { setChatPending(null); pushMessage('assistant', 'No hice ningún cambio.', 'info'); }} onConfirm={() => void executePending(chatPending, 'chat')} />}
            {busy && <article className="nx-message assistant nx-typing"><span><NexoMark size={15} /></span><p><i /><i /><i /></p></article>}
          </div>
          <form className="nx-composer" onSubmit={(event) => void send(event)}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Contame qué pasa con tu PC…" disabled={Boolean(busy)} /><button aria-label="Enviar" disabled={!input.trim() || Boolean(busy)}><Send size={18} /></button></form>
        </section>
      ) : (
        <section className="nx-tools">
          {!selectedTool ? (
            <><header className="nx-tools-head"><div><small>HERRAMIENTAS</small><h1>Revisar y resolver</h1><p>Primero ves el último estado. El análisis corre solamente cuando lo pedís.</p></div></header><div className="nx-tool-list">{toolDefinitions.map((tool) => { const record = records[tool.id]; const status = tool.id === 'remote' ? remoteTool?.installed ? 'Instalado' : 'No instalado' : record ? ageLabel(record.checkedAt) : 'Sin analizar'; return <button key={tool.id} className={tool.id === 'optimizer' ? 'featured' : ''} onClick={() => { setSelectedTool(tool.id); setToolPending(null); }}><span>{tool.icon}</span><div><b>{tool.title}</b><small>{tool.detail}</small></div><em>{status}</em><ChevronRight size={16} /></button>; })}</div><footer className="nx-tools-note"><ShieldCheck size={15} /><span>NEXO no ejecuta cambios sin confirmación.</span><b>v{APP_VERSION}</b></footer></>
          ) : (
            <ToolDetail
              id={selectedTool}
              record={records[selectedTool]}
              remoteTool={remoteTool}
              supportCode={supportCode}
              optimizerPhase={optimizerPhase}
              busy={Boolean(busy)}
              hardware={hardware}
              pending={toolPending}
              onBack={() => { setSelectedTool(null); setToolPending(null); }}
              onAnalyze={async (elevated = false) => {
                try {
                  if (selectedTool === 'overview') await runOverview(true);
                  else if (selectedTool === 'temperature') await runTemperature(elevated, true);
                  else if (selectedTool === 'network' || selectedTool === 'security' || selectedTool === 'startup') await runReadTool(selectedTool, true);
                  else if (selectedTool === 'optimizer') await scanOptimizer(true);
                  else await refreshRemote();
                } catch (error) { setNotice({ tone: 'error', title: 'No se pudo completar', detail: friendlyError(error, 'Probá nuevamente.') }); }
              }}
              onExplain={() => { const record = records[selectedTool]; if (record) { setView('assistant'); setSelectedTool(null); pushMessage('assistant', recordChatText(record), record.ok ? 'success' : 'warning'); } }}
              onRequestOptimize={() => setToolPending({ id: 'clean_temp_files', title: 'Optimizar ahora', description: 'Se borrarán solo temporales de la lista blanca. Navegadores, sesiones, cookies, perfiles, historial y contraseñas quedan excluidos.' })}
              onConfirm={() => { if (toolPending) void executePending(toolPending, 'tools'); }}
              onCancel={() => setToolPending(null)}
              onRemote={() => void prepareRemoteSupport()}
            />
          )}
        </section>
      )}

      {modeOpen && <div className="nx-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModeOpen(false); }}><section className="nx-dialog"><header><div><small>CONFIGURACIÓN INICIAL</small><h2>¿Cómo querés usar NEXO?</h2></div><button aria-label="Cerrar" onClick={() => setModeOpen(false)}><X size={18} /></button></header><div className="nx-mode-actions"><button onClick={() => void activate('protected')}><ShieldCheck /><span><b>Proteger esta PC</b><small>Asistente conectado, diagnósticos y soporte técnico.</small></span><ChevronRight /></button><button onClick={() => void activate('local')}><Gauge /><span><b>Solo herramientas locales</b><small>Todo queda guardado en este equipo.</small></span><ChevronRight /></button></div></section></div>}
    </main>
  );
}

function InlineConfirmation({ action, busy, onCancel, onConfirm }: { action: PendingAction; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <section className="nx-confirm"><div><Wrench size={18} /><span><b>{action.title}</b><small>{action.description}</small></span></div><footer><button onClick={onCancel} disabled={busy}>Cancelar</button><button onClick={onConfirm} disabled={busy}>Confirmar</button></footer></section>;
}

function ToolDetail({ id, record, remoteTool, supportCode, optimizerPhase, busy, hardware, pending, onBack, onAnalyze, onExplain, onRequestOptimize, onConfirm, onCancel, onRemote }: {
  id: ToolId;
  record?: ToolRecord;
  remoteTool: RemoteToolStatus | null;
  supportCode: string;
  optimizerPhase: 'idle' | 'scanning' | 'ready' | 'cleaning' | 'done';
  busy: boolean;
  hardware: HardwareSnapshot | null;
  pending: PendingAction | null;
  onBack: () => void;
  onAnalyze: (elevated?: boolean) => Promise<void>;
  onExplain: () => void;
  onRequestOptimize: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRemote: () => void;
}) {
  const definition = toolDefinitions.find((tool) => tool.id === id)!;
  const temperatureNeedsAdmin = id === 'temperature' && hardware?.permissionRequired && !record?.ok;
  const optimizerData = id === 'optimizer' ? record?.raw as CleanupPayload | undefined : undefined;
  const canOptimize = id === 'optimizer' && optimizerPhase === 'ready' && (optimizerData?.totalBytes ?? 0) > 0;

  return (
    <div className="nx-detail">
      <header><button aria-label="Volver" onClick={onBack}><ArrowLeft size={17} /></button><span>{definition.icon}</span><div><small>{ageLabel(record?.checkedAt)}</small><h1>{definition.title}</h1><p>{definition.detail}</p></div></header>
      {id === 'optimizer' && (optimizerPhase === 'scanning' || optimizerPhase === 'cleaning') ? <RocketStage cleaning={optimizerPhase === 'cleaning'} /> : id === 'remote' ? (
        <section className="nx-remote-card"><span className={remoteTool?.installed ? 'ready' : 'missing'}><Headphones size={24} /></span><div><small>CLIENTE REMOTO</small><h2>{remoteTool?.installed ? 'RustDesk detectado' : 'RustDesk no está instalado'}</h2><p>{remoteTool?.message || 'Todavía no se comprobó el cliente remoto.'}</p>{remoteTool?.path && <code>{remoteTool.path}</code>}{supportCode && <div className="nx-support-code"><span>Solicitud NEXO</span><strong>{supportCode}</strong></div>}</div></section>
      ) : record ? (
        <><section className={`nx-result ${record.ok ? 'success' : 'warning'}`}><span>{record.ok ? <Check size={20} /> : <AlertTriangle size={20} />}</span><div><h2>{record.title}</h2><p>{record.summary}</p></div></section>{record.rows.length > 0 && <div className="nx-data-list">{record.rows.map((row, index) => <div key={`${row.label}-${index}`}><span>{row.label}</span><b className={row.tone || ''}>{row.value}</b></div>)}</div>}</>
      ) : <section className="nx-empty"><span>{definition.icon}</span><h2>Todavía no hay datos</h2><p>NEXO no va a inventar un estado. Ejecutá el análisis cuando quieras comprobarlo.</p></section>}

      {id === 'optimizer' && record && <section className="nx-exclusions"><ShieldCheck size={17} /><div><b>Navegadores protegidos</b><p>No se borran cookies, sesiones, perfiles, historial, extensiones, contraseñas ni datos de formularios.</p></div></section>}
      {pending && <section className="nx-tool-confirm"><div><Wrench size={18} /><span><b>{pending.title}</b><small>{pending.description}</small></span></div><footer><button onClick={onCancel} disabled={busy}>Cancelar</button><button onClick={onConfirm} disabled={busy}>Confirmar</button></footer></section>}

      <footer className="nx-detail-actions">
        {id === 'remote' ? <><button className="secondary" onClick={() => void onAnalyze()} disabled={busy}>Volver a detectar</button><button onClick={onRemote} disabled={busy || !remoteTool?.installed}>{supportCode ? 'Abrir RustDesk otra vez' : 'Crear soporte y abrir'}</button></> : id === 'optimizer' ? <><button className="secondary" onClick={() => void onAnalyze()} disabled={busy}>{record ? 'Analizar de nuevo' : 'Analizar basura'}</button><button onClick={onRequestOptimize} disabled={busy || !canOptimize || Boolean(pending)}>{optimizerPhase === 'done' ? 'Optimización terminada' : 'Optimizar ahora'}</button></> : <><button className="secondary" onClick={() => void onAnalyze(temperatureNeedsAdmin)} disabled={busy}>{temperatureNeedsAdmin ? 'Reintentar como administrador' : record ? 'Actualizar análisis' : 'Analizar ahora'}</button><button onClick={onExplain} disabled={!record || busy}>Explicarlo en el chat</button></>}
      </footer>
    </div>
  );
}

function RocketStage({ cleaning }: { cleaning: boolean }) {
  return <section className="nx-rocket-stage"><div className="nx-stars"><i /><i /><i /><i /><i /></div><div className="nx-planet" /><div className="nx-rocket"><Rocket size={48} /><span /></div><div className="nx-rocket-copy"><small>{cleaning ? 'OPTIMIZANDO' : 'ANALIZANDO'}</small><h2>{cleaning ? 'Limpiando basura segura' : 'Calculando qué se puede limpiar'}</h2><p>{cleaning ? 'La nave está eliminando únicamente temporales autorizados.' : 'Nada se borra durante este paso.'}</p></div></section>;
}
