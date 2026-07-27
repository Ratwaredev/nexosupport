import React from 'react';
import ReactDOM from 'react-dom/client';

const isAdminView = new URLSearchParams(window.location.search).get('view') === 'admin';

async function start() {
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
    import('./assistant.css'),
    import('./assistant-first-run.css'),
    import('./mode-picker.css'),
    import('./updater.css')
  ]);
  const [{ default: AssistantApp }, { default: AppUpdater }] = await Promise.all([
    import('./AssistantApp'),
    import('./AppUpdater')
  ]);
  root.render(
    <React.StrictMode>
      <>
        <AssistantApp />
        <AppUpdater />
      </>
    </React.StrictMode>
  );
}

void start();
