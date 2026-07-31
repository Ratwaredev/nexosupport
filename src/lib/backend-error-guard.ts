import { STORAGE_KEYS } from './domain';

let installed = false;

function readableBackendError(raw: string) {
  let message = raw.trim();
  let code = '';

  try {
    const payload = JSON.parse(raw) as { code?: unknown; message?: unknown; error_description?: unknown; error?: unknown };
    code = typeof payload.code === 'string' ? payload.code : '';
    if (typeof payload.message === 'string') message = payload.message;
    else if (typeof payload.error_description === 'string') message = payload.error_description;
    else if (typeof payload.error === 'string') message = payload.error;
  } catch {
    // Supabase sometimes returns plain text. Keep it as-is.
  }

  if (/invalid device token/i.test(message)) {
    localStorage.removeItem(STORAGE_KEYS.clientSession);
    localStorage.removeItem(STORAGE_KEYS.legacySession);
    return 'Esta PC perdió la vinculación. Ingresá un código nuevo.';
  }

  if (code === 'PGRST205' || /could not find the table|schema cache/i.test(message)) {
    return 'NEXO todavía está terminando de restaurar la base.';
  }

  if (/invalid pairing code/i.test(message)) return 'El código venció o no es válido.';
  if (/admin only|sin acceso administrativo/i.test(message)) return 'Esta cuenta no tiene acceso a Administración.';

  return message || 'No se pudo completar.';
}

export function installBackendErrorGuard() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await nativeFetch(input, init);
    if (response.ok) return response;

    const raw = await response.clone().text().catch(() => '');
    const message = readableBackendError(raw);
    if (message === raw) return response;

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('content-type', 'text/plain; charset=utf-8');

    return new Response(message, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  };
}
