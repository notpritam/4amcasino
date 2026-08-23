import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Panel, Spinner } from '../../shared/ui/index.tsx';
import { Avatar } from '../../entities/user/Avatar.tsx';

export interface LeaderboardRow {
  userId: number;
  username: string;
  displayName: string | null;
  avatarVersion: number;
  net: number;
  handsPlayed: number;
  biggestWin: number;
}

export function LeaderboardTable({ rows, minHands = 0 }: { rows: LeaderboardRow[]; minHands?: number }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No settled hands yet. Deal one and come back.</p>;
  }
  return (
    <div className="space-y-2">
      {minHands > 0 && (
        <p className="text-xs text-slate-400">
          Winnings count in settle-up after {minHands} hand{minHands === 1 ? '' : 's'} played.
        </p>
      )}
      {rows.map((r, i) => (
        <Link
          key={r.userId}
          to={`/players/${r.userId}`}
          className="flex items-center gap-4 rounded-xl bg-white p-3 ring-1 ring-slate-200/70 transition-shadow hover:shadow-md dark:bg-slate-900 dark:ring-slate-700/70"
        >
          <span
            className={cn(
              'w-8 text-center font-display text-lg font-bold',
              i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-700' : 'text-slate-300',
            )}
          >
            {i + 1}
          </span>
          <Avatar userId={r.userId} name={r.displayName ?? r.username} version={r.avatarVersion} size="sm" />
          <span className="min-w-0 flex-1 truncate font-medium">{r.displayName ?? r.username}</span>
          <span className="hidden text-xs text-slate-400 sm:block">{r.handsPlayed} hand{r.handsPlayed === 1 ? '' : 's'}</span>
          {minHands > 0 && r.handsPlayed < minHands && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              {minHands - r.handsPlayed} more to qualify
            </span>
          )}
          {r.biggestWin > 0 && (
            <span className="hidden text-xs text-slate-400 sm:block">best +{fmt(r.biggestWin)}</span>
          )}
          <span
            className={cn(
              'font-display text-lg font-bold',
              r.net > 0 ? 'text-emerald-600' : r.net < 0 ? 'text-rose-600' : 'text-slate-400',
            )}
          >
            {r.net > 0 ? '+' : ''}
            {fmt(r.net)}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);

  useEffect(() => {
    api.leaderboard().then((r) => setRows(r.rows));
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-xl font-bold">Leaderboard</h1>
      </header>
      <p className="text-sm text-slate-500">
        All-time net points from settled hands, across every room on this server.
      </p>
      {rows === null ? (
        <Panel>
          <Spinner label="Loading standings…" />
        </Panel>
      ) : (
        <LeaderboardTable rows={rows} />
      )}
    </div>
  );
}
