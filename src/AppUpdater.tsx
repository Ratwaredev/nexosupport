import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Download, RefreshCw, X } from 'lucide-react';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type AvailableUpdate = { version: string; notes?: string | null };
type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current' }
  | { status: 'available'; update: AvailableUpdate }
  | { status: 'error'; update?: AvailableUpdate; message: string };

// Manual throttle only. NEXO never checks for updates by itself.
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const MANUAL_THROTTLE_MS = Math.min(CHECK_EVERY_MS, 1200);
// app-update-installing intentionally removed: NEXO never installs or restarts itself.

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
  return 'No se pudo abrir la descarga';
}

export default function AppUpdater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const checking = useRef(false);
  const lastManualCheck = useRef(0);
  const noticeTimer = useRef<number | null>(null);

  const hideSoon = useCallback(() => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setState({ status: 'idle' }), 1800);
  }, []);

  const check = useCallback(async () => {
    if (!isTauriRuntime() || checking.current) return;
    const now = Date.now();
    if (now - lastManualCheck.current < MANUAL_THROTTLE_MS) return;
    lastManualCheck.current = now;
    checking.current = true;
    setState({ status: 'checking' });
    try {
      const update = await safeInvoke<AvailableUpdate | null>('check_app_update');
      if (update) setState({ status: 'available', update });
      else {
        setState({ status: 'current' });
        hideSoon();
      }
    } catch (error) {
      setState({ status: 'error', message: readableError(error) });
    } finally {
      checking.current = false;
    }
  }, [hideSoon]);

  const download = useCallback(async (update: AvailableUpdate) => {
    try {
      await safeInvoke('open_update_download', { version: update.version });
      setState({ status: 'idle' });
    } catch (error) {
      setState({ status: 'error', update, message: readableError(error) });
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const manual = () => void check();
    window.addEventListener('nexo:check-update', manual);
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      window.removeEventListener('nexo:check-update', manual);
    };
  }, [check]);

  if (state.status === 'idle') return null;

  if (state.status === 'checking' || state.status === 'current') {
    return (
      <aside className={`app-update-toast ${state.status}`} role="status">
        {state.status === 'current' ? <Check size={15} /> : <RefreshCw className="spin" size={15} />}
        <b>{state.status === 'current' ? 'Al día' : 'Buscando'}</b>
      </aside>
    );
  }

  const update = state.update;
  const failed = state.status === 'error';
  return (
    <aside className={`app-update-panel ${failed ? 'error' : ''}`} role="dialog" aria-modal="false">
      <button className="app-update-close" aria-label="Cerrar" onClick={() => setState({ status: 'idle' })}><X size={14} /></button>
      <span>{failed ? <CircleAlert size={19} /> : <UpdateMark size={30} />}</span>
      <div><small>{failed ? state.message : `v${update?.version || ''}`}</small><b>{failed ? 'No se pudo abrir' : 'Nueva versión'}</b></div>
      <footer>
        <button onClick={() => setState({ status: 'idle' })}>Ahora no</button>
        <button onClick={() => update ? void download(update) : void check()}>{failed ? 'Reintentar' : <><Download size={14} /> Descargar</>}</button>
      </footer>
    </aside>
  );
}
