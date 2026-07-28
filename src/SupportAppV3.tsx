import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Gauge,
  HardDrive,
  Headphones,
  MemoryStick,
  Menu,
  Minus,
  Power,
  RefreshCw,
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
import { runAgentAction } from './lib/agent';
import type { AgentActionResult } from './lib/agent';
import { requestAssistant } from './lib/assistant';
import type { AssistantToolId, ProviderMessage } from './lib/assistant';
import { readHardwareSensors, summarizeHardware } from './lib/sensors';
import type { HardwareSnapshot, SensorSummary } from './lib/sensors';
import { openRemoteTool } from './lib/support';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type Mode = 'protected' | 'local';
type Tone = 'success' | 'warning' | 'error' | 'info';
type Notice = { tone: Tone; title: string; detail?: string };
type ActivityResult = { title: string; detail: string; tone: Tone };

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
  const gradientId = `nexo-v3-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 62 54" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="4" y1="4" x2="58" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7b4dff" />
          <stop offset=".55" stopColor="#5b5be8" />
          <stop offset="1" stopColor="#3187df" />
        </linearGradient>
      </defs>
      <path d="M4 4h13.4L31 20.8 44.6 4H58L38.1 27 58 50H44.6L31 33.2 17.4 50H4l19.9-23z" fill={`url(#${gradientId})`} />
    </svg>
  );
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/tard[oó] demasiado|timeout|tiempo de espera/i.test(message)) return 'Windows tardó demasiado. La espera fue cancelada sin cambiar nada.';
  if (/permission|denied|rechaz|autorización/i.test(message)) return 'Windows no autorizó esa acción.';
  if (/código|codigo|pairing|venció|válido/i.test(message)) return 'Ese código no funciona o ya fue usado.';
  if (/fetch|network|internet|supabase|rpc/i.test(message)) return 'El servicio conectado no está disponible. Las funciones locales siguen activas.';
  return fallback;
}

function sensorLabel(snapshot: HardwareSnapshot | null, summary: SensorSummary | null) {
  if (!snapshot) return { value: '—', detail: 'Sin revisar', tone: 'info' as Tone };
  if (summary?.cpuTemperatureC != null) {
    const value = Math.round(summary.cpuTemperatureC);
    return { value: `${value}°`, detail: value >= 88 ? 'Alta' : 'Normal', tone: value >= 88 ? 'warning' as Tone : 'success' as Tone };
  }
  if (snapshot.source === 'acpi-fallback' && snapshot.sensors.length) return { value: 'Aprox.', detail: 'Sensor del sistema', tone: 'info' as Tone };
  return { value: '—', detail: 'No disponible', tone: 'info' as Tone };
}

function healthState(report: DiagnosticReport | null, summary: SensorSummary | null) {
  if (!report) return { title: 'Tu PC está lista', detail: 'Hacé una revisión para ver su estado.', tone: 'info' as Tone };
  const diskRatio = report.systemDriveTotalGb ? report.systemDriveFreeGb / report.systemDriveTotalGb : 1;
  const ramRatio = report.ramTotalGb ? report.ramFreeGb / report.ramTotalGb : 1;
  const hot = (summary?.cpuTemperatureC ?? 0) >= 88 || (summary?.gpuTemperatureC ?? 0) >= 88;
  if (diskRatio < .12 || ramRatio < .12 || report.defenderStatus !== 'Activo' || report.pendingReboot || hot) {
    return { title: 'Hay algo para revisar', detail: 'NEXO encontró al menos un punto que necesita atención.', tone: 'warning' as Tone };
  }
  return { title: 'Todo está bien', detail: 'No encontramos problemas importantes.', tone: 'success' as Tone };
}

function lastCheckLabel(report: DiagnosticReport | null) {
  if (!report?.generatedAt) return 'Todavía no revisada';
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(report.generatedAt)) / 60000));
  if (minutes < 60) return `Revisada hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `Revisada hace ${hours} h` : 'Revisada hoy';
}

export default function SupportAppV3() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [dashboard, setDashboard] = useState<ClientDashboard | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [activity, setActivity] = useState<ActivityResult | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [input, setInput] = useState('');
  const [reply, setReply] = useState('');
  const [code, setCode] = useState(backendConfig.backendKind === 'local' ? 'DEMO-PAIR' : '');
  const [pendingCode, setPendingCode] = useState('');
  const [modeOpen, setModeOpen] = useState(false);

  const device = dashboard?.device ?? null;
  const consent = dashboard?.consent ?? null;
  const active = Boolean(session?.deviceToken && device);
  const summary = useMemo(() => hardware ? summarizeHardware(hardware) : null, [hardware]);
  const health = useMemo(() => healthState(report, summary), [report, summary]);
  const temperature = useMemo(() => sensorLabel(hardware, summary), [hardware, summary]);
  const ramUsed = report?.ramTotalGb ? Math.round((1 - report.ramFreeGb / report.ramTotalGb) * 100) : null;
  const diskFree = report?.systemDriveFreeGb != null ? Math.round(report.systemDriveFreeGb) : null;

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const restored = await withTimeout(appBackend.bootstrap('client'), 7000, 'NEXO tardó demasiado en abrir.');
        if (!mounted) return;
        setSession(restored);
        if (!restored?.deviceToken) return;
        const data = await withTimeout(appBackend.getClientDashboard(restored.deviceToken), 8000, 'NEXO tardó demasiado en cargar esta PC.');
        if (!mounted) return;
        setDashboard(data);
        const latest = data.diagnostics[0]?.payload as unknown as DiagnosticReport | undefined;
        if (latest?.generatedAt) setReport(latest);
      } catch (error) {
        if (mounted) setNotice({ tone: 'error', title: 'No se pudo abrir NEXO', detail: friendlyError(error, 'Cerrá la app y volvé a abrirla.') });
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function inspect(showNotice = true) {
    if (!session?.deviceToken || !device || busy) return;
    setBusy('Revisando tu PC');
    setNotice(null);
    try {
      const nextReport = await withTimeout(runQuickDiagnostic(), 16000, 'La revisión tardó demasiado.');
      let nextHardware: HardwareSnapshot | null = null;
      try {
        nextHardware = await withTimeout(readHardwareSensors(false), 24000, 'La temperatura tardó demasiado.');
      } catch {
        nextHardware = null;
      }
      setReport(nextReport);
      setHardware(nextHardware);
      if (consent?.shareDiagnostics) {
        void appBackend.saveDiagnostic({ deviceId: device.id, payload: { ...nextReport, hardware: nextHardware } }, session.deviceToken).catch(() => undefined);
      }
      setActivity({ title: 'Revisión terminada', detail: 'Memoria, disco, seguridad y temperatura fueron revisados.', tone: 'success' });
      if (showNotice) setNotice({ tone: 'success', title: 'Revisión terminada', detail: 'Los resultados ya están visibles.' });
    } catch (error) {
      const detail = friendlyError(error, 'No se pudo revisar esta PC.');
      setNotice({ tone: 'error', title: 'No se pudo revisar', detail });
      setActivity({ title: 'Revisión incompleta', detail, tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  async function activate(mode: Mode) {
    if (!pendingCode || busy) return;
    setBusy('Preparando NEXO');
    setNotice(null);
    try {
      const identity = await withTimeout(runQuickDiagnostic(), 7000, 'Windows tardó demasiado.').catch(() => null);
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
      const selected = mode === 'protected' ? protectedConsent : localConsent;
      const savedConsent = await appBackend.saveConsents(registered.session.deviceToken, selected);
      const data = await appBackend.getClientDashboard(registered.session.deviceToken);
      setSession(registered.session);
      setDashboard({ ...data, consent: savedConsent });
      setModeOpen(false);
      setPendingCode('');
      setNotice({ tone: 'success', title: 'PC vinculada', detail: 'NEXO ya puede trabajar en este equipo.' });
      window.setTimeout(() => void inspect(false), 150);
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo activar', detail: friendlyError(error, 'Revisá el código y probá otra vez.') });
    } finally {
      setBusy('');
    }
  }

  async function runSimpleAction(action: string, working: string) {
    if (busy) return;
    setBusy(working);
    setNotice(null);
    try {
      const result = await withTimeout(runAgentAction(action), 22000, `${working} tardó demasiado.`);
      setActivity({ title: result.ok ? 'Listo' : 'No se pudo completar', detail: result.message, tone: result.ok ? 'success' : 'error' });
      setNotice({ tone: result.ok ? 'success' : 'error', title: result.ok ? 'Listo' : 'No se pudo completar', detail: result.message });
      return result;
    } catch (error) {
      const detail = friendlyError(error, 'La acción no pudo completarse.');
      setActivity({ title: 'No se pudo completar', detail, tone: 'error' });
      setNotice({ tone: 'error', title: 'No se pudo completar', detail });
      return null;
    } finally {
      setBusy('');
    }
  }

  async function readTemperature(elevated = false) {
    if (busy) return;
    setBusy(elevated ? 'Esperando permiso de Windows' : 'Leyendo temperatura');
    setNotice(null);
    try {
      const snapshot = await withTimeout(readHardwareSensors(elevated), elevated ? 90000 : 30000, 'La lectura tardó demasiado.');
      setHardware(snapshot);
      const nextSummary = summarizeHardware(snapshot);
      const hasTemperature = nextSummary.cpuTemperatureC != null || nextSummary.gpuTemperatureC != null || snapshot.sensors.length > 0;
      const detail = hasTemperature ? 'La temperatura ya está visible.' : 'Este equipo no expuso una temperatura compatible.';
      setActivity({ title: 'Temperatura revisada', detail, tone: hasTemperature ? 'success' : 'info' });
      setNotice({ tone: hasTemperature ? 'success' : 'info', title: 'Temperatura revisada', detail });
    } catch (error) {
      const detail = friendlyError(error, 'La temperatura no está disponible en este equipo.');
      setActivity({ title: 'Temperatura no disponible', detail, tone: 'info' });
      setNotice({ tone: 'info', title: 'Temperatura no disponible', detail });
    } finally {
      setBusy('');
    }
  }

  async function requestSupport() {
    if (!session?.deviceToken || !device || busy) return;
    setBusy('Preparando asistencia');
    try {
      const ticket = await appBackend.createTicket({ deviceId: device.id, issue: input.trim() || 'Solicita asistencia técnica', clientName: device.displayName, priority: 'normal' }, session.deviceToken);
      const remote = await appBackend.createRemoteSession({ deviceId: device.id, ticketId: ticket.id }, session.deviceToken);
      void openRemoteTool().catch(() => undefined);
      const detail = `Solicitud creada. Código ${remote.code}`;
      setActivity({ title: 'Soporte preparado', detail, tone: 'success' });
      setNotice({ tone: 'success', title: 'Soporte preparado', detail });
    } catch (error) {
      const detail = friendlyError(error, 'No se pudo preparar la asistencia.');
      setNotice({ tone: 'error', title: 'No se pudo abrir soporte', detail });
    } finally {
      setBusy('');
    }
  }

  async function executeAssistantTool(name: AssistantToolId) {
    if (name === 'run_quick_diagnostic') return inspect();
    if (name === 'network_check') return runSimpleAction('network_check', 'Revisando Internet');
    if (name === 'defender_status') return runSimpleAction('defender_status', 'Revisando seguridad');
    if (name === 'scan_temp_files') return runSimpleAction('scan_temp_files', 'Buscando temporales');
    if (name === 'startup_review') return runSimpleAction('startup_review', 'Revisando el inicio');
    if (name === 'remote_support') return requestSupport();
    setReply('Esa acción necesita una confirmación específica. Abrila desde el menú de acciones.');
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (!value || busy || !session?.deviceToken) return;
    setInput('');
    setReply('');
    setBusy('Buscando una solución');
    try {
      const messages: ProviderMessage[] = [{ role: 'user', content: value }];
      const response = await requestAssistant({ deviceToken: session.deviceToken, messages, diagnostic: consent?.shareDiagnostics ? report : null, hardware: consent?.shareDiagnostics ? summary : null, appVersion: APP_VERSION });
      const call = response.message.tool_calls?.[0];
      if (call) {
        setBusy('');
        await executeAssistantTool(call.function.name);
        setReply('Listo. El resultado quedó arriba.');
      } else {
        setReply(response.message.content || 'Decime qué querés revisar.');
      }
    } catch (error) {
      setReply(friendlyError(error, 'No pude responder ahora. Las acciones locales siguen disponibles.'));
    } finally {
      setBusy('');
    }
  }

  async function openAdmin() {
    setMenuOpen(false);
    try {
      if (!isTauriRuntime()) throw new Error('NEXO Control se abre desde Windows.');
      await safeInvoke('open_admin_window');
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo abrir Administración', detail: friendlyError(error, 'Cerrá NEXO y volvé a abrirlo.') });
    }
  }

  if (booting) {
    return <main className="n3-app n3-loading"><NexoMark size={42} /><b>Abriendo NEXO</b><span /></main>;
  }

  return (
    <main className="n3-app">
      <header className="n3-topbar" data-tauri-drag-region>
        <div className="n3-brand" data-tauri-drag-region><NexoMark /><span><b>NEXO</b><small>Support</small></span></div>
        <span className={`n3-live ${health.tone}`} data-tauri-drag-region><i />{active ? 'ACTIVO' : 'SIN ACTIVAR'}</span>
        <div className="n3-window-actions">
          <button aria-label="Menú" onClick={() => setMenuOpen((value) => !value)}><Menu size={16} /></button>
          <button aria-label="Minimizar" onClick={() => void safeInvoke('minimize_main_window')}><Minus size={15} /></button>
          <button aria-label="Ocultar" onClick={() => void safeInvoke('hide_main_window')}><X size={15} /></button>
        </div>
        {menuOpen && (
          <nav className="n3-menu">
            <button onClick={() => { setMenuOpen(false); void inspect(); }}><RefreshCw size={15} /> Revisar esta PC</button>
            <button onClick={() => void openAdmin()}><Settings2 size={15} /> Administración <ChevronRight size={14} /></button>
            <button onClick={() => { setMenuOpen(false); window.dispatchEvent(new Event('nexo:check-update')); }}><RefreshCw size={15} /> Buscar actualización</button>
            <button className="danger" onClick={() => void safeInvoke('exit_app')}><Power size={15} /> Cerrar NEXO</button>
          </nav>
        )}
      </header>

      {notice && (
        <div className={`n3-toast ${notice.tone}`}>
          {notice.tone === 'error' || notice.tone === 'warning' ? <AlertTriangle size={17} /> : <Check size={17} />}
          <span><b>{notice.title}</b>{notice.detail && <small>{notice.detail}</small>}</span>
          <button aria-label="Cerrar aviso" onClick={() => setNotice(null)}><X size={14} /></button>
        </div>
      )}

      {!active ? (
        <section className="n3-activate">
          <NexoMark size={52} />
          <h1>Conectá esta PC.</h1>
          <p>Ingresá el código que te entregó NEXO.</p>
          <form onSubmit={(event) => { event.preventDefault(); const value = code.trim().toUpperCase(); if (value.length >= 4) { setPendingCode(value); setModeOpen(true); } }}>
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Código de activación" autoComplete="off" />
            <button disabled={code.trim().length < 4 || Boolean(busy)}>Continuar</button>
          </form>
        </section>
      ) : (
        <>
          <section className="n3-main">
            <section className={`n3-health ${health.tone}`}>
              <div className="n3-health-copy">
                <span className="n3-health-icon"><ShieldCheck size={24} /></span>
                <div><small>ESTADO DE TU PC</small><h1>{health.title}</h1><p>{health.detail}</p></div>
              </div>
              <button onClick={() => void inspect()} disabled={Boolean(busy)}>{busy ? <RefreshCw className="spin" size={17} /> : <Gauge size={17} />} {busy || 'Revisar ahora'}</button>
              <footer>{lastCheckLabel(report)}</footer>
            </section>

            <div className="n3-quick-actions nv2-quick-actions">
              <button onClick={() => void inspect()} disabled={Boolean(busy)}><Gauge /><span><b>Revisar</b><small>Estado general</small></span></button>
              <button onClick={() => void runSimpleAction('network_check', 'Revisando Internet')} disabled={Boolean(busy)}><Wifi /><span><b>Internet</b><small>Conexión y DNS</small></span></button>
              <button onClick={() => void readTemperature(false)} disabled={Boolean(busy)}><Thermometer /><span><b>Temperatura</b><small>Sensores del equipo</small></span></button>
              <button onClick={() => void requestSupport()} disabled={Boolean(busy)}><Headphones /><span><b>Técnico</b><small>Asistencia humana</small></span></button>
            </div>

            <section className="n3-summary">
              <header><div><small>ÚLTIMA REVISIÓN</small><b>{activity?.title || (report ? 'Resultados disponibles' : 'Todavía sin revisar')}</b></div><button onClick={() => setDetailsOpen((value) => !value)}>{detailsOpen ? 'Ocultar' : 'Ver detalles'} <ChevronDown className={detailsOpen ? 'open' : ''} size={15} /></button></header>
              <div className="n3-metric-row">
                <Metric icon={<MemoryStick />} label="Memoria" value={ramUsed != null ? `${ramUsed}%` : '—'} hint={ramUsed != null ? (ramUsed > 85 ? 'Alta' : 'Normal') : 'Sin dato'} warning={(ramUsed ?? 0) > 85} />
                <Metric icon={<HardDrive />} label="Disco libre" value={diskFree != null ? `${diskFree} GB` : '—'} hint={diskFree != null ? (diskFree < 15 ? 'Poco espacio' : 'Disponible') : 'Sin dato'} warning={(diskFree ?? 99) < 15} />
                <Metric icon={<Thermometer />} label="Temperatura" value={temperature.value} hint={temperature.detail} warning={temperature.tone === 'warning'} />
                <Metric icon={<ShieldCheck />} label="Seguridad" value={report ? (report.defenderStatus === 'Activo' ? 'Bien' : 'Revisar') : '—'} hint={report ? report.defenderStatus : 'Sin dato'} warning={Boolean(report && report.defenderStatus !== 'Activo')} />
              </div>
              {detailsOpen && (
                <div className="n3-details">
                  <Detail label="Sistema" value={report?.os || 'Sin dato'} />
                  <Detail label="Procesador" value={report?.cpu || 'Sin dato'} />
                  <Detail label="Inicio" value={report ? `${report.startupItems} programas` : 'Sin dato'} />
                  <Detail label="Reinicio pendiente" value={report?.pendingReboot ? 'Sí' : 'No'} />
                  <Detail label="CPU" value={summary?.cpuTemperatureC != null ? `${Math.round(summary.cpuTemperatureC)} °C` : 'No disponible'} />
                  <Detail label="GPU" value={summary?.gpuTemperatureC != null ? `${Math.round(summary.gpuTemperatureC)} °C` : 'No disponible'} />
                  {hardware?.permissionRequired && <button className="n3-permission" onClick={() => void readTemperature(true)}><ShieldCheck size={15} /> Leer más sensores con permiso de Windows</button>}
                </div>
              )}
              {activity && <div className={`n3-activity ${activity.tone}`}><Activity size={15} /><span><b>{activity.title}</b><small>{activity.detail}</small></span></div>}
            </section>

            {reply && <section className="n3-reply"><NexoMark size={18} /><p>{reply}</p><button aria-label="Cerrar respuesta" onClick={() => setReply('')}><X size={13} /></button></section>}
            {busy && <section className="n3-working"><RefreshCw className="spin" size={17} /><span><b>{busy}</b><small>Podés seguir viendo la app mientras termina.</small></span></section>}
          </section>

          <footer className="n3-footer">
            <form onSubmit={(event) => void send(event)}>
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="¿Qué problema tiene tu PC?" disabled={Boolean(busy)} />
              <button aria-label="Enviar" disabled={!input.trim() || Boolean(busy)}><Send size={17} /></button>
            </form>
            <div><span>{dashboard?.entitlement?.plan?.toUpperCase() || 'LOCAL'} · {lastCheckLabel(report)}</span><span>v{APP_VERSION}</span></div>
          </footer>
        </>
      )}

      {modeOpen && (
        <div className="n3-modal-backdrop">
          <section className="n3-mode-modal">
            <header><div><small>EMPEZAR</small><h2>¿Cómo querés usar NEXO?</h2></div><button aria-label="Cerrar" onClick={() => setModeOpen(false)} disabled={Boolean(busy)}><X size={17} /></button></header>
            {busy ? <div className="n3-modal-working"><RefreshCw className="spin" /><b>{busy}</b></div> : <div className="n3-mode-actions">
              <button onClick={() => void activate('protected')}><ShieldCheck /><span><b>Proteger esta PC</b><small>Revisión automática y ayuda por chat.</small></span><ChevronRight /></button>
              <button onClick={() => void activate('local')}><Gauge /><span><b>Revisión rápida</b><small>Todo queda en este equipo.</small></span><ChevronRight /></button>
            </div>}
          </section>
        </div>
      )}
    </main>
  );
}

function Metric({ icon, label, value, hint, warning }: { icon: React.ReactNode; label: string; value: string; hint: string; warning: boolean }) {
  return <div className={warning ? 'warning' : ''}><span>{icon}</span><div><small>{label}</small><b>{value}</b><em>{hint}</em></div></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><b>{value}</b></div>;
}
