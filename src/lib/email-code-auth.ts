const SESSION_KEY = 'nexo:user-auth:v1';

type AuthConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export type EmailUserSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email: string;
};

type AuthPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
};

function config(): AuthConfig {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('NEXO no tiene cuentas configuradas.');
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), supabaseAnonKey };
}

async function authRequest<T>(path: string, init: RequestInit, bearer?: string): Promise<T> {
  const current = config();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${current.supabaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        apikey: current.supabaseAnonKey,
        Authorization: `Bearer ${bearer || current.supabaseAnonKey}`,
        'Content-Type': 'application/json',
        ...(init.headers || {})
      }
    });
    if (!response.ok) {
      const raw = await response.text();
      let message = raw;
      try {
        const parsed = JSON.parse(raw);
        message = parsed.msg || parsed.message || parsed.error_description || parsed.error || raw;
      } catch {}
      if (/rate|limit|seconds/i.test(message)) throw new Error('Esperá un momento antes de pedir otro código.');
      if (/token|expired|invalid/i.test(message)) throw new Error('El código no es válido o venció.');
      throw new Error(message || 'No se pudo conectar con NEXO.');
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (error) {
    if (error instanceof Error && /abort|failed to fetch|network|load failed/i.test(error.message)) {
      throw new Error('No hay conexión.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeSession(payload: AuthPayload): EmailUserSession {
  const accessToken = payload.access_token || '';
  const refreshToken = payload.refresh_token || '';
  const userId = payload.user?.id || '';
  const email = payload.user?.email || '';
  if (!accessToken || !refreshToken || !userId || !email) throw new Error('No se pudo iniciar la sesión.');
  return {
    accessToken,
    refreshToken,
    userId,
    email,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000
  };
}

function readSession(): EmailUserSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as EmailUserSession | null;
    return parsed?.accessToken && parsed?.refreshToken && parsed?.email ? parsed : null;
  } catch {
    return null;
  }
}

function saveSession(session: EmailUserSession | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

export async function requestEmailCode(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error('Ingresá un email válido.');
  await authRequest('/auth/v1/otp', {
    method: 'POST',
    body: JSON.stringify({ email: normalized, create_user: true })
  });
}

export async function verifyEmailCode(email: string, token: string): Promise<EmailUserSession> {
  const normalized = email.trim().toLowerCase();
  const code = token.replace(/\s/g, '');
  if (!/^\d{6,8}$/.test(code)) throw new Error('Ingresá el código del email.');
  const payload = await authRequest<AuthPayload>('/auth/v1/verify', {
    method: 'POST',
    body: JSON.stringify({ type: 'email', email: normalized, token: code })
  });
  const session = normalizeSession(payload);
  saveSession(session);
  return session;
}

async function refreshSession(session: EmailUserSession): Promise<EmailUserSession | null> {
  try {
    const payload = await authRequest<AuthPayload>('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refreshToken })
    });
    const next = normalizeSession(payload);
    saveSession(next);
    return next;
  } catch {
    saveSession(null);
    return null;
  }
}

export async function restoreEmailSession(): Promise<EmailUserSession | null> {
  const session = readSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + 120_000) return session;
  return refreshSession(session);
}

export async function signOutEmailSession(session?: EmailUserSession | null): Promise<void> {
  const current = session || readSession();
  saveSession(null);
  if (!current?.accessToken) return;
  try {
    await authRequest('/auth/v1/logout', { method: 'POST' }, current.accessToken);
  } catch {}
}
