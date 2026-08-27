import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CaretLeft, CaretRight, DownloadSimple, FilmSlate, SkipBack } from '@phosphor-icons/react';
import { renderReplayGif } from '../../features/share/replayGif.ts';
import { api } from '../../shared/api.ts';
import { buildReplay, type Replay } from '../../shared/replay.ts';
import { fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Panel, Spinner } from '../../shared/ui/index.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { useStore } from '../../shared/store.ts';
import { RoundTable } from '../../widgets/table/RoundTable.tsx';
import type { SeatView } from '../../widgets/table/players.tsx';

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
  const [record, setRecord] = useState<unknown>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const auth = useStore((s) => s.auth);

  useEffect(() => {
    void Promise.all([api.hand(roomId!, handId!), api.getRoom(roomId!)]).then(([hand, room]) => {
      setReplay(buildReplay(hand.entries));
      const ps = room.players as RoomPlayer[];
      setPlayers(new Map(ps.map((p) => [p.userId, p])));
      // the saved game: the full signed transcript plus who's who, enough to
      // re-verify offline or cut a broadcast video from
      // (requested by notpritam, docs/FEATURES.md)
      setRecord({
        game: '4AM Casino hand record',
        roomId,
        handId: hand.handId,
        head: hand.head,
        ts: hand.ts,
        players: ps.map((p) => ({ userId: p.userId, username: p.username, displayName: p.displayName })),
        entries: hand.entries,
      });
    });
  }, [roomId, handId]);

  // one animated GIF of the whole hand, sized for a tweet
  // (requested by notpritam, docs/FEATURES.md)
  const [gifBusy, setGifBusy] = useState<string | null>(null);
  const shareGif = async () => {
    if (!replay || gifBusy) return;
    try {
      const nameOf = (seat: number) => {
        const uid = replay.seats.find((s) => s.seat === seat)?.userId;
        return (uid !== undefined && players.get(uid)?.displayName) || `Seat ${seat + 1}`;
      };
      const roomName = 'the 4AM table';
      const blob = await renderReplayGif(replay, nameOf, roomName, (done, total) =>
        setGifBusy(`${done}/${total}`),
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `4am-hand-${handId?.slice(0, 8)}.gif`;
      a.click();
      URL.revokeObjectURL(a.href);
      // the GIF downloads; the intent opens with the words - attach and post
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(
          'This hand at 4AM Casino ♠ provably fair poker with friends - poker.notpritam.in',
        )}`,
        '_blank',
      );
    } finally {
      setGifBusy(null);
    }
  };

  const saveRecord = () => {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `4am-hand-${handId?.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

  /** Translate one replay step into the shape the live table renders. */
  const seatViews: SeatView[] = useMemo(() => {
    if (!replay || !step) return [];
    // blind positions, standard rules: heads-up the button posts the small
    const order = replay.seats.map((s) => s.seat).sort((a, b) => a - b);
    const bi = Math.max(0, order.indexOf(replay.buttonSeat));
    const heads = order.length === 2;
    const sbSeat = heads ? replay.buttonSeat : order[(bi + 1) % order.length];
    const bbSeat = order[(bi + (heads ? 1 : 2)) % order.length];

    return replay.seats.map((s) => {
      const info = players.get(s.userId);
      const es = step.betting?.seats.find((x) => x.seat === s.seat);
      const award = step.awards?.find((a) => a.seat === s.seat);
      return {
        seat: s.seat,
        userId: s.userId,
        username: info?.username ?? `seat${s.seat + 1}`,
        displayName: info?.displayName ?? `Seat ${s.seat + 1}`,
        avatarVersion: info?.avatarVersion ?? 0,
        stack: es ? es.stack : s.stack,
        isButton: replay.buttonSeat === s.seat,
        isSB: sbSeat === s.seat,
        isBB: bbSeat === s.seat,
        isToAct: step.actor === s.seat,
        folded: !!es?.folded,
        allIn: !!es && es.stack === 0 && !es.folded,
        inHand: true,
        broke: false,
        sittingOut: false,
        isLeader: false,
        // a recording has no live presence, so nobody is dimmed as offline
        connected: true,
        speaking: false,
        voiceMuted: false,
        revealed: step.reveals[s.seat],
        won: !!award && award.amount > 0,
        pendingBuy: 0,
        lastAction: step.lastActions[s.seat],
      };
    });
  }, [replay, step, players]);

  // if the viewer played this hand, their seat rotates to the bottom exactly as
  // it does at a live table, and their cards sit where they always sit
  const mySeat = useMemo(
    () => replay?.seats.find((s) => s.userId === auth.userId)?.seat ?? null,
    [replay, auth.userId],
  );
  const myCards = (mySeat !== null && step?.reveals[mySeat]) || [];
  const committedBySeat = useMemo(() => {
    const out: Record<number, number> = {};
    for (const s of step?.betting?.seats ?? []) out[s.seat] = s.committed;
    return out;
  }, [step]);

  if (!replay || !step) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Rebuilding hand from its transcript…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
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
        {replay.tv && <Badge tone="amber">TV replay</Badge>}
        <Button
          variant="secondary"
          className="ml-auto"
          onClick={() => void shareGif()}
          disabled={!!gifBusy}
          title="Renders the whole hand as a GIF, downloads it, and opens a tweet - attach the GIF and post"
        >
          <FilmSlate size={15} weight="bold" className="mr-1 inline" />
          {gifBusy ? `GIF ${gifBusy}…` : 'GIF for Twitter'}
        </Button>
        <Button variant="secondary" onClick={saveRecord} disabled={!record}>
          <DownloadSimple size={15} weight="bold" className="mr-1 inline" />
          Save hand
        </Button>
      </header>
      <p className="text-sm text-slate-500">
        {replay.tv
          ? 'Everyone revealed their hand key after this hand, so every hole card is visible - broadcast style.'
          : 'Rebuilt from the signed transcript, showing only what was public. Folded cards stay secret forever.'}
      </p>

      {/* The felt itself. Same widget the live table uses, fed from the
          transcript instead of a socket, so a replay looks like the hand looked
          rather than like a report about it. */}
      <section className="rounded-3xl bg-gradient-to-b from-slate-100 to-slate-200/70 p-3 dark:from-slate-900 dark:to-slate-950">
        <RoundTable
          seats={seatViews}
          mySeat={mySeat}
          myUserId={auth.userId}
          myCards={myCards}
          committedBySeat={committedBySeat}
          urgent={false}
          handLive={step.awards === null}
          canSit={false}
          onSit={() => {}}
          canKick={false}
          onKick={() => {}}
          bankerId={0}
          hostId={null}
          coBankerId={null}
          bb={replay.bb}
        >
          <div className="rounded-xl bg-indigo-600 px-5 py-1.5 font-display text-lg font-bold text-white shadow-lg">
            POT {fmt(pot)}
          </div>
          <div className="flex gap-1.5 md:gap-2">
            {[0, 1, 2, 3, 4].map((i) =>
              step.board[i] !== undefined ? (
                <PlayingCard key={`${i}-${step.board[i]}`} card={step.board[i]} size="md" deal />
              ) : (
                <div
                  key={i}
                  className="h-20 w-14 rounded-lg border-2 border-dashed border-slate-400/40 md:h-24 md:w-[4.2rem] md:rounded-xl dark:border-slate-600/50"
                />
              ),
            )}
          </div>
          {step.board2.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-fuchsia-500">
                Run 2
              </span>
              {step.board2.map((c) => (
                <PlayingCard key={`r2-${c}`} card={c} size="sm" deal />
              ))}
            </div>
          )}
          <div className="rounded-full bg-white/80 px-4 py-1.5 text-sm font-semibold text-slate-700 shadow-sm dark:bg-slate-800/90 dark:text-slate-200">
            {step.label}
          </div>
        </RoundTable>
      </section>

      {/* controls */}
      <Panel className="flex flex-wrap items-center gap-2.5">
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
          className="min-w-32 flex-1 accent-indigo-600"
          aria-label="replay position"
        />
        <span className="w-16 text-right text-xs text-slate-400">
          {idx + 1} / {last + 1}
        </span>
      </Panel>
    </div>
  );
}
