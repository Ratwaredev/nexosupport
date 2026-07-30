import React from 'react';
import ReactDOM from 'react-dom/client';
import { ensureLocalOwnerWorkspace } from './lib/local-owner-bootstrap';

const url = new URL(window.location.href);
const isAdminView = url.pathname.endsWith('/admin.html') || url.searchParams.get('view') === 'admin';

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

  await Promise.all([
    import('./support-v4.css'),
    import('./support-v5.css'),
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
