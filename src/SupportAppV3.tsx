import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Gauge,
  HardDrive,
  Headphones,
  MemoryStick,
  Menu,
  Minus,
  Power,
  RefreshCw,
  Rocket,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
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
import { requestAssistant } from './lib/assistant';
import type { AssistantToolId, ProviderMessage } from './lib/assistant';
import { readHardwareSensors, summarizeHardware } from './lib/sensors';
import type { HardwareSnapshot, SensorSummary } from './lib/sensors';
import { getRemoteToolStatus, openRemoteTool } from './lib/support';
import type { RemoteToolStatus } from './lib/support';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type Mode = 'protected' | 'local';
type Tone = 'success' | 'warning' | 'error' | 'info';
type Notice = { tone: Tone; title: string; detail?: string };
type Panel = 'tools' | 'details' | 'temperature' | 'support' | null;
type ConfirmAction = { id: string; title: string; detail: string } | null;

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
  if (/permission|denied|rechaz|autorización/i.test(message)) return 'La autorización fue cancelada o el sistema bloqueó el acceso.';
  if (/fetch|network|internet|supabase|rpc/i.test(message)) return 'El servicio conectado no está disponible. Las herramientas locales siguen funcionando.';
  return message || fallback;
}

function lastCheckLabel(report: DiagnosticReport | null) {
  if (!report?.generatedAt) return 'Sin revisar';
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(report.generatedAt)) / 60000));
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `Hace ${hours} h` : 'Hoy';
}

function healthState(report: DiagnosticReport | null, summary: SensorSummary | null) {
  if (!report) return { title: 'Revisión pendiente', detail: 'La app está lista. Revisá el equipo cuando lo necesites.', tone: 'info' as Tone };
  const diskRatio = report.systemDriveTotalGb > 0 ? report.systemDriveFreeGb / report.systemDriveTotalGb : 1;
  const ramRatio = report.ramTotalGb > 0 ? report.ramFreeGb / report.ramTotalGb : 1;
  const hot = [summary?.cpuTemperatureC, summary?.gpuTemperatureC, summary?.storageTemperatureC, summary?.systemTemperatureC]
    .some((value) => (value ?? 0) >= 88);
  const issues = [diskRatio < .12, ramRatio < .12, report.defenderStatus !== 'Activo', report.pendingReboot, hot].filter(Boolean).length;
  if (issues) return { title: `${issues} ${issues === 1 ? 'punto para revisar' : 'puntos para revisar'}`, detail: 'Abrí los detalles para ver qué necesita atención.', tone: 'warning' as Tone };
  if (!summary?.temperatureAvailable) return { title: 'Sin alertas críticas', detail: 'Rendimiento y seguridad están bien. La temperatura todavía no pudo comprobarse.', tone: 'info' as Tone };
  if (!summary.temperatureTrusted) return { title: 'Sin alertas críticas', detail: 'La temperatura disponible es general y aproximada.', tone: 'info' as Tone };
  return { title: 'Tu PC está en orden', detail: 'No encontramos problemas importantes en esta revisión.', tone: 'success' as Tone };
}

function temperatureState(snapshot: HardwareSnapshot | null, summary: SensorSummary | null) {
  const values = [summary?.cpuTemperatureC, summary?.gpuTemperatureC, summary?.storageTemperatureC, summary?.systemTemperatureC]
    .filter((value): value is number => value != null);
  if (values.length) {
    const hottest = Math.round(Math.max(...values));
    if (!summary?.temperatureTrusted) return { value: `${hottest}°`, label: 'Aproximada', tone: 'info' as Tone };
    return { value: `${hottest}°`, label: hottest >= 88 ? 'Alta' : 'Normal', tone: hottest >= 88 ? 'warning' as Tone : 'success' as Tone };
  }
  if (snapshot?.permissionRequired) return { value: 'Sin lectura', label: 'Probá como admin', tone: 'warning' as Tone };
  if (snapshot) return { value: 'No detectada', label: 'Sin sensor compatible', tone: 'info' as Tone };
  return { value: 'Sin leer', label: 'Tocá para revisar', tone: 'info' as Tone };
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
  const [panel, setPanel] = useState<Panel>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
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
    const duration = notice.tone === 'error' || notice.tone === 'warning' ? 8500 : 4800;
    const timer = window.setTimeout(() => setNotice(null), duration);
    return () => window.clearTimeout(timer);
  }, [notice]);

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

  async function inspect(showNotice = true) {
    if (!session?.deviceToken || !device || busy) return;
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
      setReport(nextReport);
      if (nextHardware) setHardware(nextHardware);

      if (consent?.shareDiagnostics) {
        void appBackend.saveDiagnostic({ deviceId: device.id, payload: { ...nextReport, hardware: nextHardware } }, session.deviceToken).catch(() => undefined);
      }

      if (showNotice) {
        const nextSummary = nextHardware ? summarizeHardware(nextHardware) : null;
        setNotice({
          tone: nextSummary?.temperatureTrusted ? 'success' : nextSummary?.temperatureAvailable ? 'info' : 'warning',
          title: 'Revisión terminada',
          detail: nextSummary?.temperatureTrusted
            ? 'Rendimiento, seguridad y temperatura fueron actualizados.'
            : nextSummary?.temperatureAvailable
              ? 'Rendimiento y seguridad están actualizados. La temperatura es general y aproximada.'
              : 'Rendimiento y seguridad están actualizados, pero el equipo no entregó una temperatura.'
        });
      }
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo revisar', detail: friendlyError(error, 'Probá nuevamente.') });
    } finally {
      setBusy('');
    }
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
      setNotice({ tone: 'success', title: 'PC conectada', detail: 'NEXO está listo. La primera revisión se ejecuta cuando la pedís.' });
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo activar', detail: friendlyError(error, 'Revisá el código y probá otra vez.') });
    } finally {
      setBusy('');
    }
  }

  async function runSimpleAction(action: string, working: string) {
    if (busy) return null;
    setBusy(working);
    setNotice(null);
    try {
      const result = await withTimeout(runAgentAction(action), 30000, `${working} tardó demasiado.`);
      setNotice({ tone: result.ok ? 'success' : 'error', title: result.ok ? 'Acción completada' : 'No se pudo completar', detail: result.message });
      return result;
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo completar', detail: friendlyError(error, 'La acción no pudo completarse.') });
      return null;
    } finally {
      setBusy('');
      setConfirmAction(null);
    }
  }

  async function readTemperature(elevated = false) {
    if (busy) return;
    setBusy(elevated ? 'Esperando autorización' : 'Buscando sensores');
    setNotice(null);
    try {
      const snapshot = await withTimeout(readHardwareSensors(elevated), elevated ? 150000 : 55000, 'La lectura tardó demasiado.');
      setHardware(snapshot);
      const next = summarizeHardware(snapshot);
      setNotice({
        tone: next.temperatureTrusted ? 'success' : next.temperatureAvailable ? 'info' : snapshot.permissionRequired ? 'warning' : 'info',
        title: next.temperatureTrusted
          ? 'Temperatura actualizada'
          : next.temperatureAvailable
            ? 'Lectura aproximada disponible'
            : snapshot.permissionRequired
              ? 'Hace falta autorización'
              : 'No encontramos un sensor compatible',
        detail: next.temperatureAvailable ? snapshot.note : snapshot.note || 'El fabricante no expone una lectura utilizable.'
      });
      setPanel('temperature');
    } catch (error) {
      setNotice({ tone: 'info', title: 'No se pudo leer la temperatura', detail: friendlyError(error, 'El equipo no expone un sensor compatible.') });
    } finally {
      setBusy('');
    }
  }

  function openTemperaturePanel() {
    setPanel('temperature');
    if (!hardware && !busy) window.setTimeout(() => void readTemperature(false), 0);
  }

  async function requestSupport() {
    if (!session?.deviceToken || !device || busy) return;
    setBusy('Preparando soporte');
    setNotice(null);
    try {
      const ticket = await appBackend.createTicket({ deviceId: device.id, issue: input.trim() || 'Solicita asistencia técnica', clientName: device.displayName, priority: 'normal' }, session.deviceToken);
      const remote = await appBackend.createRemoteSession({ deviceId: device.id, ticketId: ticket.id }, session.deviceToken);
      setSupportCode(remote.code);

      let status = await getRemoteToolStatus();
      if (status.installed) status = await openRemoteTool();
      setRemoteTool(status);
      setPanel('support');
      setNotice({
        tone: status.installed ? 'success' : 'warning',
        title: status.installed ? 'RustDesk abierto' : 'Solicitud creada',
        detail: status.message
      });
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo abrir soporte', detail: friendlyError(error, 'Probá nuevamente.') });
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
      setNotice({ tone: status.installed ? 'success' : 'warning', title: status.installed ? 'RustDesk abierto' : 'RustDesk no está instalado', detail: status.message });
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo abrir RustDesk', detail: friendlyError(error, 'Probá nuevamente.') });
    } finally {
      setBusy('');
    }
  }

  async function executeAssistantTool(name: AssistantToolId) {
    if (name === 'run_quick_diagnostic') return inspect();
    if (name === 'network_check') return runSimpleAction('network_check', 'Revisando Internet');
    if (name === 'defender_status') return runSimpleAction('defender_status', 'Revisando seguridad');
    if (name === 'scan_temp_files') return runSimpleAction('temp_scan', 'Buscando temporales');
    if (name === 'startup_review') return runSimpleAction('startup_review', 'Revisando inicio');
    if (name === 'remote_support') return requestSupport();
    setReply('Abrí Herramientas para confirmar esa acción.');
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (!value || busy || !session?.deviceToken) return;
    setInput('');
    setReply('');
    setBusy('Pensando');
    try {
      const messages: ProviderMessage[] = [{ role: 'user', content: value }];
      const response = await requestAssistant({ deviceToken: session.deviceToken, messages, diagnostic: consent?.shareDiagnostics ? report : null, hardware: consent?.shareDiagnostics ? summary : null, appVersion: APP_VERSION });
      const call = response.message.tool_calls?.[0];
      if (call) {
        setBusy('');
        await executeAssistantTool(call.function.name);
        setReply('Listo. Revisá el resultado arriba.');
      } else {
        setReply(response.message.content || 'Decime qué querés resolver.');
      }
    } catch (error) {
      setReply(friendlyError(error, 'No pude responder ahora. Las herramientas locales siguen disponibles.'));
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
        <div className="nc-brand" data-tauri-drag-region><NexoMark size={24} /><span><b>NEXO</b><small>Support</small></span></div>
        <span className={`nc-live ${health.tone}`} data-tauri-drag-region><i />{active ? runtimeLabel : 'SIN ACTIVAR'}</span>
        <div className="nc-window-actions">
          <button aria-label="Menú" onClick={() => setMenuOpen((value) => !value)}><Menu size={17} /></button>
          <button aria-label="Minimizar" onClick={() => void safeInvoke('minimize_main_window')}><Minus size={16} /></button>
          <button aria-label="Cerrar NEXO" onClick={() => void safeInvoke('exit_app')}><X size={16} /></button>
        </div>
        {menuOpen && (
          <nav className="nc-menu">
            <button onClick={() => { setMenuOpen(false); setPanel('tools'); }}><Wrench size={16} /> Herramientas <ChevronRight size={15} /></button>
            <button onClick={() => void openAdmin()}><Settings2 size={16} /> Administración <ChevronRight size={15} /></button>
            <button onClick={() => { setMenuOpen(false); window.dispatchEvent(new Event('nexo:check-update')); }}><RefreshCw size={16} /> Buscar actualización</button>
            <button className="danger" onClick={() => void safeInvoke('exit_app')}><Power size={16} /> Cerrar NEXO</button>
          </nav>
        )}
      </header>

      {busy && <div className="nc-progress" role="status"><i /><span>{busy}</span></div>}

      {notice && (
        <div className={`nc-toast ${notice.tone}`} role="status" aria-live="polite">
          {notice.tone === 'error' || notice.tone === 'warning' ? <AlertTriangle size={18} /> : <Check size={18} />}
          <span><b>{notice.title}</b>{notice.detail && <small>{notice.detail}</small>}</span>
          <button aria-label="Cerrar aviso" onClick={() => setNotice(null)}><X size={15} /></button>
        </div>
      )}

      {!active ? (
        <section className="nc-activate">
          <NexoMark size={52} />
          <h1>Conectá esta PC</h1>
          <p>Ingresá el código de NEXO para activar soporte y diagnósticos.</p>
          <form onSubmit={(event) => { event.preventDefault(); const value = code.trim().toUpperCase(); if (value.length >= 4) { setPendingCode(value); setModeOpen(true); } }}>
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Código de activación" autoComplete="off" />
            <button disabled={code.trim().length < 4 || Boolean(busy)}>Continuar</button>
          </form>
        </section>
      ) : (
        <>
          <section className="nc-home">
            <section className={`nc-hero ${health.tone}`}>
              <div className="nc-hero-state"><span><ShieldCheck size={24} /></span><div><small>{lastCheckLabel(report)}</small><h1>{health.title}</h1><p>{health.detail}</p></div></div>
              <button onClick={() => void inspect()} disabled={Boolean(busy)}>{busy ? <RefreshCw className="spin" size={17} /> : <Gauge size={17} />} {busy ? 'Revisando' : 'Revisar ahora'}</button>
            </section>

            <section className="nc-section-heading"><div><small>ESTADO DEL EQUIPO</small><h2>Información principal</h2></div><button onClick={() => setPanel('details')}>Ver detalles</button></section>

            <section className="nc-readings" aria-label="Estado del equipo">
              <Reading icon={<Thermometer />} label="Temperatura" value={temperature.value} note={temperature.label} tone={temperature.tone} onClick={openTemperaturePanel} />
              <Reading icon={<MemoryStick />} label="Memoria RAM" value={ramUsed != null ? `${ramUsed}% usado` : 'Sin revisar'} note={ramUsed != null ? (ramUsed > 85 ? 'Uso alto' : 'Uso normal') : 'Revisá el equipo'} tone={ramUsed == null ? 'info' : ramUsed > 85 ? 'warning' : 'success'} onClick={() => setPanel('details')} />
              <Reading icon={<HardDrive />} label="Almacenamiento" value={diskFree != null ? `${diskFree} GB libres` : 'Sin revisar'} note={diskFree != null ? (diskFree < 15 ? 'Espacio bajo' : 'Espacio suficiente') : 'Revisá el equipo'} tone={diskFree == null ? 'info' : diskFree < 15 ? 'warning' : 'success'} onClick={() => setPanel('details')} />
              <Reading icon={<ShieldCheck />} label="Seguridad" value={report ? (report.defenderStatus === 'Activo' ? 'Protección activa' : 'Necesita revisión') : 'Sin revisar'} note={report?.defenderStatus || 'Revisá el equipo'} tone={!report ? 'info' : report.defenderStatus === 'Activo' ? 'success' : 'warning'} onClick={() => void runSimpleAction('defender_status', 'Revisando seguridad')} />
            </section>

            <section className="nc-section-heading nc-actions-heading"><div><small>ACCIONES RÁPIDAS</small><h2>Resolver problemas comunes</h2></div></section>
            <section className="nc-actions">
              <button onClick={() => setPanel('tools')}><Sparkles /><span><b>Optimizar equipo</b><small>Limpieza y mantenimiento seguro</small></span><ChevronRight /></button>
              <button onClick={() => void runSimpleAction('network_check', 'Revisando Internet')} disabled={Boolean(busy)}><Wifi /><span><b>Revisar Internet</b><small>Conexión, DNS y puerta de enlace</small></span><ChevronRight /></button>
              <button onClick={() => void requestSupport()} disabled={Boolean(busy)}><Headphones /><span><b>Hablar con un técnico</b><small>{remoteTool?.installed ? 'RustDesk está listo' : 'Crear solicitud de soporte'}</small></span><ChevronRight /></button>
            </section>

            {reply && <section className="nc-reply"><NexoMark size={18} /><p>{reply}</p><button aria-label="Cerrar respuesta" onClick={() => setReply('')}><X size={14} /></button></section>}
          </section>

          <footer className="nc-footer">
            <form onSubmit={(event) => void send(event)}>
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Contame qué problema tenés" disabled={Boolean(busy)} />
              <button aria-label="Enviar" disabled={!input.trim() || Boolean(busy)}><Send size={18} /></button>
            </form>
            <span>v{APP_VERSION}</span>
          </footer>
        </>
      )}

      {modeOpen && (
        <div className="nc-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModeOpen(false); }}>
          <section className="nc-sheet nc-mode-sheet">
            <header><div><small>CONFIGURACIÓN INICIAL</small><h2>¿Cómo querés usar NEXO?</h2></div><button aria-label="Cerrar" onClick={() => setModeOpen(false)}><X size={18} /></button></header>
            <div className="nc-mode-actions">
              <button onClick={() => void activate('protected')}><ShieldCheck /><span><b>Proteger esta PC</b><small>Diagnósticos, ayuda conectada y soporte técnico.</small></span><ChevronRight /></button>
              <button onClick={() => void activate('local')}><Gauge /><span><b>Solo revisar</b><small>Las revisiones quedan guardadas en este equipo.</small></span><ChevronRight /></button>
            </div>
          </section>
        </div>
      )}

      {panel && (
        <div className="nc-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPanel(null); }}>
          <section className={`nc-sheet nc-${panel}-sheet`}>
            <header><div><small>{panel === 'tools' ? 'HERRAMIENTAS' : panel === 'temperature' ? 'SENSORES' : panel === 'support' ? 'ESCRITORIO REMOTO' : 'DETALLES'}</small><h2>{panel === 'tools' ? 'Mantenimiento del equipo' : panel === 'temperature' ? 'Temperatura del equipo' : panel === 'support' ? 'Soporte remoto' : 'Estado completo'}</h2></div><button aria-label="Cerrar" onClick={() => setPanel(null)}><X size={18} /></button></header>

            {panel === 'tools' && (
              <div className="nc-tool-list">
                <Tool icon={<Trash2 />} title="Liberar espacio" detail="Borra temporales antiguos que ya no se usan" onClick={() => setConfirmAction({ id: 'clean_temp_files', title: 'Liberar espacio', detail: 'NEXO borrará únicamente archivos temporales antiguos que el sistema permita eliminar.' })} />
                <Tool icon={<Wifi />} title="Reparar Internet" detail="Limpia la caché DNS sin cambiar tu red" onClick={() => setConfirmAction({ id: 'repair_network', title: 'Reparar Internet', detail: 'NEXO limpiará la caché DNS. No cambia tu contraseña ni la configuración del router.' })} />
                <Tool icon={<ShieldCheck />} title="Análisis rápido" detail="Inicia el análisis oficial de Microsoft Defender" onClick={() => setConfirmAction({ id: 'defender_quick_scan', title: 'Analizar esta PC', detail: 'Microsoft Defender iniciará un análisis rápido en segundo plano.' })} />
                <Tool icon={<Rocket />} title="Revisar inicio" detail="Detecta programas que pueden demorar el arranque" onClick={() => void runSimpleAction('startup_review', 'Revisando inicio')} />
              </div>
            )}

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
                  <div className="nc-temperature-empty">
                    <Thermometer size={24} />
                    <div>
                      <b>{hardware?.permissionRequired ? 'Todavía no pudimos acceder a los sensores internos' : hardware ? 'Este equipo no entregó una temperatura compatible' : 'Todavía no se hizo una lectura'}</b>
                      <p>{hardware?.permissionRequired ? 'Podés reintentar como administrador. Va a aparecer el cuadro normal de autorización del sistema.' : hardware?.note || 'Buscá sensores para comprobar CPU, GPU, disco y placa madre.'}</p>
                    </div>
                  </div>
                )}

                <div className="nc-source-row"><span>Método de lectura</span><b>{summary?.sourceLabel || 'Todavía sin lectura'}</b></div>
                <button className="nc-primary" onClick={() => void readTemperature(Boolean(hardware?.permissionRequired))} disabled={Boolean(busy)}>
                  {busy ? 'Buscando sensores…' : hardware?.permissionRequired ? 'Reintentar como administrador' : 'Volver a buscar sensores'}
                </button>
                <p className="nc-panel-note">{hardware?.note || 'NEXO descarta valores imposibles y diferencia una temperatura directa de una lectura general aproximada.'}</p>
              </div>
            )}

            {panel === 'support' && (
              <div className="nc-support-panel">
                <div className={`nc-remote-state ${remoteTool?.installed ? 'ready' : 'missing'}`}>
                  <Headphones size={22} />
                  <div><b>{remoteTool?.installed ? 'RustDesk detectado' : 'RustDesk no está instalado'}</b><p>{remoteTool?.message || 'NEXO comprueba si el cliente open source está instalado en el equipo.'}</p></div>
                </div>
                {supportCode && <div className="nc-support-code"><span>Código de solicitud</span><strong>{supportCode}</strong><small>Compartilo con el técnico de NEXO.</small></div>}
                <button className="nc-primary" onClick={() => void openRemoteNow()} disabled={Boolean(busy) || !remoteTool?.installed}>{remoteTool?.installed ? 'Abrir RustDesk' : 'RustDesk no disponible'}</button>
                <p className="nc-panel-note">La conexión nunca empieza sola: ves RustDesk, compartís tu ID y aceptás el acceso.</p>
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

      {confirmAction && (
        <div className="nc-backdrop nc-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmAction(null); }}>
          <section className="nc-confirm">
            <span><Wrench size={23} /></span>
            <h2>{confirmAction.title}</h2>
            <p>{confirmAction.detail}</p>
            <div><button onClick={() => setConfirmAction(null)}>Cancelar</button><button onClick={() => void runSimpleAction(confirmAction.id, confirmAction.title)}>Confirmar</button></div>
          </section>
        </div>
      )}
    </main>
  );
}

function Reading({ icon, label, value, note, tone, onClick }: { icon: ReactNode; label: string; value: string; note: string; tone: Tone; onClick: () => void }) {
  return <button className={tone} onClick={onClick}><span>{icon}</span><div><small>{label}</small><b>{value}</b><em>{note}</em></div><ChevronRight size={16} /></button>;
}

function Tool({ icon, title, detail, onClick }: { icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return <button onClick={onClick}><span>{icon}</span><div><b>{title}</b><small>{detail}</small></div><ChevronRight size={17} /></button>;
}

function Value({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><b>{value}</b></div>;
}
