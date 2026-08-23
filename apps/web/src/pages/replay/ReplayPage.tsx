import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CaretLeft, CaretRight, SkipBack } from '@phosphor-icons/react';
import { api } from '../../shared/api.ts';
import { buildReplay, type Replay } from '../../shared/replay.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Panel, Spinner } from '../../shared/ui/index.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { Avatar } from '../../entities/user/Avatar.tsx';

interface RoomPlayer {
  userId: number;
  username: string;
  displayName: string;
  avatarVersion: number;
}

export function ReplayPage() {
  const { id: roomId, handId } = useParams<{ id: string; handId: string }>();
  const [replay, setReplay] = useState<Replay | null>(null);
  const [players, setPlayers] = useState<Map<number, RoomPlayer>>(new Map());
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    void Promise.all([api.hand(roomId!, handId!), api.getRoom(roomId!)]).then(([hand, room]) => {
      setReplay(buildReplay(hand.entries));
      setPlayers(new Map((room.players as RoomPlayer[]).map((p) => [p.userId, p])));
    });
  }, [roomId, handId]);

  const step = replay?.steps[idx] ?? null;
  const last = (replay?.steps.length ?? 1) - 1;

  useEffect(() => {
    if (!playing || !replay) return;
    if (idx >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIdx((i) => Math.min(i + 1, last)), 1300);
    return () => clearTimeout(t);
  }, [playing, idx, last, replay]);

  const pot = useMemo(
    () => (step?.betting ? step.betting.seats.reduce((s, x) => s + x.total, 0) : 0),
    [step],
  );

  if (!replay || !step) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Rebuilding hand from its transcript…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-center gap-3">
        <Link
          to={`/room/${roomId}/hands`}
          className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        >
          ← Hands
        </Link>
        <h1 className="font-display text-xl font-bold">Replay</h1>
        <span className="font-mono text-xs text-slate-400">{handId?.slice(0, 8)}</span>
        <Badge tone="slate">
          blinds {replay.sb}/{replay.bb}
        </Badge>
      </header>
      <p className="text-sm text-slate-500">
        Rebuilt from the signed transcript, showing only what was public. Folded cards stay secret forever.
      </p>

      {/* board */}
      <Panel className="flex flex-col items-center gap-4">
        <div className="rounded-xl bg-indigo-600 px-5 py-1.5 font-display text-lg font-bold text-white">
          POT {fmt(pot)}
        </div>
        <div className="flex gap-2">
          {[0, 1, 2, 3, 4].map((i) =>
            step.board[i] !== undefined ? (
              <PlayingCard key={`${i}-${step.board[i]}`} card={step.board[i]} size="md" deal />
            ) : (
              <div key={i} className="h-24 w-[4.2rem] rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700" />
            ),
          )}
        </div>
        <div className="text-sm font-medium text-slate-600 dark:text-slate-300">{step.label}</div>
      </Panel>

      {/* seats */}
      <div className="space-y-2">
        {replay.seats.map((s) => {
          const info = players.get(s.userId);
          const es = step.betting?.seats.find((x) => x.seat === s.seat);
          const award = step.awards?.find((a) => a.seat === s.seat);
          const revealed = step.reveals[s.seat];
          return (
            <div
              key={s.seat}
              className={cn(
                'flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200/70 dark:bg-slate-900 dark:ring-slate-700/70',
                step.actor === s.seat && 'ring-2 ring-indigo-500',
                es?.folded && 'opacity-45',
              )}
            >
              <Avatar
                userId={s.userId}
                name={info?.displayName ?? `Seat ${s.seat + 1}`}
                version={info?.avatarVersion ?? 0}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {info?.displayName ?? `Seat ${s.seat + 1}`}
                  {replay.buttonSeat === s.seat && <span className="ml-1.5 text-xs text-slate-400">(D)</span>}
                </div>
                <div className="font-display text-xs text-slate-500">
                  {fmt(es ? es.stack : s.stack)}
                  {es && es.committed > 0 && <span className="ml-2 text-indigo-500">bet {fmt(es.committed)}</span>}
                </div>
              </div>
              {es?.folded && <Badge tone="rose">FOLDED</Badge>}
              {award && award.amount > 0 && <Badge tone="emerald">+{fmt(award.amount)}</Badge>}
              <div className="flex gap-1">
                {revealed ? (
                  revealed.map((c) => <PlayingCard key={c} card={c} size="xs" deal />)
                ) : es && !es.folded ? (
                  <>
                    <PlayingCard faceDown size="xs" />
                    <PlayingCard faceDown size="xs" />
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* controls */}
      <Panel className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => setIdx(0)} aria-label="restart">
          <SkipBack size={16} weight="fill" />
        </Button>
        <Button variant="secondary" onClick={() => setIdx((i) => Math.max(0, i - 1))} aria-label="back">
          <CaretLeft size={16} weight="bold" />
        </Button>
        <Button onClick={() => (idx >= last ? (setIdx(0), setPlaying(true)) : setPlaying((p) => !p))}>
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button variant="secondary" onClick={() => setIdx((i) => Math.min(last, i + 1))} aria-label="forward">
          <CaretRight size={16} weight="bold" />
        </Button>
        <input
          type="range"
          min={0}
          max={last}
          value={idx}
          onChange={(e) => setIdx(+e.target.value)}
          className="flex-1 accent-indigo-600"
          aria-label="replay position"
        />
        <span className="w-16 text-right text-xs text-slate-400">
          {idx + 1} / {last + 1}
        </span>
      </Panel>
    </div>
  );
}
