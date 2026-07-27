import { useEffect, useRef, useState } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { isTauriRuntime, safeInvoke } from './lib/tauri';

type AvailableUpdate = {
  version: string;
  notes?: string | null;
};

type UpdateState =
  | { status: 'idle' }
  | { status: 'installing'; update: AvailableUpdate }
  | { status: 'error'; update: AvailableUpdate; message: string };

const CHECK_EVERY_MS = 30 * 60 * 1000;

export default function AppUpdater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const started = useRef(false);
  const installing = useRef(false);

  async function install(update: AvailableUpdate) {
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
  }

  useEffect(() => {
    if (!isTauriRuntime() || started.current) return;
    started.current = true;
    let active = true;

    const check = async () => {
      if (installing.current) return;
      try {
        const update = await safeInvoke<AvailableUpdate | null>('check_app_update');
        if (active && update) await install(update);
      } catch {
        // Sin conexión, NEXO sigue funcionando y vuelve a intentar luego.
      }
    };

    const first = window.setTimeout(() => void check(), 1800);
    const interval = window.setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      active = false;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, []);

  if (state.status === 'idle') return null;
  const isInstalling = state.status === 'installing';

  return (
    <aside className={`app-update ${state.status}`} role="status" aria-live="polite">
      <span className="app-update-icon">
        {isInstalling ? <RefreshCw className="spin" size={18} /> : <CircleAlert size={18} />}
      </span>
      <div>
        <b>{isInstalling ? `Actualizando a ${state.update.version}` : 'No pude actualizar NEXO'}</b>
        <p>{isInstalling ? 'Se instalará solo y NEXO volverá a abrir.' : state.message}</p>
      </div>
      {!isInstalling && <button className="app-update-primary" onClick={() => void install(state.update)}>Reintentar</button>}
    </aside>
  );
}
