import React from 'react';
import ReactDOM from 'react-dom/client';
import { installBackendErrorGuard } from './lib/backend-error-guard';
import { ensureLocalOwnerWorkspace } from './lib/local-owner-bootstrap';

const url = new URL(window.location.href);
const isAdminView = url.pathname.endsWith('/admin.html') || url.searchParams.get('view') === 'admin';

async function start() {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('NEXO root is missing.');
  const root = ReactDOM.createRoot(rootElement);

  if (isAdminView) {
    const { default: AdminBootstrap } = await import('./AdminBootstrap');
    root.render(<AdminBootstrap />);
    return;
  }

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
  root.render(
    <React.StrictMode>
      <>
        <SupportAppV6 />
        <AppUpdater />
      </>
    </React.StrictMode>
  );
}

void start().catch((error: unknown) => {
  console.error('NEXO startup failure', error);
  const root = document.getElementById('root');
  if (!root) return;
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
