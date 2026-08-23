import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import { deriveAuthKey, deriveIdentity } from '../../shared/crypto.ts';
import { useStore } from '../../shared/store.ts';
import { Button, Input, Panel, Spinner } from '../../shared/ui/index.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { cardFromName } from '@4am/shared';

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<'idle' | 'deriving' | 'submitting' | 'success'>('idle');
  const busy = phase !== 'idle';
  const [expired] = useState(() => new URLSearchParams(window.location.search).has('expired'));
  const [error, setError] = useState<string | null>(null);
  const setAuth = useStore((s) => s.setAuth);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPhase('deriving');
    try {
      // scrypt is intentionally slow; yield a frame so the spinner paints first
      await new Promise((r) => setTimeout(r, 30));
      const authKey = deriveAuthKey(username, password);
      const identity = deriveIdentity(username, password);
      setPhase('submitting');
      const res =
        mode === 'register'
          ? await api.register(username, authKey, identity.publicKey)
          : await api.login(username, authKey);
      setAuth({ token: res.token, userId: res.userId, username, identity });
      setPhase('success');
      setTimeout(() => nav('/lobby'), 650);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
      setPhase('idle');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-end justify-center gap-1.5">
          {['As', 'Kh'].map((n, i) => (
            <PlayingCard key={n} card={cardFromName(n)} size="sm" className={i ? 'rotate-6' : '-rotate-6'} />
          ))}
        </div>
        <h1 className="mb-1 text-center font-display text-2xl font-bold">4AM Casino</h1>
        <p className="mb-6 text-center text-sm text-slate-500">
          Hold'em with friends. Nobody sees your cards. Not even the house.
        </p>
        {expired && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            Your session expired, most likely because the server restarted. On free hosting the
            play-money data resets with it, so you may need to register again.
          </div>
        )}
        <Panel>
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-md py-1.5 text-sm font-medium capitalize transition-colors ${
                  mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {m === 'login' ? 'Log in' : 'Register'}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="space-y-3">
            <Input
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={busy}
              required
              minLength={2}
              pattern="[a-zA-Z0-9_]+"
            />
            <Input
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              disabled={busy}
              required
              minLength={6}
            />
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <Button
              type="submit"
              className={phase === 'success' ? 'w-full bg-emerald-500 hover:bg-emerald-500' : 'w-full'}
              disabled={busy}
            >
              {phase === 'deriving' ? (
                <Spinner label="Deriving your keys…" />
              ) : phase === 'submitting' ? (
                <Spinner label={mode === 'register' ? 'Creating account…' : 'Signing in…'} />
              ) : phase === 'success' ? (
                mode === 'register' ? (
                  '✓ Account created. Dealing you in…'
                ) : (
                  '✓ Signed in. Dealing you in…'
                )
              ) : mode === 'login' ? (
                'Log in'
              ) : (
                'Create account'
              )}
            </Button>
          </form>
          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            Your password also derives your card-signing key in this browser. It is never sent to the
            server.
          </p>
        </Panel>
        <Link
          to="/fair"
          className="mt-4 block text-center text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          How can an online deck be fair? Watch the 60-second explainer
        </Link>
      </div>
    </div>
  );
}
