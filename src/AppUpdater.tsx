import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Download, Power, RefreshCw, X } from 'lucide-react';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type AvailableUpdate = {
  version: string;
  notes?: string | null;
};

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking'; manual: boolean }
  | { status: 'current' }
  | { status: 'available'; update: AvailableUpdate }
  | { status: 'installing'; update: AvailableUpdate }
  | { status: 'error'; update?: AvailableUpdate; message: string };

type DismissedUpdate = {
  version: string;
  until: number;
};

const CHECK_EVERY_MS = 60 * 1000;
const MIN_EVENT_GAP_MS = 10 * 1000;
const SNOOZE_MS = 15 * 60 * 1000;
const CURRENT_NOTICE_MS = 2600;

function readableError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : fallback;
  if (/network|fetch|internet|connection/i.test(raw)) return 'No pude consultar GitHub. Revisá Internet y probá otra vez.';
  if (/signature|firma/i.test(raw)) return 'La actualización no superó la verificación de seguridad.';
  return fallback;
}

export default function AppUpdater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const started = useRef(false);
  const installing = useRef(false);
  const checking = useRef(false);
  const dismissedUpdate = useRef<DismissedUpdate | null>(null);
  const lastCheckAt = useRef(0);
  const clearTimer = useRef<number | null>(null);

  const clearNoticeLater = useCallback(() => {
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => setState({ status: 'idle' }), CURRENT_NOTICE_MS);
  }, []);

  const dismiss = useCallback((update?: AvailableUpdate) => {
    if (update?.version) {
      dismissedUpdate.current = {
        version: update.version,
        until: Date.now() + SNOOZE_MS
      };
    }
    setState({ status: 'idle' });
  }, []);

  const closeNexo = useCallback(async () => {
    if (!isTauriRuntime()) {
      window.close();
      return;
    }

    try {
      await Promise.race([
        safeInvoke('exit_app'),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('exit timeout')), 1200);
        })
      ]);
    } catch {
      window.close();
    }
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
        message: readableError(error, 'No se pudo instalar la actualización. NEXO sigue abierto y no cambió nada.')
      });
    }
  }, []);

  const check = useCallback(async (manual = false) => {
    if (!isTauriRuntime() || installing.current || checking.current) return;

    const now = Date.now();
    if (!manual && now - lastCheckAt.current < MIN_EVENT_GAP_MS) return;

    checking.current = true;
    lastCheckAt.current = now;
    if (manual) setState({ status: 'checking', manual: true });

    try {
      const update = await safeInvoke<AvailableUpdate | null>('check_app_update');
      if (update) {
        const dismissed = dismissedUpdate.current;
        if (!manual && dismissed?.version === update.version && Date.now() < dismissed.until) return;
        if (dismissed && dismissed.version !== update.version) dismissedUpdate.current = null;
        setState({ status: 'available', update });
        return;
      }

      dismissedUpdate.current = null;
      if (manual) {
        setState({ status: 'current' });
        clearNoticeLater();
      }
    } catch (error) {
      if (manual) {
        setState({
          status: 'error',
          message: readableError(error, 'No se pudo buscar una actualización.')
        });
      }
    } finally {
      checking.current = false;
    }
  }, [clearNoticeLater]);

  useEffect(() => {
    if (!isTauriRuntime() || started.current) return;
    started.current = true;

    const first = window.setTimeout(() => void check(false), 1800);
    const interval = window.setInterval(() => void check(false), CHECK_EVERY_MS);
    const onFocus = () => void check(false);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check(false);
    };
    const onOnline = () => void check(false);
    const onPageShow = () => void check(false);
    const onManual = () => void check(true);
    const onPassive = () => void check(false);

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('nexo:check-update', onManual);
    window.addEventListener('nexo:check-update-passive', onPassive);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('nexo:check-update', onManual);
      window.removeEventListener('nexo:check-update-passive', onPassive);
    };
  }, [check]);

  if (state.status === 'idle') return null;

  if (state.status === 'checking' || state.status === 'current') {
    return (
      <aside className={`app-update-toast ${state.status}`} role="status" aria-live="polite">
        <span>{state.status === 'current' ? <Check size={17} /> : <RefreshCw className="spin" size={17} />}</span>
        <div>
          <b>{state.status === 'current' ? 'NEXO está al día' : 'Buscando actualización'}</b>
          <small>{state.status === 'current' ? 'No hay una versión más nueva.' : 'Esto tarda unos segundos.'}</small>
        </div>
      </aside>
    );
  }

  const update = state.status === 'available' || state.status === 'installing' ? state.update : state.update;
  const installingNow = state.status === 'installing';
  const failed = state.status === 'error';

  return (
    <div className="app-update-backdrop" role="presentation">
      <section className={`app-update-dialog ${state.status}`} role="dialog" aria-modal="true" aria-labelledby="nexo-update-title">
        {!installingNow && (
          <button className="app-update-dialog-close" aria-label="Cerrar actualización" onClick={() => dismiss(update)}>
            <X size={16} />
          </button>
        )}

        <span className="app-update-dialog-icon">
          {failed ? <CircleAlert size={23} /> : installingNow ? <RefreshCw className="spin" size={23} /> : <Download size={23} />}
        </span>

        <div className="app-update-dialog-copy">
          <small>ACTUALIZACIÓN DE NEXO</small>
          <h2 id="nexo-update-title">
            {failed ? 'No se pudo actualizar' : installingNow ? 'Instalando actualización' : `NEXO ${update?.version || ''} está disponible`}
          </h2>
          <p>
            {failed
              ? state.message
              : installingNow
                ? 'NEXO se cerrará, instalará la nueva versión y volverá a abrir automáticamente.'
                : 'La descarga está firmada. Podés actualizar ahora o seguir trabajando y hacerlo más tarde.'}
          </p>
        </div>

        <footer>
          {!installingNow && <button className="app-update-secondary" onClick={() => dismiss(update)}>Más tarde</button>}
          {!installingNow && (
            <button
              className="app-update-primary"
              onClick={() => update ? void install(update) : void check(true)}
            >
              {failed ? 'Reintentar' : 'Actualizar ahora'}
            </button>
          )}
          {!installingNow && (
            <button className="app-update-close-app" onClick={() => void closeNexo()}>
              <Power size={13} /> Cerrar NEXO
            </button>
          )}
          {installingNow && <div className="app-update-progress"><i /><span>Descargando e instalando…</span></div>}
        </footer>
      </section>
    </div>
  );
}
