'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

  const deactivated = params.get('error') === 'inactive';

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
    <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-sub">
        Calo UAE · Central Warehouse
      </div>
      <h1 className="mt-1 text-2xl font-bold text-ink">Van check</h1>
      <p className="mt-2 text-sm text-sub">
        Pre-departure quality checks for chilled vans.
      </p>

      {deactivated && (
        <div className="mt-4 rounded-lg bg-fail-soft p-3 text-sm font-medium text-fail">
          This account is no longer active.
        </div>
      )}

      <div className="mt-6 space-y-3">
        <div>
          <label htmlFor="email" className="text-xs font-bold uppercase tracking-wide text-sub">
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
            className="mt-1 w-full rounded-xl border border-line bg-steel px-3 py-3 text-base text-ink outline-none focus:border-fleet"
          />
        </div>

        <div>
          <label htmlFor="password" className="text-xs font-bold uppercase tracking-wide text-sub">
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
            className="mt-1 w-full rounded-xl border border-line bg-steel px-3 py-3 text-base text-ink outline-none focus:border-fleet"
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
        className="mt-6 w-full rounded-xl bg-fleet py-4 text-base font-bold text-white disabled:bg-line disabled:text-sub"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="mt-4 text-center text-xs text-sub">
        Your name goes on every check you file. Do not share this login.
      </p>
    </div>
  );
};

const LoginPage = () => (
  <main className="flex min-h-screen items-center justify-center p-4">
    <Suspense fallback={<div className="text-sm text-sub">Loading…</div>}>
      <LoginForm />
    </Suspense>
  </main>
);

export default LoginPage;
