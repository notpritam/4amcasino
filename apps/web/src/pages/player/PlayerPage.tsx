import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle, HandCoins, UserPlus } from '@phosphor-icons/react';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Dialog, Panel, Spinner } from '../../shared/ui/index.tsx';
import { Avatar } from '../../entities/user/Avatar.tsx';
import { StyleRadar } from '../../features/stats/charts.tsx';

interface DebtRow {
  roomId: string;
  roomName: string;
  otherUserId: number;
  otherName: string;
  otherAvatarVersion: number;
  direction: 'owe' | 'owed';
  amount: number;
  myConfirmed: boolean;
  otherConfirmed: boolean;
}

interface SettledRow {
  roomId: string;
  roomName: string;
  otherUserId: number;
  otherName: string;
  direction: 'owe' | 'owed';
  amount: number;
  ts: number;
}

/** Who you owe and who owes you, across every room, with two-sided
 *  "we settled" confirmation - the game's real conclusion, right on your
 *  profile (requested by notpritam, docs/FEATURES.md). */
function SettleUpPanel() {
  const [debts, setDebts] = useState<DebtRow[] | null>(null);
  const [settled, setSettled] = useState<SettledRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () =>
    api.myDebts().then((r) => {
      setDebts(r.debts as DebtRow[]);
      setSettled(r.settled as SettledRow[]);
    });
  useEffect(() => {
    void load();
  }, []);
  if (debts === null) return null;
  if (debts.length === 0 && settled.length === 0) return null;
  return (
    <Panel>
      <h2 className="mb-1 font-display font-semibold">Settle up</h2>
      <p className="mb-3 text-xs text-slate-500">
        Once you have squared a debt outside the app, both of you mark it settled and it clears
        here too.
      </p>
      <div className="space-y-2">
        {debts.map((d) => {
          const key = `${d.roomId}:${d.otherUserId}`;
          return (
            <div
              key={key}
              className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"
            >
              <Avatar
                userId={d.otherUserId}
                name={d.otherName}
                version={d.otherAvatarVersion}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  {d.direction === 'owe' ? (
                    <>
                      You owe <b>{d.otherName}</b>{' '}
                      <span className="font-display font-bold text-rose-600">{fmt(d.amount)}</span>
                    </>
                  ) : (
                    <>
                      <b>{d.otherName}</b> owes you{' '}
                      <span className="font-display font-bold text-emerald-600">
                        {fmt(d.amount)}
                      </span>
                    </>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {d.roomName}
                  {d.otherConfirmed && !d.myConfirmed && ' · they marked it settled - confirm?'}
                  {d.myConfirmed && !d.otherConfirmed && ` · waiting for ${d.otherName} to confirm`}
                </div>
              </div>
              <Button
                variant={d.otherConfirmed && !d.myConfirmed ? 'primary' : 'secondary'}
                disabled={d.myConfirmed || busy === key}
                onClick={() => {
                  setBusy(key);
                  void api
                    .markSettled(d.roomId, d.otherUserId)
                    .then(load)
                    .finally(() => setBusy(null));
                }}
              >
                {d.myConfirmed ? '✓ marked' : 'Mark settled'}
              </Button>
            </div>
          );
        })}
        {settled.map((d, i) => (
          <div
            key={`done-${i}`}
            className="flex items-center gap-2.5 rounded-xl p-2.5 text-sm text-slate-500"
          >
            <CheckCircle size={17} weight="fill" className="shrink-0 text-emerald-500" />
            <span className="min-w-0 flex-1 truncate">
              {d.direction === 'owe' ? `You paid ${d.otherName}` : `${d.otherName} paid you`}{' '}
              {fmt(d.amount)} · {d.roomName}
            </span>
            <span className="text-xs">{new Date(d.ts).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Befriend and send points to this player from their profile - the sending
 *  itself rides an existing shared room's ledger
 *  (requested by notpritam, docs/FEATURES.md). */
function PlayerActions({ userId, name }: { userId: number; name: string }) {
  const [friendState, setFriendState] = useState<'none' | 'sent' | 'friends'>('none');
  const [sendOpen, setSendOpen] = useState(false);
  const [rooms, setRooms] = useState<{ id: string; name: string; myStack: number; handActive: boolean }[]>([]);
  const [roomId, setRoomId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void api.friends().then((r) => {
      const has = (list: unknown) =>
        ((list as { userId: number }[] | undefined) ?? []).some((x) => x.userId === userId);
      if (has(r.friends)) setFriendState('friends');
      else if (has(r.outgoing)) setFriendState('sent');
    }).catch(() => {});
    void api.sharedRooms(userId).then((r) => {
      setRooms(r.rooms);
      if (r.rooms[0]) setRoomId(r.rooms[0].id);
    }).catch(() => {});
  }, [userId]);
  const room = rooms.find((r) => r.id === roomId);
  const amt = Math.floor(Number(amount)) || 0;
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        disabled={friendState !== 'none'}
        onClick={() =>
          void api
            .addFriend(name)
            .then(() => setFriendState('sent'))
            .catch((e) => setNote(e instanceof Error ? e.message : 'could not send'))
        }
      >
        <UserPlus size={16} className="mr-1 inline" />
        {friendState === 'friends' ? 'Friends ✓' : friendState === 'sent' ? 'Request sent' : 'Add friend'}
      </Button>
      {rooms.length > 0 && (
        <Button variant="secondary" onClick={() => setSendOpen(true)}>
          <HandCoins size={16} className="mr-1 inline" />
          Send points
        </Button>
      )}
      {note && <span className="text-xs text-slate-500">{note}</span>}
      <Dialog open={sendOpen} onClose={() => setSendOpen(false)} title={`Send points to ${name}`}>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">From your stack in</span>
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · you have {fmt(r.myStack)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Amount</span>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              placeholder="points"
            />
          </label>
          {room?.handActive && (
            <p className="text-xs text-amber-600">
              A hand is running at that table - sends land between hands.
            </p>
          )}
          {note && <p className="text-xs text-rose-600">{note}</p>}
          <Button
            className="w-full"
            disabled={!room || amt <= 0 || amt > (room?.myStack ?? 0)}
            onClick={() =>
              void api
                .transfer(roomId, userId, amt)
                .then(() => {
                  setSendOpen(false);
                  setNote(null);
                })
                .catch((e) => setNote(e instanceof Error ? e.message : 'could not send'))
            }
          >
            Send {fmt(amt)}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

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
  const myUserId = useStore((s) => s.auth.userId);
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

      {myUserId === p.userId ? (
        <SettleUpPanel />
      ) : (
        <Panel>
          <PlayerActions userId={p.userId} name={p.username} />
        </Panel>
      )}

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
