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
  message: string;
};

export async function createRemoteSession(): Promise<RemoteSession> {
  if (isTauriRuntime()) {
    return safeInvoke<RemoteSession>('create_remote_session');
  }

  const code = Math.random().toString(36).slice(2, 8).toUpperCase();

  return {
    code,
    expiresInMinutes: 20,
    instructions: 'Modo navegador: la sesión remota real se prepara dentro de la aplicación de Windows.'
  };
}

export async function getRemoteToolStatus(): Promise<RemoteToolStatus> {
  if (isTauriRuntime()) {
    return safeInvoke<RemoteToolStatus>('remote_tool_status');
  }

  return {
    installed: false,
    name: 'RustDesk',
    path: null,
    message: 'Vista previa: NEXO detecta RustDesk instalado dentro de Windows.'
  };
}

export async function openRemoteTool(): Promise<RemoteToolStatus> {
  if (isTauriRuntime()) {
    return safeInvoke<RemoteToolStatus>('open_remote_tool');
  }

  return {
    installed: false,
    name: 'RustDesk',
    path: null,
    message: 'Vista previa: en Windows se abre RustDesk sin mostrar una consola.'
  };
}
