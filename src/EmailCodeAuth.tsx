import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Check, LoaderCircle, LogOut, Mail } from 'lucide-react';
import {
  type EmailUserSession,
  requestEmailCode,
  restoreEmailSession,
  signOutEmailSession,
  verifyEmailCode
} from './lib/email-code-auth';

type Step = 'email' | 'code';

export default function EmailCodeAuth({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<EmailUserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void restoreEmailSession().then(value => {
      if (!active) return;
      setSession(value);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setError('');
    try {
      await requestEmailCode(email);
      setStep('code');
      setCode('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar el código.');
    } finally {
      setWorking(false);
    }
  }

  async function confirmCode(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setError('');
    try {
      const next = await verifyEmailCode(email, code);
      setSession(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar el código.');
    } finally {
      setWorking(false);
    }
  }

  async function logout() {
    const current = session;
    setSession(null);
    setStep('email');
    setCode('');
    await signOutEmailSession(current);
  }

  if (loading) {
    return <main className="email-auth-shell"><LoaderCircle className="email-auth-spinner" size={24} /></main>;
  }

  if (!session) {
    return (
      <main className="email-auth-shell">
        <section className="email-auth-card" aria-label="Acceso a NEXO">
          <div className="email-auth-mark">N</div>
          <header>
            <h1>NEXO</h1>
            <p>{step === 'email' ? 'Ingresá con tu email.' : `Código enviado a ${email.trim().toLowerCase()}`}</p>
          </header>

          {step === 'email' ? (
            <form onSubmit={sendCode}>
              <label>
                <span>Email</span>
                <div className="email-auth-input"><Mail size={16} /><input autoFocus type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="nombre@email.com" autoComplete="email" /></div>
              </label>
              <button className="email-auth-primary" type="submit" disabled={working || !email.trim()}>{working ? <LoaderCircle className="email-auth-spinner" size={17} /> : 'Enviar código'}</button>
            </form>
          ) : (
            <form onSubmit={confirmCode}>
              <label>
                <span>Código</span>
                <input className="email-auth-code" autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="000000" />
              </label>
              <button className="email-auth-primary" type="submit" disabled={working || code.length < 6}>{working ? <LoaderCircle className="email-auth-spinner" size={17} /> : <><Check size={17} /> Entrar</>}</button>
              <button className="email-auth-secondary" type="button" onClick={() => { setStep('email'); setCode(''); setError(''); }}>Cambiar email</button>
            </form>
          )}

          {error ? <div className="email-auth-error" role="alert">{error}</div> : null}
        </section>
      </main>
    );
  }

  return (
    <>
      {children}
      <button className="email-auth-account" type="button" onClick={() => void logout()} title="Cerrar sesión">
        <span>{session.email}</span><LogOut size={13} />
      </button>
    </>
  );
}
