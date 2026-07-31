import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Bot, Check, Headphones, LayoutGrid, Menu, MessageCircle, Minus, Power, Send, Settings2, X } from 'lucide-react';
import { appBackend, backendConfig } from './lib/backend';
import type { AppSession, ClientDashboard, UpdateConsentInput } from './lib/domain';
import { APP_VERSION } from './lib/domain';
import type { DiagnosticReport } from './lib/diagnostics';
import type { HardwareSnapshot } from './lib/sensors';
import type { ProviderMessage } from './lib/assistant';
import {
  addPlannedStep,
  askAgent,
  createReport,
  executeSafeTool,
  finishReport,
  pendingFromMessage,
  safeToolResultMessage,
  updateStep
} from './lib/secure-agent';
import type { AgentReport, PendingAction } from './lib/secure-agent';
import { getRemoteToolStatus, installRemoteTool, openRemoteTool } from './lib/support';
import { safeInvoke } from './lib/tauri';

type ChatLine = { id: string; role: 'assistant' | 'user' | 'system'; text: string };
type View = 'assistant' | 'tools';

const defaultCode = import.meta.env.VITE_DEFAULT_PAIRING_CODE?.trim()
  || (backendConfig.backendKind === 'local' ? 'DEMO-PAIR' : '');
const nowId = () => crypto.randomUUID();

function NexoMark({ size = 24 }: { size?: number }) {
  const id = `nexo-v7-${size}`;
  return <svg width={size} height={size} viewBox="0 0 62 54" aria-hidden="true"><defs><linearGradient id={id} x1="4" y1="4" x2="58" y2="50"><stop stopColor="#765cff"/><stop offset=".55" stopColor="#5d61ea"/><stop offset="1" stopColor="#288bdf"/></linearGradient></defs><path d="M4 4h13.4L31 20.8 44.6 4H58L38.1 27 58 50H44.6L31 33.2 17.4 50H4l19.9-23z" fill={`url(#${id})`}/></svg>;
}

function line(role: ChatLine['role'], text: string): ChatLine { return { id: nowId(), role, text }; }
function cleanText(value: string | null | undefined) { return (value || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1600); }

export default function SupportAppV7() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [dashboard, setDashboard] = useState<ClientDashboard | null>(null);
  const [code, setCode] = useState(defaultCode);
  const [consent, setConsent] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState('');
  const [view, setView] = useState<View>('assistant');
  const [menuOpen, setMenuOpen] = useState(false);
  const [messages, setMessages] = useState<ProviderMessage[]>([]);
  const [lines, setLines] = useState<ChatLine[]>([line('assistant', '¿Qué pasa con la PC?')]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [report, setReport] = useState<AgentReport | null>(null);
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport | null>(null);
  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null);
  const [progress, setProgress] = useState(0);
  const thread = useRef<HTMLDivElement | null>(null);

  const device = dashboard?.device ?? null;
  const active = Boolean(session?.deviceToken && device);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const restored = await appBackend.bootstrap('client');
        if (!mounted) return;
        setSession(restored);
        if (restored?.deviceToken) setDashboard(await appBackend.getClientDashboard(restored.deviceToken));
      } finally { if (mounted) setBooting(false); }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' }), 30);
    return () => clearTimeout(timer);
  }, [lines, pending, busy]);

  function push(role: ChatLine['role'], text: string) { setLines((current) => [...current, line(role, text)]); }

  async function saveAgentReport(next: AgentReport) {
    if (!session?.deviceToken || !device) return;
    setReport(next);
    await appBackend.saveDiagnostic({ deviceId: device.id, payload: next as unknown as Record<string, unknown> }, session.deviceToken);
  }

  async function activate(event: FormEvent) {
    event.preventDefault();
    if (!consent || code.trim().length < 4 || busy) return;
    setBusy('Conectando');
    try {
      const registered = await appBackend.registerClient({
        pairingCode: code.trim().toUpperCase(),
        deviceName: 'PC de soporte', computerName: 'Equipo Windows', userName: 'Usuario', os: 'Windows', platform: 'windows'
      });
      if (!registered.session.deviceToken) throw new Error('No se pudo conectar.');
      const permissions: UpdateConsentInput = {
        assistantEnabled: true,
        shareDiagnostics: true,
        automaticChecks: false,
        hardwareSensors: true,
        elevatedSensors: false
      };
      await appBackend.saveConsents(registered.session.deviceToken, permissions);
      setSession(registered.session);
      setDashboard(await appBackend.getClientDashboard(registered.session.deviceToken));
    } catch (error) { push('system', error instanceof Error ? error.message : 'No se pudo conectar.'); }
    finally { setBusy(''); }
  }

  async function continueAgent(history: ProviderMessage[], activeReport: AgentReport, turns = 0): Promise<void> {
    if (!session?.deviceToken || turns > 6) {
      const ended = finishReport(activeReport, 'needs-support', 'El agente llegó al límite seguro de pasos.');
      await saveAgentReport(ended);
      push('assistant', 'Necesita soporte remoto.');
      return;
    }
    setBusy('Revisando');
    try {
      const response = await askAgent({ deviceToken: session.deviceToken, messages: history, diagnostic, hardware, appVersion: APP_VERSION });
      const assistantMessage = response.message;
      const nextHistory = [...history, assistantMessage];
      setMessages(nextHistory);
      const action = pendingFromMessage(assistantMessage);
      if (action) {
        const planned = addPlannedStep(activeReport, action);
        await saveAgentReport(planned);
        if (action.mode === 'confirm' || action.mode === 'support') {
          setPending(action);
          push('assistant', action.label);
          return;
        }
        await runAction(action, nextHistory, planned, turns);
        return;
      }
      const text = cleanText(assistantMessage.content) || 'Listo.';
      push('assistant', text);
      const finalStatus = /soporte|t[eé]cnico|hardware|reemplaz/i.test(text) ? 'needs-support' : 'resolved';
      await saveAgentReport(finishReport(activeReport, finalStatus, text));
    } catch (error) {
      const text = error instanceof Error ? error.message : 'No se pudo continuar.';
      push('system', text);
      await saveAgentReport(finishReport(activeReport, 'failed', text));
    } finally { setBusy(''); }
  }

  async function runAction(action: PendingAction, history: ProviderMessage[], activeReport: AgentReport, turns: number) {
    setPending(null);
    setBusy(action.label);
    setProgress(0);
    let next = updateStep(activeReport, action.callId, { status: 'running', startedAt: new Date().toISOString() });
    await saveAgentReport(next);
    try {
      if (action.tool === 'remote_support') {
        let remote = await getRemoteToolStatus();
        if (!remote.installed) remote = await installRemoteTool();
        if (!remote.installed) throw new Error('RustDesk no está listo.');
        if (!session?.deviceToken || !device) throw new Error('PC no conectada.');
        const ticket = await appBackend.createTicket({ deviceId: device.id, clientName: device.displayName, issue: remote.id ? `Soporte remoto · RustDesk ${remote.id}` : 'Soporte remoto', priority: 'normal' }, session.deviceToken);
        await appBackend.createRemoteSession({ deviceId: device.id, ticketId: ticket.id }, session.deviceToken);
        await openRemoteTool();
        const result = { ok: true, rustDeskId: remote.id || null, ticketId: ticket.id };
        next = updateStep(next, action.callId, { status: 'done', finishedAt: new Date().toISOString(), result });
        await saveAgentReport(finishReport(next, 'needs-support', 'Soporte remoto preparado.'));
        push('assistant', 'Soporte remoto listo.');
        return;
      }
      const result = await executeSafeTool(action.tool, setProgress);
      if (action.tool === 'run_quick_diagnostic') {
        const payload = result as { diagnostic?: DiagnosticReport; hardware?: HardwareSnapshot | null };
        if (payload.diagnostic) setDiagnostic(payload.diagnostic);
        if (payload.hardware) setHardware(payload.hardware);
        if (!activeReport.before) next = { ...next, before: result };
      }
      next = updateStep(next, action.callId, { status: 'done', finishedAt: new Date().toISOString(), result });
      await saveAgentReport(next);
      push('system', `${action.label}: listo`);
      const toolMessage = safeToolResultMessage(action.callId, action.tool, result);
      const nextHistory = [...history, toolMessage];
      setMessages(nextHistory);
      await continueAgent(nextHistory, next, turns + 1);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Falló la acción.';
      next = updateStep(next, action.callId, { status: 'failed', finishedAt: new Date().toISOString(), error: text });
      await saveAgentReport(finishReport(next, 'failed', text));
      push('system', text);
    } finally { setBusy(''); setProgress(0); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy || pending || !device) return;
    setInput('');
    push('user', text);
    const userMessage: ProviderMessage = { role: 'user', content: text };
    const history = [...messages, userMessage];
    setMessages(history);
    const nextReport = createReport(device.id, text);
    await saveAgentReport(nextReport);
    await continueAgent(history, nextReport);
  }

  async function decide(approved: boolean) {
    if (!pending || !report) return;
    if (!approved) {
      const cancelled = updateStep(report, pending.callId, { status: 'cancelled', finishedAt: new Date().toISOString() });
      await saveAgentReport(finishReport(cancelled, 'cancelled', 'El usuario canceló la acción.'));
      setPending(null);
      push('assistant', 'Cancelado.');
      return;
    }
    await runAction(pending, messages, report, report.steps.length);
  }

  if (booting) return <main className="nv-app nv-loading"><NexoMark size={44}/><i/></main>;

  return <main className="nv-app">
    <header className="nv-top" data-tauri-drag-region>
      <div className="nv-brand" data-tauri-drag-region><NexoMark size={22}/><b>NEXO</b></div>
      <span className="nv-ready"><i/>{active ? 'LISTO' : 'SIN CONECTAR'}</span>
      <div className="nv-window"><button aria-label="Menú" onClick={() => setMenuOpen(!menuOpen)}><Menu size={16}/></button><button aria-label="Minimizar" onClick={() => void safeInvoke('minimize_main_window')}><Minus size={16}/></button><button aria-label="Cerrar NEXO" onClick={() => void safeInvoke('hide_main_window')}><X size={16}/></button></div>
      {menuOpen && <nav className="nv-menu"><button onClick={() => void safeInvoke('open_admin_window')}><Settings2 size={15}/> Administración</button><button onClick={() => void safeInvoke('exit_app')}><Power size={15}/> Salir</button></nav>}
    </header>

    {!active ? <section className="nv-connect"><NexoMark size={54}/><h1>Conectar PC</h1><form onSubmit={(event) => void activate(event)}><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Código" autoComplete="off"/><label className="nv-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/><span>Compartir diagnóstico con NEXO</span></label><button disabled={!consent || code.trim().length < 4 || Boolean(busy)}>Conectar</button></form></section> : <>
      <nav className="nv-tabs"><button className={view === 'assistant' ? 'active' : ''} onClick={() => setView('assistant')}><MessageCircle size={15}/> Asistente</button><button className={view === 'tools' ? 'active' : ''} onClick={() => setView('tools')}><LayoutGrid size={15}/> Actividad</button></nav>
      {view === 'assistant' ? <section className="nv-chat"><header><span><Bot size={18}/></span><div><b>NEXO</b><small>{device?.displayName}</small></div></header><div className="nv-thread" ref={thread}>{lines.map((item) => <article key={item.id} className={item.role === 'system' ? 'assistant' : item.role}><span>{item.role !== 'user' && <NexoMark size={14}/>}</span><p>{item.text}</p></article>)}{pending && <div className="nv-confirm"><b>{pending.label}</b><small>{pending.description}</small><button onClick={() => void decide(false)}>Cancelar</button><button onClick={() => void decide(true)}>Autorizar</button></div>}{busy && <div className="nv-agent-progress"><i style={{ width: `${progress || 18}%` }}/><span>{progress ? `${Math.round(progress)}%` : busy}</span></div>}</div><form className="nv-compose" onSubmit={(event) => void send(event)}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="¿Qué pasa con la PC?" disabled={Boolean(busy || pending)}/><button aria-label="Enviar" disabled={!input.trim() || Boolean(busy || pending)}><Send size={17}/></button></form></section> : <section className="nv-tools"><header><h1>Actividad</h1></header><div className="nv-data">{report?.steps.length ? report.steps.map((step) => <div key={step.id}><span>{step.label}</span><b>{step.status === 'done' ? 'Listo' : step.status === 'failed' ? 'Error' : step.status === 'cancelled' ? 'Cancelado' : 'Pendiente'}</b></div>) : <div><span>Sin actividad</span><b>—</b></div>}</div>{report?.summary && <section className="nv-result ok"><span><Check size={18}/></span><h2>{report.summary}</h2></section>}<button className="nv-remote-shortcut" onClick={() => { setView('assistant'); setInput('Necesito soporte remoto'); }}><Headphones size={17}/> Soporte remoto</button></section>}
    </>}
  </main>;
}
