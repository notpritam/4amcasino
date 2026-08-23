import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Panel, Spinner } from '../../shared/ui/index.tsx';
import { Avatar } from '../../entities/user/Avatar.tsx';

interface PlayerProfile {
  userId: number;
  username: string;
  displayName: string;
  bio: string;
  avatarVersion: number;
  createdAt: number;
  stats: { net: number; handsPlayed: number; biggestWin: number };
  rivals: {
    userId: number;
    username: string;
    displayName: string;
    avatarVersion: number;
    handsTogether: number;
    netVs: number;
  }[];
  transactions: {
    roomId: string;
    roomName: string;
    delta: number;
    kind: string;
    note: string | null;
    ref: string | null;
    ts: number;
  }[];
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4 text-center dark:bg-slate-800/60">
      <div
        className={cn(
          'font-display text-2xl font-bold',
          tone === 'up' && 'text-emerald-600',
          tone === 'down' && 'text-rose-600',
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

export function PlayerPage() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<PlayerProfile | null>(null);

  useEffect(() => {
    api.userProfile(Number(id)).then(setP);
  }, [id]);

  if (!p) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading player…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Link to="/lobby" className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        ← Lobby
      </Link>

      <Panel className="flex items-center gap-5">
        <Avatar userId={p.userId} name={p.displayName} version={p.avatarVersion} size="xl" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold">{p.displayName}</h1>
          <div className="text-sm text-slate-400">
            @{p.username} · joined {new Date(p.createdAt).toLocaleDateString()}
          </div>
          {p.bio && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{p.bio}</p>}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Net points"
          value={`${p.stats.net > 0 ? '+' : ''}${fmt(p.stats.net)}`}
          tone={p.stats.net > 0 ? 'up' : p.stats.net < 0 ? 'down' : undefined}
        />
        <Stat label="Hands played" value={fmt(p.stats.handsPlayed)} />
        <Stat
          label="Biggest win"
          value={p.stats.biggestWin > 0 ? `+${fmt(p.stats.biggestWin)}` : '0'}
          tone={p.stats.biggestWin > 0 ? 'up' : undefined}
        />
      </div>

      <Panel>
        <h2 className="mb-3 font-display font-semibold">Rivals</h2>
        {p.rivals.length === 0 ? (
          <p className="text-sm text-slate-500">No shared hands yet.</p>
        ) : (
          <div className="space-y-2">
            {p.rivals.map((r, i) => (
              <Link key={r.userId} to={`/players/${r.userId}`} className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                {i === 0 && <Badge tone="amber">top rival</Badge>}
                <Avatar userId={r.userId} name={r.displayName} version={r.avatarVersion} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.displayName}</span>
                <span className="text-xs text-slate-400">{r.handsTogether} hand{r.handsTogether === 1 ? '' : 's'} together</span>
                <span
                  className={cn(
                    'font-display text-sm font-bold',
                    r.netVs > 0 ? 'text-emerald-600' : r.netVs < 0 ? 'text-rose-600' : 'text-slate-400',
                  )}
                >
                  {r.netVs > 0 ? '+' : ''}
                  {fmt(r.netVs)} vs them
                </span>
              </Link>
            ))}
          </div>
        )}
      </Panel>

      <Panel className="overflow-x-auto p-0">
        <div className="px-4 pt-4 font-display font-semibold">Transaction history</div>
        <table className="mt-2 w-full text-sm">
          <tbody>
            {p.transactions.map((t, i) => (
              <tr key={i} className="border-t border-slate-50 dark:border-slate-800">
                <td className="whitespace-nowrap px-4 py-2 text-slate-400">
                  {new Date(t.ts).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-slate-500">{t.roomName}</td>
                <td className="px-4 py-2">
                  <Badge tone={t.kind === 'purchase' ? 'indigo' : 'slate'}>{t.kind}</Badge>
                </td>
                <td
                  className={cn(
                    'px-4 py-2 text-right font-display font-semibold',
                    t.delta > 0 ? 'text-emerald-600' : 'text-rose-600',
                  )}
                >
                  {t.delta > 0 ? '+' : ''}
                  {fmt(t.delta)}
                </td>
              </tr>
            ))}
            {p.transactions.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-400">Nothing yet.</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="h-3" />
      </Panel>
    </div>
  );
}
