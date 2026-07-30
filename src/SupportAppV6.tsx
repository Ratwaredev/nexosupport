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
  X
} from 'lucide-react';
import { appBackend, backendConfig } from './lib/backend';
import type { AppSession, ClientDashboard, UpdateConsentInput } from './lib/domain';
import { APP_VERSION } from './lib/domain';
import { runQuickDiagnostic } from './lib/diagnostics';
import type { DiagnosticReport } from './lib/diagnostics';
import { optimizeTempFiles, runAgentAction } from './lib/agent';
import type { OptimizerProgress } from './lib/agent';
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
import { safeInvoke } from './lib/tauri';

type View = 'assistant' | 'tools';
type OptimizerPhase = 'idle' | 'scanning' | 'ready' | 'confirm' | 'cleaning' | 'done';
type Notice = { tone: 'success' | 'warning' | 'error'; text: string };
type ChatMessage = { id: string; role: 'assistant' | 'user'; text: string };
type ToolDefinition = { id: ToolId; title: string; icon: ReactNode };

const defaultConsent: UpdateConsentInput = {
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
  const id = `nexo-v6-${size}`;
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
  if (/timeout|tard[oó] demasiado/i.test(raw)) return 'La tarea tardó demasiado.';
  if (/permission|denied|autorizaci[oó]n|rechaz/i.test(raw)) return 'Windows canceló la autorización.';
  return raw;
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
  const [messages, setMessages] = useState<ChatMessage[]>([
    message('assistant', 'Hola. ¿Qué revisamos?')
  ]);
  const [optimizerPhase, setOptimizerPhase] = useState<OptimizerPhase>('idle');
  const [progress, setProgress] = useState<OptimizerProgress>({ percent: 0, processedFiles: 0, totalFiles: 0, freedBytes: 0, current: '' });
  const thread = useRef<HTMLDivElement | null>(null);

  const device = dashboard?.device ?? null;
  const active = Boolean(session?.deviceToken && device);
  const hardwareSummary = useMemo(() => hardware ? summarizeHardware(hardware) : null, [hardware]);

  function saveRecord(record: ToolRecord) {
    setRecords((current) => ({ ...current, [record.id]: record }));
    return record;
  }

  function push(role: ChatMessage['role'], text: string) {
    setMessages((current) => [...current, message(role, text)]);
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
    const timer = window.setTimeout(() => thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' }), 20);
    return () => window.clearTimeout(timer);
  }, [messages, busy, view]);

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
      await appBackend.saveConsents(registered.session.deviceToken, defaultConsent);
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
      const result = await runAgentAction(action);
      return saveRecord(id === 'network' ? networkRecord(result) : id === 'security' ? securityRecord(result) : startupRecord(result));
    } finally {
      setBusy('');
    }
  }

  async function scanOptimizer() {
    setOptimizerPhase('scanning');
    setBusy('Analizando');
    try {
      const result = await runAgentAction('temp_scan');
      const record = saveRecord(optimizerRecord(result, false));
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
      const result = await optimizeTempFiles(setProgress);
      const record = saveRecord(optimizerRecord(result, true));
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
      const result = await runAgentAction(action);
      setNotice({ tone: result.ok ? 'success' : 'warning', text: result.message || 'Listo.' });
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

  async function startRemote() {
    if (!session?.deviceToken || !device) return;
    setBusy('Abriendo soporte');
    try {
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
      await openRemoteTool();
      setNotice({ tone: 'success', text: 'RustDesk abierto.' });
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error) });
    } finally {
      setBusy('');
    }
  }

  async function chatTool(id: ToolId) {
    try {
      if (id === 'optimizer' || id === 'remote') {
        setView('tools');
        setSelected(id);
        return;
      }
      const record = id === 'overview'
        ? await runOverview(false)
        : id === 'temperature'
          ? await runTemperature(false)
          : await runReadTool(id as 'network' | 'security' | 'startup');
      push('assistant', compactRecord(record));
    } catch (error) {
      push('assistant', errorText(error));
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    push('user', text);
    const value = text.toLowerCase();
    if (/optim|limpi|basura|espacio/.test(value)) return chatTool('optimizer');
    if (/remoto|rustdesk|soporte|t[eé]cnico/.test(value)) return chatTool('remote');
    if (/temperatura|calor|sensor/.test(value)) return chatTool('temperature');
    if (/internet|wifi|dns|red/.test(value)) return chatTool('network');
    if (/seguridad|defender|virus|antivirus/.test(value)) return chatTool('security');
    if (/inicio|arranque|encender/.test(value)) return chatTool('startup');
    if (/pc|equipo|lento|ram|disco|revis|rendimiento/.test(value)) return chatTool('overview');
    push('assistant', 'Puedo revisar PC, temperatura, Internet, seguridad, inicio, optimización o soporte remoto.');
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
              <button onClick={() => void (remote?.installed ? startRemote() : installRemote())} disabled={Boolean(busy)}>{remote?.installed ? 'Abrir soporte' : 'Instalar RustDesk'}</button>
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

      {active && (
        <nav className="nv-tabs">
          <button className={view === 'assistant' ? 'active' : ''} onClick={() => { setView('assistant'); setSelected(null); }}><MessageCircle size={15} /> Asistente</button>
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
      ) : view === 'assistant' ? (
        <section className="nv-chat">
          <header><span><Bot size={18} /></span><div><b>NEXO</b><small>{device?.displayName}</small></div></header>
          <div className="nv-thread" ref={thread}>
            {messages.map((item) => <article key={item.id} className={item.role}><span>{item.role === 'assistant' && <NexoMark size={14} />}</span><p>{item.text}</p></article>)}
            {messages.length === 1 && (
              <div className="nv-prompts">
                <button onClick={() => void chatTool('overview')}>Revisar PC</button>
                <button onClick={() => void chatTool('temperature')}>Temperatura</button>
                <button onClick={() => void chatTool('network')}>Internet</button>
                <button onClick={() => void chatTool('optimizer')}>Optimizar</button>
              </div>
            )}
          </div>
          <form className="nv-compose" onSubmit={(event) => void send(event)}>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="¿Qué pasa con la PC?" disabled={Boolean(busy)} />
            <button aria-label="Enviar" disabled={!input.trim() || Boolean(busy)}><Send size={17} /></button>
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

function RocketStage({ progress }: { progress: OptimizerProgress }) {
  return (
    <section className="nv-flight">
      <div className="nv-stars"><i /><i /><i /><i /><i /></div>
      <div className="nv-rocket"><Rocket size={54} /><span /></div>
      <strong>{Math.max(0, Math.min(100, Math.round(progress.percent)))}%</strong>
      <div className="nv-progress"><i style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} /></div>
    </section>
  );
}
