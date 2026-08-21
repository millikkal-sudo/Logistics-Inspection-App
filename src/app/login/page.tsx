'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CaloMark } from '@/components/CaloMark';
import { browserClient } from '@/lib/supabaseBrowser';

/**
 * Supabase's own messages are written for developers. These are written
 * for someone standing in a warehouse at 06:30 who needs to know what to
 * do next, not what went wrong internally.
 */
const readableError = (message: string): string => {
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials')) {
    return 'That email and password do not match. Check both, or ask Aflah to reset it.';
  }
  if (lower.includes('email not confirmed')) {
    return 'This account has not been confirmed yet. Ask Aflah to confirm it in Supabase.';
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (lower.includes('fetch') || lower.includes('network')) {
    return 'No connection. Check the wifi and try again.';
  }
  return message;
};

const LoginForm = () => {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reason = params.get('error');
  const deactivated = reason === 'inactive';
  const misconfigured = reason === 'config';

  const signIn = async (): Promise<void> => {
    if (email.trim() === '' || password === '') {
      setError('Enter your email and password.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { error: authError } = await browserClient().auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError !== null) {
        setError(readableError(authError.message));
        setBusy(false);
        return;
      }

      router.replace('/');
      router.refresh();
    } catch {
      setError('Could not reach the sign-in service. Check the connection.');
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm rounded-lg bg-surface-card p-8 shadow-3">
      <CaloMark />
      <div className="mt-6 text-[11px] font-bold uppercase tracking-[0.16em] text-content-secondary">
        UAE · Central Warehouse
      </div>
      <h1 className="mt-1 text-3xl font-black text-content-contrast">Van check</h1>
      <p className="mt-2 text-sm text-content-secondary">
        Pre-departure quality checks for chilled vans.
      </p>

      {deactivated && (
        <div className="mt-4 rounded-lg bg-fail-soft p-3 text-sm font-medium text-fail">
          This account is no longer active.
        </div>
      )}

      {misconfigured && (
        <div className="mt-4 space-y-1 rounded-lg bg-fail-soft p-3">
          <p className="text-sm font-medium text-fail">This app is not configured yet.</p>
          <p className="text-xs text-content-secondary">
            The Supabase environment variables are missing on the server. Add them in
            Vercel under Settings &rarr; Environment Variables, then redeploy.
          </p>
        </div>
      )}

      <div className="mt-6 space-y-3">
        <div>
          <label htmlFor="email" className="text-xs font-bold uppercase tracking-wide text-content-secondary">
            Email
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void signIn();
              }
            }}
            className="mt-1 w-full rounded-xl border border-line bg-surface-page px-3 py-3 text-base text-content outline-none focus:border-brand"
          />
        </div>

        <div>
          <label htmlFor="password" className="text-xs font-bold uppercase tracking-wide text-content-secondary">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void signIn();
              }
            }}
            className="mt-1 w-full rounded-xl border border-line bg-surface-page px-3 py-3 text-base text-content outline-none focus:border-brand"
          />
        </div>
      </div>

      {error !== null && (
        <div className="mt-4 rounded-lg bg-fail-soft p-3 text-sm font-medium text-fail">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => void signIn()}
        disabled={busy}
        className="mt-6 w-full rounded-xl bg-brand py-4 text-base font-bold text-content-invert disabled:bg-line disabled:text-content-secondary"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="mt-4 text-center text-xs text-content-secondary">
        Your name goes on every check you file. Do not share this login.
      </p>
    </div>
  );
};

const LoginPage = () => (
  <main className="flex min-h-screen items-center justify-center p-4">
    <Suspense fallback={<div className="text-sm text-content-secondary">Loading…</div>}>
      <LoginForm />
    </Suspense>
  </main>
);

export default LoginPage;
