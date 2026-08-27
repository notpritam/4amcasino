import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  CaretDown,
  CaretRight,
  CheckCircle,
  HandCoins,
  UserPlus,
} from '@phosphor-icons/react';
import type { CardId } from '@4am/shared';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Dialog, Panel, Spinner } from '../../shared/ui/index.tsx';
import { Avatar } from '../../entities/user/Avatar.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
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

interface HandHistoryRow {
  handId: string;
  roomId: string;
  roomName: string;
  ts: number;
  net: number;
  outcome: string;
  board: CardId[];
  myCards: CardId[] | null;
  voided: boolean;
}

const SETTLE_OPEN_KEY = '4am-settle-open';

/** Who you owe and who owes you - grouped per room, each room collapsible
 *  with its bottom line in the header, so twenty debts read like five rooms.
 *  Both sides mark "settled" and it resolves on the platform too
 *  (requested by notpritam, docs/FEATURES.md). */
function SettleUpPanel() {
  const [debts, setDebts] = useState<DebtRow[] | null>(null);
  const [settled, setSettled] = useState<SettledRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(SETTLE_OPEN_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
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

  const rooms = new Map<string, { name: string; rows: DebtRow[] }>();
  for (const d of debts) {
    const g = rooms.get(d.roomId) ?? { name: d.roomName, rows: [] };
    g.rows.push(d);
    rooms.set(d.roomId, g);
  }
  const toggle = (roomId: string) => {
    const next = new Set(open);
    if (next.has(roomId)) next.delete(roomId);
    else next.add(roomId);
    setOpen(next);
    localStorage.setItem(SETTLE_OPEN_KEY, JSON.stringify([...next]));
  };

  return (
    <Panel>
      <h2 className="mb-1 font-display font-semibold">Settle up</h2>
      <p className="mb-3 text-xs text-slate-500">
        Square the debt outside the app, then both of you mark it settled and it clears here too.
      </p>
      <div className="space-y-1.5">
        {[...rooms.entries()].map(([roomId, g]) => {
          const owedToMe = g.rows.filter((d) => d.direction === 'owed').reduce((s, d) => s + d.amount, 0);
          const iOwe = g.rows.filter((d) => d.direction === 'owe').reduce((s, d) => s + d.amount, 0);
          const net = owedToMe - iOwe;
          const isOpen = open.has(roomId);
          return (
            <div
              key={roomId}
              className="overflow-hidden rounded-xl ring-1 ring-slate-200/70 dark:ring-slate-700/60"
            >
              <button
                onClick={() => toggle(roomId)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2.5 bg-slate-50 px-3.5 py-2.5 text-left hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800"
              >
                {isOpen ? (
                  <CaretDown size={13} className="shrink-0 text-slate-400" />
                ) : (
                  <CaretRight size={13} className="shrink-0 text-slate-400" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.name}</span>
                <span className="text-xs text-slate-400">
                  {g.rows.length} debt{g.rows.length === 1 ? '' : 's'}
                </span>
                <span
                  className={cn(
                    'font-display text-sm font-bold',
                    net > 0 ? 'text-emerald-600' : net < 0 ? 'text-rose-600' : 'text-slate-400',
                  )}
                >
                  {net > 0 ? '+' : ''}
                  {fmt(net)}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-1.5 p-2">
                  {g.rows.map((d) => {
                    const key = `${d.roomId}:${d.otherUserId}`;
                    return (
                      <div key={key} className="flex flex-wrap items-center gap-3 rounded-lg p-1.5">
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
                                <span className="font-display font-bold text-rose-600">
                                  {fmt(d.amount)}
                                </span>
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
                          {(d.myConfirmed || d.otherConfirmed) && (
                            <div className="text-xs text-slate-500">
                              {d.otherConfirmed && !d.myConfirmed && 'they marked it settled - confirm?'}
                              {d.myConfirmed && !d.otherConfirmed && `waiting for ${d.otherName} to confirm`}
                            </div>
                          )}
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
                </div>
              )}
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
  const [rooms, setRooms] = useState<
    { id: string; name: string; myStack: number; handActive: boolean }[]
  >([]);
  const [roomId, setRoomId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void api
      .friends()
      .then((r) => {
        const has = (list: unknown) =>
          ((list as { userId: number }[] | undefined) ?? []).some((x) => x.userId === userId);
        if (has(r.friends)) setFriendState('friends');
        else if (has(r.outgoing)) setFriendState('sent');
      })
      .catch(() => {});
    void api
      .sharedRooms(userId)
      .then((r) => {
        setRooms(r.rooms);
        if (r.rooms[0]) setRoomId(r.rooms[0].id);
      })
      .catch(() => {});
  }, [userId]);
  const room = rooms.find((r) => r.id === roomId);
  const amt = Math.floor(Number(amount)) || 0;
  return (
    <div className="flex w-full flex-col gap-2">
      <Button
        variant="secondary"
        className="w-full"
        disabled={friendState !== 'none'}
        onClick={() =>
          void api
            .addFriend(name)
            .then(() => setFriendState('sent'))
            .catch((e) => setNote(e instanceof Error ? e.message : 'could not send'))
        }
      >
        <UserPlus size={16} className="mr-1 inline" />
        {friendState === 'friends'
          ? 'Friends ✓'
          : friendState === 'sent'
            ? 'Request sent'
            : 'Add friend'}
      </Button>
      {rooms.length > 0 && (
        <Button variant="secondary" className="w-full" onClick={() => setSendOpen(true)}>
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

/** The history rail: hands first - each row is an outcome with YOUR cards,
 *  expandable to the board and a replay link - then the raw money moves on a
 *  second tab. The active tab lives in the URL (requested by notpritam). */
function HistoryRail({ own, transactions }: { own: boolean; transactions: PlayerProfile['transactions'] }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'money' || !own ? 'money' : 'hands';
  const [hands, setHands] = useState<HandHistoryRow[] | null>(null);
  const [openHand, setOpenHand] = useState<string | null>(null);
  useEffect(() => {
    if (own) void api.handHistory().then((r) => setHands(r.hands as HandHistoryRow[]));
  }, [own]);
  const money = useMemo(
    () => transactions.filter((t) => t.kind !== 'hand-settlement').slice(0, 40),
    [transactions],
  );
  const setTab = (t: 'hands' | 'money') => {
    const next = new URLSearchParams(params);
    if (t === 'hands') next.delete('tab');
    else next.set('tab', 'money');
    setParams(next, { replace: true });
  };

  return (
    <Panel className="p-0">
      <div className="flex items-center gap-1 border-b border-slate-100 px-3 pt-3 dark:border-slate-800">
        {own && (
          <button
            onClick={() => setTab('hands')}
            className={cn(
              'rounded-t-lg px-3 py-2 text-sm font-semibold',
              tab === 'hands'
                ? 'border-b-2 border-indigo-500 text-slate-900 dark:text-white'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300',
            )}
          >
            Hands
          </button>
        )}
        <button
          onClick={() => setTab('money')}
          className={cn(
            'rounded-t-lg px-3 py-2 text-sm font-semibold',
            tab === 'money'
              ? 'border-b-2 border-indigo-500 text-slate-900 dark:text-white'
              : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300',
          )}
        >
          Money moves
        </button>
      </div>

      {tab === 'hands' ? (
        hands === null ? (
          <p className="p-4 text-sm text-slate-400">Loading hands…</p>
        ) : hands.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No hands on record yet.</p>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-800/70">
            {hands.map((h) => {
              const isOpen = openHand === h.handId;
              return (
                <div key={h.handId}>
                  <button
                    onClick={() => setOpenHand(isOpen ? null : h.handId)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <span className="flex shrink-0 gap-0.5">
                      {h.myCards ? (
                        h.myCards.map((c) => <PlayingCard key={c} card={c} size="xs" />)
                      ) : (
                        <>
                          <PlayingCard faceDown size="xs" />
                          <PlayingCard faceDown size="xs" />
                        </>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {h.outcome}
                        {h.voided && (
                          <span className="ml-1.5 text-xs font-normal text-slate-400">(voided)</span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {h.roomName} ·{' '}
                        {new Date(h.ts).toLocaleString(undefined, {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'font-display text-sm font-bold',
                        h.net > 0 ? 'text-emerald-600' : h.net < 0 ? 'text-rose-600' : 'text-slate-400',
                      )}
                    >
                      {h.net > 0 ? '+' : ''}
                      {fmt(h.net)}
                    </span>
                    {isOpen ? (
                      <CaretDown size={12} className="shrink-0 text-slate-400" />
                    ) : (
                      <CaretRight size={12} className="shrink-0 text-slate-400" />
                    )}
                  </button>
                  {isOpen && (
                    <div className="space-y-2 bg-slate-50/60 px-3.5 py-2.5 dark:bg-slate-800/40">
                      {h.board.length > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="mr-1 text-[0.65rem] uppercase tracking-wide text-slate-400">
                            board
                          </span>
                          {h.board.map((c) => (
                            <PlayingCard key={c} card={c} size="xs" />
                          ))}
                        </div>
                      )}
                      <Link
                        to={`/room/${h.roomId}/replay/${h.handId}`}
                        className="inline-block text-xs font-semibold text-indigo-600 dark:text-indigo-400"
                      >
                        Full replay →
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="divide-y divide-slate-50 dark:divide-slate-800/70">
          {money.length === 0 && <p className="p-4 text-sm text-slate-400">Nothing yet.</p>}
          {money.map((t, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3.5 py-2 text-sm">
              <Badge tone={t.kind === 'purchase' ? 'indigo' : t.kind === 'commission' ? 'amber' : 'slate'}>
                {t.kind}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
                {t.roomName}
                {t.note ? ` · ${t.note}` : ''} ·{' '}
                {new Date(t.ts).toLocaleString(undefined, {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span
                className={cn(
                  'font-display font-semibold',
                  t.delta > 0 ? 'text-emerald-600' : 'text-rose-600',
                )}
              >
                {t.delta > 0 ? '+' : ''}
                {fmt(t.delta)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function StatRow({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="flex items-baseline justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <span
        className={cn(
          'font-display text-xl font-bold',
          tone === 'up' && 'text-emerald-600',
          tone === 'down' && 'text-rose-600',
        )}
      >
        {value}
      </span>
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

  const own = myUserId === p.userId;

  // the whole screen works for a living: identity on the left, the money and
  // the game in the middle, history down the right - no more single skinny
  // column (Linear-style layout requested by notpritam, docs/FEATURES.md)
  return (
    <div className="mx-auto max-w-[1440px] p-4 md:p-6">
      <div className="grid items-start gap-5 lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)_400px]">
        {/* left rail: who this is */}
        <div className="space-y-5">
          <Panel>
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="relative">
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
                <div className="text-sm text-slate-400">@{p.username}</div>
                {rank !== null && (
                  <div className="mt-1 text-xs font-semibold text-indigo-500 dark:text-indigo-300">
                    #{rank} on the leaderboard
                  </div>
                )}
                <div className="mt-1 text-xs text-slate-400">
                  joined {new Date(p.createdAt).toLocaleDateString()}
                </div>
                {p.bio && (
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{p.bio}</p>
                )}
              </div>
            </div>
          </Panel>
          <div className="space-y-2">
            <StatRow
              label="Net points"
              value={`${p.stats.net > 0 ? '+' : ''}${fmt(p.stats.net)}`}
              tone={p.stats.net > 0 ? 'up' : p.stats.net < 0 ? 'down' : undefined}
            />
            <StatRow label="Hands played" value={fmt(p.stats.handsPlayed)} />
            <StatRow
              label="Biggest win"
              value={p.stats.biggestWin > 0 ? `+${fmt(p.stats.biggestWin)}` : '0'}
              tone={p.stats.biggestWin > 0 ? 'up' : undefined}
            />
          </div>
          {!own && <PlayerActions userId={p.userId} name={p.username} />}
        </div>

        {/* middle: the money and the game */}
        <div className="min-w-0 space-y-5">
          {own && <SettleUpPanel />}
          {style && style.hands > 0 && (
            <Panel>
              <div className="mb-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="font-display font-semibold">Play style</h2>
                <Badge
                  tone={
                    style.archetype === 'The shark'
                      ? 'emerald'
                      : style.archetype === 'The calling station'
                        ? 'amber'
                        : 'indigo'
                  }
                >
                  {style.archetype}
                </Badge>
                <span className="text-xs text-slate-400">
                  from {fmt(style.hands)} public hand transcripts
                </span>
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
                    Reaches showdown in <b>{style.showdownPct}%</b> of hands and wins{' '}
                    <b>{style.winPct}%</b>.
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
                  <Link
                    key={r.userId}
                    to={`/players/${r.userId}`}
                    className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    {i === 0 && <Badge tone="amber">top rival</Badge>}
                    <Avatar userId={r.userId} name={r.displayName} version={r.avatarVersion} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.displayName}</span>
                    <span className="text-xs text-slate-400">
                      {r.handsTogether} hand{r.handsTogether === 1 ? '' : 's'} together
                    </span>
                    <span
                      className={cn(
                        'font-display text-sm font-bold',
                        r.netVs > 0
                          ? 'text-emerald-600'
                          : r.netVs < 0
                            ? 'text-rose-600'
                            : 'text-slate-400',
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
        </div>

        {/* right rail: history */}
        <div className="min-w-0 lg:col-span-2 xl:col-span-1">
          <HistoryRail own={own} transactions={p.transactions} />
        </div>
      </div>
    </div>
  );
}
