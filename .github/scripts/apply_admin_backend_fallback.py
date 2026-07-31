from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'Missing patch target: {label}')
    return text.replace(old, new, 1)

backend_path = Path('src/lib/backend.ts')
backend = backend_path.read_text(encoding='utf-8')
backend = replace_once(
    backend,
    "select=<T>(t:string,p:Record<string,string>={},token?:string)=>req<T[]>(path(t,p),undefined,token),one=async<T>(t:string,p:Record<string,string>,token?:string)=>(await select<T>(t,{...p,limit:'1'},token))[0]||null",
    "select=<T>(t:string,p:Record<string,string>={},token?:string)=>req<T[]>(path(t,p),undefined,token),optionalSelect=async<T>(t:string,p:Record<string,string>={},token?:string)=>{try{return await select<T>(t,p,token)}catch(error){if(error instanceof Error&&/PGRST205|schema cache|Could not find the table/i.test(error.message))return[];throw error}},one=async<T>(t:string,p:Record<string,string>,token?:string)=>(await select<T>(t,{...p,limit:'1'},token))[0]||null",
    'optional Supabase table select'
)

pattern = re.compile(r"async getAdminDashboard\(\)\{const s=admin\(\),\[profile,users,devices,entitlements,tickets,diagnostics\]=await Promise\.all\(\[(.*?)\]\);if\(!profile\)throw Error\('Perfil administrativo inválido\.'\);return\{profile,users,devices,entitlements,tickets,diagnostics,releases:\[\],pairingCodes:\[\]\}\}", re.S)
replacement = "async getAdminDashboard(){const s=admin(),profile=await one<AdminProfile>('admin_users',{user_id:`eq.${s.userId}`},s.accessToken);if(!profile)throw Error('Sin acceso administrativo.');const[users,devices,entitlements,tickets,diagnostics]=await Promise.all([optionalSelect<SupportUserRecord>('support_users',{select:'id,org_name,full_name,email,status,default_plan,default_model,monthly_message_limit,is_staff,created_at,updated_at',order:'updated_at.desc',limit:'200'},s.accessToken),optionalSelect<DeviceRecord>('devices',{select:'id,org_name,support_user_id,display_name,computer_name,user_name,os,platform,status,last_seen_at,created_at,updated_at',order:'updated_at.desc',limit:'200'},s.accessToken),optionalSelect<DeviceEntitlementRecord>('device_entitlements',{select:'device_id,status,plan,model,monthly_message_limit,messages_used,period_start,created_at,updated_at',order:'updated_at.desc',limit:'200'},s.accessToken),optionalSelect<TicketRecord>('tickets',{select:'id,device_id,client_name,issue,status,priority,created_at,updated_at',order:'updated_at.desc',limit:'80'},s.accessToken),optionalSelect<DiagnosticRecord>('diagnostics',{select:'id,device_id,generated_at,payload',order:'generated_at.desc',limit:'20'},s.accessToken)]);return{profile,users,devices,entitlements,tickets,diagnostics,releases:[],pairingCodes:[]}}"
backend, count = pattern.subn(replacement, backend, count=1)
if count != 1:
    raise RuntimeError('Missing patch target: resilient admin dashboard')
backend_path.write_text(backend, encoding='utf-8')

admin_path = Path('src/AdminApp.tsx')
admin = admin_path.read_text(encoding='utf-8')
admin = replace_once(
    admin,
    "  if (/failed to fetch|network|load failed|connection|timeout|abort/i.test(raw)) return 'No hay conexión con NEXO Control.';\n  return raw || 'No se pudo completar.';",
    "  if (/failed to fetch|network|load failed|connection|timeout|abort/i.test(raw)) return 'No hay conexión con NEXO Control.';\n  if (/invalid_credentials|invalid login credentials/i.test(raw)) return 'Correo o contraseña incorrectos.';\n  if (/PGRST205|schema cache|Could not find the table/i.test(raw)) return 'La base de NEXO está incompleta. El acceso fue validado, pero faltan módulos.';\n  if (/Sin acceso administrativo/i.test(raw)) return 'Esta cuenta no tiene permiso de administrador.';\n  return raw || 'No se pudo completar.';",
    'professional admin error messages'
)
admin_path.write_text(admin, encoding='utf-8')

contracts_path = Path('scripts/verify-product-contracts.mjs')
contracts = contracts_path.read_text(encoding='utf-8')
anchor = "requireMatch(admin, /deviceCountByUser/, 'Control debe evitar cálculos repetidos por usuario.');"
if anchor not in contracts:
    raise RuntimeError('Missing patch target: admin performance contract')
contracts = contracts.replace(anchor, anchor + "\nrequireMatch(admin, /invalid_credentials/, 'Control debe mostrar errores de acceso legibles.');", 1)
backend_anchor = "requireMatch(admin, /admin-loading/, 'Control debe mostrar una carga aislada antes del panel.');"
contracts = contracts.replace(backend_anchor, backend_anchor + "\nrequireMatch(await readFile('src/lib/backend.ts', 'utf8'), /optionalSelect/, 'Control debe tolerar módulos faltantes sin romper la ventana.');", 1)
contracts_path.write_text(contracts, encoding='utf-8')

print('Admin backend fallback patch applied.')
