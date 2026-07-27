import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity,
  Check,
  CircleAlert,
  Cpu,
  Gauge,
  HardDrive,
  Headphones,
  MessageCircle,
  Minus,
  MoreHorizontal,
  Network,
  Power,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Trash2,
  WifiOff,
  Wrench,
  X
} from 'lucide-react';
import { appBackend, backendConfig } from './lib/backend';
import type { AppSession, ClientDashboard } from './lib/domain';
import { APP_VERSION } from './lib/domain';
import { runQuickDiagnostic } from './lib/diagnostics';
import type { DiagnosticReport } from './lib/diagnostics';
import { getAgentStatus, runAgentAction } from './lib/agent';
import type { AgentActionResult, AgentStatus } from './lib/agent';
import { openRemoteTool } from './lib/support';
import { isTauriRuntime, safeInvoke } from './lib/tauri';
import { normalizeToolResult, requestAssistant, TOOL_CATALOG } from './lib/assistant';
import type { AssistantToolId, ProviderMessage, ProviderToolCall, ToolDefinition } from './lib/assistant';

type UiMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  diagnostic?: DiagnosticReport;
  result?: AgentActionResult;
};

type Approval = { call: ProviderToolCall; tool: ToolDefinition };

type CareState = {
  label: string;
  detail: string;
  tone: 'good' | 'warning' | 'danger';
};

const MSG_KEY = 'nexo.chat.v2';
const CTX_KEY = 'nexo.context.v2';
const CHECK_KEY = 'nexo.last-check.v2';
const CHECK_MS = 4 * 60 * 60 * 1000;
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const welcome = (): UiMessage => ({
  id: id(),
  role: 'assistant',
  text: 'Hola. Soy NEXO. Contame qué pasa o elegí una opción.'
});

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || '') as T;
  } catch {
    return fallback;
  }
}

function needsAttention(report: DiagnosticReport) {
  const disk = report.systemDriveTotalGb ? report.systemDriveFreeGb / report.systemDriveTotalGb : 1;
  const ram = report.ramTotalGb ? report.ramFreeGb / report.ramTotalGb : 1;
  return disk < 0.12 || ram < 0.12 || report.defenderStatus !== 'Activo' || report.pendingReboot || (report.maxTemperatureC ?? 0) >= 85;
}

function getCareState(report: DiagnosticReport | null): CareState {
  if (!report) {
    return { label: 'Lista para revisar', detail: 'Todavía no hice un chequeo completo', tone: 'warning' };
  }
  if (needsAttention(report)) {
    return { label: 'Hay algo para revisar', detail: 'NEXO encontró una mejora posible', tone: 'warning' };
  }
  return { label: 'Tu PC está protegida', detail: 'No encontré problemas importantes', tone: 'good' };
}

export default function AssistantApp() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [dashboard, setDashboard] = useState<ClientDashboard | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>(() => load(MSG_KEY, [welcome()]));
  const [context, setContext] = useState<ProviderMessage[]>(() => load(CTX_KEY, []));
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport | null>(null);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [code, setCode] = useState(backendConfig.backendKind === 'local' ? 'DEMO-PAIR' : '');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState('');
  const [approval, setApproval] = useState<Approval | null>(null);
  const [menu, setMenu] = useState(false);
  const [plan, setPlan] = useState('Protección activa');
  const scroll = useRef<HTMLDivElement>(null);

  const activated = session?.role === 'client' && Boolean(session.deviceToken);
  const device = dashboard?.device;
  const careState = useMemo(() => getCareState(diagnostic), [diagnostic]);

  useEffect(() => {
    let alive = true;
    void appBackend.bootstrap().then(async restored => {
      if (!alive) return;
      if (restored?.role === 'admin') {
        await appBackend.signOut();
        setSession(null);
        return;
      }
      setSession(restored);
      if (restored?.deviceToken) {
        const data = await appBackend.getClientDashboard(restored.deviceToken);
        if (!alive) return;
        setDashboard(data);
        const latest = data.diagnostics[0]?.payload as unknown as DiagnosticReport | undefined;
        if (latest) setDiagnostic(latest);
      }
    }).catch(() => setSession(null)).finally(() => alive && setBooting(false));
    void getAgentStatus().then(setAgent).catch(() => setAgent(null));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    localStorage.setItem(MSG_KEY, JSON.stringify(messages.slice(-40)));
    requestAnimationFrame(() => {
      if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    });
  }, [messages, busy, approval]);

  useEffect(() => {
    localStorage.setItem(CTX_KEY, JSON.stringify(context.slice(-24)));
  }, [context]);

  useEffect(() => {
    if (!activated || !session?.deviceToken || !device) return;
    const check = async () => {
      if (Date.now() - Number(localStorage.getItem(CHECK_KEY) || 0) < CHECK_MS) return;
      try {
        const report = await runQuickDiagnostic();
        setDiagnostic(report);
        localStorage.setItem(CHECK_KEY, String(Date.now()));
        await appBackend.saveDiagnostic(
          { deviceId: device.id, payload: report as unknown as Record<string, unknown> },
          session.deviceToken ?? ''
        );
        if (needsAttention(report)) {
          addBot('Encontré algo que conviene revisar. Te lo explico sin tecnicismos.', report);
        }
      } catch {
        // La revisión de fondo nunca interrumpe al usuario.
      }
    };
    const first = window.setTimeout(() => void check(), 2500);
    const timer = window.setInterval(() => void check(), CHECK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [activated, session?.deviceToken, device]);

  const addBot = (text: string, report?: DiagnosticReport, result?: AgentActionResult) => {
    setMessages(old => [...old, { id: id(), role: 'assistant', text, diagnostic: report, result }]);
  };

  const addUser = (text: string) => {
    setMessages(old => [...old, { id: id(), role: 'user', text }]);
  };

  async function activate() {
    if (busy || code.trim().length < 4) return;
    setBusy('Vinculando esta PC con NEXO');
    try {
      const report = await runQuickDiagnostic();
      const registered = await appBackend.registerClient({
        pairingCode: code.trim().toUpperCase(),
        deviceName: report.computerName || 'Mi PC',
        issue: 'Activación de NEXO Support',
        computerName: report.computerName,
        userName: report.userName,
        os: report.os,
        platform: 'windows'
      });
      const data = await appBackend.getClientDashboard(registered.session.deviceToken ?? '');
      setSession(registered.session);
      setDashboard(data);
      setDiagnostic(report);
      setContext([]);
      setMessages([
        welcome(),
        { id: id(), role: 'assistant', text: 'Listo. Esta PC ya está cuidada. Podés cerrar la ventana: sigo disponible en la bandeja.' }
      ]);
      await appBackend.saveDiagnostic(
        { deviceId: registered.device.id, payload: report as unknown as Record<string, unknown> },
        registered.session.deviceToken ?? ''
      );
    } catch (error) {
      addBot(error instanceof Error ? error.message : 'Ese código no es válido. Pedile uno nuevo a NEXO.');
    } finally {
      setBusy('');
    }
  }

  async function send(text: string) {
    const value = text.trim();
    if (!value || busy || approval || !activated) return;
    setInput('');
    addUser(value);
    const next = [...context, { role: 'user', content: value } as ProviderMessage].slice(-24);
    setContext(next);
    await ask(next);
  }

  async function ask(ctx: ProviderMessage[], depth = 0): Promise<void> {
    if (!session?.deviceToken || depth > 4) return;
    setBusy(depth ? 'Interpretando el resultado' : 'Pensando la mejor solución');
    try {
      const response = await requestAssistant({
        deviceToken: session.deviceToken,
        messages: ctx,
        diagnostic,
        agentStatus: agent,
        appVersion: APP_VERSION
      });
      if (response.entitlement?.plan) setPlan(`Plan ${response.entitlement.plan}`);
      const assistant = response.message;
      const next = [...ctx, assistant].slice(-24);
      setContext(next);
      if (assistant.content) addBot(assistant.content);
      const call = assistant.tool_calls?.[0];
      if (!call) return;
      const tool = TOOL_CATALOG[call.function.name];
      if (!tool) {
        addBot('No voy a ejecutar esa acción porque no está autorizada.');
        return;
      }
      if (tool.mode === 'read') {
        const result = await execute(call.function.name);
        const toolMessage: ProviderMessage = {
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: normalizeToolResult(result)
        };
        const withResult = [...next, toolMessage].slice(-24);
        setContext(withResult);
        await ask(withResult, depth + 1);
      } else {
        setApproval({ call, tool });
      }
    } catch (error) {
      addBot(error instanceof Error ? error.message : 'No pude responder ahora. No hice ningún cambio.');
    } finally {
      setBusy('');
    }
  }

  async function execute(tool: AssistantToolId): Promise<AgentActionResult | DiagnosticReport> {
    setBusy(TOOL_CATALOG[tool].progressLabel);
    if (tool === 'run_quick_diagnostic') {
      const report = await runQuickDiagnostic();
      setDiagnostic(report);
      addBot('Terminé la revisión. Esto es lo importante:', report);
      if (session?.deviceToken && device) {
        await appBackend.saveDiagnostic(
          { deviceId: device.id, payload: report as unknown as Record<string, unknown> },
          session.deviceToken
        );
      }
      return report;
    }
    if (tool === 'remote_support') return remoteSupport();
    const map: Record<Exclude<AssistantToolId, 'run_quick_diagnostic' | 'remote_support'>, string> = {
      network_check: 'network_check',
      scan_temp_files: 'temp_scan',
      startup_review: 'startup_review',
      defender_status: 'defender_status',
      clean_temp_files: 'clean_temp_files',
      repair_network: 'repair_network',
      defender_quick_scan: 'defender_quick_scan',
      open_windows_update: 'windows_update'
    };
    const result = await runAgentAction(map[tool]);
    addBot(result.message, undefined, result);
    return result;
  }

  async function remoteSupport(): Promise<AgentActionResult> {
    if (!session?.deviceToken || !device) {
      return { action: 'remote_support', ok: false, message: 'Esta PC todavía no está vinculada.', details: [] };
    }
    const userMessages = messages.filter(message => message.role === 'user');
    const issue = userMessages[userMessages.length - 1]?.text || 'El usuario solicita asistencia técnica.';
    const ticket = await appBackend.createTicket(
      { deviceId: device.id, issue, clientName: device.displayName, priority: 'normal' },
      session.deviceToken
    );
    const remote = await appBackend.createRemoteSession(
      { deviceId: device.id, ticketId: ticket.id },
      session.deviceToken
    );
    await openRemoteTool();
    return {
      action: 'remote_support',
      ok: true,
      message: 'La asistencia técnica quedó preparada.',
      details: [`Código ${remote.code}. Un técnico de NEXO puede continuar.`]
    };
  }

  async function approve() {
    if (!approval) return;
    const current = approval;
    setApproval(null);
    try {
      const result = await execute(current.call.function.name);
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
      addBot(error instanceof Error ? error.message : 'No pude completar la acción. No hice otros cambios.');
    } finally {
      setBusy('');
    }
  }

  function reject() {
    if (!approval) return;
    const toolMessage: ProviderMessage = {
      role: 'tool',
      tool_call_id: approval.call.id,
      name: approval.call.function.name,
      content: JSON.stringify({ ok: false, cancelledByUser: true })
    };
    const next = [...context, toolMessage].slice(-24);
    setApproval(null);
    setContext(next);
    addBot('Perfecto. No cambié nada.');
    void ask(next, 1);
  }

  const lastCheck = useMemo(() => {
    const value = Number(localStorage.getItem(CHECK_KEY) || 0);
    if (!value) return 'Todavía no revisé esta PC';
    const minutes = Math.max(1, Math.round((Date.now() - value) / 60000));
    return minutes < 60 ? `Revisada hace ${minutes} min` : `Revisada hace ${Math.round(minutes / 60)} h`;
  }, [diagnostic, messages]);

  const hide = () => isTauriRuntime() ? safeInvoke('hide_main_window') : Promise.resolve();
  const minimize = () => isTauriRuntime() ? safeInvoke('minimize_main_window') : Promise.resolve();
  const exit = () => isTauriRuntime() ? safeInvoke('exit_app') : Promise.resolve();
  const reset = () => {
    setMessages([welcome()]);
    setContext([]);
    setApproval(null);
    setMenu(false);
  };

  if (booting) {
    return (
      <main className="nexo-popup boot">
        <NexoMark size={46} animated />
        <div className="boot-copy">
          <strong>Preparando NEXO</strong>
          <span>Chequeando que todo esté listo…</span>
        </div>
        <div className="boot-progress"><i /></div>
      </main>
    );
  }

  return (
    <main className="nexo-popup">
      <header className="topbar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <NexoMark size={28} />
          <div>
            <strong>NEXO</strong>
            <span>Support</span>
          </div>
        </div>

        <div className={`top-status ${activated ? 'active' : ''}`} data-tauri-drag-region>
          <i />
          <span>{activated ? plan : 'Sin activar'}</span>
        </div>

        <div className="window-buttons">
          <button aria-label="Más opciones" onClick={() => setMenu(value => !value)}><MoreHorizontal size={16} /></button>
          <button aria-label="Minimizar" onClick={() => void minimize()}><Minus size={15} /></button>
          <button aria-label="Ocultar" onClick={() => void hide()}><X size={15} /></button>
        </div>

        {menu && (
          <div className="menu">
            <button onClick={() => void send('Revisá mi PC ahora')}><RefreshCw size={15} /> Revisar ahora</button>
            <button onClick={reset}><Trash2 size={15} /> Limpiar chat</button>
            <button className="danger" onClick={() => void exit()}><Power size={15} /> Cerrar NEXO</button>
          </div>
        )}
      </header>

      <section className="chat" ref={scroll}>
        {!activated ? (
          <Activation />
        ) : (
          <>
            <CareCard state={careState} lastCheck={lastCheck} onCheck={() => void send('Revisá mi PC ahora')} busy={Boolean(busy)} />

            <div className="conversation-label"><span>Conversación</span><i /></div>
            {messages.map(message => <Bubble key={message.id} message={message} />)}

            {messages.length <= 2 && !busy && (
              <div className="quick-grid">
                <QuickAction icon={<Gauge size={20} />} tone="purple" label="PC lenta" hint="Detectar qué la frena" onClick={() => void send('Mi PC está lenta')} />
                <QuickAction icon={<WifiOff size={20} />} tone="blue" label="Sin Internet" hint="Revisar red y DNS" onClick={() => void send('No tengo Internet')} />
                <QuickAction icon={<ShieldCheck size={20} />} tone="green" label="Revisar PC" hint="Chequeo completo" onClick={() => void send('Revisá mi PC ahora')} />
                <QuickAction icon={<Headphones size={20} />} tone="orange" label="Técnico" hint="Pedir ayuda humana" onClick={() => void send('Quiero hablar con un técnico')} />
              </div>
            )}

            {approval && <ApprovalCard approval={approval} approve={() => void approve()} reject={reject} />}
            {busy && <Thinking label={busy} />}
          </>
        )}
      </section>

      <footer className="composer-area">
        {!activated ? (
          <form className="activation-form" onSubmit={event => { event.preventDefault(); void activate(); }}>
            <div className="activation-input">
              <ShieldCheck size={18} />
              <input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="Código de activación" />
            </div>
            <button aria-label="Activar" disabled={busy.length > 0 || code.trim().length < 4}><Send size={18} /></button>
          </form>
        ) : (
          <form className="composer" onSubmit={(event: FormEvent) => { event.preventDefault(); void send(input); }}>
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Contame qué pasa…"
              rows={1}
              disabled={Boolean(busy) || Boolean(approval)}
            />
            <button aria-label="Enviar" disabled={!input.trim() || Boolean(busy) || Boolean(approval)}><Send size={18} /></button>
          </form>
        )}
        <div className="foot"><span>{activated ? lastCheck : 'El código te lo entrega NEXO'}</span><span>v{APP_VERSION}</span></div>
      </footer>
    </main>
  );
}

function NexoMark({ size = 28, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg className={`nexo-mark ${animated ? 'animated' : ''}`} width={size} height={size} viewBox="0 0 62 54" aria-hidden="true">
      <defs>
        <linearGradient id="nexo-mark-gradient" x1="4" y1="4" x2="58" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8d3cff" />
          <stop offset="0.5" stopColor="#5948ff" />
          <stop offset="1" stopColor="#168fff" />
        </linearGradient>
      </defs>
      <path d="M4 4h13.4L31 20.8 44.6 4H58L38.1 27 58 50H44.6L31 33.2 17.4 50H4l19.9-23z" fill="url(#nexo-mark-gradient)" />
    </svg>
  );
}

function Activation() {
  return (
    <div className="activation">
      <div className="activation-visual">
        <div className="activation-halo halo-one" />
        <div className="activation-halo halo-two" />
        <NexoMark size={72} animated />
        <Sparkles className="spark spark-one" size={15} />
        <Sparkles className="spark spark-two" size={12} />
      </div>
      <span className="activation-kicker">Asistente para Windows</span>
      <h1>Tu PC, cuidada por NEXO.</h1>
      <p>Ingresá el código que te dieron. Después solo tenés que contarme qué pasa.</p>
      <div className="activation-benefits">
        <div><ShieldCheck size={17} /><span><b>Revisión clara</b><small>Sin palabras técnicas</small></span></div>
        <div><Check size={17} /><span><b>Siempre con permiso</b><small>Nada cambia solo</small></span></div>
        <div><Headphones size={17} /><span><b>Ayuda humana</b><small>Cuando realmente haga falta</small></span></div>
      </div>
    </div>
  );
}

function CareCard({ state, lastCheck, onCheck, busy }: { state: CareState; lastCheck: string; onCheck: () => void; busy: boolean }) {
  return (
    <section className={`care-card ${state.tone}`}>
      <div className="care-orb">
        <div className="care-ring" />
        <ShieldCheck size={24} />
      </div>
      <div className="care-copy">
        <span>Estado del equipo</span>
        <strong>{state.label}</strong>
        <small>{state.detail} · {lastCheck}</small>
      </div>
      <button onClick={onCheck} disabled={busy} aria-label="Revisar ahora"><RefreshCw className={busy ? 'spin' : ''} size={16} /></button>
    </section>
  );
}

function QuickAction({ icon, label, hint, tone, onClick }: { icon: ReactNode; label: string; hint: string; tone: string; onClick: () => void }) {
  return (
    <button className={`quick-action ${tone}`} onClick={onClick}>
      <span className="quick-icon">{icon}</span>
      <span className="quick-copy"><b>{label}</b><small>{hint}</small></span>
      <span className="quick-arrow">→</span>
    </button>
  );
}

function Bubble({ message }: { message: UiMessage }) {
  return (
    <article className={`bubble-row ${message.role}`}>
      {message.role === 'assistant' && <div className="avatar"><NexoMark size={20} /></div>}
      <div className="bubble">
        <p>{message.text}</p>
        {message.diagnostic && <Diagnostic report={message.diagnostic} />}
        {message.result && <Result result={message.result} />}
      </div>
    </article>
  );
}

function Diagnostic({ report }: { report: DiagnosticReport }) {
  const ram = report.ramTotalGb ? Math.round((1 - report.ramFreeGb / report.ramTotalGb) * 100) : 0;
  const disk = report.systemDriveTotalGb ? Math.round((1 - report.systemDriveFreeGb / report.systemDriveTotalGb) * 100) : 0;
  const temperature = report.maxTemperatureC == null ? null : Math.round(report.maxTemperatureC);
  return (
    <div className="diagnostic">
      <DiagnosticMetric icon={<Cpu size={15} />} label="Memoria" value={`${ram}%`} progress={ram} bad={ram > 85} />
      <DiagnosticMetric icon={<HardDrive size={15} />} label="Disco" value={`${disk}%`} progress={disk} bad={disk > 88} />
      <DiagnosticMetric icon={<ShieldCheck size={15} />} label="Seguridad" value={report.defenderStatus === 'Activo' ? 'Bien' : 'Revisar'} progress={report.defenderStatus === 'Activo' ? 100 : 42} bad={report.defenderStatus !== 'Activo'} />
      <DiagnosticMetric icon={<Thermometer size={15} />} label="Temperatura" value={temperature == null ? 'Sin dato' : `${temperature}°`} progress={temperature == null ? 0 : Math.min(100, temperature)} bad={(report.maxTemperatureC ?? 0) > 82} />
    </div>
  );
}

function DiagnosticMetric({ icon, label, value, progress, bad }: { icon: ReactNode; label: string; value: string; progress: number; bad: boolean }) {
  return (
    <div className={`metric ${bad ? 'bad' : ''}`}>
      <div className="metric-head"><span>{icon}{label}</span><b>{value}</b></div>
      <div className="metric-track"><i style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} /></div>
    </div>
  );
}

function Result({ result }: { result: AgentActionResult }) {
  return (
    <div className={`result ${result.ok ? 'success' : 'bad'}`}>
      <span className="result-icon">{result.ok ? <Check size={15} /> : <CircleAlert size={15} />}</span>
      <span><b>{result.ok ? 'Acción completada' : 'No se pudo completar'}</b><small>{result.details[0] || 'No se realizaron otros cambios.'}</small></span>
    </div>
  );
}

function ApprovalCard({ approval, approve, reject }: { approval: Approval; approve: () => void; reject: () => void }) {
  return (
    <div className="approval">
      <div className="approval-top">
        <span className="approval-icon">{approval.tool.mode === 'support' ? <Wrench size={20} /> : <ShieldCheck size={20} />}</span>
        <span><small>NEXO recomienda</small><b>{approval.tool.label}</b></span>
      </div>
      <p>{approval.tool.description}</p>
      <div className="approval-safe"><ShieldCheck size={14} /> Solo se hará esta acción</div>
      <div className="approval-actions"><button className="yes" onClick={approve}>Sí, continuar</button><button className="no" onClick={reject}>Ahora no</button></div>
    </div>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <div className="thinking">
      <div className="thinking-visual">
        <NexoMark size={26} animated />
        <div className="scan-line" />
      </div>
      <span><b>{label}</b><small>Podés seguir usando la PC.</small></span>
      <div className="thinking-dots"><i /><i /><i /></div>
    </div>
  );
}
