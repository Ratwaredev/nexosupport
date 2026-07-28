import { useEffect, useMemo, useRef, useState } from 'react';
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
import { openRemoteTool } from './lib/support';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type Mode = 'protected' | 'local';
type Tone = 'success' | 'warning' | 'error' | 'info';
type Notice = { tone: Tone; title: string; detail?: string };
type Panel = 'tools' | 'details' | 'temperature' | null;
type ConfirmAction = { id: string; title: string; detail: string } | null;

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
  const gradientId = `nexo-compact-${size}`;
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
  if (/tard[oó] demasiado|timeout|tiempo de espera/i.test(message)) return 'Windows tardó demasiado. Probá nuevamente.';
  if (/permission|denied|rechaz|autorización/i.test(message)) return 'Windows no autorizó esa acción.';
  if (/fetch|network|internet|supabase|rpc/i.test(message)) return 'El servicio conectado no está disponible. Las herramientas locales siguen funcionando.';
  return fallback;
}

function lastCheckLabel(report: DiagnosticReport | null) {
  if (!report?.generatedAt) return 'Sin revisar';
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(report.generatedAt)) / 60000));
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `Hace ${hours} h` : 'Hoy';
}

function healthState(report: DiagnosticReport | null, summary: SensorSummary | null) {
  if (!report) return { title: 'Revisemos tu PC', detail: 'Un chequeo tarda menos de un minuto.', tone: 'info' as Tone };
  const diskRatio = report.systemDriveTotalGb ? report.systemDriveFreeGb / report.systemDriveTotalGb : 1;
  const ramRatio = report.ramTotalGb ? report.ramFreeGb / report.ramTotalGb : 1;
  const hot = (summary?.cpuTemperatureC ?? 0) >= 88 || (summary?.gpuTemperatureC ?? 0) >= 88;
  const issues = [diskRatio < .12, ramRatio < .12, report.defenderStatus !== 'Activo', report.pendingReboot, hot].filter(Boolean).length;
  if (issues) return { title: `${issues} ${issues === 1 ? 'punto para revisar' : 'puntos para revisar'}`, detail: 'NEXO puede ayudarte a resolverlo.', tone: 'warning' as Tone };
  return { title: 'Tu PC está en orden', detail: 'No encontramos problemas importantes.', tone: 'success' as Tone };
}

function temperatureState(snapshot: HardwareSnapshot | null, summary: SensorSummary | null) {
  const values = [summary?.cpuTemperatureC, summary?.gpuTemperatureC, summary?.storageTemperatureC].filter((value): value is number => value != null);
  if (values.length) {
    const hottest = Math.round(Math.max(...values));
    return { value: `${hottest}°`, label: hottest >= 88 ? 'Alta' : 'Normal', tone: hottest >= 88 ? 'warning' as Tone : 'success' as Tone };
  }
  if (snapshot?.permissionRequired) return { value: 'Permiso', label: 'Tocar para leer', tone: 'warning' as Tone };
  if (snapshot) return { value: '—', label: 'No expuesta', tone: 'info' as Tone };
  return { value: '—', label: 'Sin leer', tone: 'info' as Tone };
}

export default function SupportAppV3() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [dashboard, setDashboard] = useState<ClientDashboard | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null);
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
  const initialCheckStarted = useRef(false);

  const device = dashboard?.device ?? null;
  const consent = dashboard?.consent ?? null;
  const active = Boolean(session?.deviceToken && device);
  const summary = useMemo(() => hardware ? summarizeHardware(hardware) : null, [hardware]);
  const health = useMemo(() => healthState(report, summary), [report, summary]);
  const temperature = useMemo(() => temperatureState(hardware, summary), [hardware, summary]);
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

  useEffect(() => {
    if (!active || report || busy || initialCheckStarted.current) return;
    initialCheckStarted.current = true;
    window.setTimeout(() => void inspect(false), 300);
  }, [active, report, busy]);

  async function inspect(showNotice = true) {
    if (!session?.deviceToken || !device || busy) return;
    setBusy('Revisando');
    setNotice(null);
    try {
      const nextReport = await withTimeout(runQuickDiagnostic(), 16000, 'La revisión tardó demasiado.');
      const nextHardware = await withTimeout(readHardwareSensors(false), 40000, 'La temperatura tardó demasiado.').catch(() => null);
      setReport(nextReport);
      setHardware(nextHardware);
      if (consent?.shareDiagnostics) {
        void appBackend.saveDiagnostic({ deviceId: device.id, payload: { ...nextReport, hardware: nextHardware } }, session.deviceToken).catch(() => undefined);
      }
      if (showNotice) setNotice({ tone: 'success', title: 'Revisión lista', detail: 'Los valores ya están actualizados.' });
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
      const savedConsent = await appBackend.saveConsents(registered.session.deviceToken, mode === 'protected' ? protectedConsent : localConsent);
      const data = await appBackend.getClientDashboard(registered.session.deviceToken);
      setSession(registered.session);
      setDashboard({ ...data, consent: savedConsent });
      setModeOpen(false);
      setPendingCode('');
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
      const result = await withTimeout(runAgentAction(action), 90000, `${working} tardó demasiado.`);
      setNotice({ tone: result.ok ? 'success' : 'error', title: result.ok ? 'Listo' : 'No se pudo completar', detail: result.message });
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
    setBusy(elevated ? 'Esperando permiso' : 'Leyendo sensores');
    setNotice(null);
    try {
      const snapshot = await withTimeout(readHardwareSensors(elevated), elevated ? 120000 : 45000, 'La lectura tardó demasiado.');
      setHardware(snapshot);
      const next = summarizeHardware(snapshot);
      const found = next.cpuTemperatureC != null || next.gpuTemperatureC != null || next.storageTemperatureC != null;
      setNotice({
        tone: found ? 'success' : snapshot.permissionRequired ? 'warning' : 'info',
        title: found ? 'Temperatura actualizada' : snapshot.permissionRequired ? 'Falta permiso de Windows' : 'Sensor no disponible',
        detail: found ? 'CPU, GPU y discos compatibles fueron leídos.' : snapshot.note
      });
      setPanel('temperature');
    } catch (error) {
      setNotice({ tone: 'info', title: 'No se pudo leer la temperatura', detail: friendlyError(error, 'El fabricante no expone un sensor compatible a Windows.') });
    } finally {
      setBusy('');
    }
  }

  async function requestSupport() {
    if (!session?.deviceToken || !device || busy) return;
    setBusy('Preparando soporte');
    try {
      const ticket = await appBackend.createTicket({ deviceId: device.id, issue: input.trim() || 'Solicita asistencia técnica', clientName: device.displayName, priority: 'normal' }, session.deviceToken);
      const remote = await appBackend.createRemoteSession({ deviceId: device.id, ticketId: ticket.id }, session.deviceToken);
      void openRemoteTool().catch(() => undefined);
      setNotice({ tone: 'success', title: 'Soporte preparado', detail: `Código ${remote.code}` });
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo abrir soporte', detail: friendlyError(error, 'Probá nuevamente.') });
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
      if (!isTauriRuntime()) throw new Error('NEXO Control se abre desde Windows.');
      await safeInvoke('open_admin_window');
    } catch (error) {
      setNotice({ tone: 'error', title: 'No se pudo abrir Administración', detail: friendlyError(error, 'Probá nuevamente.') });
    }
  }

  if (booting) return <main className="nc-app nc-loading"><NexoMark size={40} /><b>Abriendo NEXO</b><i /></main>;

  return (
    <main className="nc-app">
      <header className="nc-topbar" data-tauri-drag-region>
        <div className="nc-brand" data-tauri-drag-region><NexoMark size={22} /><span><b>NEXO</b><small>Support</small></span></div>
        <span className={`nc-live ${health.tone}`} data-tauri-drag-region><i />{busy || (active ? 'ACTIVO' : 'SIN ACTIVAR')}</span>
        <div className="nc-window-actions">
          <button aria-label="Menú" onClick={() => setMenuOpen((value) => !value)}><Menu size={16} /></button>
          <button aria-label="Minimizar" onClick={() => void safeInvoke('minimize_main_window')}><Minus size={15} /></button>
          <button aria-label="Cerrar NEXO" onClick={() => void safeInvoke('exit_app')}><X size={15} /></button>
        </div>
        {menuOpen && (
          <nav className="nc-menu">
            <button onClick={() => { setMenuOpen(false); setPanel('tools'); }}><Wrench size={15} /> Herramientas <ChevronRight size={14} /></button>
            <button onClick={() => void openAdmin()}><Settings2 size={15} /> Administración <ChevronRight size={14} /></button>
            <button onClick={() => { setMenuOpen(false); window.dispatchEvent(new Event('nexo:check-update')); }}><RefreshCw size={15} /> Buscar actualización</button>
            <button className="danger" onClick={() => void safeInvoke('exit_app')}><Power size={15} /> Cerrar NEXO</button>
          </nav>
        )}
      </header>

      {notice && (
        <div className={`nc-toast ${notice.tone}`}>
          {notice.tone === 'error' || notice.tone === 'warning' ? <AlertTriangle size={17} /> : <Check size={17} />}
          <span><b>{notice.title}</b>{notice.detail && <small>{notice.detail}</small>}</span>
          <button aria-label="Cerrar aviso" onClick={() => setNotice(null)}><X size={14} /></button>
        </div>
      )}

      {!active ? (
        <section className="nc-activate">
          <NexoMark size={48} />
          <h1>Conectá esta PC</h1>
          <p>Ingresá el código de NEXO.</p>
          <form onSubmit={(event) => { event.preventDefault(); const value = code.trim().toUpperCase(); if (value.length >= 4) { setPendingCode(value); setModeOpen(true); } }}>
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Código de activación" autoComplete="off" />
            <button disabled={code.trim().length < 4 || Boolean(busy)}>Continuar</button>
          </form>
        </section>
      ) : (
        <>
          <section className="nc-home">
            <section className={`nc-hero ${health.tone}`}>
              <div className="nc-hero-state"><span><ShieldCheck size={22} /></span><div><small>{lastCheckLabel(report)}</small><h1>{health.title}</h1><p>{health.detail}</p></div></div>
              <button onClick={() => void inspect()} disabled={Boolean(busy)}>{busy === 'Revisando' ? <RefreshCw className="spin" size={16} /> : <Gauge size={16} />} Revisar</button>
            </section>

            <section className="nc-readings" aria-label="Estado del equipo">
              <Reading icon={<Thermometer />} label="Temp." value={temperature.value} note={temperature.label} tone={temperature.tone} onClick={() => setPanel('temperature')} />
              <Reading icon={<MemoryStick />} label="RAM" value={ramUsed != null ? `${ramUsed}%` : '—'} note={ramUsed != null ? (ramUsed > 85 ? 'Alta' : 'Normal') : 'Sin dato'} tone={(ramUsed ?? 0) > 85 ? 'warning' : 'success'} onClick={() => setPanel('details')} />
              <Reading icon={<HardDrive />} label="Libre" value={diskFree != null ? `${diskFree} GB` : '—'} note={diskFree != null ? (diskFree < 15 ? 'Bajo' : 'Bien') : 'Sin dato'} tone={(diskFree ?? 99) < 15 ? 'warning' : 'success'} onClick={() => setPanel('details')} />
              <Reading icon={<ShieldCheck />} label="Seguridad" value={report ? (report.defenderStatus === 'Activo' ? 'Bien' : 'Revisar') : '—'} note={report?.defenderStatus || 'Sin dato'} tone={report?.defenderStatus === 'Activo' ? 'success' : 'warning'} onClick={() => void runSimpleAction('defender_status', 'Revisando seguridad')} />
            </section>

            <section className="nc-actions">
              <button onClick={() => setPanel('tools')}><Sparkles /><span><b>Optimizar</b><small>Acciones útiles</small></span></button>
              <button onClick={() => void runSimpleAction('network_check', 'Revisando Internet')} disabled={Boolean(busy)}><Wifi /><span><b>Internet</b><small>Probar conexión</small></span></button>
              <button onClick={() => void requestSupport()} disabled={Boolean(busy)}><Headphones /><span><b>Técnico</b><small>Pedir ayuda</small></span></button>
            </section>

            {reply && <section className="nc-reply"><NexoMark size={17} /><p>{reply}</p><button aria-label="Cerrar respuesta" onClick={() => setReply('')}><X size={13} /></button></section>}
            {busy && <section className="nc-working"><RefreshCw className="spin" size={17} /><b>{busy}</b></section>}
          </section>

          <footer className="nc-footer">
            <form onSubmit={(event) => void send(event)}>
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="¿Qué querés resolver?" disabled={Boolean(busy)} />
              <button aria-label="Enviar" disabled={!input.trim() || Boolean(busy)}><Send size={17} /></button>
            </form>
            <span>v{APP_VERSION}</span>
          </footer>
        </>
      )}

      {modeOpen && (
        <div className="nc-backdrop">
          <section className="nc-sheet nc-mode-sheet">
            <header><div><small>EMPEZAR</small><h2>¿Cómo querés usar NEXO?</h2></div><button aria-label="Cerrar" onClick={() => setModeOpen(false)}><X size={17} /></button></header>
            <div className="nc-mode-actions">
              <button onClick={() => void activate('protected')}><ShieldCheck /><span><b>Proteger esta PC</b><small>Revisiones y ayuda conectada.</small></span><ChevronRight /></button>
              <button onClick={() => void activate('local')}><Gauge /><span><b>Solo revisar</b><small>Todo queda en esta PC.</small></span><ChevronRight /></button>
            </div>
          </section>
        </div>
      )}

      {panel && (
        <div className="nc-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPanel(null); }}>
          <section className="nc-sheet">
            <header><div><small>{panel === 'tools' ? 'HERRAMIENTAS' : panel === 'temperature' ? 'SENSORES' : 'DETALLES'}</small><h2>{panel === 'tools' ? '¿Qué querés mejorar?' : panel === 'temperature' ? 'Temperatura del equipo' : 'Estado completo'}</h2></div><button aria-label="Cerrar" onClick={() => setPanel(null)}><X size={17} /></button></header>

            {panel === 'tools' && (
              <div className="nc-tool-list">
                <Tool icon={<Trash2 />} title="Liberar espacio" detail="Borra temporales antiguos" onClick={() => setConfirmAction({ id: 'clean_temp_files', title: 'Liberar espacio', detail: 'NEXO borrará únicamente archivos temporales antiguos que Windows permita eliminar.' })} />
                <Tool icon={<Wifi />} title="Reparar Internet" detail="Limpia la caché DNS" onClick={() => setConfirmAction({ id: 'repair_network', title: 'Reparar Internet', detail: 'NEXO limpiará la caché DNS. No cambia tu contraseña ni la configuración del router.' })} />
                <Tool icon={<ShieldCheck />} title="Análisis rápido" detail="Usa Microsoft Defender" onClick={() => setConfirmAction({ id: 'defender_quick_scan', title: 'Analizar esta PC', detail: 'Microsoft Defender iniciará un análisis rápido en segundo plano.' })} />
                <Tool icon={<Rocket />} title="Revisar inicio" detail="Detecta programas que demoran" onClick={() => void runSimpleAction('startup_review', 'Revisando inicio')} />
              </div>
            )}

            {panel === 'temperature' && (
              <div className="nc-temperature-panel">
                <div className={`nc-temperature-value ${temperature.tone}`}><Thermometer /><strong>{temperature.value}</strong><span>{temperature.label}</span></div>
                <div className="nc-temperature-grid">
                  <Value label="CPU" value={summary?.cpuTemperatureC != null ? `${Math.round(summary.cpuTemperatureC)} °C` : 'No disponible'} />
                  <Value label="GPU" value={summary?.gpuTemperatureC != null ? `${Math.round(summary.gpuTemperatureC)} °C` : 'No disponible'} />
                  <Value label="Disco" value={summary?.storageTemperatureC != null ? `${Math.round(summary.storageTemperatureC)} °C` : 'No disponible'} />
                  <Value label="Ventilador" value={summary?.fanRpm != null ? `${Math.round(summary.fanRpm)} RPM` : 'No disponible'} />
                </div>
                <button className="nc-primary" onClick={() => void readTemperature(Boolean(hardware?.permissionRequired))} disabled={Boolean(busy)}>{hardware?.permissionRequired ? 'Leer con permiso de Windows' : 'Volver a leer'}</button>
                <p>{hardware?.note || 'NEXO consulta sensores que el firmware y los controladores exponen a Windows.'}</p>
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
        <div className="nc-backdrop nc-confirm-backdrop">
          <section className="nc-confirm">
            <span><Wrench size={22} /></span>
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
  return <button className={tone} onClick={onClick}><span>{icon}</span><small>{label}</small><b>{value}</b><em>{note}</em></button>;
}

function Tool({ icon, title, detail, onClick }: { icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return <button onClick={onClick}><span>{icon}</span><div><b>{title}</b><small>{detail}</small></div><ChevronRight size={16} /></button>;
}

function Value({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><b>{value}</b></div>;
}
