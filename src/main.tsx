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
    import('./support-v2.css'),
    import('./updater.css')
  ]);
  const [{ default: SupportAppV2 }, { default: AppUpdater }] = await Promise.all([
    import('./SupportAppV2'),
    import('./AppUpdater')
  ]);
  root.render(
    <React.StrictMode>
      <>
        <SupportAppV2 />
        <AppUpdater />
      </>
    </React.StrictMode>
  );
}

void start();
