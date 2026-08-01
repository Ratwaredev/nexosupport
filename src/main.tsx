import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import AdminBootstrap from './AdminBootstrap';
import { installBackendErrorGuard } from './lib/backend-error-guard';
import { ensureLocalOwnerWorkspace } from './lib/local-owner-bootstrap';

type NexoView = 'admin' | 'support';
type NexoWindow = Window & { __NEXO_VIEW__?: NexoView };
type ViewEvent = CustomEvent<NexoView>;
type SupportComponent = React.ComponentType;

const url = new URL(window.location.href);
const nativeView = (window as NexoWindow).__NEXO_VIEW__;
const initialView: NexoView = nativeView === 'admin' || url.pathname.endsWith('/admin.html') || url.searchParams.get('view') === 'admin'
  ? 'admin'
  : 'support';

function NexoRoot({ SupportApp, AppUpdater }: { SupportApp: SupportComponent; AppUpdater: SupportComponent }) {
  const [view, setView] = useState<NexoView>(initialView);

  useEffect(() => {
    const switchView = (event: Event) => {
      const next = (event as ViewEvent).detail;
      if (next === 'admin' || next === 'support') setView(next);
    };
    window.addEventListener('nexo:set-view', switchView);
    return () => window.removeEventListener('nexo:set-view', switchView);
  }, []);

  if (view === 'admin') return <AdminBootstrap />;

  return (
    <>
      <SupportApp />
      <AppUpdater />
    </>
  );
}

async function start() {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('NEXO root is missing.');

  rootElement.removeAttribute('data-nexo-native-shell');
  rootElement.replaceChildren();

  installBackendErrorGuard();
  ensureLocalOwnerWorkspace();

  await Promise.all([
    import('./support-v7.css'),
    import('./support-agent.css'),
    import('./updater.css')
  ]);
  const [{ default: SupportAppV6 }, { default: AppUpdater }] = await Promise.all([
    import('./SupportAppV6'),
    import('./AppUpdater')
  ]);

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <NexoRoot SupportApp={SupportAppV6} AppUpdater={AppUpdater} />
    </React.StrictMode>
  );
}

void start().catch((error: unknown) => {
  console.error('NEXO startup failure', error);
  const root = document.getElementById('root');
  if (!root) return;
  root.removeAttribute('data-nexo-native-shell');
  root.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;background:#f5f6f8;font-family:Segoe UI,sans-serif;color:#20222a">
      <section style="width:340px;padding:24px;border:1px solid #dfe1e7;border-radius:16px;background:#fff;box-shadow:0 20px 55px rgba(20,24,36,.12)">
        <strong style="display:block;margin-bottom:8px">NEXO no pudo abrirse</strong>
        <span style="display:block;margin-bottom:16px;color:#777c87;font-size:12px">Cerrá esta ventana y volvé a intentarlo.</span>
        <button id="nexo-emergency-close" style="width:100%;height:40px;border:0;border-radius:10px;color:#fff;background:#5a51c7;cursor:pointer">Cerrar</button>
      </section>
    </main>`;
  document.getElementById('nexo-emergency-close')?.addEventListener('click', () => window.close());
});
