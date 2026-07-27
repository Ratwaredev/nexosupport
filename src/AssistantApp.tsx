import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Activity, Check, CircleAlert, HardDrive, MessageCircle, Minus, Network, ShieldCheck, Sparkles, Trash2, Wrench, X } from 'lucide-react';
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

type UiMessage = { id: string; role: 'assistant' | 'user'; text: string; diagnostic?: DiagnosticReport; result?: AgentActionResult };
type Approval = { call: ProviderToolCall; tool: ToolDefinition };

const MSG_KEY = 'nexo.chat.v2';
const CTX_KEY = 'nexo.context.v2';
const CHECK_KEY = 'nexo.last-check.v2';
const CHECK_MS = 4 * 60 * 60 * 1000;
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const welcome = (): UiMessage => ({ id: id(), role: 'assistant', text: 'Hola. Soy NEXO y cuido esta PC. Contame qué pasa o elegí una opción.' });

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
}

function needsAttention(report: DiagnosticReport) {
  const disk = report.systemDriveTotalGb ? report.systemDriveFreeGb / report.systemDriveTotalGb : 1;
  const ram = report.ramTotalGb ? report.ramFreeGb / report.ramTotalGb : 1;
  return disk < .12 || ram < .12 || report.defenderStatus !== 'Activo' || report.pendingReboot || (report.maxTemperatureC ?? 0) >= 85;
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

  useEffect(() => {
    let alive = true;
    void appBackend.bootstrap().then(async restored => {
      if (!alive) return;
      if (restored?.role === 'admin') { await appBackend.signOut(); setSession(null); return; }
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
    requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; });
  }, [messages, busy, approval]);
  useEffect(() => localStorage.setItem(CTX_KEY, JSON.stringify(context.slice(-24))), [context]);

  useEffect(() => {
    if (!activated || !session?.deviceToken || !device) return;
    const check = async () => {
      if (Date.now() - Number(localStorage.getItem(CHECK_KEY) || 0) < CHECK_MS) return;
      try {
        const report = await runQuickDiagnostic();
        setDiagnostic(report);
        localStorage.setItem(CHECK_KEY, String(Date.now()));
        await appBackend.saveDiagnostic({ deviceId: device.id, payload: report as unknown as Record<string, unknown> }, session.deviceToken ?? '');
        if (needsAttention(report)) addBot('Encontré algo que conviene revisar. Abrime y te lo explico sin tecnicismos.', report);
      } catch { /* revisión silenciosa */ }
    };
    const first = window.setTimeout(() => void check(), 2500);
    const timer = window.setInterval(() => void check(), CHECK_MS);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [activated, session?.deviceToken, device]);

  const addBot = (text: string, report?: DiagnosticReport, result?: AgentActionResult) => setMessages(old => [...old, { id: id(), role: 'assistant', text, diagnostic: report, result }]);
  const addUser = (text: string) => setMessages(old => [...old, { id: id(), role: 'user', text }]);

  async function activate() {
    if (busy || code.trim().length < 4) return;
    setBusy('Vinculando esta PC con NEXO');
    try {
      const report = await runQuickDiagnostic();
      const registered = await appBackend.registerClient({
        pairingCode: code.trim().toUpperCase(), deviceName: report.computerName || 'Mi PC', issue: 'Activación de NEXO Support',
        computerName: report.computerName, userName: report.userName, os: report.os, platform: 'windows'
      });
      const data = await appBackend.getClientDashboard(registered.session.deviceToken ?? '');
      setSession(registered.session); setDashboard(data); setDiagnostic(report); setContext([]);
      setMessages([welcome(), { id: id(), role: 'assistant', text: 'Listo. Esta PC ya está cuidada por NEXO. Podés cerrar la ventana: quedo en el icono de la bandeja.' }]);
      await appBackend.saveDiagnostic({ deviceId: registered.device.id, payload: report as unknown as Record<string, unknown> }, registered.session.deviceToken ?? '');
    } catch (error) { addBot(error instanceof Error ? error.message : 'Ese código no es válido. Pedile uno nuevo a NEXO.'); }
    finally { setBusy(''); }
  }

  async function send(text: string) {
    const value = text.trim();
    if (!value || busy || approval || !activated) return;
    setInput(''); addUser(value);
    const next = [...context, { role: 'user', content: value } as ProviderMessage].slice(-24);
    setContext(next); await ask(next);
  }

  async function ask(ctx: ProviderMessage[], depth = 0): Promise<void> {
    if (!session?.deviceToken || depth > 4) return;
    setBusy(depth ? 'NEXO está revisando el resultado' : 'NEXO está pensando');
    try {
      const response = await requestAssistant({ deviceToken: session.deviceToken, messages: ctx, diagnostic, agentStatus: agent, appVersion: APP_VERSION });
      if (response.entitlement?.plan) setPlan(`Plan ${response.entitlement.plan}`);
      const assistant = response.message;
      const next = [...ctx, assistant].slice(-24); setContext(next);
      if (assistant.content) addBot(assistant.content);
      const call = assistant.tool_calls?.[0];
      if (!call) return;
      const tool = TOOL_CATALOG[call.function.name];
      if (!tool) { addBot('No voy a ejecutar esa acción porque no está autorizada.'); return; }
      if (tool.mode === 'read') {
        const result = await execute(call.function.name);
        const toolMessage: ProviderMessage = { role: 'tool', tool_call_id: call.id, name: call.function.name, content: normalizeToolResult(result) };
        const withResult = [...next, toolMessage].slice(-24); setContext(withResult);
        await ask(withResult, depth + 1);
      } else setApproval({ call, tool });
    } catch (error) { addBot(error instanceof Error ? error.message : 'No pude responder ahora. No hice ningún cambio.'); }
    finally { setBusy(''); }
  }

  async function execute(tool: AssistantToolId): Promise<AgentActionResult | DiagnosticReport> {
    setBusy(TOOL_CATALOG[tool].progressLabel);
    if (tool === 'run_quick_diagnostic') {
      const report = await runQuickDiagnostic(); setDiagnostic(report); addBot('Terminé la revisión. Esto es lo importante:', report);
      if (session?.deviceToken && device) await appBackend.saveDiagnostic({ deviceId: device.id, payload: report as unknown as Record<string, unknown> }, session.deviceToken);
      return report;
    }
    if (tool === 'remote_support') return remoteSupport();
    const map: Record<Exclude<AssistantToolId, 'run_quick_diagnostic' | 'remote_support'>, string> = {
      network_check: 'network_check', scan_temp_files: 'temp_scan', startup_review: 'startup_review', defender_status: 'defender_status',
      clean_temp_files: 'clean_temp_files', repair_network: 'repair_network', defender_quick_scan: 'defender_quick_scan', open_windows_update: 'windows_update'
    };
    const result = await runAgentAction(map[tool]); addBot(result.message, undefined, result); return result;
  }

  async function remoteSupport(): Promise<AgentActionResult> {
    if (!session?.deviceToken || !device) return { action: 'remote_support', ok: false, message: 'Esta PC todavía no está vinculada.', details: [] };
    const userMessages = messages.filter(message => message.role === 'user');
    const issue = userMessages[userMessages.length - 1]?.text || 'El usuario solicita asistencia técnica.';
    const ticket = await appBackend.createTicket({ deviceId: device.id, issue, clientName: device.displayName, priority: 'normal' }, session.deviceToken);
    const remote = await appBackend.createRemoteSession({ deviceId: device.id, ticketId: ticket.id }, session.deviceToken);
    await openRemoteTool();
    return { action: 'remote_support', ok: true, message: 'La asistencia técnica quedó preparada.', details: [`Código ${remote.code}. Un técnico de NEXO puede continuar.`] };
  }

  async function approve() {
    if (!approval) return;
    const current = approval; setApproval(null);
    try {
      const result = await execute(current.call.function.name);
      const toolMessage: ProviderMessage = { role: 'tool', tool_call_id: current.call.id, name: current.call.function.name, content: normalizeToolResult(result) };
      const next = [...context, toolMessage].slice(-24); setContext(next); await ask(next, 1);
    } catch (error) { addBot(error instanceof Error ? error.message : 'No pude completar la acción. No hice otros cambios.'); }
    finally { setBusy(''); }
  }

  function reject() {
    if (!approval) return;
    const toolMessage: ProviderMessage = { role: 'tool', tool_call_id: approval.call.id, name: approval.call.function.name, content: JSON.stringify({ ok: false, cancelledByUser: true }) };
    const next = [...context, toolMessage].slice(-24); setApproval(null); setContext(next); addBot('Perfecto. No cambié nada.'); void ask(next, 1);
  }

  const lastCheck = useMemo(() => {
    const value = Number(localStorage.getItem(CHECK_KEY) || 0); if (!value) return 'Todavía no revisé esta PC';
    const minutes = Math.max(1, Math.round((Date.now() - value) / 60000)); return minutes < 60 ? `Revisada hace ${minutes} min` : `Revisada hace ${Math.round(minutes / 60)} h`;
  }, [diagnostic, messages]);

  const hide = () => isTauriRuntime() ? safeInvoke('hide_main_window') : Promise.resolve();
  const minimize = () => isTauriRuntime() ? safeInvoke('minimize_main_window') : Promise.resolve();
  const exit = () => isTauriRuntime() ? safeInvoke('exit_app') : Promise.resolve();
  const reset = () => { setMessages([welcome()]); setContext([]); setApproval(null); setMenu(false); };

  if (booting) return <main className="nexo-popup boot"><NexoLogo /><Rocket active /><span>Preparando tu asistente…</span></main>;

  return <main className="nexo-popup">
    <header className="topbar" data-tauri-drag-region>
      <NexoLogo /><div className="online" data-tauri-drag-region><i />{activated ? plan : 'Activación pendiente'}</div>
      <div className="window-buttons">
        <button onClick={() => setMenu(v => !v)}>•••</button><button onClick={() => void minimize()}><Minus size={15} /></button><button onClick={() => void hide()}><X size={15} /></button>
      </div>
      {menu && <div className="menu"><button onClick={() => void send('Revisá mi PC ahora')}><Activity size={14} /> Revisar ahora</button><button onClick={reset}><Trash2 size={14} /> Limpiar chat</button><button onClick={() => void exit()}><X size={14} /> Cerrar NEXO</button></div>}
    </header>

    <section className="chat" ref={scroll}>
      {!activated ? <Activation /> : <>
        {messages.map(message => <Bubble key={message.id} message={message} />)}
        {messages.length <= 2 && !busy && <div className="quick">
          <button onClick={() => void send('Mi PC está lenta')}><Sparkles size={14} /> Mi PC está lenta</button>
          <button onClick={() => void send('No tengo Internet')}><Network size={14} /> No tengo Internet</button>
          <button onClick={() => void send('Revisá mi PC ahora')}><ShieldCheck size={14} /> Revisar mi PC</button>
          <button onClick={() => void send('Quiero hablar con un técnico')}><MessageCircle size={14} /> Hablar con técnico</button>
        </div>}
        {approval && <ApprovalCard approval={approval} approve={() => void approve()} reject={reject} />}
        {busy && <Thinking label={busy} />}
      </>}
    </section>

    <footer className="composer-area">
      {!activated ? <form className="activation-form" onSubmit={(event) => { event.preventDefault(); void activate(); }}><input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="Código de activación" /><button disabled={busy.length > 0 || code.trim().length < 4}><Rocket active={Boolean(busy)} /></button></form>
      : <form className="composer" onSubmit={(event: FormEvent) => { event.preventDefault(); void send(input); }}><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(input); } }} placeholder="Escribí qué pasa…" rows={1} disabled={Boolean(busy) || Boolean(approval)} /><button disabled={!input.trim() || Boolean(busy) || Boolean(approval)}><Rocket active={Boolean(busy)} /></button></form>}
      <div className="foot"><span>{activated ? lastCheck : 'El código te lo entrega NEXO'}</span><span>v{APP_VERSION}</span></div>
    </footer>
  </main>;
}

function NexoLogo() { return <div className="logo" aria-label="NEXO Support"><b>NE</b><span className="xmark"><i /><i /></span><b>O</b><small>Support</small></div>; }
function Rocket({ active = false }: { active?: boolean }) { return <svg className={`rocket ${active ? 'active' : ''}`} viewBox="0 0 32 32"><path d="M18.8 4.2c3.3-1.5 6.5-1.1 8.9-.5.6 2.4 1 5.6-.5 8.9-1.5 3.4-4.5 6.2-8.9 8.5l-7.4-7.4c2.3-4.4 5.1-7.4 7.9-9.5Z" /><circle cx="21.5" cy="9.6" r="2.5" /><path d="M11.5 13.2 6 14.5l-2 4.1 7.2.4M18.7 20.5l-1.3 5.5-4.1 2 .4-7.2M10.8 21.2l-4.2 4.2M9.2 18.8 3.8 21" /></svg>; }
function Activation() { return <div className="activation"><div className="rocket-stage"><Rocket active /></div><span>Tu asistente para Windows</span><h1>Una PC cuidada, sin entender de computación.</h1><p>Ingresá el código que te dio NEXO. Después solo tenés que contarme qué pasa.</p><div><em><Check size={13} /> Revisión automática</em><em><Check size={13} /> Cambios con permiso</em><em><Check size={13} /> Técnico cuando haga falta</em></div></div>; }
function Bubble({ message }: { message: UiMessage }) { return <article className={`bubble-row ${message.role}`}>{message.role === 'assistant' && <div className="avatar"><span className="xmark"><i /><i /></span></div>}<div className="bubble"><p>{message.text}</p>{message.diagnostic && <Diagnostic report={message.diagnostic} />}{message.result && <Result result={message.result} />}</div></article>; }
function Diagnostic({ report }: { report: DiagnosticReport }) { const ram = report.ramTotalGb ? Math.round((1 - report.ramFreeGb / report.ramTotalGb) * 100) : 0; const disk = report.systemDriveTotalGb ? Math.round((1 - report.systemDriveFreeGb / report.systemDriveTotalGb) * 100) : 0; return <div className="diagnostic"><Metric icon={<Activity size={13} />} label="Memoria" value={`${ram}%`} bad={ram > 85} /><Metric icon={<HardDrive size={13} />} label="Disco" value={`${disk}%`} bad={disk > 88} /><Metric icon={<ShieldCheck size={13} />} label="Seguridad" value={report.defenderStatus === 'Activo' ? 'Protegida' : 'Revisar'} bad={report.defenderStatus !== 'Activo'} /><Metric icon={<Sparkles size={13} />} label="Temperatura" value={report.maxTemperatureC == null ? 'Sin lectura' : `${report.maxTemperatureC.toFixed(0)} °C`} bad={(report.maxTemperatureC ?? 0) > 82} /></div>; }
function Metric({ icon, label, value, bad }: { icon: ReactNode; label: string; value: string; bad: boolean }) { return <div><span>{icon}{label}</span><b className={bad ? 'bad' : ''}>{value}</b></div>; }
function Result({ result }: { result: AgentActionResult }) { return <div className={`result ${result.ok ? '' : 'bad'}`}>{result.ok ? <Check size={14} /> : <CircleAlert size={14} />}<span><b>{result.ok ? 'Listo' : 'No se pudo completar'}</b><small>{result.details[0] || 'No se realizaron otros cambios.'}</small></span></div>; }
function ApprovalCard({ approval, approve, reject }: { approval: Approval; approve: () => void; reject: () => void }) { return <div className="approval"><div className="approval-icon">{approval.tool.mode === 'support' ? <Wrench size={19} /> : <ShieldCheck size={19} />}</div><span>NEXO propone</span><h3>{approval.tool.label}</h3><p>{approval.tool.description}</p><button className="yes" onClick={approve}>Sí, hacelo</button><button className="no" onClick={reject}>No, dejalo así</button></div>; }
function Thinking({ label }: { label: string }) { return <div className="thinking"><div><Rocket active /></div><span><b>{label}</b><small>Podés seguir usando la PC.</small></span><i /><i /><i /></div>; }
