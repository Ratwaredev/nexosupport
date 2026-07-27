import React from 'react';
import ReactDOM from 'react-dom/client';
import AssistantApp from './AssistantApp';
import AdminApp from './AdminApp';
import './assistant.css';
import './admin.css';

const isAdminView = new URLSearchParams(window.location.search).get('view') === 'admin';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isAdminView ? <AdminApp /> : <AssistantApp />}
  </React.StrictMode>
);
