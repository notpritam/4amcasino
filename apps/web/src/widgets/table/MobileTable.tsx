import { useEffect, useState } from 'react';
import NumberFlow from '@number-flow/react';
import {
  HAND_CATEGORY_NAMES,
  evaluate5,
  evaluate7,
  handCategory,
  legalActions,
  rankOf,
  type CardId,
} from '@4am/shared';
import { act, showMyCards, startHand } from '../../shared/gameClient.ts';
import { useStore } from '../../shared/store.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { Avatar } from '../../entities/user/Avatar.tsx';
import type { SeatView } from './players.tsx';

/** Offsuit-style phone table: flat dark canvas, opponents in a top row,
 *  huge board cards, bare pot number, ghost-pill actions, giant hole cards. */

function strengthLabel(myCards: CardId[], board: CardId[]): string | null {
  if (myCards.length < 2) return null;
  const all = [...myCards, ...board];
  if (all.length < 5) {
    return rankOf(myCards[0]!) === rankOf(myCards[1]!) ? 'Pair' : 'High Card';
  }
  let best = 0;
  if (all.length === 7) best = evaluate7(all);
  else if (all.length === 5) best = evaluate5(all);
  else for (let skip = 0; skip < all.length; skip++) best = Math.max(best, evaluate5(all.filter((_, i) => i !== skip)));
  return HAND_CATEGORY_NAMES[handCategory(best)] ?? null;
}

function OpponentColumn({ p, urgent }: { p: SeatView; urgent: boolean }) {
  const engineCommitted = useStore(
    (s) => s.hand.betting?.seats.find((x) => x.seat === p.seat)?.committed ?? 0,
  );
  return (
    <div
      className={cn(
        'flex w-16 shrink-0 flex-col items-center gap-1 rounded-2xl px-1 pt-1.5',
        p.isToAct && 'turn-stripes-dark bg-indigo-500/10 ring-1 ring-indigo-400/50',
        p.isToAct && urgent && 'turn-stripes-dark-rose bg-rose-500/10 ring-rose-400/60',
        (p.folded || !p.connected) && 'opacity-40',
        p.broke && 'opacity-50 saturate-50',
      )}
    >
      <div className="relative">
        <Avatar
          userId={p.userId}
          name={p.displayName}
          version={p.avatarVersion}
          size="md"
          speaking={p.speaking}
          className={cn(
            p.isToAct && 'ring-2 ring-indigo-400',
            p.isToAct && urgent && 'ring-rose-500 animate-urgent',
            p.won && 'animate-winner',
          )}
        />
        {p.isButton && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[0.55rem] font-bold text-slate-900">
            D
          </span>
        )}
        {p.lastAction && (
          <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-950/90 px-2 py-0.5 text-[0.6rem] font-semibold capitalize text-white ring-1 ring-white/20">
            {p.lastAction.type}
          </span>
        )}
        {p.inHand && p.revealed && (
          <div className="absolute -right-3 -top-2 flex gap-0.5">
            {p.revealed.map((c) => (
              <PlayingCard key={c} card={c} size="xs" deal />
            ))}
          </div>
        )}
      </div>
      <div className="max-w-full truncate text-xs font-medium text-white/80">{p.displayName}</div>
      <div className={cn('font-display text-sm font-bold', p.broke ? 'text-rose-400' : 'text-white')}>
        <NumberFlow value={p.stack} />
      </div>
      <div className="h-6">
        {p.broke && (
          <span className="rounded-full bg-rose-500/20 px-1.5 py-px text-[0.55rem] font-bold uppercase text-rose-300">
            out
          </span>
        )}
        {engineCommitted > 0 && (
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/10 px-1.5 font-display text-xs font-bold text-amber-300">
            {fmt(engineCommitted)}
          </span>
        )}
      </div>
    </div>
  );
}

function MobileActions({ mySeat, isHost, statusText }: { mySeat: number | null; isHost: boolean; statusText: string | null }) {
  const hand = useStore((s) => s.hand);
  const room = useStore((s) => s.room);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [sentAtSeq, setSentAtSeq] = useState<number | null>(null);
  const [showSentFor, setShowSentFor] = useState<string | null>(null);

  const st = hand.betting;
  const la = st ? legalActions(st) : null;
  const handOver = hand.result !== null || hand.abort !== null;
  const myTurn = la !== null && la.seat === mySeat && !handOver;
  const handIdle = !hand.handId || handOver;
  const sb = room?.room.sb ?? 1;
  const pot = st ? st.seats.reduce((s, x) => s + x.total, 0) : 0;

  useEffect(() => {
    if (myTurn && la) setRaiseTo(la.minRaiseTo);
    if (!myTurn) setRaiseOpen(false);
  }, [myTurn, la?.minRaiseTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = sentAtSeq !== null;
  useEffect(() => {
    if (sentAtSeq !== null && (hand.actionSeq !== sentAtSeq || !myTurn)) setSentAtSeq(null);
  }, [hand.actionSeq, myTurn, sentAtSeq]);
  useEffect(() => {
    if (sentAtSeq === null) return;
    const t = setTimeout(() => setSentAtSeq(null), 6000);
    return () => clearTimeout(t);
  }, [sentAtSeq]);
  const send = (a: Parameters<typeof act>[0]) => {
    setSentAtSeq(hand.actionSeq);
    act(a);
  };

  const ghost =
    'flex-1 rounded-full border border-white/25 px-4 py-3 text-center text-sm font-semibold text-white active:scale-[0.98]';

  const myStack = room?.players.find((pl) => pl.seat === mySeat)?.stack ?? 0;

  // voluntary card show: available once you folded, or when the hand is over
  const iFolded = !!st?.seats.find((s) => s.seat === mySeat)?.folded;
  const dealtIn = mySeat !== null && hand.seats.some((s) => s.seat === mySeat) && hand.myCards.length > 0;
  const alreadyPublic =
    mySeat !== null &&
    (!!hand.shown[mySeat] || !!hand.showdown?.reveals.some((r) => r.seat === mySeat));
  const canShow = dealtIn && !alreadyPublic && (iFolded || handOver);
  const showBtn = canShow ? (
    <button
      disabled={showSentFor === hand.handId}
      onClick={() => {
        setShowSentFor(hand.handId);
        showMyCards();
      }}
      className="mx-auto block rounded-full border border-white/25 px-4 py-1.5 text-xs font-semibold text-white/80 active:scale-[0.98] disabled:opacity-50"
    >
      Show cards
    </button>
  ) : null;

  if (handIdle) {
    return (
      <div className="space-y-2">
        {showBtn}
        {mySeat !== null && myStack === 0 ? (
          <p className="py-2 text-center text-sm font-semibold text-rose-300">
            You are out of chips. Buy points from the bank (menu, top right).
          </p>
        ) : isHost ? (
          <button onClick={startHand} className="w-full rounded-full bg-white py-3 text-sm font-bold text-slate-900 active:scale-[0.98]">
            Start hand
          </button>
        ) : (
          <p className="py-2 text-center text-sm text-white/50">Waiting for the host to deal.</p>
        )}
      </div>
    );
  }

  if (!myTurn || !la || !st) {
    return (
      <div className="space-y-2">
        {showBtn}
        <p className="py-2 text-center text-sm text-white/50">{statusText ?? 'Waiting…'}</p>
      </div>
    );
  }

  const potRaise = (frac: number) => {
    const target = st.currentBet + Math.round((pot + la.callAmount) * frac);
    return Math.min(Math.max(Math.round(target / sb) * sb, la.minRaiseTo), la.maxRaiseTo);
  };

  return (
    <div className="space-y-2.5">
      {raiseOpen && la.canRaise && (
        <div className="space-y-2.5 rounded-2xl bg-white/5 p-3">
          <div className="flex gap-1.5">
            {[
              { label: 'Min', value: la.minRaiseTo },
              { label: '½ pot', value: potRaise(0.5) },
              { label: 'Pot', value: potRaise(1) },
              { label: 'All-in', value: la.maxRaiseTo },
            ].map((q) => (
              <button
                key={q.label}
                onClick={() => setRaiseTo(q.value)}
                className={cn(
                  'flex-1 rounded-full px-2 py-1.5 text-xs font-semibold',
                  raiseTo === q.value ? 'bg-white text-slate-900' : 'bg-white/10 text-white/80',
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={la.minRaiseTo}
            max={la.maxRaiseTo}
            step={sb}
            value={raiseTo}
            onChange={(e) => setRaiseTo(+e.target.value)}
            className="w-full accent-white"
            aria-label="Raise amount"
          />
          <button
            disabled={pending}
            onClick={() => send(st.currentBet === 0 ? { type: 'bet', amount: raiseTo } : { type: 'raise', amount: raiseTo })}
            className="w-full rounded-full bg-white py-2.5 text-sm font-bold text-slate-900 active:scale-[0.98] disabled:opacity-50"
          >
            {st.currentBet === 0 ? `Bet ${fmt(raiseTo)}` : `Raise to ${fmt(raiseTo)}`}
          </button>
        </div>
      )}
      {pending && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-white/60">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-white" />
          Sending…
        </p>
      )}
      <div className={cn('flex gap-2', pending && 'pointer-events-none opacity-50')}>
        <button onClick={() => send({ type: 'fold' })} className={cn(ghost, 'border-rose-500/40 text-rose-300')}>
          Fold
        </button>
        <button onClick={() => send(la.canCheck ? { type: 'check' } : { type: 'call' })} className={ghost}>
          {la.canCheck ? 'Check' : `Call ${fmt(la.callAmount)}`}
        </button>
        {la.canRaise && (
          <button
            onClick={() => setRaiseOpen((v) => !v)}
            className={cn(ghost, raiseOpen && 'border-white bg-white/10')}
          >
            Raise
          </button>
        )}
      </div>
    </div>
  );
}

export function MobileTable({
  opponents,
  me,
  mySeat,
  isHost,
  myCards,
  board,
  pot,
  urgent,
  statusText,
}: {
  opponents: SeatView[];
  me: SeatView | undefined;
  mySeat: number | null;
  isHost: boolean;
  myCards: CardId[];
  board: CardId[];
  pot: number;
  urgent: boolean;
  statusText: string | null;
}) {
  const myCommitted = useStore(
    (s) => s.hand.betting?.seats.find((x) => x.seat === mySeat)?.committed ?? 0,
  );
  const strength = me && me.inHand ? strengthLabel(myCards, board) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3 text-white">
      {/* opponents */}
      <div className="flex justify-center gap-2 overflow-x-auto pb-1">
        {opponents.length === 0 ? (
          <p className="py-3 text-sm text-white/50">Waiting for friends to sit down…</p>
        ) : (
          opponents.map((p) => <OpponentColumn key={p.seat} p={p} urgent={urgent} />)
        )}
      </div>

      {/* board */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="flex gap-1.5">
          {[0, 1, 2, 3, 4].map((i) =>
            board[i] !== undefined ? (
              <PlayingCard key={`${i}-${board[i]}`} card={board[i]} size="md" deal className="shadow-lg" />
            ) : (
              <div key={i} className="card-hatch h-24 w-[4.2rem] rounded-xl shadow-lg" />
            ),
          )}
        </div>
        <div className="flex w-full items-baseline justify-end gap-2 pr-2">
          <span className="text-xs uppercase tracking-wide text-white/40">pot</span>
          <span className="font-display text-3xl font-bold">
            <NumberFlow value={pot} />
          </span>
        </div>
      </div>

      {/* my bet chip */}
      <div className="h-8 pl-1">
        {myCommitted > 0 && (
          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-white/10 px-2 font-display text-sm font-bold text-amber-300">
            {fmt(myCommitted)}
          </span>
        )}
      </div>

      {/* actions */}
      <MobileActions mySeat={mySeat} isHost={isHost} statusText={statusText} />

      {/* hole cards + identity tile */}
      <div className="mt-4 flex items-end justify-between gap-3">
        <div className={cn('flex', me?.folded && 'opacity-40')}>
          {me && me.inHand && (myCards.length > 0 || !me.folded) ? (
            myCards.length ? (
              myCards.map((c, i) => (
                <PlayingCard key={c} card={c} size="xl" deal className={cn('shadow-2xl', i === 1 && '-ml-7')} />
              ))
            ) : (
              <>
                <PlayingCard faceDown size="xl" />
                <PlayingCard faceDown size="xl" className="-ml-7" />
              </>
            )
          ) : null}
        </div>
        {me && (
          <div
            className={cn(
              'flex min-w-28 flex-col items-center gap-1 rounded-2xl border border-white/20 px-4 py-3',
              me.isToAct && 'turn-stripes-dark border-indigo-400 bg-indigo-500/10',
              me.isToAct && urgent && 'turn-stripes-dark-rose border-rose-500 bg-rose-500/10 animate-urgent',
              me.won && 'animate-winner',
            )}
          >
            {strength && <span className="text-xs font-semibold text-white/80">{strength}</span>}
            <Avatar userId={me.userId} name={me.displayName} version={me.avatarVersion} size="sm" speaking={me.speaking} />
            <span className={cn('font-display text-lg font-bold', me.broke && 'text-rose-400')}>
              <NumberFlow value={me.stack} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
