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
    const url = requestUrl(input);
    const method = (init?.method || 'GET').toUpperCase();
    if (!url.endsWith('/auth/v1/recover') || method !== 'POST') {
      return originalFetch(input, init);
    }

    const supabaseUrl = backendConfig.supabaseUrl;
    const supabaseAnonKey = backendConfig.supabaseAnonKey;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('La recuperación no está configurada.');
    }

    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    const redirectTo = await safeInvoke<string>('start_password_reset_server', {
      supabaseUrl,
      supabaseAnonKey
    });

    return originalFetch(input, {
      ...init,
      body: JSON.stringify({ ...body, redirect_to: redirectTo })
    });
  }) as typeof window.fetch;
}
