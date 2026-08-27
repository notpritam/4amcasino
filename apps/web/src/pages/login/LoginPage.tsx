import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import {
  deriveAuthKey,
  deriveIdentity,
  deriveRecoveryAuthKey,
  normalizeRecoveryCode,
} from '../../shared/crypto.ts';
import { takePendingJoin } from '../../shared/pendingJoin.ts';
import { useStore } from '../../shared/store.ts';
import { Button, Input, Panel, Spinner } from '../../shared/ui/index.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { cardFromName } from '@4am/shared';

type Mode = 'login' | 'register' | 'recover';

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phase, setPhase] = useState<'idle' | 'deriving' | 'submitting' | 'success'>('idle');
  const busy = phase !== 'idle';
  const [expired] = useState(() => new URLSearchParams(window.location.search).has('expired'));
  // a share link sent us here; the code is also parked in sessionStorage
  const [joinCode] = useState(() => new URLSearchParams(window.location.search).get('join'));
  const [error, setError] = useState<string | null>(null);
  const setAuth = useStore((s) => s.setAuth);
  const nav = useNavigate();

  /** Land the user wherever they were actually headed: into the shared table if
   *  a /j/CODE link brought them here, otherwise the lobby. */
  async function goOnwards() {
    const pending = takePendingJoin() ?? joinCode;
    if (pending) {
      try {
        const room = await api.joinRoom(pending);
        nav(`/room/${room.id}`);
        return;
      } catch {
        // the code went stale or the table is gone - don't strand them here
        nav('/lobby');
        return;
      }
    }
    nav('/lobby');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'recover') {
      if (password !== confirm) return setError('the new passwords do not match');
      if (normalizeRecoveryCode(recoveryCode).length < 20) {
        return setError('that recovery code looks too short');
      }
    }
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
          : mode === 'recover'
            ? await api.recover(
                username,
                deriveRecoveryAuthKey(recoveryCode),
                authKey,
                identity.publicKey,
              )
            : await api.login(username, authKey);
      setAuth({ token: res.token, userId: res.userId, username, identity });
      setPhase('success');
      setTimeout(() => void goOnwards(), 650);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
      setPhase('idle');
    }
  }

  const cta =
    mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : 'Reset my password';

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
        {joinCode && (
          <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
            You were invited to a table (<span className="font-mono font-bold">{joinCode}</span>).
            Log in or create an account and we'll seat you straight away.
          </div>
        )}
        {expired && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            The server restarted and reset its data, so your login is gone. Sessions here never
            time out on their own. Register again with the same name and you are back in.
          </div>
        )}
        <Panel>
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`rounded-md py-1.5 text-sm font-medium capitalize transition-colors ${
                  mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {m === 'login' ? 'Log in' : 'Register'}
              </button>
            ))}
          </div>

          {mode === 'recover' && (
            <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Enter the recovery code you saved when you set up the account. It works once, and it
              issues you a brand-new signing key — your old hands stay verifiable either way.
            </div>
          )}

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
            {mode === 'recover' && (
              <Input
                placeholder="Recovery code (XXXXXX-XXXXXX-…)"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                disabled={busy}
                required
                className="font-mono tracking-wider"
              />
            )}
            <Input
              placeholder={mode === 'recover' ? 'New password' : 'Password'}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              disabled={busy}
              required
              minLength={6}
            />
            {mode === 'recover' && (
              <Input
                placeholder="Repeat new password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
                required
                minLength={6}
              />
            )}
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <Button
              type="submit"
              className={phase === 'success' ? 'w-full bg-emerald-500 hover:bg-emerald-500' : 'w-full'}
              disabled={busy}
            >
              {phase === 'deriving' ? (
                <Spinner label="Deriving your keys…" />
              ) : phase === 'submitting' ? (
                <Spinner
                  label={
                    mode === 'register'
                      ? 'Creating account…'
                      : mode === 'recover'
                        ? 'Recovering…'
                        : 'Signing in…'
                  }
                />
              ) : phase === 'success' ? (
                joinCode ? (
                  '✓ Seating you at the table…'
                ) : mode === 'register' ? (
                  '✓ Account created. Dealing you in…'
                ) : (
                  '✓ Signed in. Dealing you in…'
                )
              ) : (
                cta
              )}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'recover' ? 'login' : 'recover');
              setError(null);
              setConfirm('');
              setRecoveryCode('');
            }}
            className="mt-3 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {mode === 'recover' ? '← Back to log in' : 'Forgot your password?'}
          </button>

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
