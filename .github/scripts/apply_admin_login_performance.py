from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Missing patch target: {label}")
    return text.replace(old, new, 1)


admin_path = Path('src/AdminApp.tsx')
admin = admin_path.read_text(encoding='utf-8')

admin = replace_once(
    admin,
    "  const [generatedCode, setGeneratedCode] = useState('');\n  const refreshing = useRef(false);",
    "  const [generatedCode, setGeneratedCode] = useState('');\n  const [showPassword, setShowPassword] = useState(false);\n  const [recovering, setRecovering] = useState(false);\n  const [failedAttempts, setFailedAttempts] = useState(0);\n  const refreshing = useRef(false);",
    'admin login state'
)

admin = replace_once(
    admin,
    "  useEffect(() => {\n    const clearAdminSession = () => localStorage.removeItem(STORAGE_KEYS.adminSession);\n    clearAdminSession();\n    setSession(null);\n    setDashboard(null);\n    window.addEventListener('beforeunload', clearAdminSession);\n    return () => window.removeEventListener('beforeunload', clearAdminSession);\n  }, []);",
    "  useEffect(() => {\n    const clearAdminSession = () => {\n      localStorage.removeItem(STORAGE_KEYS.adminSession);\n      sessionStorage.removeItem(STORAGE_KEYS.adminSession);\n    };\n    clearAdminSession();\n    setSession(null);\n    setDashboard(null);\n    window.addEventListener('beforeunload', clearAdminSession);\n    return () => window.removeEventListener('beforeunload', clearAdminSession);\n  }, []);",
    'admin session cleanup'
)

admin = replace_once(
    admin,
    "  const userDevices = useMemo(\n    () => selectedUser ? (dashboard?.devices ?? []).filter((device) => device.supportUserId === selectedUser.id) : [],\n    [dashboard?.devices, selectedUser]\n  );",
    "  const userDevices = useMemo(\n    () => selectedUser ? (dashboard?.devices ?? []).filter((device) => device.supportUserId === selectedUser.id) : [],\n    [dashboard?.devices, selectedUser]\n  );\n\n  const deviceCountByUser = useMemo(() => {\n    const counts = new Map<string, number>();\n    for (const device of dashboard?.devices ?? []) {\n      if (!device.supportUserId) continue;\n      counts.set(device.supportUserId, (counts.get(device.supportUserId) ?? 0) + 1);\n    }\n    return counts;\n  }, [dashboard?.devices]);",
    'device count memo'
)

admin = replace_once(
    admin,
    "  async function login(event: FormEvent) {\n    event.preventDefault();\n    setBusy('Ingresando');\n    setError('');\n    try {\n      const result = await appBackend.signInAdmin(email.trim(), password);\n      setSession(result.session);\n      await refresh();\n    } catch (reason) {\n      setError(adminError(reason));\n    } finally {\n      setBusy('');\n    }\n  }",
    "  async function login(event: FormEvent) {\n    event.preventDefault();\n    const normalizedEmail = email.trim().toLowerCase();\n    if (!/^\\S+@\\S+\\.\\S+$/.test(normalizedEmail)) {\n      setError('Ingresá un correo válido.');\n      return;\n    }\n    if (!password) {\n      setError('Ingresá tu contraseña.');\n      return;\n    }\n    if (failedAttempts >= 5) {\n      setError('Demasiados intentos. Cerrá Administración y volvé a abrirla.');\n      return;\n    }\n    setBusy('Ingresando');\n    setError('');\n    try {\n      const result = await appBackend.signInAdmin(normalizedEmail, password);\n      setSession(result.session);\n      setFailedAttempts(0);\n      await refresh();\n    } catch (reason) {\n      setFailedAttempts((current) => current + 1);\n      setError(adminError(reason));\n    } finally {\n      setBusy('');\n    }\n  }\n\n  async function recoverAccess() {\n    const normalizedEmail = email.trim().toLowerCase();\n    if (!/^\\S+@\\S+\\.\\S+$/.test(normalizedEmail)) {\n      setError('Escribí primero tu correo administrador.');\n      return;\n    }\n    if (!backendConfig.supabaseUrl || !backendConfig.supabaseAnonKey) {\n      setError('La recuperación no está disponible en modo local.');\n      return;\n    }\n    setRecovering(true);\n    setError('');\n    try {\n      const response = await fetch(`${backendConfig.supabaseUrl.replace(/\\/$/, '')}/auth/v1/recover`, {\n        method: 'POST',\n        headers: {\n          apikey: backendConfig.supabaseAnonKey,\n          Authorization: `Bearer ${backendConfig.supabaseAnonKey}`,\n          'Content-Type': 'application/json'\n        },\n        body: JSON.stringify({ email: normalizedEmail })\n      });\n      if (!response.ok) throw new Error(await response.text());\n      setNotice('Te enviamos el enlace para recuperar el acceso.');\n    } catch (reason) {\n      setError(adminError(reason));\n    } finally {\n      setRecovering(false);\n    }\n  }",
    'professional login flow'
)

admin = replace_once(
    admin,
    "  const closeAdmin = async () => {\n    localStorage.removeItem(STORAGE_KEYS.adminSession);",
    "  const closeAdmin = async () => {\n    localStorage.removeItem(STORAGE_KEYS.adminSession);\n    sessionStorage.removeItem(STORAGE_KEYS.adminSession);",
    'close admin session'
)

old_login = """  if (!session) {
    return (
      <main className=\"admin-login\">
        <section className=\"login-card\">
          <div className=\"login-brand\"><NexoMark size={32} /><span><b>NEXO</b><small>Control</small></span></div>
          <div className=\"login-copy\"><h1>Administración</h1><p>Usuarios, equipos y soporte.</p></div>
          <form onSubmit={login}>
            <label><span>Correo</span><input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete=\"username\" /></label>
            <label><span>Contraseña</span><input type=\"password\" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete=\"current-password\" /></label>
            {error && <div className=\"form-error\"><CircleAlert size={15} />{error}</div>}
            <button disabled={Boolean(busy)}>{busy || 'Entrar'}</button>
          </form>
          <button className=\"login-close\" onClick={() => void closeAdmin()}><X size={16} /> Cerrar</button>
        </section>
      </main>
    );
  }

  return (
"""

new_login = """  if (!session) {
    return (
      <main className=\"admin-login\">
        <section className=\"login-shell\">
          <aside className=\"login-visual\">
            <div className=\"login-brand\"><NexoMark size={35} /><span><b>NEXO</b><small>Control</small></span></div>
            <div className=\"login-visual-copy\"><span>ACCESO PRIVADO</span><h1>Administración segura.</h1><p>Usuarios, equipos y soporte remoto.</p></div>
            <div className=\"login-security\"><ShieldCheck size={18} /><span><b>Sesión temporal</b><small>Se cierra al salir de esta ventana.</small></span></div>
          </aside>
          <section className=\"login-card\">
            <button className=\"login-close\" onClick={() => void closeAdmin()} aria-label=\"Cerrar\"><X size={17} /></button>
            <div className=\"login-copy\"><span>NEXO CONTROL</span><h2>Iniciar sesión</h2><p>Usá tu cuenta administradora.</p></div>
            <form onSubmit={login}>
              <label><span>Correo</span><input type=\"email\" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete=\"username\" placeholder=\"admin@empresa.com\" /></label>
              <label><span>Contraseña</span><div className=\"password-input\"><input type={showPassword ? 'text' : 'password'} required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete=\"current-password\" /><button type=\"button\" onClick={() => setShowPassword((current) => !current)}>{showPassword ? 'Ocultar' : 'Mostrar'}</button></div></label>
              <div className=\"login-options\"><span>Cuenta autorizada</span><button type=\"button\" onClick={() => void recoverAccess()} disabled={recovering}>{recovering ? 'Enviando…' : 'Recuperar acceso'}</button></div>
              {error && <div className=\"form-error\"><CircleAlert size={15} />{error}</div>}
              {notice && <div className=\"form-success\"><Check size={15} />{notice}</div>}
              <button disabled={Boolean(busy) || failedAttempts >= 5}>{busy || 'Entrar a Control'}</button>
            </form>
            <p className=\"login-help\">El correo debe existir en NEXO y tener permiso de administrador.</p>
          </section>
        </section>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className=\"admin-loading\">
        <NexoMark size={38} />
        <span className=\"admin-loading-ring\" />
        <p>Cargando Control</p>
      </main>
    );
  }

  return (
"""
admin = replace_once(admin, old_login, new_login, 'professional login surface')

admin = replace_once(
    admin,
    "                {users.map((user) => {\n                  const count = (dashboard?.devices ?? []).filter((device) => device.supportUserId === user.id).length;",
    "                {users.slice(0, 120).map((user) => {\n                  const count = deviceCountByUser.get(user.id) ?? 0;",
    'bounded user rendering'
)
admin = admin.replace("      {devices.map((device) => {", "      {devices.slice(0, 160).map((device) => {", 1)
admin = admin.replace("        {tickets.map((ticket) => {", "        {tickets.slice(0, 80).map((ticket) => {", 1)
admin = admin.replace("        {reports.map(({ record, report }) => {", "        {reports.slice(0, 40).map(({ record, report }) => {", 1)

admin_path.write_text(admin, encoding='utf-8')

backend_path = Path('src/lib/backend.ts')
backend = backend_path.read_text(encoding='utf-8')
backend = replace_once(
    backend,
    "const read=(role:Role)=>{try{return JSON.parse(localStorage.getItem(key(role))||'null') as AppSession|null}catch{return null}};\nconst write=(role:Role,value:AppSession|null)=>value?localStorage.setItem(key(role),JSON.stringify(value)):localStorage.removeItem(key(role));",
    "const store=(role:Role)=>role==='admin'?sessionStorage:localStorage;\nconst read=(role:Role)=>{try{return JSON.parse(store(role).getItem(key(role))||'null') as AppSession|null}catch{return null}};\nconst write=(role:Role,value:AppSession|null)=>value?store(role).setItem(key(role),JSON.stringify(value)):store(role).removeItem(key(role));",
    'admin session storage'
)

remote_start = backend.index('function remote(c:RuntimeConfig)')
remote = backend[remote_start:]
pattern = re.compile(r"async getAdminDashboard\(\)\{const s=admin\(\),\[profile,users,devices,entitlements,tickets,diagnostics,releases,pairingCodes\]=await Promise\.all\(\[(.*?)\]\);if\(!profile\)throw Error\('Perfil administrativo inválido\.'\);return\{profile,users,devices,entitlements,tickets,diagnostics,releases,pairingCodes\}\}", re.S)
replacement = "async getAdminDashboard(){const s=admin(),[profile,users,devices,entitlements,tickets,diagnostics]=await Promise.all([one<AdminProfile>('admin_users',{user_id:`eq.${s.userId}`},s.accessToken),select<SupportUserRecord>('support_users',{select:'id,org_name,full_name,email,status,default_plan,default_model,monthly_message_limit,is_staff,created_at,updated_at',order:'updated_at.desc',limit:'200'},s.accessToken),select<DeviceRecord>('devices',{select:'id,org_name,support_user_id,display_name,computer_name,user_name,os,platform,status,last_seen_at,created_at,updated_at',order:'updated_at.desc',limit:'200'},s.accessToken),select<DeviceEntitlementRecord>('device_entitlements',{select:'device_id,status,plan,model,monthly_message_limit,messages_used,period_start,created_at,updated_at',order:'updated_at.desc',limit:'200'},s.accessToken),select<TicketRecord>('tickets',{select:'id,device_id,client_name,issue,status,priority,created_at,updated_at',order:'updated_at.desc',limit:'80'},s.accessToken),select<DiagnosticRecord>('diagnostics',{select:'id,device_id,generated_at,payload',order:'generated_at.desc',limit:'20'},s.accessToken)]);if(!profile)throw Error('Perfil administrativo inválido.');return{profile,users,devices,entitlements,tickets,diagnostics,releases:[],pairingCodes:[]}}"
remote, count = pattern.subn(replacement, remote, count=1)
if count != 1:
    raise RuntimeError('Missing patch target: lightweight admin dashboard')
backend = backend[:remote_start] + remote
backend_path.write_text(backend, encoding='utf-8')

css_path = Path('src/admin.css')
css = css_path.read_text(encoding='utf-8')
css += r'''

/* Professional admin access */
.admin-login{padding:28px;background:radial-gradient(circle at 18% 18%,rgba(111,76,255,.12),transparent 34%),linear-gradient(145deg,#f7f7fa,#ebeef4)}
.login-shell{width:min(820px,calc(100vw - 56px));min-height:510px;display:grid;grid-template-columns:minmax(0,1.02fr) minmax(360px,.98fr);overflow:hidden;border:1px solid #d9dce5;border-radius:22px;background:#fff;box-shadow:0 30px 80px rgba(22,25,37,.14)}
.login-visual{padding:38px;display:flex;flex-direction:column;color:#fff;background:radial-gradient(circle at 75% 20%,rgba(145,86,255,.5),transparent 34%),linear-gradient(150deg,#14111f,#24164a 58%,#151527)}
.login-visual .login-brand small{color:rgba(255,255,255,.62)}
.login-visual-copy{margin:auto 0;max-width:290px}.login-visual-copy>span,.login-copy>span{font-size:10px;font-weight:800;letter-spacing:.14em}.login-visual-copy>span{color:#aeb8ff}.login-visual-copy h1{margin:12px 0 10px;font-size:38px;line-height:1.02;letter-spacing:-.055em}.login-visual-copy p{margin:0;color:rgba(255,255,255,.65);font-size:13px}
.login-security{display:flex;align-items:center;gap:10px;padding-top:22px;border-top:1px solid rgba(255,255,255,.12)}.login-security>span{display:grid;gap:4px}.login-security b{font-size:11px}.login-security small{color:rgba(255,255,255,.55);font-size:9.5px}
.login-shell>.login-card{width:auto;padding:42px;border:0;border-radius:0;box-shadow:none;display:flex;flex-direction:column;justify-content:center}.login-shell .login-copy{margin:0 0 28px}.login-shell .login-copy>span{color:#6658d7}.login-shell .login-copy h2{margin:8px 0 7px;font-size:29px;letter-spacing:-.045em}.login-shell .login-copy p{margin:0;color:#7a7e88;font-size:12px}
.password-input{height:44px;border:1px solid #d8dae0;border-radius:9px;display:flex;align-items:center;overflow:hidden;background:#fff}.password-input:focus-within{border-color:#7763e8;box-shadow:0 0 0 3px rgba(119,99,232,.09)}.password-input input{height:42px;min-width:0;flex:1;border:0!important;box-shadow:none!important}.password-input button{height:100%;padding:0 12px;border:0;color:#655bc6;background:transparent;font-size:10px;font-weight:750;cursor:pointer}
.login-options{margin-top:-3px;display:flex;align-items:center;justify-content:space-between}.login-options span{color:#9598a2;font-size:9.5px}.login-options button{border:0;padding:0;color:#5b52c8;background:transparent;font-size:10px;font-weight:750;cursor:pointer}.login-options button:disabled{opacity:.5}
.form-success{padding:10px;border-radius:8px;display:flex;align-items:center;gap:8px;color:#24714e;background:#effbf5;font-size:11px}.login-help{margin:18px 0 0;color:#9396a0;font-size:9.5px;line-height:1.45}.login-shell .login-close{right:17px;top:17px;width:30px;height:30px;padding:0;display:grid;place-items:center;border-radius:8px}.login-shell .login-close:hover{background:#f2f3f6}
.admin-loading{width:100%;height:100%;display:grid;place-items:center;align-content:center;gap:13px;background:#f4f5f7}.admin-loading-ring{width:28px;height:28px;border:3px solid #ddd9f7;border-top-color:#6256d7;border-radius:50%;animation:admin-loading-spin .7s linear infinite}.admin-loading p{margin:0;color:#7b7f89;font-size:11px;font-weight:700}@keyframes admin-loading-spin{to{transform:rotate(360deg)}}
@media(max-width:980px){.login-shell{grid-template-columns:1fr;max-width:430px}.login-visual{display:none}.login-shell>.login-card{min-height:500px}}
'''
css_path.write_text(css, encoding='utf-8')

contracts_path = Path('scripts/verify-product-contracts.mjs')
contracts = contracts_path.read_text(encoding='utf-8')
anchor = "requireMatch(admin, /clearAdminSession[\\s\\S]*STORAGE_KEYS\\.adminSession/, 'Control debe exigir una sesión nueva al abrir Administración.');"
if anchor not in contracts:
    raise RuntimeError('Missing patch target: admin contract anchor')
contracts = contracts.replace(anchor, anchor + "\nrequireMatch(admin, /recoverAccess[\\s\\S]*auth\\/v1\\/recover/, 'Control debe permitir recuperar el acceso.');\nrequireMatch(admin, /deviceCountByUser/, 'Control debe evitar cálculos repetidos por usuario.');\nrequireMatch(admin, /admin-loading/, 'Control debe mostrar una carga aislada antes del panel.');", 1)
contracts = contracts.replace("forbidMatch(admin, /setInterval\\(poll/, 'Control no debe consultar la base continuamente.');", "forbidMatch(admin, /setInterval\\(poll/, 'Control no debe consultar la base continuamente.');\nrequireMatch(updater + admin, /sessionStorage/, 'La sesión administrativa debe vivir sólo durante la ventana.');", 1)
contracts_path.write_text(contracts, encoding='utf-8')

print('Professional admin login and lightweight dashboard patch applied.')
