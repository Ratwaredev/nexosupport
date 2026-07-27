import { invoke } from '@tauri-apps/api/core';

export const isTauriRuntime = () => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

export async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error('NEXO Support está corriendo en modo navegador de desarrollo.');
  }
  return invoke<T>(command, args);
}
