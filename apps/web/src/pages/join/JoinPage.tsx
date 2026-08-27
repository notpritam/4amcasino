import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import { setPendingJoin } from '../../shared/pendingJoin.ts';
import { useStore } from '../../shared/store.ts';
import { Button, Panel, Spinner } from '../../shared/ui/index.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { cardFromName } from '@4am/shared';

/** `/j/CODE` - the shareable table link (requested by notpritam,
 *  docs/FEATURES.md). Logged in, it joins and forwards you to the felt. Logged
 *  out, it parks the code and sends you through login first. */
export function JoinPage() {
  const { code = '' } = useParams();
  const token = useStore((s) => s.auth.token);
  const username = useStore((s) => s.auth.username);
  const logout = useStore((s) => s.logout);
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // StrictMode double-invokes effects in dev; joining twice is harmless but the
  // flash of a second request is not worth it
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!clean) {
      setError('that link is missing its table code');
      return;
    }
    if (!token) {
      setPendingJoin(clean);
      nav(`/login?join=${clean}`, { replace: true });
      return;
    }
    api
      .joinRoom(clean)
      .then((room) => nav(`/room/${room.id}`, { replace: true }))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'could not join that table'),
      );
  }, [code, token, nav]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex items-end justify-center gap-1.5">
          {['As', 'Kh'].map((n, i) => (
            <PlayingCard
              key={n}
              card={cardFromName(n)}
              size="sm"
              className={i ? 'rotate-6' : '-rotate-6'}
            />
          ))}
        </div>
        <Panel>
          {error ? (
            <>
              <h1 className="font-display text-lg font-semibold">Couldn't join</h1>
              <p className="mt-1 text-sm text-slate-500">{error}</p>
              <p className="mt-3 font-mono text-xs tracking-widest text-slate-400">
                {code.toUpperCase()}
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <Button onClick={() => nav('/lobby')}>Go to the lobby</Button>
                {username && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      logout();
                      nav(`/login?join=${code.toUpperCase()}`, { replace: true });
                    }}
                  >
                    Signed in as {username} — use a different account
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <Spinner label="Taking you to the table…" />
              <p className="mt-3 font-mono text-xs tracking-widest text-slate-400">
                {code.toUpperCase()}
              </p>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
