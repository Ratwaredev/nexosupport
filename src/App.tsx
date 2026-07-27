import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  CheckCircle2,
  Clipboard,
  Clock3,
  Cpu,
  HardDrive,
  Laptop,
  LockKeyhole,
  LogOut,
  Monitor,
  RefreshCw,
  Server,
  ShieldCheck,
  Thermometer,
  Ticket,
  Users,
  Wrench,
  X,
  Zap
} from 'lucide-react';
import { appBackend, backendConfig } from './lib/backend';
import type {
  AdminDashboard,
  AppSession,
  ClientDashboard,
  Priority,
  TicketRecord,
  TicketStatus,
  UpdateResult
} from './lib/domain';
import { APP_VERSION, STORAGE_KEYS } from './lib/domain';
import { DiagnosticReport, runQuickDiagnostic } from './lib/diagnostics';
import { checkForUpdates as checkNativeUpdates, installLatestUpdate as installNativeUpdate } from './lib/updates';
import { openRemoteTool, RemoteSession } from './lib/support';
import { AgentActionResult, AgentStatus, getAgentStatus, runAgentAction } from './lib/agent';

type AdminView = 'requests' | 'devices' | 'releases';
type Toast = { message: string; tone: 'neutral' | 'success' | 'warning' | 'danger' } | null;

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});

function formatDate(value?: string) {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sin registro' : dateFormatter.format(date);
}

function ticketLabel(id?: string) {
  if (!id) return 'Sin solicitud';
  return id.replace(/^UD-/, 'NX-');
}

function statusLabel(status?: TicketStatus) {
  switch (status) {
    case 'nuevo': return 'Nueva';
    case 'esperando': return 'En espera';
    case 'en-remoto': return 'En asistencia';
    case 'cerrado': return 'Resuelta';
    default: return 'Sin estado';
  }
}

function statusTone(status?: TicketStatus) {
  switch (status) {
    case 'nuevo': return 'purple';
    case 'esperando': return 'amber';
    case 'en-remoto': return 'blue';
    case 'cerrado': return 'green';
    default: return 'muted';
  }
}

function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [adminView, setAdminView] = useState<AdminView>('requests');
  const [toast, setToast] = useState<Toast>(null);
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  const [adminEmail, setAdminEmail] = useState(
    backendConfig.backendKind === 'local' ? 'admin@nexo.local' : ''
  );
  const [adminPassword, setAdminPassword] = useState(
    backendConfig.backendKind === 'local' ? backendConfig.localAdminPassword : ''
  );
  const [clientPairingCode, setClientPairingCode] = useState(
    backendConfig.backendKind === 'local' ? 'DEMO-PAIR' : ''
  );
  const [clientIssue, setClientIssue] = useState('');

  const [adminDashboard, setAdminDashboard] = useState<AdminDashboard | null>(null);
  const [clientDashboard, setClientDashboard] = useState<ClientDashboard | null>(null);
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport | null>(null);
  const [remoteSession, setRemoteSession] = useState<RemoteSession | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState('');
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [agentResult, setAgentResult] = useState<AgentActionResult | null>(null);
  const [pairingGenerated, setPairingGenerated] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState('');

  const selectedTicket = useMemo<TicketRecord | undefined>(() => {
    const tickets = session?.role === 'admin'
      ? adminDashboard?.tickets ?? []
      : clientDashboard?.tickets ?? [];
    return tickets.find((ticketItem) => ticketItem.id === selectedTicketId) ?? tickets[0];
  }, [adminDashboard?.tickets, clientDashboard?.tickets, selectedTicketId, session?.role]);

  const openTickets = useMemo(() => {
    const tickets = session?.role === 'admin'
      ? adminDashboard?.tickets ?? []
      : clientDashboard?.tickets ?? [];
    return tickets.filter((ticketItem) => ticketItem.status !== 'cerrado');
  }, [adminDashboard?.tickets, clientDashboard?.tickets, session?.role]);

  useEffect(() => {
    let alive = true;

    void appBackend.bootstrap()
      .then((restored) => {
        if (alive) setSession(restored);
      })
      .catch(() => {
        if (alive) setSession(null);
      })
      .finally(() => {
        if (alive) setBooting(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken || !backendConfig.supabaseUrl || !backendConfig.supabaseAnonKey) return;

    let alive = true;

    const restoreSession = async () => {
      try {
        const baseUrl = backendConfig.supabaseUrl?.replace(/\/$/, '');
        const anonKey = backendConfig.supabaseAnonKey;
        if (!baseUrl || !anonKey) return;

        const headers = {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        };

        const authResponse = await fetch(`${baseUrl}/auth/v1/user`, { headers });
        if (!authResponse.ok) return;

        const user = await authResponse.json() as { id: string; email: string | null };
        const profileResponse = await fetch(
          `${baseUrl}/rest/v1/admin_users?select=*&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
          { headers }
        );
        if (!profileResponse.ok) return;

        const profiles = await profileResponse.json() as Array<{
          user_id: string;
          email: string;
          org_name: string;
        }>;
        const profile = profiles[0];
        if (!profile) return;

        const restoredSession: AppSession = {
          role: 'admin',
          backendKind: 'supabase',
          userId: user.id,
          accessToken,
          refreshToken: refreshToken ?? undefined,
          email: profile.email || user.email || undefined,
          displayName: profile.org_name,
          orgName: profile.org_name
        };

        window.localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(restoredSession));
        if (alive) {
          setSession(restoredSession);
          setShowAdminLogin(false);
          window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        }
      } catch {
        // The regular login remains available if the OAuth hash cannot be restored.
      }
    };

    void restoreSession();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    void checkNativeUpdates().then((result) => {
      if (!alive) return;
      setUpdateResult(result);
    }).catch(() => undefined);

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setAdminDashboard(null);
      setClientDashboard(null);
      setDiagnostic(null);
      setRemoteSession(null);
      setSelectedTicketId('');
      return;
    }

    if (session.role === 'admin') {
      void refreshAdmin();
    } else {
      void refreshClient(session.deviceToken ?? '');
    }
    void loadMaintenanceTelemetry();
  }, [session]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function refreshAdmin() {
    setIsBusy(true);
    try {
      const dashboard = await appBackend.getAdminDashboard();
      setAdminDashboard(dashboard);
      setSelectedTicketId((current) => current || dashboard.tickets[0]?.id || '');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo cargar el panel técnico.', 'danger');
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshClient(deviceToken: string) {
    if (!deviceToken) return;
    setIsBusy(true);
    try {
      const dashboard = await appBackend.getClientDashboard(deviceToken);
      setClientDashboard(dashboard);
      setSelectedTicketId((current) => current || dashboard.tickets[0]?.id || '');

      const latestDiagnostic = dashboard.diagnostics[0];
      if (latestDiagnostic) {
        setDiagnostic(latestDiagnostic.payload as unknown as DiagnosticReport);
      }
      if (dashboard.latestSession) {
        setRemoteSession({
          code: dashboard.latestSession.code,
          expiresInMinutes: dashboard.latestSession.expiresInMinutes,
          instructions: dashboard.latestSession.instructions
        });
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo cargar el estado del equipo.', 'danger');
    } finally {
      setIsBusy(false);
    }
  }

  async function loadMaintenanceTelemetry() {
    try {
      setAgentStatus(await getAgentStatus());
    } catch {
      setAgentStatus(null);
    }
  }

  function notify(message: string, tone: NonNullable<Toast>['tone'] = 'neutral') {
    setToast({ message, tone });
  }

  function handleSignOut() {
    void appBackend.signOut().finally(() => {
      setSession(null);
      setAdminDashboard(null);
      setClientDashboard(null);
      setDiagnostic(null);
      setRemoteSession(null);
      setUpdateResult(null);
      setAgentResult(null);
      setSelectedTicketId('');
      setShowAdminLogin(false);
      notify('Sesión cerrada.', 'neutral');
    });
  }

  async function handleAdminSignIn() {
    if (!adminEmail.trim() || !adminPassword) {
      notify('Completá el correo y la contraseña.', 'warning');
      return;
    }

    setIsBusy(true);
    try {
      const email = backendConfig.backendKind === 'local' && adminEmail.trim() === 'admin@nexo.local'
        ? backendConfig.localAdminEmail
        : adminEmail.trim();
      const result = await appBackend.signInAdmin(email, adminPassword);
      setSession(result.session);
      setAdminDashboard(await appBackend.getAdminDashboard());
      setAdminView('requests');
      setShowAdminLogin(false);
      notify('Acceso técnico iniciado.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo iniciar sesión.', 'danger');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleClientRegister() {
    if (!clientPairingCode.trim()) {
      notify('Ingresá el código que te dio el equipo de soporte.', 'warning');
      return;
    }
    if (clientIssue.trim().length < 8) {
      notify('Contanos brevemente qué está pasando.', 'warning');
      return;
    }

    setIsBusy(true);
    try {
      const report = await runQuickDiagnostic();
      setDiagnostic(report);
      const deviceName = report.computerName || report.userName || 'Equipo cliente';
      const result = await appBackend.registerClient({
        pairingCode: clientPairingCode.trim(),
        deviceName,
        issue: clientIssue.trim(),
        computerName: report.computerName,
        userName: report.userName,
        os: report.os,
        platform: 'windows'
      });

      setSession(result.session);
      setClientDashboard(await appBackend.getClientDashboard(result.session.deviceToken ?? ''));
      notify('Equipo vinculado. Ya podés solicitar asistencia.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo vincular el equipo.', 'danger');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRunDiagnostic() {
    if (!session?.deviceToken) {
      notify('Primero vinculá el equipo.', 'warning');
      return;
    }

    setIsBusy(true);
    try {
      const report = await runQuickDiagnostic();
      setDiagnostic(report);
      await appBackend.saveDiagnostic(
        {
          deviceId: session.deviceId ?? '',
          payload: report as unknown as Record<string, unknown>
        },
        session.deviceToken
      );
      await refreshClient(session.deviceToken);
      notify('Diagnóstico actualizado.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo ejecutar el diagnóstico.', 'danger');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreateTicket() {
    if (!session?.deviceToken || !clientDashboard?.device) {
      notify('Primero vinculá el equipo.', 'warning');
      return;
    }
    if (clientIssue.trim().length < 8) {
      notify('Describí el problema antes de pedir asistencia.', 'warning');
      return;
    }

    setIsBusy(true);
    try {
      const normalizedIssue = clientIssue.toLowerCase();
      const priority: Priority = normalizedIssue.includes('urgente') || normalizedIssue.includes('no prende')
        ? 'alta'
        : 'normal';
      const ticketRecord = await appBackend.createTicket(
        {
          deviceId: clientDashboard.device.id,
          issue: clientIssue.trim(),
          clientName: clientDashboard.device.displayName,
          priority
        },
        session.deviceToken
      );
      const supportSession = await appBackend.createRemoteSession(
        {
          deviceId: clientDashboard.device.id,
          ticketId: ticketRecord.id
        },
        session.deviceToken
      );

      setRemoteSession({
        code: supportSession.code,
        expiresInMinutes: supportSession.expiresInMinutes,
        instructions: supportSession.instructions
      });
      await refreshClient(session.deviceToken);
      notify(`Solicitud ${ticketLabel(ticketRecord.id)} creada.`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo crear la solicitud.', 'danger');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleOpenRemote() {
    try {
      notify(await openRemoteTool(), 'neutral');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo abrir la asistencia remota.', 'danger');
    }
  }

  async function handleGeneratePairingCode() {
    if (session?.role !== 'admin') return;

    setIsBusy(true);
    try {
      const record = await appBackend.generatePairingCode();
      setPairingGenerated(record.code);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(record.code);
      }
      await refreshAdmin();
      notify('Código generado y copiado.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo generar el código.', 'danger');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleUpdateCheck() {
    setIsBusy(true);
    try {
      const result = await appBackend.checkForUpdates(APP_VERSION);
      setUpdateResult(result);
      notify(result.notes, result.status === 'available' ? 'warning' : 'neutral');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo verificar la versión.', 'danger');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleNativeUpdateCheck() {
    try {
      const result = await checkNativeUpdates();
      setUpdateResult(result);
      notify(result.notes, result.status === 'available' ? 'warning' : 'neutral');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo verificar la actualización.', 'danger');
    }
  }

  async function handleNativeUpdateInstall() {
    setIsUpdating(true);
    try {
      const result = await installNativeUpdate((progress) => setUpdateProgress(progress));
      setUpdateResult(result);
      notify(result.notes, result.status === 'available' ? 'warning' : 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo instalar la actualización.', 'danger');
    } finally {
      setIsUpdating(false);
      setUpdateProgress('');
    }
  }

  async function handleAgentAction(actionId: string) {
    setIsBusy(true);
    try {
      const result = await runAgentAction(actionId);
      setAgentResult(result);
      notify(result.message, result.ok ? 'success' : 'warning');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo ejecutar la acción.', 'danger');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRefreshDashboard() {
    if (!session) return;
    if (session.role === 'admin') {
      await refreshAdmin();
    } else if (session.deviceToken) {
      await refreshClient(session.deviceToken);
    }
    notify('Información actualizada.', 'success');
  }

  if (booting) {
    return <LoadingScreen />;
  }

  if (!session) {
    return (
      <AuthScreen
        pairingCode={clientPairingCode}
        issue={clientIssue}
        adminEmail={adminEmail}
        adminPassword={adminPassword}
        showAdminLogin={showAdminLogin}
        isBusy={isBusy}
        updateResult={updateResult}
        isUpdating={isUpdating}
        updateProgress={updateProgress}
        onPairingCodeChange={setClientPairingCode}
        onIssueChange={setClientIssue}
        onConnect={handleClientRegister}
        onOpenAdmin={() => setShowAdminLogin(true)}
        onCloseAdmin={() => setShowAdminLogin(false)}
        onAdminEmailChange={setAdminEmail}
        onAdminPasswordChange={setAdminPassword}
        onAdminSignIn={handleAdminSignIn}
        onInstallUpdate={handleNativeUpdateInstall}
      />
    );
  }

  return (
    <main className="nexo-app workspace-view">
      <AmbientBackground />
      <AppHeader
        session={session}
        isBusy={isBusy}
        onRefresh={handleRefreshDashboard}
        onSignOut={handleSignOut}
      />

      {session.role === 'admin' ? (
        <AdminWorkspace
          dashboard={adminDashboard}
          view={adminView}
          selectedTicket={selectedTicket}
          selectedTicketId={selectedTicketId}
          pairingCode={pairingGenerated || adminDashboard?.pairingCodes[0]?.code || ''}
          openTicketCount={openTickets.length}
          updateResult={updateResult}
          isBusy={isBusy}
          onViewChange={setAdminView}
          onSelectTicket={setSelectedTicketId}
          onGeneratePairingCode={handleGeneratePairingCode}
          onOpenRemote={handleOpenRemote}
          onUpdateTicket={async (status) => {
            if (!selectedTicket) return;
            setIsBusy(true);
            try {
              await appBackend.updateTicketStatus(selectedTicket.id, status);
              await refreshAdmin();
              notify(`Solicitud ${ticketLabel(selectedTicket.id)} actualizada.`, 'success');
            } catch (error) {
              notify(error instanceof Error ? error.message : 'No se pudo actualizar la solicitud.', 'danger');
            } finally {
              setIsBusy(false);
            }
          }}
          onCheckUpdates={handleUpdateCheck}
          onNativeUpdateCheck={handleNativeUpdateCheck}
        />
      ) : (
        <ClientWorkspace
          dashboard={clientDashboard}
          issue={clientIssue}
          diagnostic={diagnostic}
          remoteSession={remoteSession}
          agentStatus={agentStatus}
          agentResult={agentResult}
          updateResult={updateResult}
          isBusy={isBusy}
          isUpdating={isUpdating}
          updateProgress={updateProgress}
          onIssueChange={setClientIssue}
          onCreateTicket={handleCreateTicket}
          onRunDiagnostic={handleRunDiagnostic}
          onOpenRemote={handleOpenRemote}
          onCheckUpdates={handleNativeUpdateCheck}
          onInstallUpdate={handleNativeUpdateInstall}
          onAgentAction={handleAgentAction}
        />
      )}

      {toast && <ToastBar toast={toast} onClose={() => setToast(null)} />}
      <div className="version-chip">NEXO Support · v{APP_VERSION}</div>
    </main>
  );
}

function AmbientBackground() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient-orb ambient-orb-one" />
      <div className="ambient-orb ambient-orb-two" />
      <div className="ambient-grid" />
    </div>
  );
}

function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`nexo-brand ${dark ? 'dark' : ''}`} aria-label="NEXO Support">
      <span className="brand-word">NE</span>
      <svg className="brand-x" viewBox="0 0 32 28" aria-hidden="true">
        <defs>
          <linearGradient id="nexo-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7a3cff" />
            <stop offset="1" stopColor="#188fff" />
          </linearGradient>
        </defs>
        <path d="M4 3L15.5 14L4 25" fill="none" stroke="url(#nexo-gradient)" strokeWidth="5.2" strokeLinecap="square" />
        <path d="M28 3L16.5 14L28 25" fill="none" stroke="url(#nexo-gradient)" strokeWidth="5.2" strokeLinecap="square" />
      </svg>
      <span className="brand-word">O</span>
      <span className="brand-product">Support</span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="nexo-app loading-view">
      <AmbientBackground />
      <div className="loading-card">
        <Brand />
        <div className="loading-line"><span /></div>
        <p>Preparando una conexión segura.</p>
      </div>
    </main>
  );
}

type AuthScreenProps = {
  pairingCode: string;
  issue: string;
  adminEmail: string;
  adminPassword: string;
  showAdminLogin: boolean;
  isBusy: boolean;
  updateResult: UpdateResult | null;
  isUpdating: boolean;
  updateProgress: string;
  onPairingCodeChange: (value: string) => void;
  onIssueChange: (value: string) => void;
  onConnect: () => void;
  onOpenAdmin: () => void;
  onCloseAdmin: () => void;
  onAdminEmailChange: (value: string) => void;
  onAdminPasswordChange: (value: string) => void;
  onAdminSignIn: () => void;
  onInstallUpdate: () => void;
};

function AuthScreen(props: AuthScreenProps) {
  return (
    <main className="nexo-app auth-view">
      <AmbientBackground />
      <header className="public-header">
        <Brand />
        <button className="quiet-button" onClick={props.onOpenAdmin}>
          <LockKeyhole size={15} /> Acceso técnico
        </button>
      </header>

      <section className="auth-layout">
        <div className="auth-copy">
          <span className="eyebrow">Soporte técnico NEXO</span>
          <h1>Tu equipo vuelve a funcionar, <span>sin vueltas.</span></h1>
          <p>
            Vinculá esta computadora con el código que te dio el técnico. NEXO revisa el estado del sistema y deja todo listo para asistirte.
          </p>
          <div className="trust-row">
            <span><ShieldCheck size={17} /> Acceso autorizado</span>
            <span><Clock3 size={17} /> Diagnóstico rápido</span>
            <span><Laptop size={17} /> Hecho para Windows</span>
          </div>
        </div>

        <section className="auth-card surface-card">
          <div className="card-heading">
            <span className="step-number">01</span>
            <div>
              <h2>Solicitar asistencia</h2>
              <p>Dos datos y el equipo queda vinculado.</p>
            </div>
          </div>

          <label className="field-label">
            <span>Código de acceso</span>
            <input
              value={props.pairingCode}
              onChange={(event: ChangeEvent<HTMLInputElement>) => props.onPairingCodeChange(event.target.value.toUpperCase())}
              placeholder="EJ: NEXO-82F4"
              autoComplete="one-time-code"
            />
          </label>

          <label className="field-label">
            <span>¿Qué está pasando?</span>
            <textarea
              value={props.issue}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => props.onIssueChange(event.target.value)}
              placeholder="Ej: La computadora tarda mucho en iniciar y se congela."
            />
          </label>

          <button className="primary-button full" onClick={props.onConnect} disabled={props.isBusy}>
            {props.isBusy ? <RefreshCw className="spin" size={18} /> : <ArrowRight size={18} />}
            {props.isBusy ? 'Revisando el equipo…' : 'Conectar con NEXO'}
          </button>

          <p className="privacy-note">
            El diagnóstico se ejecuta cuando lo pedís. NEXO no mantiene monitoreo oculto.
          </p>

          {props.updateResult?.status === 'available' && (
            <div className="update-inline">
              <div>
                <strong>Nueva versión {props.updateResult.nextVersion}</strong>
                <span>{props.isUpdating ? props.updateProgress || 'Instalando…' : 'Lista para instalar'}</span>
              </div>
              <button onClick={props.onInstallUpdate} disabled={props.isUpdating}>
                <ArrowDownToLine size={16} /> Actualizar
              </button>
            </div>
          )}
        </section>
      </section>

      <footer className="public-footer">
        <span>NEXO · Transformación digital</span>
        <span>v{APP_VERSION}</span>
      </footer>

      {props.showAdminLogin && (
        <div className="modal-backdrop" onClick={props.onCloseAdmin} role="presentation">
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="admin-title" onClick={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}>
            <button className="modal-close" onClick={props.onCloseAdmin} aria-label="Cerrar">
              <X size={18} />
            </button>
            <span className="eyebrow">Panel privado</span>
            <h2 id="admin-title">Acceso técnico</h2>
            <p>Ingresá con la cuenta del equipo de soporte.</p>

            <label className="field-label">
              <span>Correo</span>
              <input
                value={props.adminEmail}
                onChange={(event: ChangeEvent<HTMLInputElement>) => props.onAdminEmailChange(event.target.value)}
                placeholder="tecnico@nexo.com"
                autoComplete="username"
              />
            </label>
            <label className="field-label">
              <span>Contraseña</span>
              <input
                type="password"
                value={props.adminPassword}
                onChange={(event: ChangeEvent<HTMLInputElement>) => props.onAdminPasswordChange(event.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === 'Enter') props.onAdminSignIn();
                }}
              />
            </label>
            <button className="primary-button full" onClick={props.onAdminSignIn} disabled={props.isBusy}>
              <LockKeyhole size={17} /> {props.isBusy ? 'Ingresando…' : 'Entrar al panel'}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

function AppHeader({
  session,
  isBusy,
  onRefresh,
  onSignOut
}: {
  session: AppSession;
  isBusy: boolean;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="app-header">
      <Brand />
      <div className="header-context">
        <span className="status-dot" />
        <span>{session.role === 'admin' ? 'Panel técnico' : 'Equipo conectado'}</span>
      </div>
      <div className="header-actions">
        <button className="icon-button" onClick={onRefresh} disabled={isBusy} aria-label="Actualizar">
          <RefreshCw className={isBusy ? 'spin' : ''} size={17} />
        </button>
        <button className="quiet-button" onClick={onSignOut}>
          <LogOut size={16} /> Salir
        </button>
      </div>
    </header>
  );
}

type AdminWorkspaceProps = {
  dashboard: AdminDashboard | null;
  view: AdminView;
  selectedTicket?: TicketRecord;
  selectedTicketId: string;
  pairingCode: string;
  openTicketCount: number;
  updateResult: UpdateResult | null;
  isBusy: boolean;
  onViewChange: (view: AdminView) => void;
  onSelectTicket: (ticketId: string) => void;
  onGeneratePairingCode: () => void;
  onOpenRemote: () => void;
  onUpdateTicket: (status: TicketStatus) => void;
  onCheckUpdates: () => void;
  onNativeUpdateCheck: () => void;
};

function AdminWorkspace(props: AdminWorkspaceProps) {
  const selectedDevice = props.dashboard?.devices.find((device) => device.id === props.selectedTicket?.deviceId);
  const activeDevices = props.dashboard?.devices.filter((device) => device.status !== 'idle').length ?? 0;

  return (
    <div className="workspace-shell admin-shell">
      <aside className="sidebar">
        <div className="sidebar-section">
          <span className="sidebar-label">Gestión</span>
          <button className={props.view === 'requests' ? 'active' : ''} onClick={() => props.onViewChange('requests')}>
            <Ticket size={18} /> Solicitudes <b>{props.openTicketCount}</b>
          </button>
          <button className={props.view === 'devices' ? 'active' : ''} onClick={() => props.onViewChange('devices')}>
            <Monitor size={18} /> Equipos <b>{props.dashboard?.devices.length ?? 0}</b>
          </button>
          <button className={props.view === 'releases' ? 'active' : ''} onClick={() => props.onViewChange('releases')}>
            <Server size={18} /> Versiones
          </button>
        </div>

        <div className="pairing-card">
          <span className="sidebar-label">Nuevo acceso</span>
          <strong>{props.pairingCode || '— — — —'}</strong>
          <p>Válido por 30 minutos. Se copia automáticamente.</p>
          <button className="secondary-button full" onClick={props.onGeneratePairingCode} disabled={props.isBusy}>
            <Clipboard size={16} /> Generar código
          </button>
        </div>
      </aside>

      <section className="workspace-main">
        <div className="workspace-title-row">
          <div>
            <span className="eyebrow">Centro de soporte</span>
            <h1>{props.view === 'requests' ? 'Solicitudes' : props.view === 'devices' ? 'Equipos' : 'Versiones'}</h1>
          </div>
          <div className="summary-strip">
            <div><span>Abiertas</span><strong>{props.openTicketCount}</strong></div>
            <div><span>Activos</span><strong>{activeDevices}</strong></div>
            <div><span>Backend</span><strong>{props.dashboard ? 'Online' : '—'}</strong></div>
          </div>
        </div>

        {props.view === 'requests' && (
          <div className="request-layout">
            <section className="surface-card request-list-card">
              <div className="section-heading">
                <div>
                  <h2>Cola actual</h2>
                  <p>Ordenada por actividad reciente.</p>
                </div>
                <Activity size={19} />
              </div>
              <div className="request-list">
                {(props.dashboard?.tickets ?? []).length === 0 && <EmptyState text="No hay solicitudes todavía." />}
                {(props.dashboard?.tickets ?? []).map((ticketItem) => (
                  <button
                    key={ticketItem.id}
                    className={`request-row ${ticketItem.id === props.selectedTicketId ? 'active' : ''}`}
                    onClick={() => props.onSelectTicket(ticketItem.id)}
                  >
                    <div className="request-row-top">
                      <strong>{ticketLabel(ticketItem.id)}</strong>
                      <StatusPill label={statusLabel(ticketItem.status)} tone={statusTone(ticketItem.status)} />
                    </div>
                    <span className="request-client">{ticketItem.clientName}</span>
                    <p>{ticketItem.issue}</p>
                    <small>{formatDate(ticketItem.updatedAt)}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="surface-card request-detail-card">
              {props.selectedTicket ? (
                <>
                  <div className="detail-head">
                    <div>
                      <span className="eyebrow">{ticketLabel(props.selectedTicket.id)}</span>
                      <h2>{props.selectedTicket.clientName}</h2>
                    </div>
                    <StatusPill label={statusLabel(props.selectedTicket.status)} tone={statusTone(props.selectedTicket.status)} />
                  </div>

                  <div className="issue-box">
                    <span>Problema informado</span>
                    <p>{props.selectedTicket.issue}</p>
                  </div>

                  <div className="detail-grid">
                    <InfoLine label="Equipo" value={selectedDevice?.displayName ?? 'Sin vincular'} />
                    <InfoLine label="Sistema" value={selectedDevice?.os ?? 'Sin datos'} />
                    <InfoLine label="Prioridad" value={props.selectedTicket.priority === 'alta' ? 'Alta' : 'Normal'} />
                    <InfoLine label="Último cambio" value={formatDate(props.selectedTicket.updatedAt)} />
                  </div>

                  <div className="detail-actions">
                    <button className="primary-button" onClick={() => props.onUpdateTicket('en-remoto')} disabled={props.isBusy}>
                      <Zap size={17} /> Iniciar asistencia
                    </button>
                    <button className="secondary-button" onClick={props.onOpenRemote}>
                      <Wrench size={17} /> Abrir remoto
                    </button>
                  </div>

                  <div className="status-actions">
                    <span>Cambiar estado</span>
                    <button onClick={() => props.onUpdateTicket('nuevo')}>Nueva</button>
                    <button onClick={() => props.onUpdateTicket('esperando')}>En espera</button>
                    <button onClick={() => props.onUpdateTicket('cerrado')}>Resolver</button>
                  </div>
                </>
              ) : (
                <EmptyState text="Seleccioná una solicitud para ver el detalle." />
              )}
            </section>
          </div>
        )}

        {props.view === 'devices' && (
          <section className="surface-card table-card">
            <div className="section-heading">
              <div><h2>Equipos vinculados</h2><p>Estado y última conexión.</p></div>
              <Users size={19} />
            </div>
            <div className="data-table">
              <div className="table-head"><span>Equipo</span><span>Sistema</span><span>Estado</span><span>Última conexión</span></div>
              {(props.dashboard?.devices ?? []).map((device) => (
                <div className="table-row" key={device.id}>
                  <span><strong>{device.displayName}</strong><small>{device.computerName}</small></span>
                  <span>{device.os}</span>
                  <span><StatusPill label={device.status === 'idle' ? 'Disponible' : device.status === 'waiting' ? 'Esperando' : device.status === 'en-remoto' ? 'En asistencia' : 'Mantenimiento'} tone={device.status === 'idle' ? 'green' : 'blue'} /></span>
                  <span>{formatDate(device.lastSeenAt)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {props.view === 'releases' && (
          <section className="surface-card releases-card">
            <div className="section-heading">
              <div><h2>Distribución</h2><p>Versiones disponibles para los equipos.</p></div>
              <div className="inline-actions">
                <button className="secondary-button" onClick={props.onCheckUpdates}><RefreshCw size={16} /> Backend</button>
                <button className="secondary-button" onClick={props.onNativeUpdateCheck}><ArrowDownToLine size={16} /> Updater</button>
              </div>
            </div>
            <div className="release-current">
              <span>Estado del updater</span>
              <strong>{props.updateResult?.status === 'available' ? `Disponible ${props.updateResult.nextVersion}` : props.updateResult?.notes ?? 'Sin verificar'}</strong>
            </div>
            <div className="release-list">
              {(props.dashboard?.releases ?? []).map((release) => (
                <article key={release.id}>
                  <div><strong>v{release.version}</strong><StatusPill label={release.isActive ? 'Activa' : 'Inactiva'} tone={release.isActive ? 'green' : 'muted'} /></div>
                  <p>{release.notes}</p>
                  <small>{formatDate(release.publishedAt)} · {release.channel}</small>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

type ClientWorkspaceProps = {
  dashboard: ClientDashboard | null;
  issue: string;
  diagnostic: DiagnosticReport | null;
  remoteSession: RemoteSession | null;
  agentStatus: AgentStatus | null;
  agentResult: AgentActionResult | null;
  updateResult: UpdateResult | null;
  isBusy: boolean;
  isUpdating: boolean;
  updateProgress: string;
  onIssueChange: (value: string) => void;
  onCreateTicket: () => void;
  onRunDiagnostic: () => void;
  onOpenRemote: () => void;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  onAgentAction: (actionId: string) => void;
};

function ClientWorkspace(props: ClientWorkspaceProps) {
  const latestTicket = props.dashboard?.tickets[0];
  const latestDiagnostic = props.dashboard?.diagnostics[0]?.payload as Partial<DiagnosticReport> | undefined;
  const report = props.diagnostic ?? latestDiagnostic ?? null;
  const diskTotal = typeof report?.systemDriveTotalGb === 'number' ? report.systemDriveTotalGb : null;
  const diskFree = typeof report?.systemDriveFreeGb === 'number' ? report.systemDriveFreeGb : null;
  const ramTotal = typeof report?.ramTotalGb === 'number' ? report.ramTotalGb : null;
  const ramFree = typeof report?.ramFreeGb === 'number' ? report.ramFreeGb : null;
  const diskFreePercent = diskTotal && diskFree != null
    ? Math.round((diskFree / diskTotal) * 100)
    : null;
  const ramUsagePercent = ramTotal && ramFree != null
    ? Math.round(((ramTotal - ramFree) / ramTotal) * 100)
    : null;
  const remoteCode = props.remoteSession?.code ?? latestTicket?.remoteCode;
  const updateAvailable = props.updateResult?.status === 'available';

  return (
    <div className="workspace-shell client-shell">
      <section className="workspace-main client-main">
        <div className="client-hero">
          <div>
            <span className="eyebrow">{props.dashboard?.device.displayName ?? 'Equipo vinculado'}</span>
            <h1>{latestTicket && latestTicket.status !== 'cerrado' ? 'Tu solicitud está en curso.' : '¿En qué te ayudamos?'}</h1>
            <p>
              {latestTicket && latestTicket.status !== 'cerrado'
                ? `El equipo NEXO ya tiene el caso ${ticketLabel(latestTicket.id)} y puede continuar desde acá.`
                : 'Describí el problema y NEXO prepara el diagnóstico y la conexión remota.'}
            </p>
          </div>
          {latestTicket && (
            <div className="hero-status">
              <StatusPill label={statusLabel(latestTicket.status)} tone={statusTone(latestTicket.status)} />
              <strong>{ticketLabel(latestTicket.id)}</strong>
              <small>Actualizado {formatDate(latestTicket.updatedAt)}</small>
            </div>
          )}
        </div>

        <div className="client-grid">
          <section className="surface-card support-card">
            <div className="section-heading">
              <div><h2>Asistencia</h2><p>Contanos qué necesitás resolver.</p></div>
              <Ticket size={19} />
            </div>
            <label className="field-label">
              <span>Descripción del problema</span>
              <textarea
                value={props.issue}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => props.onIssueChange(event.target.value)}
                placeholder="Ej: Se congela al abrir programas y el ventilador hace mucho ruido."
              />
            </label>
            <div className="support-actions">
              <button className="primary-button" onClick={props.onCreateTicket} disabled={props.isBusy}>
                <ArrowRight size={17} /> Pedir asistencia
              </button>
              {remoteCode && (
                <button className="secondary-button" onClick={props.onOpenRemote}>
                  <Wrench size={17} /> Abrir remoto
                </button>
              )}
            </div>
            {remoteCode && (
              <div className="remote-code-box">
                <span>Código de sesión</span>
                <strong>{remoteCode}</strong>
                <small>Vence en {props.remoteSession?.expiresInMinutes ?? 20} minutos</small>
              </div>
            )}
          </section>

          <section className="surface-card health-card">
            <div className="section-heading">
              <div><h2>Estado del equipo</h2><p>Último diagnóstico disponible.</p></div>
              <Activity size={19} />
            </div>
            <div className="health-grid">
              <HealthMetric icon={<Cpu size={18} />} label="Memoria" value={ramUsagePercent == null ? '—' : `${ramUsagePercent}% en uso`} tone={ramUsagePercent != null && ramUsagePercent > 85 ? 'warning' : 'normal'} />
              <HealthMetric icon={<HardDrive size={18} />} label="Disco libre" value={diskFreePercent == null ? '—' : `${diskFreePercent}%`} tone={diskFreePercent != null && diskFreePercent < 15 ? 'warning' : 'normal'} />
              <HealthMetric icon={<Thermometer size={18} />} label="Temperatura" value={report?.maxTemperatureC == null ? '—' : `${report.maxTemperatureC.toFixed(1)} °C`} tone={report?.maxTemperatureC != null && report.maxTemperatureC > 80 ? 'warning' : 'normal'} />
              <HealthMetric icon={<ShieldCheck size={18} />} label="Seguridad" value={report?.defenderStatus ?? 'Sin revisar'} tone="normal" />
            </div>
            <button className="secondary-button full" onClick={props.onRunDiagnostic} disabled={props.isBusy}>
              <RefreshCw className={props.isBusy ? 'spin' : ''} size={16} /> Ejecutar diagnóstico
            </button>
            {report?.recommendations?.[0] && <p className="diagnostic-note">{report.recommendations[0]}</p>}
          </section>

          <section className="surface-card tools-card">
            <div className="section-heading">
              <div><h2>Acciones seguras</h2><p>Chequeos puntuales, sin monitoreo permanente.</p></div>
              <Wrench size={19} />
            </div>
            <div className="tool-grid">
              <ToolButton icon={<Thermometer size={18} />} label="Temperatura" onClick={() => props.onAgentAction('temp_scan')} />
              <ToolButton icon={<Zap size={18} />} label="Inicio" onClick={() => props.onAgentAction('startup_review')} />
              <ToolButton icon={<RefreshCw size={18} />} label="Windows Update" onClick={() => props.onAgentAction('windows_update')} />
              <ToolButton icon={<ShieldCheck size={18} />} label="Defender" onClick={() => props.onAgentAction('defender_status')} />
            </div>
            <div className="agent-note">
              <span className={props.agentStatus?.monitoring ? 'status-dot warning' : 'status-dot'} />
              <div>
                <strong>{props.agentStatus?.monitoring ? 'Monitoreo activo' : 'Sólo bajo demanda'}</strong>
                <span>{props.agentResult?.message ?? props.agentStatus?.notes ?? 'Las acciones se ejecutan únicamente al presionar un botón.'}</span>
              </div>
            </div>
          </section>

          <section className="surface-card update-card">
            <div className="section-heading">
              <div><h2>Aplicación</h2><p>Mantené NEXO Support actualizado.</p></div>
              <ArrowDownToLine size={19} />
            </div>
            <div className="version-state">
              <div>
                <span>Versión instalada</span>
                <strong>v{APP_VERSION}</strong>
              </div>
              <StatusPill label={updateAvailable ? 'Actualización disponible' : 'Al día'} tone={updateAvailable ? 'amber' : 'green'} />
            </div>
            <p>{props.updateResult?.notes ?? 'Todavía no se verificó el canal de actualizaciones.'}</p>
            {updateAvailable ? (
              <button className="primary-button full" onClick={props.onInstallUpdate} disabled={props.isUpdating}>
                <ArrowDownToLine size={17} /> {props.isUpdating ? props.updateProgress || 'Instalando…' : `Instalar ${props.updateResult?.nextVersion}`}
              </button>
            ) : (
              <button className="secondary-button full" onClick={props.onCheckUpdates}>
                <RefreshCw size={16} /> Buscar actualización
              </button>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function HealthMetric({
  icon,
  label,
  value,
  tone
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: 'normal' | 'warning';
}) {
  return (
    <div className={`health-metric ${tone}`}>
      <span className="metric-icon">{icon}</span>
      <div><span>{label}</span><strong>{value}</strong></div>
    </div>
  );
}

function ToolButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button className="tool-button" onClick={onClick}>{icon}<span>{label}</span></button>;
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return <div className="info-line"><span>{label}</span><strong>{value}</strong></div>;
}

function StatusPill({ label, tone }: { label: string; tone: string }) {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <CheckCircle2 size={24} />
      <p>{text}</p>
    </div>
  );
}

function ToastBar({ toast, onClose }: { toast: NonNullable<Toast>; onClose: () => void }) {
  return (
    <div className={`toast-bar ${toast.tone}`} role="status">
      <span>{toast.message}</span>
      <button onClick={onClose} aria-label="Cerrar"><X size={15} /></button>
    </div>
  );
}

export default App;
