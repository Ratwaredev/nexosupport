import { safeInvoke, isTauriRuntime } from './tauri';

export type RemoteSession = {
  code: string;
  expiresInMinutes: number;
  instructions: string;
};

export type RemoteToolStatus = {
  installed: boolean;
  name: string;
  path?: string | null;
  id?: string | null;
  message: string;
};

export async function createRemoteSession(): Promise<RemoteSession> {
  if (isTauriRuntime()) return safeInvoke<RemoteSession>('create_remote_session');
  return { code: 'NX-DEMO', expiresInMinutes: 20, instructions: 'Vista previa.' };
}

export async function getRemoteToolStatus(): Promise<RemoteToolStatus> {
  if (isTauriRuntime()) return safeInvoke<RemoteToolStatus>('managed_remote_tool_status');
  return { installed: true, name: 'RustDesk', path: 'C:\\Program Files\\RustDesk\\rustdesk.exe', id: '123 456 789', message: 'Listo para soporte.' };
}

export async function installRemoteTool(): Promise<RemoteToolStatus> {
  if (isTauriRuntime()) return safeInvoke<RemoteToolStatus>('managed_install_remote_tool');
  return getRemoteToolStatus();
}

// App.tsx sigue compilándose aunque ya no sea la superficie activa y esperaba texto.
// La implementación activa (SupportAppV6) consume el objeto estructurado.
export async function openRemoteTool(): Promise<any> {
  if (isTauriRuntime()) return safeInvoke<RemoteToolStatus>('managed_open_remote_tool');
  return getRemoteToolStatus();
}
