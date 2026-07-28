import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, RefreshCw } from 'lucide-react';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type AvailableUpdate = {
  version: string;
  notes?: string | null;
};

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking'; manual: boolean }
  | { status: 'current' }
  | { status: 'installing'; update: AvailableUpdate }
  | { status: 'error'; update?: AvailableUpdate; message: string };

const CHECK_EVERY_MS = 15 * 60 * 1000;
const CURRENT_NOTICE_MS = 2600;

export default function AppUpdater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const started = useRef(false);
  const installing = useRef(false);
  const checking = useRef(false);
  const clearTimer = useRef<number | null>(null);

  const clearNoticeLater = useCallback(() => {
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => setState({ status: 'idle' }), CURRENT_NOTICE_MS);
  }, []);

  const install = useCallback(async (update: AvailableUpdate) => {
    if (installing.current) return;
    installing.current = true;
    setState({ status: 'installing', update });
    try {
      await safeInvoke('install_app_update');
    } catch (error) {
      installing.current = false;
      setState({
        status: 'error',
        update,
        message: error instanceof Error ? error.message : 'No se pudo instalar la actualización.'
      });
    }
  }, []);

  const check = useCallback(async (manual = false) => {
    if (!isTauriRuntime() || installing.current || checking.current) return;
    checking.current = true;
    if (manual) setState({ status: 'checking', manual: true });
    try {
      const update = await safeInvoke<AvailableUpdate | null>('check_app_update');
      if (update) {
        await install(update);
        return;
      }
      if (manual) {
        setState({ status: 'current' });
        clearNoticeLater();
      }
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'No se pudo buscar una actualización.'
      });
    } finally {
      checking.current = false;
    }
  }, [clearNoticeLater, install]);

  useEffect(() => {
    if (!isTauriRuntime() || started.current) return;
    started.current = true;

    const first = window.setTimeout(() => void check(false), 1200);
    const interval = window.setInterval(() => void check(false), CHECK_EVERY_MS);
    const onFocus = () => void check(false);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check(false);
    };
    const onManual = () => void check(true);

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('nexo:check-update', onManual);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('nexo:check-update', onManual);
    };
  }, [check]);

  if (state.status === 'idle') return null;
  const isInstalling = state.status === 'installing';
  const isChecking = state.status === 'checking';
  const isCurrent = state.status === 'current';

  return (
    <aside className={`app-update ${state.status}`} role="status" aria-live="polite">
      <span className="app-update-icon">
        {isCurrent ? <Check size={18} /> : isInstalling || isChecking ? <RefreshCw className="spin" size={18} /> : <CircleAlert size={18} />}
      </span>
      <div>
        <b>{isInstalling ? `Actualizando a ${state.update.version}` : isChecking ? 'Buscando actualización' : isCurrent ? 'NEXO está al día' : 'No pude actualizar NEXO'}</b>
        <p>{isInstalling ? 'Se instalará solo y NEXO volverá a abrir.' : isChecking ? 'Esto tarda unos segundos.' : isCurrent ? 'No hay una versión más nueva.' : state.message}</p>
      </div>
      {state.status === 'error' && <button className="app-update-primary" onClick={() => void check(true)}>Reintentar</button>}
    </aside>
  );
}
