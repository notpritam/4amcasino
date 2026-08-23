import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Crown } from '@phosphor-icons/react';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Panel, Spinner } from '../../shared/ui/index.tsx';
import { Avatar } from '../../entities/user/Avatar.tsx';

interface SessionPlayer {
  userId: number;
  username: string;
  displayName: string;
  avatarVersion: number;
  stack: number;
  seat: number | null;
  bought: number;
  handsPlayed: number;
  wins: number;
  net: number;
  biggestWin: number;
  biggestLoss: number;
  hidden: boolean;
}

interface SessionReport {
  hands: number;
  firstTs: number | null;
  lastTs: number | null;
  biggestPot: number;
  players: SessionPlayer[];
}

function fmtDur(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
    </div>
  );
}

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
  const [session, setSession] = useState<SessionReport | null>(null);
  const [bankerId, setBankerId] = useState<number | null>(null);
  const [coBankerId, setCoBankerId] = useState<number | null>(null);
  const [minSettleHands, setMinSettleHands] = useState(0);
  const [voided, setVoided] = useState(false);
  const [revertErr, setRevertErr] = useState<string | null>(null);
  const myUserId = useStore((s) => s.auth.userId);

  const load = () => {
    api.ledger(roomId!).then((r) => {
      setEntries(r.entries);
      setVerified(r.verified);
    });
    api.session(roomId!).then(setSession).catch(() => {});
    api.room(roomId!).then((r) => {
      setBankerId(r.bankerId);
      setCoBankerId(r.coBankerId ?? null);
      setMinSettleHands(r.minSettleHands ?? 0);
      setVoided(!!r.voided);
    }).catch(() => {});
  };
  useEffect(load, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function revert(entryId: number) {
    setRevertErr(null);
    try {
      await api.revertPurchase(roomId!, entryId);
      load();
    } catch (err) {
      setRevertErr(err instanceof Error ? err.message : 'could not revert');
    }
  }

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
  // purchases already compensated by a revert entry (revert.ref = purchase hash)
  const revertedHashes = new Set(entries.filter((e) => e.kind === 'revert').map((e) => e.ref));
  const voidedHands = new Set(entries.filter((e) => e.kind === 'void-hand').map((e) => e.ref));
  // the void-hand button sits on the first settlement row of each hand
  const firstOfHand = new Map<string, number>();
  for (const e of entries) {
    if (e.kind === 'hand-settlement' && e.ref && !firstOfHand.has(e.ref)) firstOfHand.set(e.ref, e.id);
  }
  const amBanker = myUserId !== null && (myUserId === bankerId || myUserId === coBankerId);

  async function voidHand(handId: string) {
    setRevertErr(null);
    try {
      await api.voidHand(roomId!, handId);
      load();
    } catch (err) {
      setRevertErr(err instanceof Error ? err.message : 'could not void the hand');
    }
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

      {session && session.hands > 0 && (
        <Panel>
          <h2 className="mb-4 font-display font-semibold">Session report</h2>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Time played"
              value={session.firstTs && session.lastTs ? fmtDur(session.lastTs - session.firstTs) : '\u2014'}
            />
            <StatTile label="Hands dealt" value={String(session.hands)} />
            <StatTile label="Biggest pot" value={fmt(session.biggestPot)} />
            <StatTile
              label="Chips on the table"
              value={fmt(session.players.reduce((sum, p) => sum + p.stack, 0))}
            />
          </div>

          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Who is winning
          </h3>
          <p className="mb-3 text-xs text-slate-400">
            Net chips won at the table. Bars to the right of the line are winnings, to the left are
            losses.
          </p>
          <div className="space-y-2">
            {(() => {
              const active = session.players.filter((p) => !p.hidden && (p.handsPlayed > 0 || p.net !== 0));
              const maxAbs = Math.max(1, ...active.map((p) => Math.abs(p.net)));
              const topId = active.find((p) => p.net > 0)?.userId;
              return active.map((p) => (
                <div key={p.userId} className="grid grid-cols-[9.5rem_1fr_5.5rem] items-center gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar userId={p.userId} name={p.displayName} version={p.avatarVersion} size="sm" />
                    <span className="truncate text-sm font-medium">{p.displayName}</span>
                    {p.userId === topId && <Crown size={14} weight="fill" className="shrink-0 text-amber-500" />}
                  </div>
                  <div className="relative h-3">
                    <span className="absolute inset-y-0 left-1/2 w-px bg-slate-300 dark:bg-slate-600" />
                    {p.net !== 0 && (
                      <span
                        className={cn(
                          'absolute inset-y-0',
                          p.net > 0
                            ? 'left-1/2 rounded-r-full bg-emerald-500'
                            : 'right-1/2 rounded-l-full bg-rose-500',
                        )}
                        style={{ width: `calc(${(Math.abs(p.net) / maxAbs) * 48}% + 2px)` }}
                      />
                    )}
                  </div>
                  <span className="text-right font-display text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {p.net > 0 ? '+' : p.net < 0 ? '\u2212' : ''}
                    {fmt(Math.abs(p.net))}
                  </span>
                </div>
              ));
            })()}
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                  <th className="py-2 pr-3">Player</th>
                  <th className="px-3 py-2 text-right">Hands</th>
                  <th className="px-3 py-2 text-right">Won</th>
                  <th className="px-3 py-2 text-right">Best pot</th>
                  <th className="px-3 py-2 text-right">Worst hit</th>
                  <th className="px-3 py-2 text-right">Bought</th>
                  <th className="px-3 py-2 text-right">Stack now</th>
                  <th className="py-2 pl-3 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {session.players.map((p) => (
                  <tr key={p.userId} className="border-b border-slate-50 dark:border-slate-800">
                    <td className="py-2.5 pr-3">
                      <span className="font-medium">{p.displayName}</span>
                      {p.hidden && (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[0.65rem] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          private
                        </span>
                      )}
                      {minSettleHands > 0 && p.handsPlayed < minSettleHands && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          {minSettleHands - p.handsPlayed} more to qualify
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-display">{p.handsPlayed}</td>
                    <td className="px-3 py-2.5 text-right font-display">{p.hidden ? '\u2014' : p.wins}</td>
                    <td className="px-3 py-2.5 text-right font-display text-emerald-600">
                      {!p.hidden && p.biggestWin > 0 ? `+${fmt(p.biggestWin)}` : '\u2014'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-display text-rose-600">
                      {!p.hidden && p.biggestLoss < 0 ? `\u2212${fmt(-p.biggestLoss)}` : '\u2014'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-display">{p.hidden ? '\u2014' : fmt(p.bought)}</td>
                    <td className="px-3 py-2.5 text-right font-display">{fmt(p.stack)}</td>
                    <td
                      className={cn(
                        'py-2.5 pl-3 text-right font-display font-bold',
                        p.hidden || p.net === 0 ? 'text-slate-400' : p.net > 0 ? 'text-emerald-600' : 'text-rose-600',
                      )}
                    >
                      {p.hidden ? '\u2014' : `${p.net > 0 ? '+' : p.net < 0 ? '\u2212' : ''}${fmt(Math.abs(p.net))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

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

      {voided && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          The banker voided this table. Nothing here counts toward leaderboards, profiles, or who
          owes whom.
        </div>
      )}
      {amBanker && (
        <Button variant="secondary" onClick={() => void api.voidRoom(roomId!, !voided).then(load)}>
          {voided ? 'Restore this table (results count again)' : 'Void this table (results stop counting)'}
        </Button>
      )}
      {revertErr && <p className="text-sm text-rose-600">Could not revert: {revertErr}</p>}
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
              {amBanker && <th className="px-4 py-3" />}
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
                {amBanker && (
                  <td className="px-4 py-2.5 text-right">
                    {e.kind === 'purchase' &&
                      (revertedHashes.has(e.entryHash) ? (
                        <Badge tone="slate">reverted</Badge>
                      ) : (
                        <Button variant="ghost" onClick={() => void revert(e.id)}>
                          Revert
                        </Button>
                      ))}
                    {e.kind === 'hand-settlement' &&
                      e.ref &&
                      firstOfHand.get(e.ref) === e.id &&
                      (voidedHands.has(e.ref) ? (
                        <Badge tone="slate">voided</Badge>
                      ) : (
                        <Button variant="ghost" onClick={() => void voidHand(e.ref!)}>
                          Void hand
                        </Button>
                      ))}
                  </td>
                )}
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={amBanker ? 7 : 6} className="px-4 py-6 text-center text-slate-400">
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
