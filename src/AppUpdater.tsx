import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type AvailableUpdate = {
  version: string;
  notes?: string | null;
};

type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; update: AvailableUpdate }
  | { status: 'installing'; update: AvailableUpdate }
  | { status: 'error'; update: AvailableUpdate; message: string };

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export default function AppUpdater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!isTauriRuntime() || started.current) return;
    started.current = true;
    let active = true;

    const check = async () => {
      try {
        const update = await safeInvoke<AvailableUpdate | null>('check_app_update');
        if (active && update) {
          setDismissed(false);
          setState({ status: 'available', update });
        }
      } catch {
        // El chequeo automático nunca debe interrumpir al usuario.
      }
    };

    const first = window.setTimeout(() => void check(), 2500);
    const interval = window.setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      active = false;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, []);

  async function install() {
    if (state.status !== 'available' && state.status !== 'error') return;
    const update = state.update;
    setState({ status: 'installing', update });
    try {
      await safeInvoke('install_app_update');
    } catch (error) {
      setState({
        status: 'error',
        update,
        message: error instanceof Error ? error.message : 'No se pudo instalar la actualización.'
      });
    }
  }

  if (state.status === 'idle' || dismissed) return null;
  const update = state.update;
  const installing = state.status === 'installing';

  return (
    <aside className="app-update" role="status" aria-live="polite">
      <span className="app-update-icon">
        {installing ? <RefreshCw className="spin" size={18} /> : <Download size={18} />}
      </span>
      <div>
        <b>{installing ? 'Actualizando NEXO' : `Nueva versión ${update.version}`}</b>
        <p>{installing ? 'La app se cerrará y volverá a abrir cuando termine.' : state.status === 'error' ? state.message : 'Incluye correcciones y mejoras. No tenés que descargar nada manualmente.'}</p>
      </div>
      {!installing && <button className="app-update-primary" onClick={() => void install()}>Actualizar</button>}
      {!installing && <button className="app-update-close" aria-label="Recordar más tarde" onClick={() => setDismissed(true)}><X size={14} /></button>}
    </aside>
  );
}
