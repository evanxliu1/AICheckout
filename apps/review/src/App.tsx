import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createReviewApi, type createReviewAuth } from './client';
import ReviewWorkspace from './ReviewWorkspace';

type Auth = ReturnType<typeof createReviewAuth>;
export default function App({ auth }: { auth: Auth }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [working, setWorking] = useState<'in' | 'out' | null>(null);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [accessError, setAccessError] = useState<number | null>(null);
  const api = useMemo(() => createReviewApi(async () => (await auth.auth.getSession()).data.session?.access_token ?? null, setAccessError), [auth]);
  useEffect(() => {
    const { data: { subscription } } = auth.auth.onAuthStateChange((event, next) => {
      setSession(next); setInitialized(true);
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') setAccessError(null);
    });
    return () => subscription.unsubscribe();
  }, [auth]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setWorking('in'); setError('');
    try {
      const { error: failed } = await auth.auth.signInWithPassword({ email: email.trim(), password });
      if (failed) setError('Sign-in failed. Check your email and password, then try again.');
    } catch { setError('Sign-in could not finish. Check your connection and try again.'); }
    finally { setPassword(''); setWorking(null); }
  }
  async function signOut() {
    setWorking('out'); setError('');
    try {
      const { error: failed } = await auth.auth.signOut({ scope: 'local' });
      if (failed) setError('Sign-out could not be confirmed. Reconnect and retry to revoke this session.');
      else { setSession(null); setAccessError(null); }
    } catch { setError('Sign-out could not be confirmed. Reconnect and retry to revoke this session.'); }
    finally { setWorking(null); }
  }

  return <>
    <a className="skip-link" href="#main">Skip to review</a>
    <header className="app-header"><a className="brand" href="/review/">AI Checkout</a><span className="header-context">Catalog review</span>
      {session && <div className="account"><span>{session.user.email}</span><button className="quiet" disabled={!!working} onClick={() => void signOut()}>Sign out</button></div>}
    </header>
    {!initialized ? <main id="main" className="sign-in"><p role="status">Checking your session…</p></main> :
      !session ? <main id="main" className="sign-in"><h1>Review the terms behind every estimate.</h1><p>Sign in to compare draft reward rules with their sources and approve a catalog release.</p>
        <form onSubmit={event => void signIn(event)}>
          <label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} disabled={!!working} />
          <label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={!!working} />
          {error && <p className="alert error" role="alert">{error}</p>}
          <button className="primary" disabled={!!working}>{working === 'in' ? 'Signing in…' : 'Sign in'}</button>
        </form><p className="muted small">Access is limited to appointed reviewers. Your session stays in this tab’s memory; refreshing requires sign-in again.</p>
      </main> : working === 'out' ? <main id="main" className="sign-in"><p role="status">Signing out…</p></main> : accessError ?
        <main id="main" className="sign-in"><h1>{accessError === 401 ? 'Your session ended.' : 'Reviewer access is required.'}</h1>
          <p>{accessError === 401 ? 'Sign out, then sign in again to continue.' : 'Ask the project operator to grant this account reviewer access.'}</p>
          <button onClick={() => setAccessError(null)}>Check access again</button>{error && <p role="alert" className="alert error">{error}</p>}
        </main> : <>{error && <p role="alert" className="alert error global-error">{error}</p>}<ReviewWorkspace key={session.user.id} api={api} /></>}
  </>;
}
