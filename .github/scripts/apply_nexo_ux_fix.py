from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


replace(
    "src/AppUpdater.tsx",
    '''  if (state.status === 'installing') {
    return (
      <aside className="app-update-installing" role="status" aria-label="Instalando actualización">
        <UpdateMark size={30} />
        <div className="app-update-track"><i /></div>
      </aside>
    );
  }
''',
    '''  if (state.status === 'installing') {
    return (
      <aside className="app-update-installing" role="status" aria-label="Instalando actualización">
        <span className="app-update-orb" aria-hidden="true"><i /></span>
      </aside>
    );
  }
''',
)

Path("src/updater.css").write_text('''.app-update-toast,.app-update-panel,.app-update-installing{position:fixed;z-index:400;right:14px;bottom:14px;color:#20222a;background:#fff;border:1px solid rgba(31,34,44,.14);box-shadow:0 14px 34px rgba(18,21,31,.18)}
.app-update-toast{height:38px;padding:0 12px;border-radius:11px;display:flex;align-items:center;gap:8px;color:#5952bd}.app-update-toast b{font-size:9.5px}.app-update-panel{width:278px;min-height:92px;padding:14px;border-radius:15px;display:grid;grid-template-columns:38px minmax(0,1fr);align-items:center;gap:10px}.app-update-panel>span{width:38px;height:38px;display:grid;place-items:center}.app-update-panel.error>span{border-radius:10px;color:#b34856;background:#fff0f2}.app-update-panel>div{display:grid;gap:3px}.app-update-panel small{color:#7d818b;font-size:8px;font-weight:800;letter-spacing:.08em}.app-update-panel b{font-size:12px}.app-update-close{position:absolute;right:7px;top:7px;width:25px;height:25px;border:0;border-radius:7px;display:grid;place-items:center;color:#8a8e97;background:transparent;cursor:pointer}.app-update-close:hover{background:#f0f1f3}.app-update-panel footer{grid-column:1/-1;display:grid;grid-template-columns:1fr 1.2fr;gap:7px}.app-update-panel footer button{height:34px;border:1px solid #dadde3;border-radius:9px;color:#60646e;background:#fff;font-size:9.5px;font-weight:750;cursor:pointer}.app-update-panel footer button:last-child{border-color:#5a51c7;color:#fff;background:#5a51c7}
.app-update-installing{width:72px;height:72px;padding:0;border-radius:22px;display:grid;place-items:center;background:rgba(15,10,29,.96);border:1px solid rgba(150,86,255,.48);box-shadow:0 0 0 1px rgba(116,54,255,.08),0 16px 42px rgba(35,15,75,.36),0 0 34px rgba(123,52,255,.22);backdrop-filter:blur(18px)}
.app-update-orb{position:relative;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;filter:drop-shadow(0 0 9px rgba(152,78,255,.92))}.app-update-orb:before{content:"";position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 12%,#6431ff 28%,#b75cff 52%,#6f9cff 72%,transparent 92%);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 0);mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 0);animation:update-orbit .82s linear infinite}.app-update-orb:after{content:"";position:absolute;inset:8px;border-radius:50%;background:radial-gradient(circle at 40% 35%,rgba(209,166,255,.34),rgba(104,49,255,.10) 48%,transparent 72%);box-shadow:inset 0 0 12px rgba(175,105,255,.22)}.app-update-orb i{width:4px;height:4px;border-radius:50%;background:#efe4ff;box-shadow:0 0 9px 3px rgba(190,116,255,.86);animation:update-pulse .9s ease-in-out infinite}
.spin{animation:update-spin .8s linear infinite}@keyframes update-spin{to{transform:rotate(360deg)}}@keyframes update-orbit{to{transform:rotate(360deg)}}@keyframes update-pulse{0%,100%{transform:scale(.72);opacity:.62}50%{transform:scale(1.25);opacity:1}}@media(max-height:590px){.app-update-toast,.app-update-panel,.app-update-installing{bottom:10px;right:10px}}@media(prefers-reduced-motion:reduce){.spin,.app-update-orb:before,.app-update-orb i{animation:none}}
''', encoding="utf-8")

replace(
    "src/AdminApp.tsx",
    "import type { AdminDashboard, AppSession, DeviceEntitlementRecord, DeviceRecord, SupportUserRecord, TicketRecord } from './lib/domain';",
    "import type { AdminDashboard, AppSession, DeviceEntitlementRecord, DeviceRecord, SupportUserRecord, TicketRecord } from './lib/domain';\nimport { STORAGE_KEYS } from './lib/domain';",
)
replace(
    "src/AdminApp.tsx",
    '''  useEffect(() => {
    void appBackend.bootstrap('admin').then(async (restored) => {
      setSession(restored);
      if (restored) await refresh();
    }).catch(() => setSession(null));
  }, []);

  useEffect(() => {
    if (!session) return;
    const poll = () => { if (document.visibilityState === 'visible') void refresh(true); };
    const timer = window.setInterval(poll, 15000);
    document.addEventListener('visibilitychange', poll);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [session]);
''',
    '''  useEffect(() => {
    const clearAdminSession = () => localStorage.removeItem(STORAGE_KEYS.adminSession);
    clearAdminSession();
    setSession(null);
    setDashboard(null);
    window.addEventListener('beforeunload', clearAdminSession);
    return () => window.removeEventListener('beforeunload', clearAdminSession);
  }, []);
''',
)
replace(
    "src/AdminApp.tsx",
    '''  async function connectRemote(remoteId: string) {
    try {
      if (isTauriRuntime()) await safeInvoke('managed_connect_remote_tool', { remoteId });
      else await navigator.clipboard?.writeText(remoteId);
      setNotice(isTauriRuntime() ? 'RustDesk abierto.' : 'ID copiado.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo abrir RustDesk.');
    }
  }
''',
    '''  async function connectRemote(remoteId: string) {
    if (isTauriRuntime() && !window.confirm(`¿Abrir RustDesk y conectarse al equipo ${remoteId}?`)) return;
    try {
      if (isTauriRuntime()) await safeInvoke('managed_connect_remote_tool', { remoteId });
      else await navigator.clipboard?.writeText(remoteId);
      setNotice(isTauriRuntime() ? 'RustDesk abierto.' : 'ID copiado.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo abrir RustDesk.');
    }
  }
''',
)
replace(
    "src/AdminApp.tsx",
    "  const closeAdmin = () => isTauriRuntime() ? safeInvoke('close_admin_window') : Promise.resolve();",
    "  const closeAdmin = async () => {\n    localStorage.removeItem(STORAGE_KEYS.adminSession);\n    setSession(null);\n    setDashboard(null);\n    if (isTauriRuntime()) await safeInvoke('close_admin_window');\n  };",
)

replace(
    "src/SupportAppV6.tsx",
    '''    setSupportCode(remoteSession.code);
    await openRemoteTool();
    return result('remote_support', true, 'Solicitud enviada.', [{
''',
    '''    setSupportCode(remoteSession.code);
    return result('remote_support', true, 'Solicitud enviada. RustDesk no se abrirá hasta que lo autorices.', [{
''',
)
replace(
    "src/SupportAppV6.tsx",
    '''              <button className="secondary" onClick={() => void analyzeSelected()} disabled={Boolean(busy)}>Revisar</button>
              <button onClick={() => void (remote?.installed ? startRemote().then(() => setNotice({ tone: 'success', text: 'Solicitud enviada.' })) : installRemote())} disabled={Boolean(busy)}>{remote?.installed ? 'Pedir soporte' : 'Instalar RustDesk'}</button>
''',
    '''              <button className="secondary" onClick={() => void analyzeSelected()} disabled={Boolean(busy)}>Revisar</button>
              {supportCode ? (
                <button onClick={() => void openRemoteTool().then(() => setNotice({ tone: 'success', text: 'RustDesk abierto.' })).catch((error) => setNotice({ tone: 'error', text: errorText(error) }))} disabled={Boolean(busy)}>Abrir RustDesk</button>
              ) : (
                <button onClick={() => void (remote?.installed ? startRemote().then(() => setNotice({ tone: 'success', text: 'Solicitud enviada. RustDesk sigue cerrado.' })) : installRemote())} disabled={Boolean(busy)}>{remote?.installed ? 'Pedir soporte' : 'Instalar RustDesk'}</button>
              )}
''',
)

backend = Path("src/lib/backend.ts")
text = backend.read_text(encoding="utf-8")
old_password = "localAdminPassword:import.meta.env.VITE_LOCAL_ADMIN_PASSWORD?.trim()||'admin123'"
old_login = "async signInAdmin(email,password){if(email!==c.localAdminEmail||password!==c.localAdminPassword)throw Error('Correo o contraseña incorrectos.');"
old_limits = "select<TicketRecord>('tickets',{order:'updated_at.desc'},s.accessToken),select<DiagnosticRecord>('diagnostics',{order:'generated_at.desc'},s.accessToken),select<ReleaseRecord>('releases',{order:'published_at.desc'},s.accessToken),select<PairingCodeRecord>('pairing_codes',{order:'created_at.desc'},s.accessToken)"
for expected in (old_password, old_login, old_limits):
    if expected not in text:
        raise SystemExit(f"Expected backend block missing: {expected[:100]!r}")
text = text.replace(old_password, "localAdminPassword:import.meta.env.VITE_LOCAL_ADMIN_PASSWORD?.trim()||''", 1)
text = text.replace(old_login, "async signInAdmin(email,password){if(!c.localAdminPassword)throw Error('Administración local no configurada.');if(email!==c.localAdminEmail||password!==c.localAdminPassword)throw Error('Correo o contraseña incorrectos.');", 1)
text = text.replace(old_limits, "select<TicketRecord>('tickets',{order:'updated_at.desc',limit:'200'},s.accessToken),select<DiagnosticRecord>('diagnostics',{order:'generated_at.desc',limit:'100'},s.accessToken),select<ReleaseRecord>('releases',{order:'published_at.desc',limit:'20'},s.accessToken),select<PairingCodeRecord>('pairing_codes',{order:'created_at.desc',limit:'100'},s.accessToken)", 1)
backend.write_text(text, encoding="utf-8")
