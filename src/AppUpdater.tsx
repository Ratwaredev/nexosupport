import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, RefreshCw, X } from 'lucide-react';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type AvailableUpdate = { version: string; notes?: string | null };
type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current' }
  | { status: 'available'; update: AvailableUpdate }
  | { status: 'installing'; update: AvailableUpdate }
  | { status: 'error'; update?: AvailableUpdate; message: string };

type DismissedUpdate = { version: string; until: number };

const CHECK_EVERY_MS = 60 * 1000;
const MIN_EVENT_GAP_MS = 10 * 1000;
const SNOOZE_MS = 15 * 60 * 1000;

function UpdateMark({ size = 44 }: { size?: number }) {
  const id = `update-x-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 62 54" aria-hidden="true">
      <defs><linearGradient id={id} x1="4" y1="4" x2="58" y2="50" gradientUnits="userSpaceOnUse"><stop stopColor="#765cff" /><stop offset=".55" stopColor="#5d61ea" /><stop offset="1" stopColor="#288bdf" /></linearGradient></defs>
      <path d="M4 4h13.4L31 20.8 44.6 4H58L38.1 27 58 50H44.6L31 33.2 17.4 50H4l19.9-23z" fill={`url(#${id})`} />
    </svg>
  );
}

function readableError(error: unknown) {
  const raw = error instanceof Error ? error.message : '';
  if (/network|fetch|internet|connection/i.test(raw)) return 'Sin conexión.';
  if (/signature|firma/i.test(raw)) return 'La firma no es válida.';
  return 'No se pudo actualizar.';
}

export default function AppUpdater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [progress, setProgress] = useState(0);
  const started = useRef(false);
  const installing = useRef(false);
  const checking = useRef(false);
  const dismissed = useRef<DismissedUpdate | null>(null);
  const lastCheck = useRef(0);
  const noticeTimer = useRef<number | null>(null);
  const progressTimer = useRef<number | null>(null);

  const hideSoon = useCallback(() => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setState({ status: 'idle' }), 2200);
  }, []);

  const dismiss = useCallback((update?: AvailableUpdate) => {
    if (update?.version) dismissed.current = { version: update.version, until: Date.now() + SNOOZE_MS };
    setState({ status: 'idle' });
  }, []);

  const install = useCallback(async (update: AvailableUpdate) => {
    if (installing.current) return;
    installing.current = true;
    setProgress(3);
    setState({ status: 'installing', update });
    progressTimer.current = window.setInterval(() => {
      setProgress((current) => current >= 92 ? current : Math.min(92, current + Math.max(1, Math.round((96 - current) / 12))));
    }, 420);
    try {
      await safeInvoke('install_app_update');
      setProgress(100);
    } catch (error) {
      installing.current = false;
      if (progressTimer.current) window.clearInterval(progressTimer.current);
      setState({ status: 'error', update, message: readableError(error) });
    }
  }, []);

  const check = useCallback(async (manual = false) => {
    if (!isTauriRuntime() || installing.current || checking.current) return;
    const now = Date.now();
    if (!manual && now - lastCheck.current < MIN_EVENT_GAP_MS) return;
    checking.current = true;
    lastCheck.current = now;
    if (manual) setState({ status: 'checking' });
    try {
      const update = await safeInvoke<AvailableUpdate | null>('check_app_update');
      if (update) {
        const previous = dismissed.current;
        if (!manual && previous?.version === update.version && Date.now() < previous.until) return;
        setState({ status: 'available', update });
      } else if (manual) {
        dismissed.current = null;
        setState({ status: 'current' });
        hideSoon();
      }
    } catch (error) {
      if (manual) setState({ status: 'error', message: readableError(error) });
    } finally {
      checking.current = false;
    }
  }, [hideSoon]);

  useEffect(() => {
    if (!isTauriRuntime() || started.current) return;
    started.current = true;
    const first = window.setTimeout(() => void check(false), 1600);
    const interval = window.setInterval(() => void check(false), CHECK_EVERY_MS);
    const passive = () => void check(false);
    const manual = () => void check(true);
    const visible = () => { if (document.visibilityState === 'visible') passive(); };
    window.addEventListener('focus', passive);
    window.addEventListener('online', passive);
    window.addEventListener('pageshow', passive);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('nexo:check-update', manual);
    window.addEventListener('nexo:check-update-passive', passive);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      if (progressTimer.current) window.clearInterval(progressTimer.current);
      window.removeEventListener('focus', passive);
      window.removeEventListener('online', passive);
      window.removeEventListener('pageshow', passive);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('nexo:check-update', manual);
      window.removeEventListener('nexo:check-update-passive', passive);
    };
  }, [check]);

  if (state.status === 'idle') return null;

  if (state.status === 'checking' || state.status === 'current') {
    return (
      <aside className={`app-update-toast ${state.status}`} role="status">
        <span>{state.status === 'current' ? <Check size={16} /> : <RefreshCw className="spin" size={16} />}</span>
        <b>{state.status === 'current' ? 'NEXO está al día' : 'Buscando actualización'}</b>
      </aside>
    );
  }

  if (state.status === 'installing') {
    return (
      <div className="app-update-backdrop">
        <section className="app-update-stage" role="dialog" aria-modal="true">
          <UpdateMark size={52} />
          <h2>Actualizando NEXO</h2>
          <strong>{Math.round(progress)}%</strong>
          <div><i style={{ width: `${progress}%` }} /></div>
        </section>
      </div>
    );
  }

  const update = state.status === 'available' ? state.update : state.update;
  const failed = state.status === 'error';
  return (
    <div className="app-update-backdrop">
      <section className={`app-update-card ${failed ? 'error' : ''}`} role="dialog" aria-modal="true">
        <button className="app-update-close" aria-label="Cerrar actualización" onClick={() => dismiss(update)}><X size={15} /></button>
        <span>{failed ? <CircleAlert size={21} /> : <UpdateMark size={36} />}</span>
        <div><small>{failed ? 'ERROR' : 'NUEVA VERSIÓN'}</small><h2>{failed ? state.message : `NEXO ${update?.version || ''}`}</h2></div>
        <footer>
          <button onClick={() => dismiss(update)}>Después</button>
          <button onClick={() => update ? void install(update) : void check(true)}>{failed ? 'Reintentar' : 'Actualizar'}</button>
        </footer>
      </section>
    </div>
  );
}
