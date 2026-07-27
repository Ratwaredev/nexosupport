import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity,
  ArrowUpRight,
  Check,
  CircleAlert,
  Cpu,
  Gauge,
  HardDrive,
  Headphones,
  Laptop,
  LockKeyhole,
  Menu,
  Minus,
  Network,
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
import type { AssistantToolId, ProviderMessage, ProviderToolCall, ToolDefinition } from './lib/assistant';
import { readHardwareSensors, summarizeHardware } from './lib/sensors';
import type { HardwareSnapshot, SensorSummary } from './lib/sensors';

type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  report?: DiagnosticReport;
  hardware?: HardwareSnapshot;
  result?: AgentActionResult;
};

type Approval = { call: ProviderToolCall; tool: ToolDefinition };
type Inspection = { report: DiagnosticReport; hardware?: HardwareSnapshot };

const MESSAGE_KEY = 'nexo.chat.v4';
const CONTEXT_KEY = 'nexo.context.v4';
const LAST_CHECK_KEY = 'nexo.last-check.v4';
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

const recommendedConsent: UpdateConsentInput = {
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

const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const welcome = (): Message => ({ id: id(), role: 'assistant', text: 'Hola. ¿Qué está pasando con esta PC?' });

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || '') as T;
  } catch {
    return fallback;
  }
}

function consentInput(value: ClientDashboard['consent']): UpdateConsentInput {
  return value ? {
    assistantEnabled: value.assistantEnabled,
    shareDiagnostics: value.shareDiagnostics,
    automaticChecks: value.automaticChecks,
    hardwareSensors: value.hardwareSensors,
    elevatedSensors: value.elevatedSensors
  } : recommendedConsent;
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

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/supabase|service role|rpc|relation|column/i.test(message)) return 'NEXO todavía no está conectado al servidor. Probá el modo local o revisá la configuración.';
  if (/network|fetch|internet|failed to fetch/i.test(message)) return 'No pude conectarme con NEXO. Revisá Internet y probá otra vez.';
  if (/código|codigo|pairing/i.test(message)) return 'Ese código no funciona o ya venció. Pedí uno nuevo.';
  if (/permission|acceso|denied|rechaz/i.test(message)) return 'Windows no autorizó esa lectura. No se cambió nada.';
  return message || fallback;
}

function NexoMark({ size = 24 }: { size?: number }) {
  const gradientId = `nexo-${size}`;
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

export default function AssistantApp() {
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
  const [approval, setApproval] = useState<Approval | null>(null);
  const [menu, setMenu] = useState(false);
  const [permissions, setPermissions] = useState(false);
  const [draft, setDraft] = useState<UpdateConsentInput>(recommendedConsent);
  const [plan, setPlan] = useState('ACTIVO');
  const scrollRef = useRef<HTMLDivElement>(null);

  const device = dashboard?.device;
  const consent = dashboard?.consent ?? null;
  const active = session?.role === 'client' && Boolean(session.deviceToken);
  const summary = useMemo(() => hardware ? summarizeHardware(hardware) : null, [hardware]);
  const attention = useMemo(() => requiresAttention(report, summary), [report, summary]);
  const lastCheck = useMemo(() => {
    const value = Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
    if (!value) return 'Todavía no revisada';
    const minutes = Math.max(1, Math.round((Date.now() - value) / 60000));
    if (minutes < 60) return `Revisada hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `Revisada hace ${hours} h` : 'Revisada hoy';
  }, [report, hardware]);

  const addAssistant = (text: string, inspection?: Inspection, result?: AgentActionResult) => {
    setMessages((current) => [...current, {
      id: id(),
      role: 'assistant',
      text,
      report: inspection?.report,
      hardware: inspection?.hardware,
      result
    }]);
  };

  useEffect(() => {
    let mounted = true;
    void appBackend.bootstrap('client').then(async (restored) => {
      if (!mounted) return;
      setSession(restored);
      if (!restored?.deviceToken) return;
      const data = await appBackend.getClientDashboard(restored.deviceToken);
      if (!mounted) return;
      setDashboard(data);
      setPlan(data.entitlement?.plan?.toUpperCase() || 'ACTIVO');
      const latest = data.diagnostics[0]?.payload as unknown as DiagnosticReport | undefined;
      if (latest) setReport(latest);
      if (!data.consent) {
        setDraft(recommendedConsent);
        setPermissions(true);
      }
    }).catch(() => setSession(null)).finally(() => mounted && setBooting(false));
    void getAgentStatus().then(setAgent).catch(() => setAgent(null));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    localStorage.setItem(MESSAGE_KEY, JSON.stringify(messages.slice(-40)));
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [messages, busy, approval]);

  useEffect(() => {
    localStorage.setItem(CONTEXT_KEY, JSON.stringify(context.slice(-24)));
  }, [context]);

  useEffect(() => {
    if (!active || !consent?.automaticChecks || !consent.hardwareSensors) return;
    const check = async () => {
      if (Date.now() - Number(localStorage.getItem(LAST_CHECK_KEY) || 0) < CHECK_INTERVAL) return;
      try {
        const inspection = await inspect(true, false);
        localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
        const currentSummary = inspection.hardware ? summarizeHardware(inspection.hardware) : null;
        if (requiresAttention(inspection.report, currentSummary)) {
          addAssistant('Encontré algo que conviene revisar.', inspection);
        }
      } catch {
        // Una revisión automática nunca interrumpe al usuario.
      }
    };
    const first = window.setTimeout(() => void check(), 3000);
    const interval = window.setInterval(() => void check(), CHECK_INTERVAL);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [active, consent?.automaticChecks, consent?.hardwareSensors, device?.id]);

  function beginActivation() {
    const value = code.trim().toUpperCase();
    if (busy || value.length < 4) return;
    setPendingCode(value);
    setDraft(recommendedConsent);
    setPermissions(true);
  }

  async function finishActivation() {
    if (!pendingCode) return;
    setBusy('Activando esta PC');
    try {
      const initialReport = draft.hardwareSensors ? await runQuickDiagnostic() : null;
      const registered = await appBackend.registerClient({
        pairingCode: pendingCode,
        deviceName: initialReport?.computerName || 'Mi PC',
        issue: 'Activación',
        computerName: initialReport?.computerName || 'Equipo Windows',
        userName: initialReport?.userName || 'Usuario',
        os: initialReport?.os || 'Windows',
        platform: 'windows'
      });
      const token = registered.session.deviceToken || '';
      const savedConsent = await appBackend.saveConsents(token, draft);
      const data = await appBackend.getClientDashboard(token);
      setSession(registered.session);
      setDashboard({ ...data, consent: savedConsent });
      setReport(initialReport);
      setMessages([welcome()]);
      setContext([]);
      setPendingCode('');
      setPermissions(false);
      if (draft.hardwareSensors) {
        const snapshot = await readHardwareSensors(false);
        setHardware(snapshot);
      }
    } catch (error) {
      addAssistant(friendlyError(error, 'No pude activar esta PC.'));
      setPermissions(false);
    } finally {
      setBusy('');
    }
  }

  async function savePermissions() {
    if (pendingCode && !active) {
      await finishActivation();
      return;
    }
    if (!session?.deviceToken) return;
    setBusy('Guardando permisos');
    try {
      const normalized = {
        ...draft,
        shareDiagnostics: draft.assistantEnabled ? draft.shareDiagnostics : false,
        automaticChecks: draft.hardwareSensors ? draft.automaticChecks : false
      };
      const saved = await appBackend.saveConsents(session.deviceToken, normalized);
      setDashboard((current) => current ? { ...current, consent: saved } : current);
      setPermissions(false);
      addAssistant('Listo. Tus permisos quedaron guardados.');
      if (saved.hardwareSensors) setHardware(await readHardwareSensors(false));
    } catch (error) {
      addAssistant(friendlyError(error, 'No pude guardar los permisos.'));
    } finally {
      setBusy('');
    }
  }

  async function inspect(withSensors: boolean, elevated: boolean): Promise<Inspection> {
    if (!session?.deviceToken || !device) throw new Error('Esta PC todavía no está vinculada.');
    const [nextReport, nextHardware] = await Promise.all([
      runQuickDiagnostic(),
      withSensors ? readHardwareSensors(elevated) : Promise.resolve(null)
    ]);
    const nextSummary = nextHardware ? summarizeHardware(nextHardware) : null;
    if (nextSummary?.cpuTemperatureC != null || nextSummary?.gpuTemperatureC != null) {
      nextReport.maxTemperatureC = Math.max(nextSummary.cpuTemperatureC ?? 0, nextSummary.gpuTemperatureC ?? 0);
      nextReport.temperatureNote = nextSummary.note;
    }
    setReport(nextReport);
    if (nextHardware) setHardware(nextHardware);
    if (consent?.shareDiagnostics) {
      await appBackend.saveDiagnostic({ deviceId: device.id, payload: { ...nextReport, hardware: nextHardware } }, session.deviceToken);
    }
    return { report: nextReport, hardware: nextHardware ?? undefined };
  }

  async function manualCheck() {
    if (busy) return;
    if (!consent) {
      setDraft(recommendedConsent);
      setPermissions(true);
      return;
    }
    if (!consent.hardwareSensors) {
      setDraft(consentInput(consent));
      setPermissions(true);
      return;
    }
    setBusy('Revisando esta PC');
    try {
      const inspection = await inspect(true, false);
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      addAssistant('Revisión terminada.', inspection);
    } catch (error) {
      addAssistant(friendlyError(error, 'No pude revisar el equipo.'));
    } finally {
      setBusy('');
    }
  }

  async function readSensors(elevated = false) {
    if (!consent?.hardwareSensors) {
      setDraft(consentInput(consent));
      setPermissions(true);
      return;
    }
    setBusy(elevated ? 'Esperando permiso de Windows' : 'Leyendo temperatura');
    try {
      const snapshot = await readHardwareSensors(elevated);
      setHardware(snapshot);
      addAssistant(snapshot.sensors.length ? 'Lectura de hardware terminada.' : snapshot.note, { report: report ?? await runQuickDiagnostic(), hardware: snapshot });
      if (elevated && snapshot.elevated && session?.deviceToken) {
        const saved = await appBackend.saveConsents(session.deviceToken, { ...consentInput(consent), elevatedSensors: true });
        setDashboard((current) => current ? { ...current, consent: saved } : current);
      }
    } catch (error) {
      addAssistant(friendlyError(error, 'No pude leer los sensores.'));
    } finally {
      setBusy('');
    }
  }

  async function send(text: string) {
    const value = text.trim();
    if (!value || busy || approval || !active) return;
    if (!consent?.assistantEnabled) {
      setDraft(consentInput(consent));
      setPermissions(true);
      return;
    }
    setInput('');
    setMessages((current) => [...current, { id: id(), role: 'user', text: value }]);
    const next = [...context, { role: 'user', content: value } as ProviderMessage].slice(-24);
    setContext(next);
    await ask(next);
  }

  async function ask(currentContext: ProviderMessage[], depth = 0): Promise<void> {
    if (!session?.deviceToken || depth > 4) return;
    setBusy(depth ? 'Interpretando el resultado' : 'Buscando una solución');
    try {
      const response = await requestAssistant({
        deviceToken: session.deviceToken,
        messages: currentContext,
        diagnostic: consent?.shareDiagnostics ? report : null,
        hardware: consent?.shareDiagnostics ? summary : null,
        agentStatus: agent,
        appVersion: APP_VERSION
      });
      if (response.entitlement?.plan) setPlan(response.entitlement.plan.toUpperCase());
      const assistantMessage = response.message;
      const next = [...currentContext, assistantMessage].slice(-24);
      setContext(next);
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
      const result = await execute(call.function.name);
      if (!consent?.shareDiagnostics) {
        addAssistant('El resultado quedó solo en esta PC. Podés habilitar “Compartir diagnóstico” para que NEXO lo interprete.');
        return;
      }
      const toolMessage: ProviderMessage = {
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: normalizeToolResult(result)
      };
      const withResult = [...next, toolMessage].slice(-24);
      setContext(withResult);
      await ask(withResult, depth + 1);
    } catch (error) {
      addAssistant(friendlyError(error, 'No pude responder. No hice cambios.'));
    } finally {
      setBusy('');
    }
  }

  async function execute(tool: AssistantToolId): Promise<AgentActionResult | DiagnosticReport | HardwareSnapshot> {
    setBusy(TOOL_CATALOG[tool].progressLabel);
    if (tool === 'run_quick_diagnostic') {
      const inspection = await inspect(Boolean(consent?.hardwareSensors), false);
      addAssistant('Revisión terminada.', inspection);
      return inspection.report;
    }
    if (tool === 'remote_support') return remoteSupport();
    const actionMap: Record<Exclude<AssistantToolId, 'run_quick_diagnostic' | 'remote_support'>, string> = {
      network_check: 'network_check',
      scan_temp_files: 'temp_scan',
      startup_review: 'startup_review',
      defender_status: 'defender_status',
      clean_temp_files: 'clean_temp_files',
      repair_network: 'repair_network',
      defender_quick_scan: 'defender_quick_scan',
      open_windows_update: 'windows_update'
    };
    const result = await runAgentAction(actionMap[tool]);
    addAssistant(result.message, undefined, result);
    return result;
  }

  async function remoteSupport(): Promise<AgentActionResult> {
    if (!session?.deviceToken || !device) return { action: 'remote_support', ok: false, message: 'Esta PC no está vinculada.', details: [] };
    const issue = [...messages].reverse().find((message) => message.role === 'user')?.text || 'Solicita asistencia';
    const ticket = await appBackend.createTicket({ deviceId: device.id, issue, clientName: device.displayName, priority: 'normal' }, session.deviceToken);
    const remote = await appBackend.createRemoteSession({ deviceId: device.id, ticketId: ticket.id }, session.deviceToken);
    await openRemoteTool();
    return { action: 'remote_support', ok: true, message: 'La asistencia quedó preparada.', details: [`Código ${remote.code}`] };
  }

  async function approveAction() {
    if (!approval) return;
    const current = approval;
    setApproval(null);
    try {
      const result = await execute(current.call.function.name);
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
    } catch (error) {
      addAssistant(friendlyError(error, 'No pude completar la acción.'));
    } finally {
      setBusy('');
    }
  }

  const hide = () => isTauriRuntime() ? safeInvoke('hide_main_window') : Promise.resolve();
  const minimize = () => isTauriRuntime() ? safeInvoke('minimize_main_window') : Promise.resolve();
  const openAdmin = () => isTauriRuntime() ? safeInvoke('open_admin_window') : Promise.resolve();
  const exit = () => isTauriRuntime() ? safeInvoke('exit_app') : Promise.resolve();

  if (booting) {
    return <main className="nexo-popup boot"><NexoMark size={38} /><span>Abriendo NEXO</span><i /></main>;
  }

  return (
    <main className="nexo-popup">
      <header className="topbar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region><NexoMark /><span><b>NEXO</b><small>Support</small></span></div>
        <div className={`top-status ${attention ? 'warning' : 'good'}`} data-tauri-drag-region><i />{active ? (attention ? 'REVISAR' : 'ACTIVO') : 'SIN ACTIVAR'}</div>
        <div className="window-buttons">
          <button aria-label="Menú" onClick={() => setMenu((value) => !value)}><Menu size={15} /></button>
          <button aria-label="Minimizar" onClick={() => void minimize()}><Minus size={14} /></button>
          <button aria-label="Ocultar" onClick={() => void hide()}><X size={14} /></button>
        </div>
        {menu && (
          <div className="menu">
            <button onClick={() => { setMenu(false); void manualCheck(); }}><RefreshCw size={15} /> Revisar esta PC</button>
            <button onClick={() => { setMenu(false); setDraft(consentInput(consent)); setPermissions(true); }}><ShieldCheck size={15} /> Privacidad y permisos</button>
            <button onClick={() => { setMenu(false); void openAdmin(); }}><Settings2 size={15} /> Administración <ArrowUpRight size={13} /></button>
            <button onClick={() => { setMessages([welcome()]); setContext([]); setMenu(false); }}><Trash2 size={15} /> Nueva conversación</button>
            <button className="danger" onClick={() => void exit()}><Power size={15} /> Cerrar NEXO</button>
          </div>
        )}
      </header>

      <section className="chat" ref={scrollRef}>
        {!active ? (
          <Activation />
        ) : (
          <>
            <StatusCard report={report} summary={summary} warning={attention} lastCheck={lastCheck} onCheck={() => void manualCheck()} busy={Boolean(busy)} />
            <QuickActions onCheck={() => void manualCheck()} onNetwork={() => void send('No tengo Internet')} onTemperature={() => void readSensors(false)} onSupport={() => void send('Quiero hablar con un técnico')} />
            <div className="conversation-title"><span>Conversación</span><i /></div>
            {messages.map((message) => <Bubble key={message.id} message={message} onElevate={() => void readSensors(true)} />)}
            {approval && <ApprovalCard approval={approval} onApprove={() => void approveAction()} onCancel={() => setApproval(null)} />}
            {busy && <Working label={busy} />}
          </>
        )}
      </section>

      <footer className="composer-area">
        {!active ? (
          <form onSubmit={(event) => { event.preventDefault(); beginActivation(); }}>
            <div className="activation-field"><LockKeyhole size={16} /><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Código de activación" /></div>
            <button aria-label="Continuar" disabled={Boolean(busy) || code.trim().length < 4}><ArrowUpRight size={17} /></button>
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
              placeholder={consent?.assistantEnabled ? 'Escribí qué pasa…' : 'Activá el asistente para conversar'}
              rows={1}
              disabled={Boolean(busy) || Boolean(approval)}
            />
            <button aria-label="Enviar" disabled={!input.trim() || Boolean(busy) || Boolean(approval)}><Send size={17} /></button>
          </form>
        )}
        <div className="footer-meta"><span>{active ? `${plan} · ${lastCheck}` : 'El código te lo entrega NEXO'}</span><span>v{APP_VERSION}</span></div>
      </footer>

      {permissions && (
        <Permissions
          value={draft}
          activation={Boolean(pendingCode && !active)}
          onChange={setDraft}
          onSave={() => void savePermissions()}
          onClose={() => { if (!pendingCode) setPermissions(false); }}
          busy={Boolean(busy)}
        />
      )}
    </main>
  );
}

function Activation() {
  return (
    <div className="activation">
      <div className="activation-mark"><NexoMark size={44} /></div>
      <span>NEXO Support</span>
      <h1>Ayuda para tu PC, sin vueltas.</h1>
      <p>Ingresá el código que te dieron. Después podés revisar el equipo o pedir ayuda escribiendo como hablás.</p>
      <div className="activation-points">
        <div><ShieldCheck size={17} /><span><b>Vos autorizás</b><small>Nada se lee ni cambia sin permiso.</small></span></div>
        <div><Check size={17} /><span><b>Explicaciones simples</b><small>Resultados claros, sin datos técnicos innecesarios.</small></span></div>
        <div><Headphones size={17} /><span><b>Soporte humano</b><small>Un técnico puede continuar cuando haga falta.</small></span></div>
      </div>
    </div>
  );
}

function StatusCard({ report, summary, warning, lastCheck, onCheck, busy }: {
  report: DiagnosticReport | null;
  summary: SensorSummary | null;
  warning: boolean;
  lastCheck: string;
  onCheck: () => void;
  busy: boolean;
}) {
  const ram = report?.ramTotalGb ? Math.round((1 - report.ramFreeGb / report.ramTotalGb) * 100) : null;
  const disk = report?.systemDriveFreeGb != null ? Math.round(report.systemDriveFreeGb) : null;
  return (
    <section className={`care-card ${warning ? 'warning' : 'good'}`}>
      <header>
        <span className="health-icon"><ShieldCheck size={20} /></span>
        <div><small>Estado del equipo</small><b>{report ? (warning ? 'Hay algo para revisar' : 'Todo está bien') : 'Lista para revisar'}</b><p>{lastCheck}</p></div>
        <button onClick={onCheck} disabled={busy}><RefreshCw className={busy ? 'spin' : ''} size={15} /><span>Revisar</span></button>
      </header>
      <div className="health-metrics">
        <MetricValue icon={<Thermometer />} value={summary?.cpuTemperatureC != null ? `${Math.round(summary.cpuTemperatureC)}°` : '—'} label="CPU" />
        <MetricValue icon={<Activity />} value={ram != null ? `${ram}%` : '—'} label="RAM" />
        <MetricValue icon={<HardDrive />} value={disk != null ? `${disk} GB` : '—'} label="Libres" />
        <MetricValue icon={<ShieldCheck />} value={report ? (report.defenderStatus === 'Activo' ? 'Bien' : 'Revisar') : '—'} label="Seguridad" />
      </div>
    </section>
  );
}

function MetricValue({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return <span>{icon}<b>{value}</b><small>{label}</small></span>;
}

function QuickActions({ onCheck, onNetwork, onTemperature, onSupport }: { onCheck: () => void; onNetwork: () => void; onTemperature: () => void; onSupport: () => void }) {
  return (
    <div className="quick-actions">
      <QuickAction icon={<Gauge />} label="Revisar" onClick={onCheck} />
      <QuickAction icon={<WifiOff />} label="Internet" onClick={onNetwork} />
      <QuickAction icon={<Thermometer />} label="Temperatura" onClick={onTemperature} />
      <QuickAction icon={<Headphones />} label="Técnico" onClick={onSupport} />
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button onClick={onClick}><span>{icon}</span><b>{label}</b></button>;
}

function Bubble({ message, onElevate }: { message: Message; onElevate: () => void }) {
  return (
    <article className={`bubble-row ${message.role}`}>
      {message.role === 'assistant' && <span className="avatar"><NexoMark size={15} /></span>}
      <div className="bubble">
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
    <div className="diagnostic">
      <DiagnosticMetric icon={<Activity />} label="Memoria" value={`${ram}%`} progress={ram} warning={ram > 85} />
      <DiagnosticMetric icon={<HardDrive />} label="Disco usado" value={`${disk}%`} progress={disk} warning={disk > 88} />
      <DiagnosticMetric icon={<ShieldCheck />} label="Seguridad" value={report.defenderStatus === 'Activo' ? 'Protegida' : 'Revisar'} progress={report.defenderStatus === 'Activo' ? 100 : 40} warning={report.defenderStatus !== 'Activo'} />
    </div>
  );
}

function DiagnosticMetric({ icon, label, value, progress, warning }: { icon: ReactNode; label: string; value: string; progress: number; warning: boolean }) {
  return (
    <div className={warning ? 'warning' : ''}>
      <header><span>{icon}{label}</span><b>{value}</b></header>
      <i><em style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} /></i>
    </div>
  );
}

function Hardware({ snapshot, onElevate }: { snapshot: HardwareSnapshot; onElevate: () => void }) {
  const summary = summarizeHardware(snapshot);
  return (
    <div className="hardware">
      <div className="hardware-grid">
        <span><small>CPU</small><b>{summary.cpuTemperatureC != null ? `${Math.round(summary.cpuTemperatureC)}°C` : 'Sin dato'}</b></span>
        <span><small>GPU</small><b>{summary.gpuTemperatureC != null ? `${Math.round(summary.gpuTemperatureC)}°C` : 'Sin dato'}</b></span>
        <span><small>Disco</small><b>{summary.storageTemperatureC != null ? `${Math.round(summary.storageTemperatureC)}°C` : 'Sin dato'}</b></span>
        <span><small>Ventilador</small><b>{summary.fanRpm != null ? `${Math.round(summary.fanRpm)} rpm` : 'Sin dato'}</b></span>
      </div>
      <p>{snapshot.note}</p>
      {snapshot.permissionRequired && <button onClick={onElevate}><LockKeyhole size={13} /> Leer más sensores con permiso de Windows</button>}
    </div>
  );
}

function Result({ result }: { result: AgentActionResult }) {
  return (
    <div className={`result ${result.ok ? '' : 'bad'}`}>
      {result.ok ? <Check size={14} /> : <CircleAlert size={14} />}
      <span><b>{result.ok ? 'Listo' : 'No se pudo completar'}</b><small>{result.message}</small></span>
    </div>
  );
}

function ApprovalCard({ approval, onApprove, onCancel }: { approval: Approval; onApprove: () => void; onCancel: () => void }) {
  return (
    <div className="approval">
      <span><Wrench size={18} /></span>
      <div><small>Necesita tu permiso</small><b>{approval.tool.label}</b><p>{approval.tool.description}</p></div>
      <footer><button onClick={onApprove}>Sí, continuar</button><button onClick={onCancel}>Ahora no</button></footer>
    </div>
  );
}

function Working({ label }: { label: string }) {
  return <div className="thinking"><Laptop size={16} /><span><b>{label}</b><small>No estoy haciendo otros cambios.</small></span><i /></div>;
}

function Permissions({ value, activation, onChange, onSave, onClose, busy }: {
  value: UpdateConsentInput;
  activation: boolean;
  onChange: (value: UpdateConsentInput) => void;
  onSave: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const setPreset = (preset: UpdateConsentInput) => onChange(preset);
  const toggle = (key: keyof UpdateConsentInput) => {
    const next = { ...value, [key]: !value[key] };
    if (key === 'assistantEnabled' && !next.assistantEnabled) next.shareDiagnostics = false;
    if (key === 'hardwareSensors' && !next.hardwareSensors) next.automaticChecks = false;
    onChange(next);
  };
  return (
    <div className="permission-backdrop">
      <section className="permission-sheet">
        <header>
          <div><small>{activation ? 'Antes de empezar' : 'Privacidad'}</small><h2>Elegí cómo querés usar NEXO.</h2></div>
          {!activation && <button aria-label="Cerrar" onClick={onClose}><X size={17} /></button>}
        </header>
        <p>Podés cambiar esto después. Las acciones que modifican Windows siempre piden otra confirmación.</p>
        <div className="preset-grid">
          <button className={value.assistantEnabled && value.shareDiagnostics ? 'selected' : ''} onClick={() => setPreset(recommendedConsent)}>
            <ShieldCheck size={18} /><span><b>Recomendado</b><small>NEXO conversa, revisa y puede interpretar el diagnóstico.</small></span><i>{value.assistantEnabled && value.shareDiagnostics && <Check size={13} />}</i>
          </button>
          <button className={!value.assistantEnabled && value.hardwareSensors ? 'selected' : ''} onClick={() => setPreset(localConsent)}>
            <Cpu size={18} /><span><b>Solo en esta PC</b><small>Revisa localmente sin enviar mensajes ni diagnóstico.</small></span><i>{!value.assistantEnabled && value.hardwareSensors && <Check size={13} />}</i>
          </button>
        </div>
        <div className="permission-list">
          <PermissionRow enabled={value.assistantEnabled} icon={<Network />} title="Conversar con NEXO" detail="Envía únicamente lo que escribís." onClick={() => toggle('assistantEnabled')} />
          <PermissionRow enabled={value.hardwareSensors} icon={<Cpu />} title="Revisar estado y temperatura" detail="Lee datos del equipo de forma local." onClick={() => toggle('hardwareSensors')} />
          <PermissionRow enabled={value.shareDiagnostics} disabled={!value.assistantEnabled} icon={<ShieldCheck />} title="Compartir diagnóstico" detail="Envía un resumen técnico, nunca tus archivos." onClick={() => toggle('shareDiagnostics')} />
          <PermissionRow enabled={value.automaticChecks} disabled={!value.hardwareSensors} icon={<RefreshCw />} title="Revisar automáticamente" detail="Chequeo liviano cada cuatro horas." onClick={() => toggle('automaticChecks')} />
        </div>
        <button className="save" onClick={onSave} disabled={busy || !value.hardwareSensors && !value.assistantEnabled}>{busy ? 'Guardando…' : activation ? 'Activar esta PC' : 'Guardar cambios'}</button>
        <small>NEXO funciona aunque elijas el modo local.</small>
      </section>
    </div>
  );
}

function PermissionRow({ enabled, disabled = false, icon, title, detail, onClick }: { enabled: boolean; disabled?: boolean; icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button disabled={disabled} onClick={onClick}>
      <span>{icon}</span>
      <div><b>{title}</b><small>{detail}</small></div>
      <i className={enabled ? 'on' : ''}>{enabled && <Check size={12} />}</i>
    </button>
  );
}
