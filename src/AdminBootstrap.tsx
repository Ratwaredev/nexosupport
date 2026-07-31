import React, { useEffect, useState } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';
import { safeInvoke } from './lib/tauri';

type BoundaryProps = { children: ReactNode; onRetry: () => void };
type BoundaryState = { failed: boolean };

const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  color: '#20222a',
  background: '#f5f6f8',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
};

class AdminBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('NEXO Control render failure', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <AdminFailure message="Administración no pudo abrirse." onRetry={this.props.onRetry} />;
  }
}

function closeAdmin() {
  void safeInvoke('close_admin_window').catch(() => window.close());
}

function AdminFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main style={shellStyle}>
      <section style={{ width: 360, padding: 26, border: '1px solid #dfe1e7', borderRadius: 18, display: 'grid', gap: 14, background: '#fff', boxShadow: '0 22px 60px rgba(25,28,40,.12)' }}>
        <span style={{ width: 42, height: 42, borderRadius: 13, display: 'grid', placeItems: 'center', color: '#fff', background: 'linear-gradient(145deg,#8d3cff,#375cff 58%,#168fff)' }}>N</span>
        <div style={{ display: 'grid', gap: 5 }}>
          <strong style={{ fontSize: 18 }}>NEXO Control</strong>
          <span style={{ color: '#747985', fontSize: 12 }}>{message}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button type="button" onClick={closeAdmin} style={{ height: 40, border: '1px solid #d9dce3', borderRadius: 10, background: '#fff', cursor: 'pointer' }}>Cerrar</button>
          <button type="button" onClick={onRetry} style={{ height: 40, border: 0, borderRadius: 10, color: '#fff', background: '#5a51c7', cursor: 'pointer' }}>Reintentar</button>
        </div>
        <small style={{ color: '#969aa4' }}>También podés presionar Esc.</small>
      </section>
    </main>
  );
}

export default function AdminBootstrap() {
  const [AdminApp, setAdminApp] = useState<ComponentType | null>(null);
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAdmin();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);

  useEffect(() => {
    let active = true;
    setFailure('');
    setAdminApp(null);

    const timeout = window.setTimeout(() => {
      if (active) setFailure('La carga tardó demasiado y fue detenida.');
    }, 12_000);

    void import('./AdminApp')
      .then((module) => {
        if (!active) return;
        window.clearTimeout(timeout);
        setAdminApp(() => module.default);
      })
      .catch((error: unknown) => {
        console.error('NEXO Control load failure', error);
        if (!active) return;
        window.clearTimeout(timeout);
        setFailure('No se pudo cargar Administración.');
      });

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [attempt]);

  if (failure) return <AdminFailure message={failure} onRetry={() => setAttempt((value) => value + 1)} />;

  if (!AdminApp) {
    return (
      <main style={shellStyle}>
        <section style={{ display: 'grid', placeItems: 'center', gap: 14 }}>
          <span style={{ width: 48, height: 48, border: '3px solid #dedbf8', borderTopColor: '#654cff', borderRadius: '50%', animation: 'admin-bootstrap-spin .8s linear infinite' }} />
          <strong style={{ fontSize: 13 }}>Abriendo NEXO Control</strong>
          <button type="button" onClick={closeAdmin} style={{ border: 0, color: '#777c87', background: 'transparent', cursor: 'pointer' }}>Cancelar</button>
          <style>{'@keyframes admin-bootstrap-spin{to{transform:rotate(360deg)}}'}</style>
        </section>
      </main>
    );
  }

  return (
    <AdminBoundary onRetry={() => setAttempt((value) => value + 1)}>
      <AdminApp />
    </AdminBoundary>
  );
}
