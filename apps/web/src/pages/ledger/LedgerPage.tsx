import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Panel, Spinner } from '../../shared/ui/index.tsx';
import { LeaderboardTable, type LeaderboardRow } from '../leaderboard/LeaderboardPage.tsx';

interface Entry {
  id: number;
  userId: number;
  username: string;
  delta: number;
  kind: string;
  approvedBy: number | null;
  note: string | null;
  ref: string | null;
  ts: number;
  entryHash: string;
}

export function LedgerPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [verified, setVerified] = useState<{ ok: boolean } | null>(null);
  const [standings, setStandings] = useState<LeaderboardRow[]>([]);

  useEffect(() => {
    api.ledger(roomId!).then((r) => {
      setEntries(r.entries);
      setVerified(r.verified);
    });
    api.roomLeaderboard(roomId!).then((r) => setStandings(r.rows)).catch(() => {});
  }, [roomId]);

  if (!entries) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading ledger…" />
      </div>
    );
  }

  const totals = new Map<string, number>();
  for (const e of entries) {
    if (e.kind === 'purchase') totals.set(e.username, (totals.get(e.username) ?? 0) + e.delta);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        <Link to={`/room/${roomId}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to table
        </Link>
        <h1 className="font-display text-xl font-bold">Bank ledger</h1>
        {verified &&
          (verified.ok ? (
            <Badge tone="emerald">chain verified</Badge>
          ) : (
            <Badge tone="rose">TAMPERED: hashes do not match</Badge>
          ))}
      </header>

      <Panel>
        <h2 className="mb-3 font-display font-semibold">Table standings</h2>
        <LeaderboardTable rows={standings} />
      </Panel>

      <Panel>
        <h2 className="mb-3 font-display font-semibold">Bought from the bank (to settle up)</h2>
        {totals.size === 0 ? (
          <p className="text-sm text-slate-500">No purchases yet.</p>
        ) : (
          <div className="space-y-1">
            {[...totals.entries()].map(([name, total]) => (
              <div key={name} className="flex justify-between text-sm">
                <span>{name}</span>
                <span className="font-display font-semibold">{fmt(total)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3 text-right">Delta</th>
              <th className="px-4 py-3">Note / ref</th>
              <th className="px-4 py-3">Hash</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-slate-50 dark:border-slate-800">
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
                  {new Date(e.ts).toLocaleString()}
                </td>
                <td className="px-4 py-2.5 font-medium">{e.username}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={e.kind === 'purchase' ? 'indigo' : 'slate'}>{e.kind}</Badge>
                </td>
                <td
                  className={cn(
                    'px-4 py-2.5 text-right font-display font-semibold',
                    e.delta > 0 ? 'text-emerald-600' : 'text-rose-600',
                  )}
                >
                  {e.delta > 0 ? '+' : ''}
                  {fmt(e.delta)}
                </td>
                <td className="max-w-40 truncate px-4 py-2.5 text-slate-500">
                  {e.note ?? (e.ref ? `hand ${e.ref.slice(0, 8)}` : '')}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                  {e.entryHash.slice(0, 10)}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  The ledger is empty. Buy points to start.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
