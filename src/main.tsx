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
    import('./support-v3.css'),
    import('./support-v3-interaction.css'),
    import('./support-v3-feedback.css'),
    import('./updater.css')
  ]);
  const [{ default: SupportAppV3 }, { default: AppUpdater }] = await Promise.all([
    import('./SupportAppV3'),
    import('./AppUpdater')
  ]);
  root.render(
    <React.StrictMode>
      <>
        <SupportAppV3 />
        <AppUpdater />
      </>
    </React.StrictMode>
  );
}

void start();
