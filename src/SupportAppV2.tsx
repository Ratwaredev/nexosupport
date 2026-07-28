import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity,
  ArrowUpRight,
  Check,
  CircleAlert,
  Gauge,
  HardDrive,
  Headphones,
  Menu,
  Minus,
  Power,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Thermometer,
  Trash2,
  WifiOff,
  Wrench,
  X
} from 'lucide-react';
import { appBackend, backendConfig } from './lib/backend';
import type { AppSession, ClientDashboard, UpdateConsentInput } from './lib/domain';
import { APP_VERSION } from './lib/domain';
import { runQuickDiagnostic } from './lib/diagnostics';
import type { DiagnosticReport } from './lib/diagnostics';
import { getAgentStatus, runAgentAction } from './lib/agent';
import type { AgentActionResult, AgentStatus } from './lib/agent';
import { openRemoteTool } from './lib/support';
import { isTauriRuntime, safeInvoke } from './lib/tauri';
import { normalizeToolResult, requestAssistant, TOOL_CATALOG } from './lib/assistant';
import type {
  AssistantToolId,
  ProviderMessage,
  ProviderToolCall,
  ToolDefinition
} from './lib/assistant';
import { readHardwareSensors, summarizeHardware } from './lib/sensors';
import type { HardwareSnapshot, SensorSummary } from './lib/sensors';

type UseMode = 'protected' | 'local';
type Notice = { tone: 'info' | 'success' | 'error'; title: string; detail?: string };
type Inspection = { report: DiagnosticReport; hardware: HardwareSnapshot | null };
type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  report?: DiagnosticReport;
  hardware?: HardwareSnapshot;
  result?: AgentActionResult;
};
type Approval = { call: ProviderToolCall; tool: ToolDefinition };
type ToolResult = AgentActionResult | DiagnosticReport | HardwareSnapshot;

const MESSAGE_KEY = 'nexo.chat.v6';
const CONTEXT_KEY = 'nexo.context.v6';
const LAST_CHECK_KEY = 'nexo.last-check.v6';
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

const protectedConsent: UpdateConsentInput = {
  assistantEnabled: true,
  shareDiagnostics: true,
  automaticChecks: true,
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

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const welcome = (): Message => ({
  id: createId(),
  role: 'assistant',
  text: 'Hola. Contame qué pasa con esta PC.'
});

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || '') as T;
  } catch {
    return fallback;
  }
}

function fallbackDiagnostic(): DiagnosticReport {
  return {
    generatedAt: new Date().toISOString(),
    computerName: 'Mi PC',
    userName: 'Usuario',
    os: 'Windows',
    cpu: 'No detectado',
    ramTotalGb: 0,
    ramFreeGb: 0,
    systemDriveTotalGb: 0,
    systemDriveFreeGb: 0,
    startupItems: 0,
    defenderStatus: 'No revisado',
    pendingReboot: false,
    maxTemperatureC: null,
    temperatureNote: 'La revisión todavía no terminó.',
    thermalZones: [],
    recommendations: []
  };
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/timeout|tard[oó] demasiado|tiempo de espera/i.test(message)) {
    return 'La herramienta de Windows tardó demasiado. Cerré la espera para que NEXO no se bloquee.';
  }
  if (/supabase|service role|rpc|relation|column|schema cache/i.test(message)) {
    return 'NEXO no pudo usar el servidor. La app sigue abierta y no cambió nada.';
  }
  if (/network|fetch|internet|failed to fetch/i.test(message)) {
    return 'No pude conectarme con NEXO. Revisá Internet y probá otra vez.';
  }
  if (/código|codigo|pairing|venció|válido/i.test(message)) {
    return 'Ese código no funciona o ya fue usado. Pedí uno nuevo.';
  }
  if (/permission|acceso|denied|rechaz|autorización/i.test(message)) {
    return 'Windows no autorizó esa acción. No se cambió nada.';
  }
  return message || fallback;
}

function NexoMark({ size = 24 }: { size?: number }) {
  const gradientId = `nexo-v2-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 62 54" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="4" y1="4" x2="58" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8d3cff" />
          <stop offset=".5" stopColor="#5948ff" />
          <stop offset="1" stopColor="#168fff" />
        </linearGradient>
      </defs>
      <path d="M4 4h13.4L31 20.8 44.6 4H58L38.1 27 58 50H44.6L31 33.2 17.4 50H4l19.9-23z" fill={`url(#${gradientId})`} />
    </svg>
  );
}

export default function SupportAppV2() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [dashboard, setDashboard] = useState<ClientDashboard | null>(null);
  const [messages, setMessages] = useState<Message[]>(() => load(MESSAGE_KEY, [welcome()]));
  const [context, setContext] = useState<ProviderMessage[]>(() => load(CONTEXT_KEY, []));
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [code, setCode] = useState(backendConfig.backendKind === 'local' ? 'DEMO-PAIR' : '');
  const [pendingCode, setPendingCode] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState('');
  const [menu, setMenu] = useState(false);
  const [modePicker, setModePicker] = useState(false);
  const [modeError, setModeError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [plan, setPlan] = useState('ACTIVO');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lockRef = useRef(false);

  const device = dashboard?.device ?? null;
  const consent = dashboard?.consent ?? null;
  const active = session?.role === 'client' && Boolean(session.deviceToken) && Boolean(device);
  const summary = useMemo(() => hardware ? summarizeHardware(hardware) : null, [hardware]);
  const attention = useMemo(() => requiresAttention(report, summary), [report, summary]);
  const currentMode: UseMode = consent?.assistantEnabled ? 'protected' : 'local';
  const lastCheck = useMemo(() => formatLastCheck(report, hardware), [report, hardware]);

  const addAssistant = useCallback((text: string, inspection?: Inspection, result?: AgentActionResult) => {
    setMessages((current) => [...current, {
      id: createId(),
      role: 'assistant',
      text,
      report: inspection?.report,
      hardware: inspection?.hardware ?? undefined,
      result
    }]);
  }, []);

  const showError = useCallback((error: unknown, fallback: string) => {
    const detail = friendlyError(error, fallback);
    setNotice({ tone: 'error', title: 'No se pudo completar', detail });
    return detail;
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const restored = await withTimeout(appBackend.bootstrap('client'), 8000, 'NEXO tardó demasiado en abrir la sesión.');
        if (!mounted) return;
        setSession(restored);
        if (!restored?.deviceToken) return;
        const data = await withTimeout(appBackend.getClientDashboard(restored.deviceToken), 10000, 'NEXO tardó demasiado en cargar esta PC.');
        if (!mounted) return;
        setDashboard(data);
        setPlan(data.entitlement?.plan?.toUpperCase() || 'ACTIVO');
        const latest = data.diagnostics[0]?.payload as unknown as DiagnosticReport | undefined;
        if (latest?.generatedAt) setReport(latest);
        if (!data.consent) setModePicker(true);
      } catch (error) {
        if (mounted) showError(error, 'No pude abrir la sesión de esta PC.');
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    void getAgentStatus().then(setAgent).catch(() => setAgent(null));
    return () => { mounted = false; };
  }, [showError]);

  useEffect(() => {
    localStorage.setItem(MESSAGE_KEY, JSON.stringify(messages.slice(-40)));
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [messages, busy, approval]);

  useEffect(() => {
    localStorage.setItem(CONTEXT_KEY, JSON.stringify(context.slice(-24)));
  }, [context]);

  const collectInspection = useCallback(async (
    token: string,
    targetDevice: ClientDashboard['device'],
    shareDiagnostics: boolean,
    includeSensors = true
  ): Promise<Inspection> => {
    const nextReport = await withTimeout(
      runQuickDiagnostic(),
      15000,
      'El diagnóstico de Windows tardó demasiado.'
    );

    let nextHardware: HardwareSnapshot | null = null;
    if (includeSensors) {
      try {
        nextHardware = await withTimeout(
          readHardwareSensors(false),
          18000,
          'La lectura de temperatura tardó demasiado.'
        );
      } catch (error) {
        nextReport.temperatureNote = friendlyError(error, 'No pude leer la temperatura.');
      }
    }

    const nextSummary = nextHardware ? summarizeHardware(nextHardware) : null;
    const temperatures = [nextSummary?.cpuTemperatureC, nextSummary?.gpuTemperatureC]
      .filter((value): value is number => typeof value === 'number');
    if (temperatures.length) {
      nextReport.maxTemperatureC = Math.max(...temperatures);
      nextReport.temperatureNote = nextSummary?.note || nextReport.temperatureNote;
    }

    setReport(nextReport);
    setHardware(nextHardware);
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

    if (shareDiagnostics) {
      try {
        await withTimeout(
          appBackend.saveDiagnostic({
            deviceId: targetDevice.id,
            payload: { ...nextReport, hardware: nextHardware }
          }, token),
          8000,
          'No pude guardar el diagnóstico en NEXO.'
        );
      } catch (error) {
        setNotice({
          tone: 'info',
          title: 'La revisión terminó',
          detail: `${friendlyError(error, 'No pude compartir el resumen.')} Los resultados siguen visibles en esta PC.`
        });
      }
    }

    return { report: nextReport, hardware: nextHardware };
  }, []);

  useEffect(() => {
    if (!active || !session?.deviceToken || !device || !consent?.automaticChecks || !consent.hardwareSensors) return;
    const run = async () => {
      if (Date.now() - Number(localStorage.getItem(LAST_CHECK_KEY) || 0) < CHECK_INTERVAL) return;
      try {
        const inspection = await collectInspection(session.deviceToken!, device, consent.shareDiagnostics, true);
        const currentSummary = inspection.hardware ? summarizeHardware(inspection.hardware) : null;
        if (requiresAttention(inspection.report, currentSummary)) {
          addAssistant('Encontré algo que conviene revisar.', inspection);
        }
      } catch {
        // Una revisión automática nunca bloquea la app.
      }
    };
    const first = window.setTimeout(() => void run(), 5000);
    const interval = window.setInterval(() => void run(), CHECK_INTERVAL);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [active, session?.deviceToken, device, consent?.automaticChecks, consent?.hardwareSensors, consent?.shareDiagnostics, collectInspection, addAssistant]);

  function beginActivation() {
    const value = code.trim().toUpperCase();
    if (busy || value.length < 4) return;
    setPendingCode(value);
    setModeError('');
    setModePicker(true);
  }

  async function activate(mode: UseMode) {
    if (!pendingCode || lockRef.current) return;
    lockRef.current = true;
    const selected = mode === 'protected' ? protectedConsent : localConsent;
    setModeError('');
    setNotice(null);
    setBusy('Vinculando esta PC');

    try {
      let identity = fallbackDiagnostic();
      try {
        identity = await withTimeout(runQuickDiagnostic(), 6500, 'La identificación de Windows tardó demasiado.');
      } catch {
        // La activación debe continuar aunque Windows tarde en entregar datos técnicos.
      }

      const registered = await withTimeout(appBackend.registerClient({
        pairingCode: pendingCode,
        deviceName: identity.computerName || 'Mi PC',
        issue: 'Activación',
        computerName: identity.computerName || 'Equipo Windows',
        userName: identity.userName || 'Usuario',
        os: identity.os || 'Windows',
        platform: 'windows'
      }), 12000, 'NEXO tardó demasiado en validar el código.');

      const token = registered.session.deviceToken;
      if (!token) throw new Error('NEXO no devolvió una sesión para esta PC.');

      const savedConsent = await withTimeout(
        appBackend.saveConsents(token, selected),
        8000,
        'NEXO tardó demasiado en guardar el modo de uso.'
      );
      const data = await withTimeout(
        appBackend.getClientDashboard(token),
        10000,
        'NEXO tardó demasiado en cargar esta PC.'
      );

      const nextDashboard = { ...data, consent: savedConsent };
      setSession(registered.session);
      setDashboard(nextDashboard);
      setPlan(nextDashboard.entitlement?.plan?.toUpperCase() || 'ACTIVO');
      setPendingCode('');
      setModePicker(false);
      setMessages([{
        id: createId(),
        role: 'assistant',
        text: mode === 'protected'
          ? 'Listo. Esta PC quedó vinculada. Ahora la estoy revisando.'
          : 'Listo. Esta PC quedó vinculada en modo local. Ahora la estoy revisando.'
      }]);
      setContext([]);
      setNotice({ tone: 'success', title: 'PC vinculada', detail: 'Podés seguir usando NEXO mientras termina la revisión.' });

      setBusy('Revisando esta PC');
      try {
        const inspection = await collectInspection(token, nextDashboard.device, selected.shareDiagnostics, true);
        addAssistant(
          mode === 'protected'
            ? 'Revisión terminada. NEXO quedó activo.'
            : 'Revisión terminada. Los datos quedaron solo en esta PC.',
          inspection
        );
      } catch (error) {
        addAssistant(friendlyError(error, 'La PC quedó vinculada, pero no pude terminar la revisión.'));
      }
    } catch (error) {
      setModeError(friendlyError(error, 'No pude vincular esta PC.'));
    } finally {
      setBusy('');
      lockRef.current = false;
    }
  }

  async function changeMode(mode: UseMode) {
    if (pendingCode && !active) {
      await activate(mode);
      return;
    }
    if (!session?.deviceToken || !device || lockRef.current) {
      setModeError('No encontré la sesión de esta PC. Cerrá NEXO y volvé a abrirlo.');
      return;
    }

    lockRef.current = true;
    const selected = mode === 'protected' ? protectedConsent : localConsent;
    setModeError('');
    setBusy(mode === 'protected' ? 'Activando protección' : 'Cambiando a modo local');
    try {
      const saved = await withTimeout(
        appBackend.saveConsents(session.deviceToken, selected),
        8000,
        'NEXO tardó demasiado en cambiar el modo.'
      );
      setDashboard((current) => current ? { ...current, consent: saved } : current);
      setModePicker(false);
      setNotice({
        tone: 'success',
        title: mode === 'protected' ? 'Protección activada' : 'Modo local activado',
        detail: 'El cambio se aplicó. La revisión sigue abajo.'
      });
      setBusy('Revisando esta PC');
      const inspection = await collectInspection(session.deviceToken, device, selected.shareDiagnostics, true);
      addAssistant(
        mode === 'protected'
          ? 'NEXO quedó activo y la revisión terminó.'
          : 'Modo local activado. La revisión no salió de esta PC.',
        inspection
      );
    } catch (error) {
      const detail = friendlyError(error, 'No pude cambiar el modo.');
      setModeError(detail);
      setNotice({ tone: 'error', title: 'No pude cambiar el modo', detail });
    } finally {
      setBusy('');
      lockRef.current = false;
    }
  }

  async function manualCheck() {
    if (!session?.deviceToken || !device || lockRef.current) {
      if (!active) setNotice({ tone: 'info', title: 'Primero vinculá esta PC', detail: 'Ingresá el código de activación.' });
      return;
    }
    lockRef.current = true;
    setBusy('Revisando esta PC');
    setNotice(null);
    try {
      const inspection = await collectInspection(
        session.deviceToken,
        device,
        consent?.shareDiagnostics ?? false,
        true
      );
      addAssistant('Revisión terminada.', inspection);
      setNotice({ tone: 'success', title: 'Revisión terminada', detail: 'Los resultados ya están visibles.' });
    } catch (error) {
      const detail = showError(error, 'No pude revisar esta PC.');
      addAssistant(detail);
    } finally {
      setBusy('');
      lockRef.current = false;
    }
  }

  async function readTemperature(elevated = false) {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(elevated ? 'Esperando permiso de Windows' : 'Leyendo temperatura');
    setNotice(null);
    try {
      const snapshot = await withTimeout(
        readHardwareSensors(elevated),
        elevated ? 90000 : 18000,
        'La lectura de temperatura tardó demasiado.'
      );
      setHardware(snapshot);
      const baseReport = report ?? await withTimeout(
        runQuickDiagnostic(),
        12000,
        'El diagnóstico de Windows tardó demasiado.'
      ).catch(() => fallbackDiagnostic());
      addAssistant(
        snapshot.sensors.length ? 'Lectura de temperatura terminada.' : snapshot.note,
        { report: baseReport, hardware: snapshot }
      );
      setNotice({
        tone: 'success',
        title: 'Temperatura revisada',
        detail: snapshot.sensors.length ? 'La lectura está visible en la conversación.' : snapshot.note
      });
    } catch (error) {
      const detail = showError(error, 'No pude leer la temperatura.');
      addAssistant(detail);
    } finally {
      setBusy('');
      lockRef.current = false;
    }
  }

  async function runSimpleTool(actionId: string, label: string): Promise<AgentActionResult> {
    if (lockRef.current) {
      return { action: actionId, ok: false, message: 'NEXO ya está trabajando.', details: [] };
    }
    lockRef.current = true;
    setBusy(label);
    setNotice(null);
    try {
      const result = await withTimeout(
        runAgentAction(actionId),
        20000,
        `${label} tardó demasiado.`
      );
      addAssistant(result.message, undefined, result);
      setNotice({
        tone: result.ok ? 'success' : 'error',
        title: result.ok ? 'Listo' : 'No se pudo completar',
        detail: result.message
      });
      return result;
    } catch (error) {
      const detail = showError(error, `No pude completar: ${label}.`);
      const result = { action: actionId, ok: false, message: detail, details: [] };
      addAssistant(detail, undefined, result);
      return result;
    } finally {
      setBusy('');
      lockRef.current = false;
    }
  }

  async function remoteSupport(): Promise<AgentActionResult> {
    if (!session?.deviceToken || !device) {
      return { action: 'remote_support', ok: false, message: 'Esta PC no está vinculada.', details: [] };
    }
    if (lockRef.current) {
      return { action: 'remote_support', ok: false, message: 'NEXO ya está trabajando.', details: [] };
    }

    lockRef.current = true;
    setBusy('Preparando asistencia');
    setNotice(null);
    try {
      const issue = [...messages].reverse().find((message) => message.role === 'user')?.text || 'Solicita asistencia técnica';
      const ticket = await withTimeout(appBackend.createTicket({
        deviceId: device.id,
        issue,
        clientName: device.displayName,
        priority: 'normal'
      }, session.deviceToken), 10000, 'NEXO tardó demasiado en crear la solicitud.');
      const remote = await withTimeout(appBackend.createRemoteSession({
        deviceId: device.id,
        ticketId: ticket.id
      }, session.deviceToken), 10000, 'NEXO tardó demasiado en preparar la asistencia.');

      try {
        await withTimeout(openRemoteTool(), 8000, 'La herramienta remota tardó demasiado en abrir.');
      } catch {
        // El ticket y el código siguen siendo válidos aunque RustDesk no esté instalado.
      }

      const result = {
        action: 'remote_support',
        ok: true,
        message: 'La solicitud quedó creada.',
        details: [`Código ${remote.code}`]
      };
      addAssistant(`La solicitud quedó creada. Código: ${remote.code}`, undefined, result);
      setNotice({ tone: 'success', title: 'Soporte preparado', detail: `Código ${remote.code}` });
      return result;
    } catch (error) {
      const detail = showError(error, 'No pude preparar la asistencia.');
      const result = { action: 'remote_support', ok: false, message: detail, details: [] };
      addAssistant(detail, undefined, result);
      return result;
    } finally {
      setBusy('');
      lockRef.current = false;
    }
  }

  async function executeTool(name: AssistantToolId): Promise<ToolResult> {
    if (name === 'run_quick_diagnostic') {
      await manualCheck();
      return report ?? fallbackDiagnostic();
    }
    if (name === 'remote_support') return remoteSupport();

    const actionMap: Record<Exclude<AssistantToolId, 'run_quick_diagnostic' | 'remote_support'>, string> = {
      network_check: 'network_check',
      scan_temp_files: 'scan_temp_files',
      startup_review: 'startup_review',
      defender_status: 'defender_status',
      clean_temp_files: 'clean_temp_files',
      repair_network: 'repair_network',
      defender_quick_scan: 'defender_quick_scan',
      open_windows_update: 'windows_update'
    };
    return runSimpleTool(actionMap[name], TOOL_CATALOG[name].progressLabel);
  }

  async function ask(currentContext: ProviderMessage[], depth = 0): Promise<void> {
    if (!session?.deviceToken || depth > 4) return;
    setBusy(depth ? 'Interpretando el resultado' : 'Buscando una solución');
    try {
      const response = await withTimeout(requestAssistant({
        deviceToken: session.deviceToken,
        messages: currentContext,
        diagnostic: consent?.shareDiagnostics ? report : null,
        hardware: consent?.shareDiagnostics ? summary : null,
        agentStatus: agent,
        appVersion: APP_VERSION
      }), 30000, 'NEXO tardó demasiado en responder.');

      if (response.entitlement?.plan) setPlan(response.entitlement.plan.toUpperCase());
      const assistantMessage = response.message;
      const nextContext = [...currentContext, assistantMessage].slice(-24);
      setContext(nextContext);
      if (assistantMessage.content) addAssistant(assistantMessage.content);

      const call = assistantMessage.tool_calls?.[0];
      if (!call) return;
      const tool = TOOL_CATALOG[call.function.name];
      if (!tool) {
        addAssistant('Esa acción no está disponible. No hice ningún cambio.');
        return;
      }
      if (tool.mode !== 'read') {
        setApproval({ call, tool });
        return;
      }

      setBusy('');
      const result = await executeTool(call.function.name);
      if (!consent?.shareDiagnostics) return;
      const toolMessage: ProviderMessage = {
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: normalizeToolResult(result)
      };
      const withTool = [...nextContext, toolMessage].slice(-24);
      setContext(withTool);
      await ask(withTool, depth + 1);
    } catch (error) {
      addAssistant(showError(error, 'NEXO no pudo responder.'));
    } finally {
      setBusy('');
    }
  }

  async function send(text: string) {
    const value = text.trim();
    if (!value || busy || approval || !active) return;
    if (!consent?.assistantEnabled) {
      setModeError('Para conversar, activá “Proteger esta PC”.');
      setModePicker(true);
      return;
    }
    setInput('');
    setMessages((current) => [...current, { id: createId(), role: 'user', text: value }]);
    const next = [...context, { role: 'user', content: value } as ProviderMessage].slice(-24);
    setContext(next);
    await ask(next);
  }

  async function approveAction() {
    if (!approval) return;
    const current = approval;
    setApproval(null);
    const result = await executeTool(current.call.function.name);
    if (!consent?.shareDiagnostics) return;
    const toolMessage: ProviderMessage = {
      role: 'tool',
      tool_call_id: current.call.id,
      name: current.call.function.name,
      content: normalizeToolResult(result)
    };
    const next = [...context, toolMessage].slice(-24);
    setContext(next);
    await ask(next, 1);
  }

  async function openAdmin() {
    setMenu(false);
    setNotice({ tone: 'info', title: 'Abriendo NEXO Control', detail: 'Esperá un segundo.' });
    try {
      if (!isTauriRuntime()) throw new Error('La administración se abre desde la aplicación de Windows.');
      await withTimeout(safeInvoke('open_admin_window'), 8000, 'NEXO Control tardó demasiado en abrir.');
      setNotice(null);
    } catch (error) {
      showError(error, 'No pude abrir NEXO Control.');
    }
  }

  async function hide() {
    try {
      if (isTauriRuntime()) await safeInvoke('hide_main_window');
    } catch (error) {
      showError(error, 'No pude ocultar NEXO.');
    }
  }

  async function minimize() {
    try {
      if (isTauriRuntime()) await safeInvoke('minimize_main_window');
    } catch (error) {
      showError(error, 'No pude minimizar NEXO.');
    }
  }

  async function exit() {
    try {
      if (isTauriRuntime()) await safeInvoke('exit_app');
    } catch (error) {
      showError(error, 'No pude cerrar NEXO.');
    }
  }

  if (booting) {
    return (
      <main className="nv2-app nv2-boot">
        <NexoMark size={40} />
        <b>Abriendo NEXO</b>
        <span />
      </main>
    );
  }

  return (
    <main className="nv2-app">
      <header className="nv2-topbar" data-tauri-drag-region>
        <div className="nv2-brand" data-tauri-drag-region>
          <NexoMark />
          <span><b>NEXO</b><small>Support</small></span>
        </div>
        <span className={`nv2-state ${attention ? 'warning' : ''}`} data-tauri-drag-region>
          <i />{active ? (attention ? 'REVISAR' : 'ACTIVO') : 'SIN ACTIVAR'}
        </span>
        <div className="nv2-window-buttons">
          <button type="button" aria-label="Menú" onClick={() => setMenu((value) => !value)}><Menu size={15} /></button>
          <button type="button" aria-label="Minimizar" onClick={() => void minimize()}><Minus size={14} /></button>
          <button type="button" aria-label="Ocultar" onClick={() => void hide()}><X size={14} /></button>
        </div>
        {menu && (
          <nav className="nv2-menu" aria-label="Menú de NEXO">
            <button type="button" onClick={() => { setMenu(false); void manualCheck(); }}><RefreshCw size={15} /> Revisar esta PC</button>
            <button type="button" onClick={() => { setMenu(false); setModeError(''); setModePicker(true); }}><ShieldCheck size={15} /> Modo de uso</button>
            <button type="button" onClick={() => void openAdmin()}><Settings2 size={15} /> Administración <ArrowUpRight size={13} /></button>
            <button type="button" onClick={() => { setMenu(false); window.dispatchEvent(new Event('nexo:check-update')); }}><RefreshCw size={15} /> Buscar actualización</button>
            <button type="button" onClick={() => { setMessages([welcome()]); setContext([]); setMenu(false); }}><Trash2 size={15} /> Nueva conversación</button>
            <button type="button" className="danger" onClick={() => void exit()}><Power size={15} /> Cerrar NEXO</button>
          </nav>
        )}
      </header>

      {notice && (
        <div className={`nv2-notice ${notice.tone}`} role="status">
          {notice.tone === 'success' ? <Check size={16} /> : notice.tone === 'error' ? <CircleAlert size={16} /> : <Activity size={16} />}
          <span><b>{notice.title}</b>{notice.detail && <small>{notice.detail}</small>}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}><X size={13} /></button>
        </div>
      )}

      <section className="nv2-content" ref={scrollRef}>
        {!active ? (
          <Activation />
        ) : (
          <>
            <StatusCard report={report} summary={summary} warning={attention} lastCheck={lastCheck} busy={Boolean(busy)} onCheck={() => void manualCheck()} />
            <QuickActions
              disabled={Boolean(busy)}
              onCheck={() => void manualCheck()}
              onNetwork={() => void runSimpleTool('network_check', 'Revisando Internet')}
              onTemperature={() => void readTemperature(false)}
              onSupport={() => void remoteSupport()}
            />
            <div className="nv2-conversation-title"><span>Conversación</span><i /></div>
            {messages.map((message) => <Bubble key={message.id} message={message} onElevate={() => void readTemperature(true)} />)}
            {approval && <ApprovalCard approval={approval} onApprove={() => void approveAction()} onCancel={() => setApproval(null)} />}
            {busy && <Working label={busy} />}
          </>
        )}
      </section>

      <footer className="nv2-footer">
        {!active ? (
          <form onSubmit={(event: FormEvent) => { event.preventDefault(); beginActivation(); }}>
            <div className="nv2-code-field">
              <ShieldCheck size={16} />
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="Código de activación"
                autoComplete="off"
              />
            </div>
            <button type="submit" disabled={Boolean(busy) || code.trim().length < 4}>Continuar</button>
          </form>
        ) : (
          <form onSubmit={(event: FormEvent) => { event.preventDefault(); void send(input); }}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              placeholder={consent?.assistantEnabled ? 'Escribí qué pasa…' : 'Activá la protección para conversar'}
              rows={1}
              disabled={Boolean(busy) || Boolean(approval)}
            />
            <button type="submit" aria-label="Enviar" disabled={!input.trim() || Boolean(busy) || Boolean(approval)}><Send size={17} /></button>
          </form>
        )}
        <div className="nv2-footer-meta"><span>{active ? `${plan} · ${lastCheck}` : 'El código te lo entrega NEXO'}</span><span>v{APP_VERSION}</span></div>
      </footer>

      {modePicker && (
        <ModePicker
          activation={Boolean(pendingCode && !active)}
          currentMode={currentMode}
          busy={busy}
          error={modeError}
          onChoose={(mode) => void changeMode(mode)}
          onClose={() => {
            if (pendingCode && !active && busy) return;
            setModePicker(false);
            setPendingCode('');
            setModeError('');
          }}
        />
      )}
    </main>
  );
}

function requiresAttention(report: DiagnosticReport | null, summary: SensorSummary | null) {
  if (!report && !summary) return false;
  const diskFree = report?.systemDriveTotalGb ? report.systemDriveFreeGb / report.systemDriveTotalGb : 1;
  const ramFree = report?.ramTotalGb ? report.ramFreeGb / report.ramTotalGb : 1;
  return diskFree < 0.12
    || ramFree < 0.12
    || Boolean(report && (report.defenderStatus !== 'Activo' || report.pendingReboot))
    || (summary?.cpuTemperatureC ?? 0) >= 88
    || (summary?.gpuTemperatureC ?? 0) >= 88;
}

function formatLastCheck(report: DiagnosticReport | null, hardware: HardwareSnapshot | null) {
  const stored = Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
  const generated = report?.generatedAt || hardware?.generatedAt;
  const timestamp = stored || (generated ? Date.parse(generated) : 0);
  if (!timestamp) return 'Todavía no revisada';
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `Revisada hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `Revisada hace ${hours} h` : 'Revisada hoy';
}

function Activation() {
  return (
    <div className="nv2-activation">
      <div className="nv2-activation-mark"><NexoMark size={45} /></div>
      <h1>Ayuda para tu PC.</h1>
      <p>Ingresá el código. Después elegís una acción y NEXO empieza enseguida.</p>
    </div>
  );
}

function StatusCard({ report, summary, warning, lastCheck, busy, onCheck }: {
  report: DiagnosticReport | null;
  summary: SensorSummary | null;
  warning: boolean;
  lastCheck: string;
  busy: boolean;
  onCheck: () => void;
}) {
  const ram = report?.ramTotalGb ? Math.round((1 - report.ramFreeGb / report.ramTotalGb) * 100) : null;
  const disk = report?.systemDriveFreeGb != null ? Math.round(report.systemDriveFreeGb) : null;
  return (
    <section className={`nv2-status-card ${warning ? 'warning' : ''}`}>
      <header>
        <span className="nv2-health-icon"><ShieldCheck size={20} /></span>
        <div><small>Estado del equipo</small><b>{report ? (warning ? 'Hay algo para revisar' : 'Todo está bien') : 'Listo para revisar'}</b><p>{lastCheck}</p></div>
        <button type="button" onClick={onCheck} disabled={busy}><RefreshCw className={busy ? 'spin' : ''} size={15} /> Revisar</button>
      </header>
      <div className="nv2-metrics">
        <Metric icon={<Thermometer />} value={summary?.cpuTemperatureC != null ? `${Math.round(summary.cpuTemperatureC)}°` : '—'} label="CPU" />
        <Metric icon={<Activity />} value={ram != null ? `${ram}%` : '—'} label="RAM" />
        <Metric icon={<HardDrive />} value={disk != null ? `${disk} GB` : '—'} label="Libres" />
        <Metric icon={<ShieldCheck />} value={report ? (report.defenderStatus === 'Activo' ? 'Bien' : 'Revisar') : '—'} label="Seguridad" />
      </div>
    </section>
  );
}

function Metric({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return <span>{icon}<b>{value}</b><small>{label}</small></span>;
}

function QuickActions({ disabled, onCheck, onNetwork, onTemperature, onSupport }: {
  disabled: boolean;
  onCheck: () => void;
  onNetwork: () => void;
  onTemperature: () => void;
  onSupport: () => void;
}) {
  return (
    <div className="nv2-quick-actions">
      <QuickAction icon={<Gauge />} label="Revisar" disabled={disabled} onClick={onCheck} />
      <QuickAction icon={<WifiOff />} label="Internet" disabled={disabled} onClick={onNetwork} />
      <QuickAction icon={<Thermometer />} label="Temperatura" disabled={disabled} onClick={onTemperature} />
      <QuickAction icon={<Headphones />} label="Técnico" disabled={disabled} onClick={onSupport} />
    </div>
  );
}

function QuickAction({ icon, label, disabled, onClick }: { icon: ReactNode; label: string; disabled: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick}><span>{icon}</span><b>{label}</b></button>;
}

function Bubble({ message, onElevate }: { message: Message; onElevate: () => void }) {
  return (
    <article className={`nv2-bubble-row ${message.role}`}>
      {message.role === 'assistant' && <span className="nv2-avatar"><NexoMark size={15} /></span>}
      <div className="nv2-bubble">
        <p>{message.text}</p>
        {message.report && <Diagnostic report={message.report} />}
        {message.hardware && <Hardware snapshot={message.hardware} onElevate={onElevate} />}
        {message.result && <Result result={message.result} />}
      </div>
    </article>
  );
}

function Diagnostic({ report }: { report: DiagnosticReport }) {
  const ram = report.ramTotalGb ? Math.round((1 - report.ramFreeGb / report.ramTotalGb) * 100) : 0;
  const disk = report.systemDriveTotalGb ? Math.round((1 - report.systemDriveFreeGb / report.systemDriveTotalGb) * 100) : 0;
  return (
    <div className="nv2-diagnostic">
      <DiagnosticMetric label="Memoria" value={report.ramTotalGb ? `${ram}%` : 'Sin dato'} progress={ram} warning={ram > 85} />
      <DiagnosticMetric label="Disco usado" value={report.systemDriveTotalGb ? `${disk}%` : 'Sin dato'} progress={disk} warning={disk > 88} />
      <DiagnosticMetric label="Seguridad" value={report.defenderStatus === 'Activo' ? 'Protegida' : report.defenderStatus} progress={report.defenderStatus === 'Activo' ? 100 : 40} warning={report.defenderStatus !== 'Activo'} />
    </div>
  );
}

function DiagnosticMetric({ label, value, progress, warning }: { label: string; value: string; progress: number; warning: boolean }) {
  return <div className={warning ? 'warning' : ''}><header><span>{label}</span><b>{value}</b></header><i><em style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} /></i></div>;
}

function Hardware({ snapshot, onElevate }: { snapshot: HardwareSnapshot; onElevate: () => void }) {
  const summary = summarizeHardware(snapshot);
  return (
    <div className="nv2-hardware">
      <div>
        <span><small>CPU</small><b>{summary.cpuTemperatureC != null ? `${Math.round(summary.cpuTemperatureC)}°C` : 'Sin dato'}</b></span>
        <span><small>GPU</small><b>{summary.gpuTemperatureC != null ? `${Math.round(summary.gpuTemperatureC)}°C` : 'Sin dato'}</b></span>
        <span><small>Disco</small><b>{summary.storageTemperatureC != null ? `${Math.round(summary.storageTemperatureC)}°C` : 'Sin dato'}</b></span>
        <span><small>Ventilador</small><b>{summary.fanRpm != null ? `${Math.round(summary.fanRpm)} rpm` : 'Sin dato'}</b></span>
      </div>
      <p>{snapshot.note}</p>
      {snapshot.permissionRequired && <button type="button" onClick={onElevate}><ShieldCheck size={13} /> Leer más sensores con permiso de Windows</button>}
    </div>
  );
}

function Result({ result }: { result: AgentActionResult }) {
  return (
    <div className={`nv2-result ${result.ok ? '' : 'bad'}`}>
      {result.ok ? <Check size={14} /> : <CircleAlert size={14} />}
      <span><b>{result.ok ? 'Listo' : 'No se pudo completar'}</b><small>{result.message}</small></span>
    </div>
  );
}

function ApprovalCard({ approval, onApprove, onCancel }: { approval: Approval; onApprove: () => void; onCancel: () => void }) {
  return (
    <div className="nv2-approval">
      <Wrench size={18} />
      <div><small>Necesita tu permiso</small><b>{approval.tool.label}</b><p>{approval.tool.description}</p></div>
      <footer><button type="button" onClick={onApprove}>Sí, continuar</button><button type="button" onClick={onCancel}>Ahora no</button></footer>
    </div>
  );
}

function Working({ label }: { label: string }) {
  return <div className="nv2-working"><RefreshCw className="spin" size={17} /><span><b>{label}</b><small>Podés esperar acá. NEXO no está haciendo otros cambios.</small></span></div>;
}

function ModePicker({ activation, currentMode, busy, error, onChoose, onClose }: {
  activation: boolean;
  currentMode: UseMode;
  busy: string;
  error: string;
  onChoose: (mode: UseMode) => void;
  onClose: () => void;
}) {
  return (
    <div className="nv2-modal-backdrop">
      <section className="nv2-mode-sheet" role="dialog" aria-modal="true" aria-label="Modo de uso de NEXO">
        <header>
          <div><small>{activation ? 'EMPEZAR' : 'MODO DE USO'}</small><h2>{activation ? '¿Qué querés hacer?' : '¿Cómo querés usar NEXO?'}</h2><p>Tocá una opción. Se aplica en el momento.</p></div>
          <button type="button" aria-label="Cerrar" onClick={onClose} disabled={Boolean(busy)}><X size={17} /></button>
        </header>

        {busy ? (
          <div className="nv2-mode-progress"><RefreshCw className="spin" size={24} /><b>{busy}</b><small>NEXO está trabajando. Esta pantalla no quedó trabada.</small></div>
        ) : (
          <div className="nv2-mode-actions">
            <button type="button" onClick={() => onChoose('protected')}>
              <span><ShieldCheck size={23} /></span>
              <div><b>Proteger esta PC</b><small>Vincula, revisa y habilita el chat.</small></div>
              <ArrowUpRight size={18} />
            </button>
            <button type="button" onClick={() => onChoose('local')}>
              <span><Gauge size={23} /></span>
              <div><b>Revisión rápida</b><small>Vincula y revisa sin compartir el diagnóstico.</small></div>
              <ArrowUpRight size={18} />
            </button>
          </div>
        )}

        {error && <div className="nv2-mode-error"><CircleAlert size={16} /><span>{error}</span></div>}
        {!busy && !activation && <small className="nv2-current-mode">Actual: {currentMode === 'protected' ? 'Protección activa' : 'Solo local'}</small>}
      </section>
    </div>
  );
}
