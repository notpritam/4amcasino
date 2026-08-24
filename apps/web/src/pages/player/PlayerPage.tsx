import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Panel, Spinner } from '../../shared/ui/index.tsx';
import { Avatar } from '../../entities/user/Avatar.tsx';
import { StyleRadar } from '../../features/stats/charts.tsx';

interface PlayStyle {
  hands: number;
  vpipPct: number;
  pfrPct: number;
  aggressionFactor: number;
  showdownPct: number;
  winPct: number;
  quietWinPct: number;
  foldRate: number;
  archetype: string;
}

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
  const [style, setStyle] = useState<PlayStyle | null>(null);
  const [rank, setRank] = useState<number | null>(null);

  useEffect(() => {
    api.userProfile(Number(id)).then(setP);
    api.playStyle(Number(id)).then(setStyle).catch(() => {});
    // global leaderboard position: #1, #2, #3... (absent for private mode)
    api
      .leaderboard()
      .then((r) => {
        const i = (r.rows as { userId: number }[]).findIndex((x) => x.userId === Number(id));
        setRank(i >= 0 ? i + 1 : null);
      })
      .catch(() => {});
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
      <Panel className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex min-w-[18rem] flex-1 items-center gap-5">
          <div className="relative shrink-0">
            <Avatar userId={p.userId} name={p.displayName} version={p.avatarVersion} size="xl" />
            {rank !== null && (
              <span
                title={`#${rank} on the leaderboard`}
                className={cn(
                  'absolute -bottom-1.5 -right-1.5 flex min-w-7 items-center justify-center rounded-full px-1.5 py-0.5 font-display text-xs font-bold ring-2 ring-white dark:ring-slate-900',
                  rank === 1
                    ? 'bg-amber-400 text-amber-950'
                    : rank === 2
                      ? 'bg-slate-300 text-slate-800'
                      : rank === 3
                        ? 'bg-amber-700 text-amber-50'
                        : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200',
                )}
              >
                #{rank}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-bold">{p.displayName}</h1>
            <div className="text-sm text-slate-400">
              @{p.username}
              {rank !== null && (
                <>
                  {' '}
                  · <span className="font-semibold text-indigo-500 dark:text-indigo-300">
                    #{rank} on the leaderboard
                  </span>
                </>
              )}{' '}
              · joined {new Date(p.createdAt).toLocaleDateString()}
            </div>
            {p.bio && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{p.bio}</p>}
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-3 gap-2.5">
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
      </Panel>

      {style && style.hands > 0 && (
        <Panel>
          <div className="mb-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="font-display font-semibold">Play style</h2>
            <Badge tone={style.archetype === 'The shark' ? 'emerald' : style.archetype === 'The calling station' ? 'amber' : 'indigo'}>
              {style.archetype}
            </Badge>
            <span className="text-xs text-slate-400">from {fmt(style.hands)} public hand transcripts</span>
          </div>
          <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
            <StyleRadar style={style} />
            <div className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
              <p>
                Plays <b>{style.vpipPct}%</b> of hands, raises first in <b>{style.pfrPct}%</b>.
              </p>
              <p>
                Aggression factor <b>{style.aggressionFactor}</b> (bets and raises per call).
              </p>
              <p>
                Reaches showdown in <b>{style.showdownPct}%</b> of hands and wins <b>{style.winPct}%</b>.
              </p>
              <p>
                <b>{style.quietWinPct}%</b> of wins never showed a card.
              </p>
            </div>
          </div>
        </Panel>
      )}

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
