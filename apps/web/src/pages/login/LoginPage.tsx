import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setAuth = useStore((s) => s.setAuth);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // scrypt is intentionally slow; yield a frame so the spinner paints first
      await new Promise((r) => setTimeout(r, 30));
      const authKey = deriveAuthKey(username, password);
      const identity = deriveIdentity(username, password);
      const res =
        mode === 'register'
          ? await api.register(username, authKey, identity.publicKey)
          : await api.login(username, authKey);
      setAuth({ token: res.token, userId: res.userId, username, identity });
      nav('/lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
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
              required
              minLength={6}
            />
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner label="Deriving keys…" /> : mode === 'login' ? 'Log in' : 'Create account'}
            </Button>
          </form>
          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            Your password also derives your card-signing key in this browser. It is never sent to the
            server.
          </p>
        </Panel>
      </div>
    </div>
  );
}
