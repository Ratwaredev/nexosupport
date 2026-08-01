import { backendConfig } from './backend';
import { isTauriRuntime, safeInvoke } from './tauri';

let installed = false;

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function installPasswordResetRedirect() {
  if (installed || !isTauriRuntime()) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = requestUrl(input);
    const method = (init?.method || 'GET').toUpperCase();
    const request = new URL(rawUrl);
    if (!request.pathname.endsWith('/auth/v1/recover') || method !== 'POST') {
      return originalFetch(input, init);
    }

    const supabaseUrl = backendConfig.supabaseUrl;
    const supabaseAnonKey = backendConfig.supabaseAnonKey;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('La recuperación no está configurada.');
    }

    const redirectTo = await safeInvoke<string>('start_password_reset_server', {
      supabaseUrl,
      supabaseAnonKey
    });

    // GoTrue reads redirect_to from the request URL. Sending it inside the JSON
    // body is ignored and falls back to the project Site URL.
    request.searchParams.set('redirect_to', redirectTo);
    return originalFetch(request.toString(), init);
  }) as typeof window.fetch;
}
