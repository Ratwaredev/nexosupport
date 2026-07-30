import React from 'react';
import ReactDOM from 'react-dom/client';
import { ensureLocalOwnerWorkspace } from './lib/local-owner-bootstrap';
import { safeInvoke } from './lib/tauri';

const url = new URL(window.location.href);
const isAdminView = url.pathname.endsWith('/admin.html') || url.searchParams.get('view') === 'admin';

function installPopupWindowControls() {
  document.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const closeButton = element?.closest<HTMLButtonElement>('button[aria-label="Cerrar NEXO"]');
    if (!closeButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    void safeInvoke('hide_main_window');
  }, true);
}

async function start() {
  ensureLocalOwnerWorkspace();
  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

  if (isAdminView) {
    const { default: AdminApp } = await import('./AdminApp');
    root.render(
      <React.StrictMode>
        <AdminApp />
      </React.StrictMode>
    );
    return;
  }

  installPopupWindowControls();
  await Promise.all([
    import('./support-v4.css'),
    import('./support-v5.css'),
    import('./support-v6.css'),
    import('./updater.css')
  ]);
  const [{ default: SupportAppV5 }, { default: AppUpdater }] = await Promise.all([
    import('./SupportAppV5'),
    import('./AppUpdater')
  ]);
  root.render(
    <React.StrictMode>
      <>
        <SupportAppV5 />
        <AppUpdater />
      </>
    </React.StrictMode>
  );
}

void start();
