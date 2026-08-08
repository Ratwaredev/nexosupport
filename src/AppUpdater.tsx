import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Download, LoaderCircle, RefreshCw } from 'lucide-react';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type AvailableUpdate = { version: string; notes?: string | null };
type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current' }
  | { status: 'available'; update: AvailableUpdate }
  | { status: 'installing'; update: AvailableUpdate }
  | { status: 'error'; update?: AvailableUpdate; message: string };

const STARTUP_CHECK_DELAY_MS = 5_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RECHECK_MS = CHECK_EVERY_MS;
const RETRY_MS = 15 * 60 * 1000;

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
  if (/permission|access|denied|administrator/i.test(raw)) return 'Windows bloqueó la actualización';
  return 'No se pudo actualizar';
}

export default function AppUpdater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const checking = useRef(false);
  const installing = useRef(false);
  const retryTimer = useRef<number | null>(null);

  const install = useCallback(async (update: AvailableUpdate) => {
    if (installing.current) return;
    installing.current = true;
    setState({ status: 'installing', update });
    try {
      await safeInvoke('install_app_update', { expectedVersion: update.version });
    } catch (error) {
      setState({ status: 'error', update, message: readableError(error) });
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      retryTimer.current = window.setTimeout(() => {
        installing.current = false;
        window.dispatchEvent(new CustomEvent('nexo:check-update'));
      }, RETRY_MS);
    }
  }, []);

  const check = useCallback(async () => {
    if (!isTauriRuntime() || checking.current || installing.current) return;
    checking.current = true;
    setState({ status: 'checking' });
    try {
      const update = await safeInvoke<AvailableUpdate | null>('check_app_update');
      if (update) {
        setState({ status: 'available', update });
        window.setTimeout(() => void install(update), 900);
      } else {
        setState({ status: 'current' });
        window.setTimeout(() => setState({ status: 'idle' }), 1400);
      }
    } catch (error) {
      setState({ status: 'error', message: readableError(error) });
    } finally {
      checking.current = false;
    }
  }, [install]);

  const openFallback = useCallback(async (update: AvailableUpdate) => {
    try {
      await safeInvoke('open_update_download', { version: update.version });
    } catch (error) {
      setState({ status: 'error', update, message: readableError(error) });
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const startup = window.setTimeout(() => void check(), STARTUP_CHECK_DELAY_MS);
    const repeat = window.setInterval(() => void check(), RECHECK_MS);
    const manual = () => void check();
    window.addEventListener('nexo:check-update', manual);
    return () => {
      window.clearTimeout(startup);
      window.clearInterval(repeat);
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      window.removeEventListener('nexo:check-update', manual);
    };
  }, [check]);

  if (state.status === 'idle') return null;

  if (state.status === 'checking' || state.status === 'current') {
    return (
      <aside className={`app-update-toast ${state.status}`} role="status">
        {state.status === 'current' ? <Check size={15} /> : <RefreshCw className="spin" size={15} />}
        <b>{state.status === 'current' ? 'Al día' : 'Buscando actualización'}</b>
      </aside>
    );
  }

  if (state.status === 'installing') {
    return (
      <aside className="app-update-installing" role="status">
        <span className="app-update-orb"><LoaderCircle className="spin" size={18} /></span>
        <b>Actualizando NEXO…</b>
      </aside>
    );
  }

  const update = state.update;
  if (state.status === 'available') {
    return (
      <aside className="app-update-panel" role="status">
        <span><UpdateMark size={30} /></span>
        <div><small>v{update.version}</small><b>Nueva versión</b></div>
      </aside>
    );
  }

  return (
    <aside className="app-update-panel error" role="dialog" aria-modal="false">
      <span><CircleAlert size={19} /></span>
      <div><small>{state.message}</small><b>Actualización pendiente</b></div>
      <footer>
        <button onClick={() => void check()}><RefreshCw size={14} /> Reintentar</button>
        {update ? <button onClick={() => void openFallback(update)}><Download size={14} /> Descargar</button> : null}
      </footer>
    </aside>
  );
}
