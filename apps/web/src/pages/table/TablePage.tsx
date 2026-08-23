import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { HAND_CATEGORY_NAMES, handCategory } from '@4am/shared';
import { bindGameClient, sit } from '../../shared/gameClient.ts';
import { wsClient } from '../../shared/ws.ts';
import { useStore } from '../../shared/store.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Dialog, Panel, Spinner } from '../../shared/ui/index.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { PlayerRow, YouRow, type SeatView } from '../../widgets/table/players.tsx';
import { ActionBar } from '../../widgets/table/ActionBar.tsx';
import { ChatPanel } from '../../widgets/table/ChatPanel.tsx';
import { BankControls } from '../../widgets/table/BankControls.tsx';

function TimerPill({ deadline }: { deadline: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, []);
  if (!deadline) return null;
  const secs = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span
      className={cn(
        'rounded-full bg-white px-3 py-1 font-display text-sm font-semibold ring-1 ring-slate-200',
        secs <= 10 && 'text-rose-600 ring-rose-200',
      )}
    >
      ⏱ 0:{String(secs).padStart(2, '0')}
    </span>
  );
}

export function TablePage() {
  const { id: roomId } = useParams<{ id: string }>();
  const room = useStore((s) => s.room);
  const hand = useStore((s) => s.hand);
  const auth = useStore((s) => s.auth);
  const errors = useStore((s) => s.errors);
  const dismissError = useStore((s) => s.dismissError);
  const resetHand = useStore((s) => s.resetHand);
  const [resultOpen, setResultOpen] = useState(false);

  useEffect(() => {
    bindGameClient();
    wsClient.joinRoom(roomId!);
    return () => {
      wsClient.leaveRoom();
      useStore.getState().setRoom(null);
    };
  }, [roomId]);

  useEffect(() => {
    if (hand.result || hand.abort) setResultOpen(true);
  }, [hand.result, hand.abort]);

  useEffect(() => {
    if (errors.length === 0) return;
    const t = setTimeout(dismissError, 4000);
    return () => clearTimeout(t);
  }, [errors, dismissError]);

  const mySeat = room?.players.find((p) => p.userId === auth.userId)?.seat ?? null;
  const isHost = room?.room.hostId === auth.userId;
  const handLive = hand.handId !== null && !hand.result && !hand.abort;

  const seatViews = useMemo((): SeatView[] => {
    if (!room) return [];
    return room.players
      .filter((p) => p.seat !== null)
      .sort((a, b) => a.seat! - b.seat!)
      .map((p) => {
        const engineSeat = hand.betting?.seats.find((s) => s.seat === p.seat);
        const inHand = handLive && hand.seats.some((s) => s.seat === p.seat);
        return {
          seat: p.seat!,
          username: p.username,
          stack: engineSeat && handLive ? engineSeat.stack : p.stack,
          isButton: handLive && hand.buttonSeat === p.seat,
          isToAct: handLive && hand.betting?.toAct === p.seat,
          folded: !!engineSeat?.folded,
          allIn: !!engineSeat?.allIn,
          inHand,
          connected: p.connected,
          lastAction: hand.lastActions[p.seat!],
        };
      });
  }, [room, hand, handLive]);

  if (!room) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Joining table…" />
      </div>
    );
  }

  const pot = hand.betting ? hand.betting.seats.reduce((s, x) => s + x.total, 0) : 0;
  const me = seatViews.find((s) => s.seat === mySeat);
  const opponents = seatViews.filter((s) => s.seat !== mySeat);
  const takenSeats = new Set(seatViews.map((s) => s.seat));

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <Link to="/lobby" className="text-sm text-slate-500 hover:text-slate-800">
          ← Leave table
        </Link>
        <h1 className="font-display text-lg font-bold">{room.room.name}</h1>
        <Badge tone="indigo" className="font-display tracking-widest">
          {room.room.joinCode}
        </Badge>
        <Badge tone="slate">
          blinds {room.room.sb}/{room.room.bb}
        </Badge>
        {room.room.auditMode === 'strict-audit' && <Badge tone="amber">strict audit</Badge>}
        <TimerPill deadline={handLive ? hand.deadline : null} />
        <div className="ml-auto flex items-center gap-2">
          <BankControls roomId={roomId!} />
          <Link to={`/room/${roomId}/ledger`}>
            <Button variant="ghost">Ledger</Button>
          </Link>
          <Link to={`/room/${roomId}/hands`}>
            <Button variant="ghost">Hands</Button>
          </Link>
        </div>
      </header>

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-4">
          <div className="grid flex-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
            {/* opponents */}
            <div className="space-y-2.5">
              {opponents.length === 0 && (
                <Panel className="text-sm text-slate-500">
                  Share code <span className="font-display font-bold">{room.room.joinCode}</span> with
                  your friends.
                </Panel>
              )}
              {opponents.map((p) => (
                <PlayerRow key={p.seat} p={p} />
              ))}
            </div>

            {/* board */}
            <div className="flex flex-col items-center justify-center gap-6 rounded-3xl bg-slate-200/50 p-6 ring-1 ring-slate-200">
              <div className="rounded-xl bg-indigo-600 px-6 py-2 font-display text-xl font-bold text-white shadow">
                POT {fmt(pot)}
              </div>
              <div className="flex gap-2">
                {[0, 1, 2, 3, 4].map((i) =>
                  hand.board[i] !== undefined ? (
                    <PlayingCard key={i} card={hand.board[i]} size="lg" />
                  ) : (
                    <div
                      key={i}
                      className="h-32 w-[5.6rem] rounded-2xl border-2 border-dashed border-slate-300"
                    />
                  ),
                )}
              </div>
              {!handLive && (
                <p className="text-sm text-slate-500">
                  {mySeat === null ? 'Pick a seat to play.' : 'No hand in progress.'}
                </p>
              )}
            </div>
          </div>

          {/* you + actions */}
          {me ? (
            <YouRow p={me} cards={hand.myCards} />
          ) : (
            <Panel>
              <div className="mb-3 text-sm font-medium text-slate-600">Pick a seat</div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 9 }, (_, i) => (
                  <Button
                    key={i}
                    variant="secondary"
                    disabled={takenSeats.has(i) || handLive}
                    onClick={() => sit(i)}
                  >
                    Seat {i + 1}
                  </Button>
                ))}
              </div>
            </Panel>
          )}
          <ActionBar mySeat={mySeat} isHost={!!isHost} />
        </div>

        <div className="min-h-80">
          <ChatPanel />
        </div>
      </div>

      {/* hand result */}
      <Dialog
        open={resultOpen && (hand.result !== null || hand.abort !== null)}
        onClose={() => {
          setResultOpen(false);
          resetHand();
        }}
        title={hand.abort ? 'Hand aborted' : 'Hand complete'}
      >
        {hand.abort ? (
          <div className="space-y-2 text-sm">
            <p className="text-rose-600">{hand.abort.reason}</p>
            {hand.abort.blamedSeat !== null && (
              <p className="text-slate-600">
                Caused by seat {hand.abort.blamedSeat + 1}. Stacks were rolled back; the transcript
                names them.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {hand.showdown ? (
              <div className="space-y-2">
                {hand.showdown.reveals.map((r) => (
                  <div key={r.seat} className="flex items-center gap-3">
                    <span className="w-24 truncate text-sm font-medium">
                      {hand.seats.find((s) => s.seat === r.seat)?.username}
                    </span>
                    <div className="flex gap-1">
                      {r.cards.map((c) => (
                        <PlayingCard key={c} card={c} size="sm" />
                      ))}
                    </div>
                    <Badge tone="slate">{HAND_CATEGORY_NAMES[handCategory(r.score)]}</Badge>
                    {hand.showdown!.awards.find((a) => a.seat === r.seat) && (
                      <Badge tone="emerald">
                        +{fmt(hand.showdown!.awards.find((a) => a.seat === r.seat)!.amount)}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-600">Everyone folded — no cards were shown.</p>
            )}
            {hand.result && (
              <div className="space-y-1 border-t border-slate-100 pt-3">
                {hand.result.deltas.map((d) => (
                  <div key={d.seat} className="flex justify-between text-sm">
                    <span>{hand.seats.find((s) => s.seat === d.seat)?.username}</span>
                    <span
                      className={cn(
                        'font-display font-semibold',
                        d.delta > 0 ? 'text-emerald-600' : d.delta < 0 ? 'text-rose-600' : 'text-slate-400',
                      )}
                    >
                      {d.delta > 0 ? '+' : ''}
                      {fmt(d.delta)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* error toasts */}
      {errors.length > 0 && (
        <div className="fixed bottom-4 left-4 z-50 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
          {errors[0]}
        </div>
      )}
    </div>
  );
}
