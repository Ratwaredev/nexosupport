from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

updater = r'''import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Download, RefreshCw, X } from 'lucide-react';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type AvailableUpdate = { version: string; notes?: string | null };
type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current' }
  | { status: 'available'; update: AvailableUpdate }
  | { status: 'error'; update?: AvailableUpdate; message: string };

// Kept as the manual-check throttle. There are no automatic update checks.
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const MANUAL_THROTTLE_MS = Math.min(CHECK_EVERY_MS, 1200);
// app-update-installing was deliberately removed: NEXO never installs or restarts itself.

function UpdateMark({ size = 32 }: { size?: number }) {
  const id = `update-x-${size}`;
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

function readableError(error: unknown) {
  const raw = error instanceof Error ? error.message : '';
  if (/network|fetch|internet|connection|dns/i.test(raw)) return 'Sin conexión';
  if (/signature|firma/i.test(raw)) return 'Firma inválida';
  return 'No se pudo abrir la descarga';
}

export default function AppUpdater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const checking = useRef(false);
  const lastManualCheck = useRef(0);
  const noticeTimer = useRef<number | null>(null);

  const hideSoon = useCallback(() => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setState({ status: 'idle' }), 1800);
  }, []);

  const check = useCallback(async () => {
    if (!isTauriRuntime() || checking.current) return;
    const now = Date.now();
    if (now - lastManualCheck.current < MANUAL_THROTTLE_MS) return;
    lastManualCheck.current = now;
    checking.current = true;
    setState({ status: 'checking' });
    try {
      const update = await safeInvoke<AvailableUpdate | null>('check_app_update');
      if (update) setState({ status: 'available', update });
      else {
        setState({ status: 'current' });
        hideSoon();
      }
    } catch (error) {
      setState({ status: 'error', message: readableError(error) });
    } finally {
      checking.current = false;
    }
  }, [hideSoon]);

  const download = useCallback(async (update: AvailableUpdate) => {
    try {
      // This command only opens the signed installer in the browser. It never
      // downloads in the background, installs, closes NEXO or restarts Windows.
      await safeInvoke('install_app_update', { expectedVersion: update.version });
      setState({ status: 'idle' });
    } catch (error) {
      setState({ status: 'error', update, message: readableError(error) });
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const manual = () => void check();
    window.addEventListener('nexo:check-update', manual);
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      window.removeEventListener('nexo:check-update', manual);
    };
  }, [check]);

  if (state.status === 'idle') return null;

  if (state.status === 'checking' || state.status === 'current') {
    return (
      <aside className={`app-update-toast ${state.status}`} role="status">
        {state.status === 'current' ? <Check size={15} /> : <RefreshCw className="spin" size={15} />}
        <b>{state.status === 'current' ? 'Al día' : 'Buscando'}</b>
      </aside>
    );
  }

  const update = state.update;
  const failed = state.status === 'error';
  return (
    <aside className={`app-update-panel ${failed ? 'error' : ''}`} role="dialog" aria-modal="false">
      <button className="app-update-close" aria-label="Cerrar" onClick={() => setState({ status: 'idle' })}><X size={14} /></button>
      <span>{failed ? <CircleAlert size={19} /> : <UpdateMark size={30} />}</span>
      <div><small>{failed ? state.message : `v${update?.version || ''}`}</small><b>{failed ? 'No se pudo abrir' : 'Nueva versión'}</b></div>
      <footer>
        <button onClick={() => setState({ status: 'idle' })}>Ahora no</button>
        <button onClick={() => update ? void download(update) : void check()}>{failed ? 'Reintentar' : <><Download size={14} /> Descargar</>}</button>
      </footer>
    </aside>
  );
}
'''
(ROOT / 'src/AppUpdater.tsx').write_text(updater, encoding='utf-8')

password_reset = r'''use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::OnceLock,
    thread,
};

static RESET_REDIRECT_URL: OnceLock<String> = OnceLock::new();

fn valid_supabase_url(value: &str) -> bool {
    value.starts_with("https://") && value.contains(".supabase.co")
}

fn reset_page(supabase_url: &str, supabase_anon_key: &str) -> Result<String, String> {
    let url = serde_json::to_string(supabase_url).map_err(|error| error.to_string())?;
    let key = serde_json::to_string(supabase_anon_key).map_err(|error| error.to_string())?;
    Ok(r#"<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Cambiar contraseña · NEXO</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f8;color:#20222a;font-family:Inter,Segoe UI,sans-serif}.card{width:min(420px,calc(100vw - 32px));padding:30px;border:1px solid #dfe1e8;border-radius:18px;background:#fff;box-shadow:0 24px 70px rgba(28,31,43,.14)}.mark{font-size:34px;font-weight:900;color:#6554e8}.muted{color:#707582;font-size:13px;line-height:1.5}label{display:block;margin:18px 0 7px;font-size:12px;font-weight:700}input{width:100%;height:44px;padding:0 13px;border:1px solid #cfd2db;border-radius:10px;font:inherit}button{width:100%;height:44px;margin-top:14px;border:0;border-radius:10px;background:#5e52d8;color:white;font-weight:750;cursor:pointer}.error{color:#b42318}.ok{color:#087a45}.hidden{display:none}</style>
</head>
<body>
  <main class="card">
    <div class="mark">X</div>
    <h1>Nueva contraseña</h1>
    <p id="status" class="muted">Validando el enlace de recuperación…</p>
    <form id="form" class="hidden">
      <label for="password">Contraseña nueva</label>
      <input id="password" type="password" minlength="8" autocomplete="new-password" required>
      <label for="repeat">Repetir contraseña</label>
      <input id="repeat" type="password" minlength="8" autocomplete="new-password" required>
      <button type="submit">Guardar contraseña</button>
    </form>
  </main>
  <script>
    const SUPABASE_URL = __SUPABASE_URL__;
    const SUPABASE_KEY = __SUPABASE_KEY__;
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    const status = document.getElementById('status');
    const form = document.getElementById('form');
    const errorDescription = params.get('error_description');

    if (errorDescription) {
      status.textContent = decodeURIComponent(errorDescription.replace(/\+/g, ' '));
      status.className = 'muted error';
    } else if (!accessToken) {
      status.textContent = 'El enlace no contiene una sesión válida. Pedí un correo nuevo desde NEXO.';
      status.className = 'muted error';
    } else {
      status.textContent = 'Elegí una contraseña de al menos 8 caracteres.';
      form.classList.remove('hidden');
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = document.getElementById('password').value;
      const repeat = document.getElementById('repeat').value;
      if (password.length < 8) {
        status.textContent = 'La contraseña debe tener al menos 8 caracteres.';
        status.className = 'muted error';
        return;
      }
      if (password !== repeat) {
        status.textContent = 'Las contraseñas no coinciden.';
        status.className = 'muted error';
        return;
      }
      status.textContent = 'Guardando…';
      status.className = 'muted';
      try {
        const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
          method: 'PUT',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ password })
        });
        if (!response.ok) throw new Error(await response.text());
        form.classList.add('hidden');
        history.replaceState({}, document.title, location.pathname);
        status.textContent = 'Contraseña actualizada. Volvé a NEXO e iniciá sesión.';
        status.className = 'muted ok';
      } catch (error) {
        status.textContent = 'No se pudo cambiar la contraseña. Pedí un enlace nuevo desde NEXO.';
        status.className = 'muted error';
      }
    });
  </script>
</body>
</html>"#
        .replace("__SUPABASE_URL__", &url)
        .replace("__SUPABASE_KEY__", &key))
}

fn serve(mut stream: TcpStream, page: &str) {
    let mut request = [0_u8; 2048];
    let _ = stream.read(&mut request);
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{}",
        page.as_bytes().len(),
        page
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

#[tauri::command]
pub fn start_password_reset_server(
    supabase_url: String,
    supabase_anon_key: String,
) -> Result<String, String> {
    if let Some(url) = RESET_REDIRECT_URL.get() {
        return Ok(url.clone());
    }
    if !valid_supabase_url(supabase_url.trim()) {
        return Err("La URL de Supabase no es válida.".to_string());
    }
    if supabase_anon_key.trim().is_empty() {
        return Err("Falta la clave pública de Supabase.".to_string());
    }

    let page = reset_page(supabase_url.trim(), supabase_anon_key.trim())?;
    let mut listeners = Vec::new();
    for port in [5173_u16, 3000_u16, 8080_u16] {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            listeners.push(listener);
        }
    }
    if listeners.is_empty() {
        return Err("No se pudo abrir el receptor local de recuperación.".to_string());
    }

    let port = listeners
        .iter()
        .find_map(|listener| listener.local_addr().ok().map(|address| address.port()))
        .ok_or("No se pudo determinar el puerto de recuperación.")?;
    let redirect = format!("http://127.0.0.1:{port}/reset-password");

    for listener in listeners {
        let page = page.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                serve(stream, &page);
            }
        });
    }

    let _ = RESET_REDIRECT_URL.set(redirect.clone());
    Ok(redirect)
}
'''
(ROOT / 'src-tauri/src/app/password_reset.rs').write_text(password_reset, encoding='utf-8')

app_path = ROOT / 'src-tauri/src/app.rs'
app = app_path.read_text(encoding='utf-8')
if 'mod password_reset;' not in app:
    app = app.replace('mod optimizer;\n', 'mod optimizer;\nmod password_reset;\n')
if 'password_reset::start_password_reset_server' not in app:
    app = app.replace('            optimizer::optimize_temp_files,\n', '            optimizer::optimize_temp_files,\n            password_reset::start_password_reset_server,\n')
app_path.write_text(app, encoding='utf-8')

updates_path = ROOT / 'src-tauri/src/app/updates.rs'
updates = updates_path.read_text(encoding='utf-8')
new_tail = r'''
fn clean_release_version(value: &str) -> Option<String> {
    let version = value.trim().trim_start_matches('v');
    if version.is_empty()
        || version.len() > 32
        || !version.chars().all(|character| character.is_ascii_digit() || character == '.')
    {
        return None;
    }
    Some(version.to_string())
}

#[tauri::command]
pub fn open_update_download(version: String) -> Result<(), String> {
    let version = clean_release_version(&version).ok_or("Versión inválida.")?;
    let url = format!(
        "https://github.com/Ratwaredev/underdocksoporteapp/releases/download/v{0}/NEXO.Support_{0}_x64-setup.exe",
        version
    );
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|error| error.to_string())
}

/// Compatibility command used by the existing frontend. It deliberately only
/// opens the signed installer download. It never installs, exits or restarts NEXO.
#[tauri::command]
pub fn install_app_update(_app: AppHandle, expected_version: String) -> Result<(), String> {
    open_update_download(expected_version)
}
'''
updates, count = re.subn(
    r'\n#\[cfg\(target_os = "windows"\)\]\nfn finish_windows_update[\s\S]*\Z',
    '\n' + new_tail,
    updates,
)
if count != 1:
    raise SystemExit('Could not replace self-installing updater tail')
updates_path.write_text(updates, encoding='utf-8')

admin_path = ROOT / 'src/AdminApp.tsx'
admin = admin_path.read_text(encoding='utf-8')
replacement = r'''  async function recoverAccess() {
    const normalizedEmail = email.trim().toLowerCase();
    const supabaseUrl = backendConfig.supabaseUrl;
    const supabaseAnonKey = backendConfig.supabaseAnonKey;
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError('Escribí primero tu correo administrador.');
      return;
    }
    if (!supabaseUrl || !supabaseAnonKey) {
      setError('La recuperación no está disponible en modo local.');
      return;
    }
    setRecovering(true);
    setError('');
    try {
      const redirectTo = isTauriRuntime()
        ? await safeInvoke<string>('start_password_reset_server', {
            supabaseUrl,
            supabaseAnonKey
          })
        : `${window.location.origin.replace(/\/$/, '')}/reset-password`;
      const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/recover`, {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: normalizedEmail, redirect_to: redirectTo })
      });
      if (!response.ok) throw new Error(await response.text());
      setNotice('Correo enviado. Dejá NEXO abierto, abrí el enlace y elegí tu contraseña.');
    } catch (reason) {
      setError(adminError(reason));
    } finally {
      setRecovering(false);
    }
  }

  async function logout()'''
admin, count = re.subn(
    r'  async function recoverAccess\(\) \{[\s\S]*?\n  \}\n\n  async function logout\(\)',
    replacement,
    admin,
    count=1,
)
if count != 1:
    raise SystemExit('Could not replace password recovery flow')
admin_path.write_text(admin, encoding='utf-8')

# Keep the product contract aligned with the deliberately manual updater.
contracts_path = ROOT / 'scripts/verify-product-contracts.mjs'
contracts = contracts_path.read_text(encoding='utf-8')
contracts = contracts.replace(
    "requireMatch(updater, /app-update-installing/, 'La actualización debe tener un indicador propio.');",
    "requireMatch(updater, /There are no automatic update checks/, 'El updater debe ser manual.');"
)
contracts = contracts.replace(
    "requireMatch(updaterCss, /\\.app-update-installing/, 'Falta el indicador compacto de actualización.');\nrequireMatch(updaterCss, /\\.app-update-orb/, 'La instalación debe mostrar el círculo eléctrico violeta.');",
    "forbidMatch(updater, /download_and_install|AUTO_CHECK_EVERY_MS|window\\.setTimeout\\(\\(\\) => void check/, 'NEXO no puede instalar ni buscar actualizaciones automáticamente.');"
)
contracts = contracts.replace(
    "requireMatch(app, /remote::managed_connect_remote_tool/, 'El comando remoto seguro debe estar registrado.');",
    "requireMatch(app, /remote::managed_connect_remote_tool/, 'El comando remoto seguro debe estar registrado.');\nrequireMatch(app, /password_reset::start_password_reset_server/, 'El reset debe abrir un receptor local real.');\nrequireMatch(admin, /redirect_to: redirectTo/, 'La recuperación debe enviar una URL de retorno explícita.');"
)
contracts_path.write_text(contracts, encoding='utf-8')

print('Applied manual updater and local password reset flow.')
