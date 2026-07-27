import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Cpu,
  Headphones,
  Laptop,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  X
} from 'lucide-react';
import { appBackend, backendConfig } from './lib/backend';
import type { AdminDashboard, AppSession, DeviceEntitlementRecord, DeviceRecord, SupportUserRecord, TicketRecord } from './lib/domain';
import { isTauriRuntime, safeInvoke } from './lib/tauri';
import './admin.css';

type View = 'users' | 'devices' | 'requests';
type UserDraft = { fullName: string; email: string; plan: string; limit: string; isStaff: boolean };

const emptyDraft: UserDraft = { fullName: '', email: '', plan: 'basic', limit: '200', isStaff: false };
const planName = (plan?: string | null) => plan === 'max' ? 'Max' : plan === 'pro' ? 'Pro' : 'Básico';

function NexoMark({ size = 25 }: { size?: number }) {
  const gradientId = `admin-nexo-${size}`;
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

export default function AdminApp() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [view, setView] = useState<View>('users');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [query, setQuery] = useState('');
  const [email, setEmail] = useState(backendConfig.backendKind === 'local' ? backendConfig.localAdminEmail : '');
  const [password, setPassword] = useState(backendConfig.backendKind === 'local' ? backendConfig.localAdminPassword : '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draft, setDraft] = useState<UserDraft>(emptyDraft);
  const [generatedCode, setGeneratedCode] = useState('');

  useEffect(() => {
    void appBackend.bootstrap('admin').then(async (restored) => {
      setSession(restored);
      if (restored) await refresh();
    }).catch(() => setSession(null));
  }, []);

  const users = useMemo(() => {
    const term = query.trim().toLowerCase();
    const all = dashboard?.users ?? [];
    return term ? all.filter((user) => `${user.fullName} ${user.email ?? ''}`.toLowerCase().includes(term)) : all;
  }, [dashboard?.users, query]);

  const selectedUser = useMemo(
    () => dashboard?.users.find((user) => user.id === selectedUserId) ?? users[0] ?? null,
    [dashboard?.users, selectedUserId, users]
  );

  const userDevices = useMemo(
    () => selectedUser ? (dashboard?.devices ?? []).filter((device) => device.supportUserId === selectedUser.id) : [],
    [dashboard?.devices, selectedUser]
  );

  const stats = useMemo(() => ({
    activeUsers: dashboard?.users.filter((user) => user.status === 'active').length ?? 0,
    protectedDevices: dashboard?.entitlements.filter((item) => item.status === 'active').length ?? 0,
    openRequests: dashboard?.tickets.filter((ticket) => ticket.status !== 'cerrado').length ?? 0
  }), [dashboard]);

  async function refresh() {
    setBusy('Actualizando');
    try {
      const data = await appBackend.getAdminDashboard();
      setDashboard(data);
      setSelectedUserId((current) => current || data.users[0]?.id || '');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pude cargar NEXO Control.');
    } finally {
      setBusy('');
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy('Ingresando');
    setError('');
    try {
      const result = await appBackend.signInAdmin(email.trim(), password);
      setSession(result.session);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pude iniciar sesión.');
    } finally {
      setBusy('');
    }
  }

  async function logout() {
    await appBackend.signOut('admin');
    setSession(null);
    setDashboard(null);
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    if (!draft.fullName.trim()) return;
    setBusy('Creando usuario');
    setError('');
    try {
      const user = await appBackend.createSupportUser({
        fullName: draft.fullName.trim(),
        email: draft.email.trim(),
        defaultPlan: draft.plan,
        monthlyMessageLimit: draft.limit ? Number(draft.limit) : null,
        isStaff: draft.isStaff
      });
      const pairing = await appBackend.generatePairingCode(user.id);
      await navigator.clipboard?.writeText(pairing.code);
      await refresh();
      setSelectedUserId(user.id);
      setGeneratedCode(pairing.code);
      setDraft(emptyDraft);
      setShowAdvanced(false);
      setShowCreate(false);
      setNotice(`Usuario creado. Código ${pairing.code} copiado.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pude crear el usuario.');
    } finally {
      setBusy('');
    }
  }

  async function updateUser(patch: Partial<SupportUserRecord>) {
    if (!selectedUser) return;
    setBusy('Guardando');
    try {
      await appBackend.updateSupportUser(selectedUser.id, patch);
      await refresh();
      setNotice('Cambios guardados.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pude guardar los cambios.');
    } finally {
      setBusy('');
    }
  }

  async function generateCode() {
    if (!selectedUser) return;
    setBusy('Generando código');
    try {
      const record = await appBackend.generatePairingCode(selectedUser.id);
      setGeneratedCode(record.code);
      await navigator.clipboard?.writeText(record.code);
      setNotice('Código copiado. Vence en 30 minutos.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pude generar el código.');
    } finally {
      setBusy('');
    }
  }

  async function copyCode() {
    if (!generatedCode) return;
    await navigator.clipboard?.writeText(generatedCode);
    setNotice('Código copiado.');
  }

  async function updateEntitlement(device: DeviceRecord, patch: Partial<DeviceEntitlementRecord>) {
    setBusy('Actualizando plan');
    try {
      await appBackend.updateDeviceEntitlement(device.id, patch);
      await refresh();
      setNotice('Plan actualizado.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pude actualizar el plan.');
    } finally {
      setBusy('');
    }
  }

  const showAssistant = () => isTauriRuntime() ? safeInvoke('show_main_window') : Promise.resolve();
  const closeAdmin = () => isTauriRuntime() ? safeInvoke('close_admin_window') : Promise.resolve();

  if (!session) {
    return (
      <main className="admin-login">
        <section className="login-card">
          <div className="login-brand"><NexoMark size={32} /><span><b>NEXO</b><small>Control</small></span></div>
          <div className="login-copy"><h1>Administración</h1><p>Gestioná personas, equipos y solicitudes.</p></div>
          <form onSubmit={login}>
            <label><span>Correo</span><input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></label>
            <label><span>Contraseña</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
            {error && <div className="form-error"><CircleAlert size={15} />{error}</div>}
            <button disabled={Boolean(busy)}>{busy || 'Entrar'}</button>
          </form>
          <button className="login-close" onClick={() => void closeAdmin()}><X size={16} /> Cerrar</button>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><NexoMark size={27} /><span><b>NEXO</b><small>Control</small></span></div>
        <nav>
          <button className={view === 'users' ? 'active' : ''} onClick={() => setView('users')}><UsersRound size={18} /><span>Usuarios</span><b>{dashboard?.users.length ?? 0}</b></button>
          <button className={view === 'devices' ? 'active' : ''} onClick={() => setView('devices')}><Laptop size={18} /><span>Equipos</span><b>{dashboard?.devices.length ?? 0}</b></button>
          <button className={view === 'requests' ? 'active' : ''} onClick={() => setView('requests')}><Headphones size={18} /><span>Solicitudes</span><b>{stats.openRequests}</b></button>
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => void showAssistant()}><ArrowUpRight size={17} /> Abrir mi asistente</button>
          <button onClick={() => void logout()}><LogOut size={17} /> Cerrar sesión</button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-header">
          <div><span>NEXO Support</span><h1>{view === 'users' ? 'Usuarios' : view === 'devices' ? 'Equipos' : 'Solicitudes'}</h1></div>
          <div className="admin-header-actions">
            <button className="icon" aria-label="Actualizar" onClick={() => void refresh()}><RefreshCw className={busy ? 'spin' : ''} size={17} /></button>
            {view === 'users' && <button className="primary" onClick={() => setShowCreate(true)}><Plus size={17} /> Nuevo usuario</button>}
          </div>
        </header>

        <div className="summary-strip">
          <span><b>{stats.activeUsers}</b><small>usuarios activos</small></span>
          <span><b>{stats.protectedDevices}</b><small>equipos protegidos</small></span>
          <span className={stats.openRequests ? 'attention' : ''}><b>{stats.openRequests}</b><small>solicitudes abiertas</small></span>
        </div>

        {(error || notice) && (
          <div className={`admin-toast ${error ? 'error' : ''}`}>
            {error ? <CircleAlert size={15} /> : <Check size={15} />} {error || notice}
            <button onClick={() => { setError(''); setNotice(''); }}><X size={14} /></button>
          </div>
        )}

        {view === 'users' && (
          <div className="users-layout">
            <section className="users-list panel">
              <div className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o correo" /></div>
              <div className="list-scroll">
                {users.map((user) => {
                  const count = (dashboard?.devices ?? []).filter((device) => device.supportUserId === user.id).length;
                  return (
                    <button key={user.id} className={selectedUser?.id === user.id ? 'selected' : ''} onClick={() => { setSelectedUserId(user.id); setGeneratedCode(''); setShowAdvanced(false); }}>
                      <span className="user-avatar">{user.fullName.slice(0, 1).toUpperCase()}</span>
                      <span><b>{user.fullName}</b><small>{user.email || 'Sin correo'} · {count} equipo{count === 1 ? '' : 's'}</small></span>
                      <i className={user.status} />
                      <ChevronRight size={16} />
                    </button>
                  );
                })}
                {users.length === 0 && <div className="list-empty"><Search size={22} /><span>No encontré usuarios.</span></div>}
              </div>
            </section>

            <section className="user-detail panel">
              {selectedUser ? (
                <>
                  <div className="detail-title">
                    <span className="detail-avatar"><UserRound size={22} /></span>
                    <div><h2>{selectedUser.fullName}</h2><p>{selectedUser.email || 'Sin correo cargado'}{selectedUser.isStaff ? ' · Equipo NEXO' : ''}</p></div>
                    <span className={`state ${selectedUser.status}`}>{selectedUser.status === 'active' ? 'Activo' : 'Suspendido'}</span>
                  </div>

                  {generatedCode && (
                    <button className="code-card" onClick={() => void copyCode()}>
                      <span><small>Código de activación</small><b>{generatedCode}</b><p>Vence en 30 minutos.</p></span>
                      <i><Copy size={17} /> Copiar</i>
                    </button>
                  )}

                  <div className="access-section">
                    <div className="section-heading"><div><span>Acceso</span><p>Plan y uso mensual de este usuario.</p></div></div>
                    <div className="detail-grid">
                      <label><span>Plan</span><select value={selectedUser.defaultPlan} onChange={(event) => void updateUser({ defaultPlan: event.target.value })}><option value="basic">Básico</option><option value="pro">Pro</option><option value="max">Max</option></select></label>
                      <label><span>Límite mensual</span><input key={`${selectedUser.id}-limit`} type="number" defaultValue={selectedUser.monthlyMessageLimit ?? ''} placeholder="Sin límite" onBlur={(event) => void updateUser({ monthlyMessageLimit: event.target.value ? Number(event.target.value) : null })} /></label>
                    </div>
                    <button className="advanced-toggle" onClick={() => setShowAdvanced((value) => !value)}><SlidersHorizontal size={15} /> Configuración avanzada <ChevronDown className={showAdvanced ? 'open' : ''} size={15} /></button>
                    {showAdvanced && (
                      <div className="advanced-panel">
                        <label><span>Modelo específico <small>opcional</small></span><input key={`${selectedUser.id}-model`} defaultValue={selectedUser.defaultModel ?? ''} placeholder="Usar el modelo del plan" onBlur={(event) => void updateUser({ defaultModel: event.target.value || null })} /></label>
                        <p>Dejalo vacío para usar el modelo configurado para el plan {planName(selectedUser.defaultPlan)}.</p>
                      </div>
                    )}
                  </div>

                  <div className="user-actions">
                    <button className="primary" onClick={() => void generateCode()}><Copy size={17} /> Generar código</button>
                    <button onClick={() => void updateUser({ status: selectedUser.status === 'active' ? 'suspended' : 'active' })}>{selectedUser.status === 'active' ? 'Suspender acceso' : 'Reactivar acceso'}</button>
                  </div>

                  <div className="section-title"><span>Equipos vinculados</span><b>{userDevices.length}</b></div>
                  <div className="compact-devices">
                    {userDevices.length === 0 && <div className="empty-device"><Laptop size={20} /><span>Todavía no vinculó ningún equipo.</span></div>}
                    {userDevices.map((device) => {
                      const entitlement = dashboard?.entitlements.find((item) => item.deviceId === device.id);
                      return (
                        <article key={device.id}>
                          <span className="device-icon"><Laptop size={17} /></span>
                          <div><b>{device.displayName}</b><small>{device.os}</small></div>
                          <span className="device-plan">{planName(entitlement?.plan)}</span>
                          <i className={device.status} />
                        </article>
                      );
                    })}
                  </div>
                </>
              ) : <div className="empty-detail"><UsersRound size={28} /><p>Seleccioná un usuario.</p></div>}
            </section>
          </div>
        )}

        {view === 'devices' && <DevicesView dashboard={dashboard} onUpdate={updateEntitlement} />}
        {view === 'requests' && <RequestsView dashboard={dashboard} onUpdate={async (ticket, status) => { await appBackend.updateTicketStatus(ticket.id, status); await refresh(); }} />}
      </section>

      {showCreate && (
        <div className="modal-backdrop">
          <form className="create-modal" onSubmit={createUser}>
            <div className="modal-head"><div><span>Nuevo usuario</span><h2>Crear y generar código</h2><p>Al terminar, el código queda copiado.</p></div><button type="button" onClick={() => setShowCreate(false)}><X size={17} /></button></div>
            <label><span>Nombre</span><input autoFocus value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} placeholder="Nombre de la persona o empresa" /></label>
            <label><span>Correo <small>opcional</small></span><input type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} placeholder="correo@ejemplo.com" /></label>
            <label><span>Plan inicial</span><select value={draft.plan} onChange={(event) => setDraft((current) => ({ ...current, plan: event.target.value }))}><option value="basic">Básico · soporte esencial</option><option value="pro">Pro · uso frecuente</option><option value="max">Max · prioridad y mayor uso</option></select></label>
            <details>
              <summary>Opciones adicionales</summary>
              <div className="modal-grid"><label><span>Mensajes por mes</span><input type="number" value={draft.limit} onChange={(event) => setDraft((current) => ({ ...current, limit: event.target.value }))} /></label><label className="check-line"><input type="checkbox" checked={draft.isStaff} onChange={(event) => setDraft((current) => ({ ...current, isStaff: event.target.checked }))} /><span>Es parte del equipo NEXO</span></label></div>
            </details>
            <button className="primary full" disabled={Boolean(busy) || !draft.fullName.trim()}>{busy || 'Crear usuario y copiar código'}</button>
          </form>
        </div>
      )}
    </main>
  );
}

function DevicesView({ dashboard, onUpdate }: { dashboard: AdminDashboard | null; onUpdate: (device: DeviceRecord, patch: Partial<DeviceEntitlementRecord>) => Promise<void> }) {
  const devices = dashboard?.devices ?? [];
  if (devices.length === 0) return <section className="panel empty-page"><Laptop size={30} /><h2>No hay equipos vinculados</h2><p>Creá un usuario y compartile su código de activación.</p></section>;
  return (
    <section className="table-panel panel">
      <div className="table-head"><span>Equipo</span><span>Usuario</span><span>Estado</span><span>Plan</span><span>Uso</span></div>
      {devices.map((device) => {
        const user = dashboard?.users.find((item) => item.id === device.supportUserId);
        const entitlement = dashboard?.entitlements.find((item) => item.deviceId === device.id);
        return (
          <div className="table-row" key={device.id}>
            <span className="device-name"><i><Cpu size={16} /></i><b>{device.displayName}</b><small>{device.computerName}</small></span>
            <span>{user?.fullName || 'Sin asignar'}</span>
            <span><i className={`dot ${device.status}`} />{device.status === 'idle' ? 'Disponible' : device.status === 'en-remoto' ? 'En asistencia' : 'Pendiente'}</span>
            <span><select value={entitlement?.plan ?? 'basic'} onChange={(event) => void onUpdate(device, { plan: event.target.value, status: 'active' })}><option value="basic">Básico</option><option value="pro">Pro</option><option value="max">Max</option></select></span>
            <span>{entitlement?.messagesUsed ?? 0} / {entitlement?.monthlyMessageLimit ?? '∞'}</span>
          </div>
        );
      })}
    </section>
  );
}

function RequestsView({ dashboard, onUpdate }: { dashboard: AdminDashboard | null; onUpdate: (ticket: TicketRecord, status: TicketRecord['status']) => Promise<void> }) {
  const tickets = dashboard?.tickets ?? [];
  if (tickets.length === 0) return <section className="panel empty-page"><ShieldCheck size={30} /><h2>No hay solicitudes</h2><p>Todo está al día.</p></section>;
  return (
    <section className="requests-panel panel">
      {tickets.map((ticket) => {
        const device = dashboard?.devices.find((item) => item.id === ticket.deviceId);
        return (
          <article key={ticket.id}>
            <div className="request-main"><span className={`priority ${ticket.priority}`} /><div><span>{ticket.id}</span><h3>{ticket.issue}</h3><p>{ticket.clientName} · {device?.displayName || 'Equipo sin identificar'}</p></div></div>
            <select value={ticket.status} onChange={(event) => void onUpdate(ticket, event.target.value as TicketRecord['status'])}><option value="nuevo">Nueva</option><option value="esperando">En espera</option><option value="en-remoto">En asistencia</option><option value="cerrado">Resuelta</option></select>
          </article>
        );
      })}
    </section>
  );
}
