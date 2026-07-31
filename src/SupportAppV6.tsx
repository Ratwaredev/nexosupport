import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
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
  X
} from 'lucide-react';
import { appBackend, backendConfig } from './lib/backend';
import type { AppSession, ClientDashboard, UpdateConsentInput } from './lib/domain';
import { APP_VERSION } from './lib/domain';
import { runQuickDiagnostic } from './lib/diagnostics';
import type { DiagnosticReport } from './lib/diagnostics';
import { getAgentStatus, optimizeTempFiles, runAgentAction } from './lib/agent';
import type { AgentActionResult, OptimizerProgress } from './lib/agent';
import {
  TOOL_CATALOG,
  normalizeToolResult,
  requestAssistant
} from './lib/assistant';
import type {
  AssistantToolId,
  ProviderMessage,
  ProviderToolCall
} from './lib/assistant';
import { readHardwareSensors, summarizeHardware } from './lib/sensors';
import type { HardwareSnapshot } from './lib/sensors';
import { getRemoteToolStatus, installRemoteTool, openRemoteTool } from './lib/support';
import type { RemoteToolStatus } from './lib/support';
import {
  networkRecord,
  optimizerRecord,
  overviewRecord,
  securityRecord,
  startupRecord,
  temperatureRecord
} from './lib/tool-evidence';
import type { ToolId, ToolRecord } from './lib/tool-evidence';
import {
  actionFromResult,
  buildRunSummary,
  createSupportRun
} from './lib/support-run';
import type { SupportRunReport } from './lib/support-run';
import { safeInvoke } from './lib/tauri';

type View = 'assistant' | 'tools';
type OptimizerPhase = 'idle' | 'scanning' | 'ready' | 'confirm' | 'cleaning' | 'done';
type Notice = { tone: 'success' | 'warning' | 'error'; text: string };
type ChatMessage = { id: string; role: 'assistant' | 'user'; text: string };
type ToolDefinition = { id: ToolId; title: string; icon: ReactNode };
type PendingApproval = {
  call: ProviderToolCall;
  history: ProviderMessage[];
  run: SupportRunReport;
  depth: number;
};

const pendingConsent: UpdateConsentInput = {
  assistantEnabled: false,
  shareDiagnostics: false,
  automaticChecks: false,
  hardwareSensors: false,
  elevatedSensors: false
};

const toolsConsent: UpdateConsentInput = {
  assistantEnabled: false,
  shareDiagnostics: false,
  automaticChecks: false,
  hardwareSensors: true,
  elevatedSensors: false
};

const activeConsent: UpdateConsentInput = {
  assistantEnabled: true,
  shareDiagnostics: true,
  automaticChecks: false,
  hardwareSensors: true,
  elevatedSensors: false
};

const defaultCode = import.meta.env.VITE_DEFAULT_PAIRING_CODE?.trim()
  || (backendConfig.backendKind === 'local' ? 'DEMO-PAIR' : '');

const tools: ToolDefinition[] = [
  { id: 'overview', title: 'Estado general', icon: <Gauge /> },
  { id: 'temperature', title: 'Temperatura', icon: <Thermometer /> },
  { id: 'network', title: 'Internet', icon: <Wifi /> },
  { id: 'security', title: 'Seguridad', icon: <ShieldCheck /> },
  { id: 'startup', title: 'Inicio', icon: <RefreshCw /> },
  { id: 'optimizer', title: 'Optimizar', icon: <Rocket /> },
  { id: 'remote', title: 'Soporte remoto', icon: <Headphones /> }
];

function NexoMark({ size = 24 }: { size?: number }) {
  const id = `nexo-v8-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 62 54" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="58" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#765cff" />
          <stop offset=".55" stopColor="#5d61ea" />
          <stop offset="1" stopColor="#288bdf" />
        </linearGradient>
      </defs>
      <path d="M4 4h13.4L31 20.8 44.6 4H58L38.1 27 58 50H44.6L31 33.2 17.4 50H4l19.9-23z" fill={`url(#${id})`} />
    </svg>
  );
}

function message(role: ChatMessage['role'], text: string): ChatMessage {
  return { id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`, role, text };
}

function compactRecord(record: ToolRecord) {
  const rows = record.rows.slice(0, 6).map((row) => `${row.label}: ${row.value}`).join('\n');
  return rows ? `${record.title}\n${rows}` : record.title;
}

function errorText(error: unknown) {
  const raw = error instanceof Error ? error.message : 'No se pudo completar.';
  if (/timeout|tard[oó] demasiado|abort/i.test(raw)) return 'La tarea tardó demasiado.';
  if (/permission|denied|autorizaci[oó]n|rechaz/i.test(raw)) return 'Windows canceló la autorización.';
  return raw;
}

function result(action: string, ok: boolean, text: string, details: unknown[] = []): AgentActionResult {
  return {
    action,
    ok,
    message: text,
    details: details.map((detail) => typeof detail === 'string' ? detail : JSON.stringify(detail))
  };
}

function runContext(run: SupportRunReport) {
  return {
    issue: run.issue,
    status: run.status,
    actions: run.actions.map((action) => ({
      tool: action.tool,
      mode: action.mode,
      ok: action.ok,
      message: action.message
    })),
    before: run.before ? {
      freeDiskGb: run.before.systemDriveFreeGb,
      freeRamGb: run.before.ramFreeGb,
      startupItems: run.before.startupItems,
      defender: run.before.defenderStatus,
      pendingReboot: run.before.pendingReboot
    } : null,
    after: run.after ? {
      freeDiskGb: run.after.systemDriveFreeGb,
      freeRamGb: run.after.ramFreeGb,
      startupItems: run.after.startupItems,
      defender: run.after.defenderStatus,
      pendingReboot: run.after.pendingReboot
    } : null
  };
}

export default function SupportAppV6() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [dashboard, setDashboard] = useState<ClientDashboard | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null);
  const [remote, setRemote] = useState<RemoteToolStatus | null>(null);
  const [supportCode, setSupportCode] = useState('');
  const [records, setRecords] = useState<Partial<Record<ToolId, ToolRecord>>>({});
  const [view, setView] = useState<View>('assistant');
  const [selected, setSelected] = useState<ToolId | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [code, setCode] = useState(defaultCode);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([message('assistant', '¿Qué pasa con la PC?')]);
  const [providerMessages, setProviderMessages] = useState<ProviderMessage[]>([]);
  const [currentRun, setCurrentRun] = useState<SupportRunReport | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [optimizerPhase, setOptimizerPhase] = useState<OptimizerPhase>('idle');
  const [progress, setProgress] = useState<OptimizerProgress>({ percent: 0, processedFiles: 0, totalFiles: 0, freedBytes: 0, current: '' });
  const thread = useRef<HTMLDivElement | null>(null);

  const device = dashboard?.device ?? null;
  const active = Boolean(session?.deviceToken && device);
  const consentResolved = Boolean(dashboard?.consent?.hardwareSensors);
  const assistantEnabled = Boolean(dashboard?.consent?.assistantEnabled && dashboard?.consent?.shareDiagnostics);
  const hardwareSummary = useMemo(() => hardware ? summarizeHardware(hardware) : null, [hardware]);

  function saveRecord(record: ToolRecord) {
    setRecords((current) => ({ ...current, [record.id]: record }));
    return record;
  }

  function push(role: ChatMessage['role'], text: string) {
    const clean = text.trim();
    if (!clean) return;
    setMessages((current) => [...current, message(role, clean)]);
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [restored, remoteStatus] = await Promise.all([
          appBackend.bootstrap('client'),
          getRemoteToolStatus().catch(() => null)
        ]);
        if (!mounted) return;
        setRemote(remoteStatus);
        setSession(restored);
        if (!restored?.deviceToken) return;
        const data = await appBackend.getClientDashboard(restored.deviceToken);
        if (!mounted) return;
        setDashboard(data);
        const latest = data.diagnostics.find((item) => {
          const payload = item.payload as Record<string, unknown>;
          return payload?.kind !== 'nexo-support-run';
        })?.payload as unknown as (DiagnosticReport & { hardware?: HardwareSnapshot }) | undefined;
        if (latest?.generatedAt) {
          setReport(latest);
          saveRecord(overviewRecord(latest, latest.hardware ? summarizeHardware(latest.hardware) : null));
        }
        if (latest?.hardware?.generatedAt) {
          setHardware(latest.hardware);
          saveRecord(temperatureRecord(latest.hardware));
        }
      } catch (error) {
        if (mounted) setNotice({ tone: 'error', text: errorText(error) });
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (view !== 'assistant') return;
    const timer = window.setTimeout(() => { if (thread.current) thread.current.scrollTop = thread.current.scrollHeight; }, 20);
    return () => window.clearTimeout(timer);
  }, [messages.length, busy, pendingApproval, view]);

  async function activate(event: FormEvent) {
    event.preventDefault();
    const pairingCode = code.trim().toUpperCase();
    if (pairingCode.length < 4 || busy) return;
    setBusy('Conectando');
    try {
      const identity = await runQuickDiagnostic().catch(() => null);
      const registered = await appBackend.registerClient({
        pairingCode,
        deviceName: identity?.computerName || 'PC de soporte',
        issue: 'Soporte técnico',
        computerName: identity?.computerName || 'Equipo Windows',
        userName: identity?.userName || 'Usuario',
        os: identity?.os || 'Windows',
        platform: 'windows'
      });
      if (!registered.session.deviceToken) throw new Error('No se creó la conexión.');
      await appBackend.saveConsents(registered.session.deviceToken, pendingConsent);
      const data = await appBackend.getClientDashboard(registered.session.deviceToken);
      setSession(registered.session);
      setDashboard(data);
      setNotice({ tone: 'success', text: 'PC conectada.' });
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error) });
    } finally {
      setBusy('');
    }
  }

  async function chooseMode(useAgent: boolean) {
    if (!session?.deviceToken) return;
    setBusy('Guardando');
    try {
      const consent = await appBackend.saveConsents(session.deviceToken, useAgent ? activeConsent : toolsConsent);
      setDashboard((current) => current ? { ...current, consent } : current);
      setView(useAgent ? 'assistant' : 'tools');
      setNotice({ tone: 'success', text: useAgent ? 'Soporte listo.' : 'Herramientas listas.' });
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error) });
    } finally {
      setBusy('');
    }
  }

  async function runOverview(force = false) {
    if (!force && records.overview) return records.overview;
    if (!session?.deviceToken || !device) throw new Error('La PC no está conectada.');
    setBusy('Revisando PC');
    try {
      const [diagnostic, sensors] = await Promise.allSettled([
        runQuickDiagnostic(),
        readHardwareSensors(false)
      ]);
      if (diagnostic.status === 'rejected') throw diagnostic.reason;
      const nextReport = diagnostic.value;
      const nextHardware = sensors.status === 'fulfilled' ? sensors.value : hardware;
      setReport(nextReport);
      if (nextHardware) {
        setHardware(nextHardware);
        saveRecord(temperatureRecord(nextHardware));
      }
      const record = saveRecord(overviewRecord(nextReport, nextHardware ? summarizeHardware(nextHardware) : null));
      if (dashboard?.consent?.shareDiagnostics) {
        void appBackend.saveDiagnostic({ deviceId: device.id, payload: { ...nextReport, hardware: nextHardware } }, session.deviceToken).catch(() => undefined);
      }
      return record;
    } finally {
      setBusy('');
    }
  }

  async function runTemperature(elevated = false) {
    setBusy(elevated ? 'Autorizando sensores' : 'Leyendo temperatura');
    try {
      const snapshot = await readHardwareSensors(elevated);
      setHardware(snapshot);
      return saveRecord(temperatureRecord(snapshot));
    } finally {
      setBusy('');
    }
  }

  async function runReadTool(id: 'network' | 'security' | 'startup') {
    const action = id === 'network' ? 'network_check' : id === 'security' ? 'defender_status' : 'startup_review';
    setBusy(id === 'network' ? 'Revisando Internet' : id === 'security' ? 'Revisando seguridad' : 'Revisando inicio');
    try {
      const actionResult = await runAgentAction(action);
      return saveRecord(id === 'network' ? networkRecord(actionResult) : id === 'security' ? securityRecord(actionResult) : startupRecord(actionResult));
    } finally {
      setBusy('');
    }
  }

  async function scanOptimizer() {
    setOptimizerPhase('scanning');
    setBusy('Analizando');
    try {
      const actionResult = await runAgentAction('temp_scan');
      const record = saveRecord(optimizerRecord(actionResult, false));
      setOptimizerPhase('ready');
      return record;
    } catch (error) {
      setOptimizerPhase('idle');
      throw error;
    } finally {
      setBusy('');
    }
  }

  async function cleanOptimizer() {
    setOptimizerPhase('cleaning');
    setProgress({ percent: 0, processedFiles: 0, totalFiles: 0, freedBytes: 0, current: '' });
    setBusy('Optimizando');
    try {
      const actionResult = await optimizeTempFiles(setProgress);
      const record = saveRecord(optimizerRecord(actionResult, true));
      setProgress((current) => ({ ...current, percent: 100, current: 'Listo' }));
      setOptimizerPhase('done');
      setNotice({ tone: 'success', text: record.title });
      return record;
    } catch (error) {
      setOptimizerPhase('ready');
      throw error;
    } finally {
      setBusy('');
    }
  }

  async function analyzeSelected(elevated = false) {
    if (!selected) return;
    try {
      if (selected === 'overview') await runOverview(true);
      else if (selected === 'temperature') await runTemperature(elevated);
      else if (selected === 'network' || selected === 'security' || selected === 'startup') await runReadTool(selected);
      else if (selected === 'optimizer') await scanOptimizer();
      else setRemote(await getRemoteToolStatus());
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error) });
    }
  }

  async function runRepair(action: 'repair_network' | 'defender_quick_scan') {
    setBusy(action === 'repair_network' ? 'Reparando Internet' : 'Iniciando Defender');
    try {
      const actionResult = await runAgentAction(action);
      setNotice({ tone: actionResult.ok ? 'success' : 'warning', text: actionResult.message || 'Listo.' });
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error) });
    } finally {
      setBusy('');
    }
  }

  async function installRemote() {
    setBusy('Instalando RustDesk');
    try {
      const status = await installRemoteTool();
      setRemote(status);
      setNotice({ tone: status.installed ? 'success' : 'warning', text: status.installed ? 'RustDesk listo.' : status.message });
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error) });
    } finally {
      setBusy('');
    }
  }

  async function startRemote(): Promise<AgentActionResult> {
    if (!session?.deviceToken || !device) throw new Error('La PC no está conectada.');
    let status = await getRemoteToolStatus();
    if (!status.installed) status = await installRemoteTool();
    setRemote(status);
    if (!status.installed) throw new Error('RustDesk no está listo.');
    const ticket = await appBackend.createTicket({
      deviceId: device.id,
      clientName: device.displayName,
      issue: status.id ? `Soporte remoto · RustDesk ${status.id}` : 'Soporte remoto',
      priority: 'normal'
    }, session.deviceToken);
    const remoteSession = await appBackend.createRemoteSession({ deviceId: device.id, ticketId: ticket.id }, session.deviceToken);
    setSupportCode(remoteSession.code);
    return result('remote_support', true, 'Solicitud enviada. RustDesk no se abrirá hasta que lo autorices.', [{
      ticketId: ticket.id,
      rustdeskId: status.id || null,
      requestCode: remoteSession.code,
      expiresInMinutes: remoteSession.expiresInMinutes
    }]);
  }

  async function executeAssistantTool(name: AssistantToolId, run: SupportRunReport) {
    const definition = TOOL_CATALOG[name];
    const startedAt = new Date().toISOString();
    setBusy(definition.progressLabel);
    let actionResult: AgentActionResult;
    let nextReport: DiagnosticReport | null = null;
    let nextHardware: HardwareSnapshot | null = null;

    try {
      if (name === 'run_quick_diagnostic') {
        const [diagnostic, sensors] = await Promise.allSettled([
          runQuickDiagnostic(),
          readHardwareSensors(false)
        ]);
        if (diagnostic.status === 'rejected') throw diagnostic.reason;
        nextReport = diagnostic.value;
        nextHardware = sensors.status === 'fulfilled' ? sensors.value : hardware;
        setReport(nextReport);
        if (nextHardware) {
          setHardware(nextHardware);
          saveRecord(temperatureRecord(nextHardware));
        }
        saveRecord(overviewRecord(nextReport, nextHardware ? summarizeHardware(nextHardware) : null));
        actionResult = result(name, true, 'Diagnóstico listo.', [{ diagnostic: nextReport, hardware: nextHardware ? summarizeHardware(nextHardware) : null }]);
      } else if (name === 'scan_temp_files') {
        actionResult = await runAgentAction('temp_scan');
        saveRecord(optimizerRecord(actionResult, false));
      } else if (name === 'clean_temp_files') {
        setProgress({ percent: 0, processedFiles: 0, totalFiles: 0, freedBytes: 0, current: '' });
        actionResult = await optimizeTempFiles(setProgress);
        setProgress((current) => ({ ...current, percent: 100, current: 'Listo' }));
        saveRecord(optimizerRecord(actionResult, true));
      } else if (name === 'remote_support') {
        actionResult = await startRemote();
      } else {
        actionResult = await runAgentAction(name);
        if (name === 'network_check') saveRecord(networkRecord(actionResult));
        if (name === 'defender_status') saveRecord(securityRecord(actionResult));
        if (name === 'startup_review') saveRecord(startupRecord(actionResult));
      }
    } finally {
      setBusy('');
    }

    const mode = definition.mode === 'read' ? 'read' : definition.mode === 'support' ? 'support' : 'change';
    let nextRun: SupportRunReport = {
      ...run,
      status: name === 'remote_support' ? 'needs-remote' : 'running',
      actions: [...run.actions, actionFromResult(name, definition.shortLabel, mode, startedAt, actionResult)]
    };

    if (nextReport) {
      const changed = run.actions.some((action) => action.mode === 'change' && action.ok);
      nextRun = changed
        ? { ...nextRun, after: nextReport }
        : { ...nextRun, before: run.before || nextReport };
    }

    if (name === 'remote_support') {
      let payload: { rustdeskId?: string | null; requestCode?: string | null } = {};
      try { payload = JSON.parse(actionResult.details[0] || '{}') as typeof payload; } catch { payload = {}; }
      nextRun = { ...nextRun, remote: payload };
    }

    setCurrentRun(nextRun);
    return { actionResult, nextRun };
  }

  async function persistRun(run: SupportRunReport) {
    if (!session?.deviceToken || !device || !dashboard?.consent?.shareDiagnostics) return;
    await appBackend.saveDiagnostic({ deviceId: device.id, payload: run as unknown as Record<string, unknown> }, session.deviceToken);
  }

  async function finishRun(run: SupportRunReport, modelText?: string | null) {
    let nextRun = { ...run };
    const changed = nextRun.actions.some((action) => action.mode === 'change' && action.ok);
    if (changed && !nextRun.after) {
      setBusy('Verificando');
      try {
        const after = await runQuickDiagnostic();
        nextRun = { ...nextRun, after };
        setReport(after);
        saveRecord(overviewRecord(after, hardwareSummary));
      } catch {
        nextRun = {
          ...nextRun,
          recommendations: [...nextRun.recommendations, 'No se pudo repetir el diagnóstico final.']
        };
      } finally {
        setBusy('');
      }
    }

    const status = nextRun.status === 'needs-remote' ? 'needs-remote' : nextRun.status === 'cancelled' ? 'cancelled' : 'completed';
    nextRun = {
      ...nextRun,
      status,
      completedAt: new Date().toISOString(),
      summary: buildRunSummary({ ...nextRun, status }),
      recommendations: nextRun.after?.recommendations?.slice(0, 4)
        || nextRun.before?.recommendations?.slice(0, 4)
        || nextRun.recommendations
    };
    setCurrentRun(nextRun);
    await persistRun(nextRun).catch(() => undefined);
    const concise = modelText?.trim().slice(0, 500);
    push('assistant', concise || nextRun.summary);
  }

  async function continueAgent(history: ProviderMessage[], run: SupportRunReport, depth = 0): Promise<void> {
    if (!session?.deviceToken) return;
    if (depth >= 7) {
      await finishRun({ ...run, status: 'failed', summary: 'La revisión alcanzó su límite.' }, 'Necesito soporte remoto para seguir.');
      return;
    }

    setBusy('Analizando');
    try {
      const response = await requestAssistant({
        deviceToken: session.deviceToken,
        messages: history,
        diagnostic: report,
        hardware: hardwareSummary,
        agentStatus: await getAgentStatus().catch(() => null),
        runContext: runContext(run),
        appVersion: APP_VERSION
      });
      const assistantMessage = response.message;
      const nextHistory = [...history, assistantMessage];
      setProviderMessages(nextHistory);
      const call = assistantMessage.tool_calls?.[0];
      if (!call) {
        await finishRun(run, assistantMessage.content);
        return;
      }
      const definition = TOOL_CATALOG[call.function.name];
      if (!definition) throw new Error('NEXO pidió una acción inválida.');
      if (definition.mode !== 'read') {
        const waiting = { ...run, status: 'waiting-confirmation' as const };
        setCurrentRun(waiting);
        setPendingApproval({ call, history: nextHistory, run: waiting, depth });
        return;
      }
      const executed = await executeAssistantTool(call.function.name, run);
      const toolMessage: ProviderMessage = {
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: normalizeToolResult(executed.actionResult)
      };
      await continueAgent([...nextHistory, toolMessage], executed.nextRun, depth + 1);
    } catch (error) {
      const failed = {
        ...run,
        status: 'failed' as const,
        completedAt: new Date().toISOString(),
        summary: errorText(error)
      };
      setCurrentRun(failed);
      await persistRun(failed).catch(() => undefined);
      push('assistant', errorText(error));
    } finally {
      setBusy('');
    }
  }

  async function beginAgent(text: string) {
    if (!assistantEnabled || busy || pendingApproval) return;
    push('user', text);
    const userMessage: ProviderMessage = { role: 'user', content: text };
    const history = [...providerMessages, userMessage].slice(-28);
    const run = createSupportRun(text);
    setProviderMessages(history);
    setCurrentRun(run);
    await continueAgent(history, run, 0);
  }

  async function approvePending() {
    const pending = pendingApproval;
    if (!pending) return;
    setPendingApproval(null);
    try {
      const executed = await executeAssistantTool(pending.call.function.name, { ...pending.run, status: 'running' });
      const toolMessage: ProviderMessage = {
        role: 'tool',
        tool_call_id: pending.call.id,
        name: pending.call.function.name,
        content: normalizeToolResult(executed.actionResult)
      };
      await continueAgent([...pending.history, toolMessage], executed.nextRun, pending.depth + 1);
    } catch (error) {
      const failed = { ...pending.run, status: 'failed' as const, completedAt: new Date().toISOString(), summary: errorText(error) };
      setCurrentRun(failed);
      await persistRun(failed).catch(() => undefined);
      push('assistant', errorText(error));
    }
  }

  async function cancelPending() {
    const pending = pendingApproval;
    if (!pending) return;
    setPendingApproval(null);
    const cancelled: SupportRunReport = {
      ...pending.run,
      status: 'cancelled',
      completedAt: new Date().toISOString(),
      summary: 'La persona canceló los cambios.'
    };
    setCurrentRun(cancelled);
    await persistRun(cancelled).catch(() => undefined);
    push('assistant', 'Cancelado.');
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    await beginAgent(text);
  }

  async function openAdmin() {
    setMenuOpen(false);
    try {
      await safeInvoke('open_admin_window');
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error) });
    }
  }

  function renderRecord(record?: ToolRecord) {
    if (!record) return <div className="nv-empty"><span>Sin datos</span></div>;
    return (
      <>
        <section className={`nv-result ${record.ok ? 'ok' : 'warn'}`}>
          <span>{record.ok ? <Check size={18} /> : <AlertTriangle size={18} />}</span>
          <h2>{record.title}</h2>
        </section>
        {record.rows.length > 0 && (
          <div className="nv-data">
            {record.rows.map((row, index) => <div key={`${row.label}-${index}`}><span>{row.label}</span><b>{row.value}</b></div>)}
          </div>
        )}
      </>
    );
  }

  function renderToolDetail() {
    if (!selected) return null;
    const definition = tools.find((tool) => tool.id === selected)!;
    const record = records[selected];
    const needsAdmin = selected === 'temperature' && hardware?.permissionRequired && !record?.ok;

    return (
      <section className="nv-detail">
        <header>
          <button aria-label="Volver" onClick={() => setSelected(null)}><ArrowLeft size={17} /></button>
          <span>{definition.icon}</span>
          <h1>{definition.title}</h1>
        </header>

        {selected === 'optimizer' ? (
          <>
            {optimizerPhase === 'scanning' && <ScanStage />}
            {optimizerPhase === 'cleaning' && <RocketStage progress={progress} />}
            {optimizerPhase !== 'scanning' && optimizerPhase !== 'cleaning' && renderRecord(record)}
            {optimizerPhase === 'confirm' && (
              <div className="nv-confirm"><b>¿Optimizar?</b><button onClick={() => setOptimizerPhase('ready')}>Cancelar</button><button onClick={() => void cleanOptimizer()}>Optimizar</button></div>
            )}
            {optimizerPhase !== 'scanning' && optimizerPhase !== 'cleaning' && optimizerPhase !== 'confirm' && (
              <footer>
                <button className="secondary" onClick={() => void scanOptimizer()} disabled={Boolean(busy)}>Analizar</button>
                <button onClick={() => setOptimizerPhase('confirm')} disabled={!record || optimizerPhase === 'done' || Boolean(busy)}>Optimizar</button>
              </footer>
            )}
          </>
        ) : selected === 'remote' ? (
          <>
            <section className={`nv-remote ${remote?.installed ? 'ok' : ''}`}>
              <Headphones size={24} />
              <div><span>RustDesk</span><strong>{remote?.installed ? remote.id || 'Listo' : 'No instalado'}</strong>{supportCode && <small>Solicitud {supportCode}</small>}</div>
            </section>
            <footer>
              <button className="secondary" onClick={() => void analyzeSelected()} disabled={Boolean(busy)}>Revisar</button>
              {supportCode ? (
                <button onClick={() => void openRemoteTool().then(() => setNotice({ tone: 'success', text: 'RustDesk abierto.' })).catch((error) => setNotice({ tone: 'error', text: errorText(error) }))} disabled={Boolean(busy)}>Abrir RustDesk</button>
              ) : (
                <button onClick={() => void (remote?.installed ? startRemote().then(() => setNotice({ tone: 'success', text: 'Solicitud enviada. RustDesk sigue cerrado.' })) : installRemote())} disabled={Boolean(busy)}>{remote?.installed ? 'Pedir soporte' : 'Instalar RustDesk'}</button>
              )}
            </footer>
          </>
        ) : (
          <>
            {renderRecord(record)}
            <footer>
              <button className="secondary" onClick={() => void analyzeSelected(needsAdmin)} disabled={Boolean(busy)}>{needsAdmin ? 'Autorizar sensores' : record ? 'Actualizar' : 'Analizar'}</button>
              {selected === 'network' && <button onClick={() => void runRepair('repair_network')} disabled={Boolean(busy)}>Reparar DNS</button>}
              {selected === 'security' && <button onClick={() => void runRepair('defender_quick_scan')} disabled={Boolean(busy)}>Analizar con Defender</button>}
            </footer>
          </>
        )}
      </section>
    );
  }

  if (booting) return <main className="nv-app nv-loading"><NexoMark size={44} /><i /></main>;

  return (
    <main className="nv-app">
      <header className="nv-top" data-tauri-drag-region>
        <div className="nv-brand" data-tauri-drag-region><NexoMark size={22} /><b>NEXO</b></div>
        <span className="nv-ready"><i />{active ? 'LISTO' : 'SIN CONECTAR'}</span>
        <div className="nv-window">
          <button aria-label="Menú" onClick={() => setMenuOpen((current) => !current)}><Menu size={16} /></button>
          <button aria-label="Minimizar" onClick={() => void safeInvoke('minimize_main_window')}><Minus size={16} /></button>
          <button aria-label="Cerrar NEXO" onClick={() => void safeInvoke('hide_main_window')}><X size={16} /></button>
        </div>
        {menuOpen && (
          <nav className="nv-menu">
            <button onClick={() => void openAdmin()}><Settings2 size={15} /> Administración</button>
            <button onClick={() => { setMenuOpen(false); window.dispatchEvent(new Event('nexo:check-update')); }}><RefreshCw size={15} /> Actualizar</button>
            <button onClick={() => void safeInvoke('exit_app')}><Power size={15} /> Salir</button>
          </nav>
        )}
      </header>

      {active && consentResolved && (
        <nav className="nv-tabs">
          {assistantEnabled && <button className={view === 'assistant' ? 'active' : ''} onClick={() => { setView('assistant'); setSelected(null); }}><MessageCircle size={15} /> Soporte</button>}
          <button className={view === 'tools' ? 'active' : ''} onClick={() => setView('tools')}><LayoutGrid size={15} /> Herramientas</button>
        </nav>
      )}

      {busy && <div className="nv-busy"><i /><span>{busy}</span></div>}
      {notice && <div className={`nv-toast ${notice.tone}`}><span>{notice.tone === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}</span><b>{notice.text}</b><button onClick={() => setNotice(null)}><X size={13} /></button></div>}

      {!active ? (
        <section className="nv-connect">
          <NexoMark size={54} />
          <h1>Conectar PC</h1>
          <form onSubmit={(event) => void activate(event)}>
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Código de soporte" autoComplete="off" />
            <button disabled={code.trim().length < 4 || Boolean(busy)}>Conectar</button>
          </form>
        </section>
      ) : !consentResolved ? (
        <section className="nv-consent">
          <span><ShieldCheck size={28} /></span>
          <h1>Elegí cómo usar NEXO</h1>
          <button onClick={() => void chooseMode(true)} disabled={Boolean(busy)}><b>Revisión guiada</b><small>Diagnóstico con autorización.</small></button>
          <button className="secondary" onClick={() => void chooseMode(false)} disabled={Boolean(busy)}><b>Herramientas</b><small>Sin enviar reportes.</small></button>
        </section>
      ) : view === 'assistant' && assistantEnabled ? (
        <section className="nv-chat">
          <header><span><Headphones size={18} /></span><div><b>NEXO</b><small>{device?.displayName}</small></div></header>
          <div className="nv-thread" ref={thread}>
            {messages.map((item) => <article key={item.id} className={item.role}><span>{item.role === 'assistant' && <NexoMark size={14} />}</span><p>{item.text}</p></article>)}
            {messages.length === 1 && (
              <div className="nv-prompts">
                <button onClick={() => void beginAgent('La PC está lenta.')}>PC lenta</button>
                <button onClick={() => void beginAgent('El disco está lento o lleno.')}>Disco</button>
                <button onClick={() => void beginAgent('No funciona bien Internet.')}>Internet</button>
                <button onClick={() => void beginAgent('Necesito soporte remoto.')}>Soporte</button>
              </div>
            )}
            {pendingApproval && (
              <section className="nv-approval">
                <span>{TOOL_CATALOG[pendingApproval.call.function.name].mode === 'support' ? <Headphones size={18} /> : <ShieldCheck size={18} />}</span>
                <div><small>NEXO solicita</small><b>{TOOL_CATALOG[pendingApproval.call.function.name].shortLabel}</b></div>
                <button onClick={() => void cancelPending()}>Cancelar</button>
                <button onClick={() => void approvePending()}>Autorizar</button>
              </section>
            )}
            {busy === 'Optimizando' && <AgentRocket progress={progress} />}
            {currentRun?.status === 'completed' && <small className="nv-run-saved">Reporte enviado</small>}
          </div>
          <form className="nv-compose" onSubmit={(event) => void send(event)}>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="¿Qué pasa con la PC?" disabled={Boolean(busy) || Boolean(pendingApproval)} />
            <button aria-label="Enviar" disabled={!input.trim() || Boolean(busy) || Boolean(pendingApproval)}><Send size={17} /></button>
          </form>
        </section>
      ) : (
        <section className="nv-tools">
          {selected ? renderToolDetail() : (
            <>
              <header><h1>Herramientas</h1></header>
              <div className="nv-tool-grid">
                {tools.map((tool) => <button key={tool.id} onClick={() => setSelected(tool.id)}><span>{tool.icon}</span><b>{tool.title}</b><ChevronRight size={15} /></button>)}
              </div>
              <small className="nv-version">v{APP_VERSION}</small>
            </>
          )}
        </section>
      )}
    </main>
  );
}

function ScanStage() {
  return <section className="nv-scan"><i /><h2>Analizando</h2><span /></section>;
}

function AgentRocket({ progress }: { progress: OptimizerProgress }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  return (
    <section className="nv-agent-flight">
      <Rocket size={26} />
      <div><b>{percent}%</b><span><i style={{ width: `${percent}%` }} /></span></div>
    </section>
  );
}

function RocketStage({ progress }: { progress: OptimizerProgress }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  return (
    <section className="nv-flight">
      <div className="nv-stars"><i /><i /><i /><i /><i /></div>
      <div className="nv-rocket"><Rocket size={54} /><span /></div>
      <strong>{percent}%</strong>
      <div className="nv-progress"><i style={{ width: `${percent}%` }} /></div>
    </section>
  );
}
