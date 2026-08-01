use std::{
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
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f8;color:#20222a;font-family:Inter,Segoe UI,sans-serif}.card{width:min(420px,calc(100vw - 32px));padding:30px;border:1px solid #dfe1e8;border-radius:18px;background:#fff;box-shadow:0 24px 70px rgba(28,31,43,.14)}.mark{font-size:34px;font-weight:900;color:#6554e8}.muted{color:#707582;font-size:13px;line-height:1.5}label{display:block;margin:18px 0 7px;font-size:12px;font-weight:700}input{width:100%;height:44px;padding:0 13px;border:1px solid #cfd2db;border-radius:10px;font:inherit}button{width:100%;height:44px;margin-top:14px;border:0;border-radius:10px;background:#5e52d8;color:#fff;font-weight:750;cursor:pointer}.error{color:#b42318}.ok{color:#087a45}.hidden{display:none}
  </style>
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
      } catch {
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
        page.len(),
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
