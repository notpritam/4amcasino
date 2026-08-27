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
      {/* Container queries, not viewport ones. These cards also render inside
          the "Room standings" dialog, which is a fraction of the screen wide -
          with `2xl:grid-cols-3` a wide monitor forced three columns into it, so
          each name column collapsed to about one character wide and wrapped
          letter-by-letter. The columns now follow the space actually available. */}
      <div className="@container">
      <div className="grid gap-2.5 @2xl:grid-cols-2 @5xl:grid-cols-3">
      {rows.map((r, i) => (
        <Link
          key={r.userId}
          to={`/players/${r.userId}`}
          className="flex items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200/70 transition-shadow hover:shadow-md dark:bg-slate-900 dark:ring-slate-700/70"
        >
          {/* the standing lives ON the avatar, so the name gets the room */}
          <span className="relative shrink-0">
            <Avatar
              userId={r.userId}
              name={r.displayName ?? r.username}
              version={r.avatarVersion}
              size="md"
            />
            <span
              className={cn(
                'absolute -bottom-1 -right-1.5 flex min-w-6 items-center justify-center rounded-full px-1 py-0.5 font-display text-[0.68rem] font-bold ring-2 ring-white dark:ring-slate-900',
                i === 0
                  ? 'bg-amber-400 text-amber-950'
                  : i === 1
                    ? 'bg-slate-300 text-slate-800'
                    : i === 2
                      ? 'bg-amber-700 text-amber-50'
                      : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
              )}
            >
              #{i + 1}
            </span>
          </span>
          <span className="min-w-0 flex-1">
            {/* break-all was what let a squeezed column split mid-word into one
                letter per line; a long name now wraps at words or truncates */}
            <span className="block truncate font-semibold leading-snug" title={r.displayName ?? r.username}>
              {r.displayName ?? r.username}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">
              {r.handsPlayed} hand{r.handsPlayed === 1 ? '' : 's'}
              {r.biggestWin > 0 && <> · best +{fmt(r.biggestWin)}</>}
            </span>
            {minHands > 0 && r.handsPlayed < minHands && (
              <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                {minHands - r.handsPlayed} more to qualify
              </span>
            )}
          </span>
          <span
            className={cn(
              'shrink-0 font-display text-xl font-bold tabular-nums',
              r.net > 0 ? 'text-emerald-600' : r.net < 0 ? 'text-rose-600' : 'text-slate-400',
            )}
          >
            {r.net > 0 ? '+' : ''}
            {fmt(r.net)}
          </span>
        </Link>
      ))}
      </div>
      </div>
    </div>
  );
}

export function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);

  useEffect(() => {
    api.leaderboard().then((r) => setRows(r.rows));
  }, []);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-4 md:p-6">
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
