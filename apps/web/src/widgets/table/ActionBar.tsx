import { useEffect, useMemo, useState } from 'react';
import NumberFlow from '@number-flow/react';
import { legalActions, type PlayerAction } from '@4am/shared';
import { act, showMyCards, startHand } from '../../shared/gameClient.ts';
import { useStore } from '../../shared/store.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Coins, HourglassMedium, Wallet } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/index.tsx';
import { myToCall, togglePreAction } from '../../features/table/preActions.ts';

export function ActionBar({
  mySeat,
  isHost,
  urgent,
  hideIdleStart = false,
}: {
  mySeat: number | null;
  isHost: boolean;
  urgent: boolean;
  hideIdleStart?: boolean;
}) {
  const hand = useStore((s) => s.hand);
  const room = useStore((s) => s.room);
  const [raiseTo, setRaiseTo] = useState(0);

  const st = hand.betting;
  const la = useMemo(() => (st ? legalActions(st) : null), [st]);
  const handOver = hand.result !== null || hand.abort !== null;
  const myTurn = la !== null && la.seat === mySeat && !handOver;
  const me = st?.seats.find((s) => s.seat === mySeat);
  const roomMe = room?.players.find((p) => p.seat === mySeat);
  const balance = me && !handOver ? me.stack : (roomMe?.stack ?? 0);
  // session position vs what was bought from the bank (stable during a hand)
  const bought = roomMe?.totalBought ?? 0;
  const net = (roomMe?.stack ?? 0) - bought;
  const pot = st ? st.seats.reduce((s, x) => s + x.total, 0) : 0;

  useEffect(() => {
    if (myTurn && la) setRaiseTo(la.minRaiseTo);
  }, [myTurn, la?.minRaiseTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const handIdle = !hand.handId || handOver;
  const sb = room?.room.sb ?? 1;

  // voluntary card show: available once you folded, or when the hand is over
  const iFolded = !!st?.seats.find((s) => s.seat === mySeat)?.folded;
  const dealtIn =
    mySeat !== null && hand.seats.some((s) => s.seat === mySeat) && hand.myCards.length > 0;
  const alreadyPublic =
    mySeat !== null &&
    (!!hand.shown[mySeat] || !!hand.showdown?.reveals.some((r) => r.seat === mySeat));
  const canShow = dealtIn && !alreadyPublic && (iFolded || handOver);
  const [showSentFor, setShowSentFor] = useState<string | null>(null);

  // pre-select an action before your turn; the game client fires it when you are to act
  const canPreAct = !handIdle && !iFolded && dealtIn && !myTurn && !!st;

  // players still in the hand whose connection dropped: the hand holds for them
  const disconnected =
    !handIdle && room
      ? hand.seats
          .filter((s) => !hand.betting?.seats.find((b) => b.seat === s.seat)?.folded)
          .filter((s) => room.players.some((p) => p.userId === s.userId && !p.connected))
          .map((s) => room.players.find((p) => p.userId === s.userId)?.displayName ?? s.username)
      : [];

  // pending: an action left this device but the table has not updated yet
  const [sentAtSeq, setSentAtSeq] = useState<number | null>(null);
  const pending = sentAtSeq !== null;
  useEffect(() => {
    if (sentAtSeq !== null && (hand.actionSeq !== sentAtSeq || !myTurn)) setSentAtSeq(null);
  }, [hand.actionSeq, myTurn, sentAtSeq]);
  useEffect(() => {
    if (sentAtSeq === null) return;
    const t = setTimeout(() => setSentAtSeq(null), 6000);
    return () => clearTimeout(t);
  }, [sentAtSeq]);
  const send = (a: PlayerAction) => {
    setSentAtSeq(hand.actionSeq);
    act(a);
  };

  /** Sensible raise-to for a fraction of the pot (pot counted after our call). */
  const potRaise = (frac: number): number => {
    if (!la || !st) return 0;
    const target = st.currentBet + Math.round((pot + la.callAmount) * frac);
    const snapped = Math.round(target / sb) * sb;
    return Math.min(Math.max(snapped, la.minRaiseTo), la.maxRaiseTo);
  };

  const quicks =
    la && st
      ? [
          { label: 'Min', value: la.minRaiseTo },
          { label: '⅓ pot', value: potRaise(1 / 3) },
          { label: '½ pot', value: potRaise(1 / 2) },
          { label: '¾ pot', value: potRaise(3 / 4) },
          { label: 'Pot', value: potRaise(1) },
          { label: 'All-in', value: la.maxRaiseTo },
        ]
      : [];

  return (
    <div
      className={cn(
        'rounded-2xl p-4',
        myTurn
          ? 'bg-indigo-600 text-white shadow-[0_18px_50px_rgba(79,70,229,0.2)]'
          : 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/70 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700/70',
        myTurn && urgent && 'animate-urgent',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-16" title="Your bet this street">
          <Coins
            size={15}
            className={myTurn ? 'text-indigo-200' : 'text-slate-400'}
            aria-label="Your bet"
          />
          <div className="font-display text-2xl font-bold">
            <NumberFlow value={me?.committed ?? 0} />
          </div>
        </div>

        {myTurn && la ? (
          <>
            {la.canRaise && (
              <div className="flex min-w-72 flex-1 flex-col gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {quicks.map((q) => (
                    <button
                      key={q.label}
                      disabled={pending}
                      onClick={() =>
                        send(
                          st!.currentBet === 0
                            ? { type: 'bet', amount: q.value }
                            : { type: 'raise', amount: q.value },
                        )
                      }
                      className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white hover:text-indigo-700 disabled:opacity-50"
                    >
                      {q.label} · {fmt(q.value)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-display text-sm">{fmt(la.minRaiseTo)}</span>
                  <input
                    type="range"
                    min={la.minRaiseTo}
                    max={la.maxRaiseTo}
                    step={sb}
                    value={raiseTo}
                    onChange={(e) => setRaiseTo(+e.target.value)}
                    className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-indigo-400 accent-white"
                    aria-label="Raise amount"
                  />
                  <span className="font-display text-sm">{fmt(la.maxRaiseTo)}</span>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              {pending && (
                <span className="flex items-center gap-1.5 text-xs text-indigo-100">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Sending…
                </span>
              )}
              <Button
                variant="secondary"
                className="border-0 bg-white/15! text-white! hover:bg-white/25! dark:bg-white/15! dark:text-white! dark:hover:bg-white/25!"
                disabled={pending}
                onClick={() => send({ type: 'fold' })}
              >
                Fold
              </Button>
              <Button
                variant="success"
                disabled={pending}
                onClick={() => send(la.canCheck ? { type: 'check' } : { type: 'call' })}
              >
                {la.canCheck ? 'Check' : `Call ${fmt(la.callAmount)}`}
              </Button>
              {la.canRaise && (
                <Button
                  variant="secondary"
                  className="border-0 bg-white! text-indigo-700! hover:bg-indigo-50! dark:bg-white! dark:text-indigo-700! dark:hover:bg-indigo-50!"
                  disabled={pending}
                  onClick={() =>
                    send(
                      st!.currentBet === 0
                        ? { type: 'bet', amount: Math.min(raiseTo, la.maxRaiseTo) }
                        : { type: 'raise', amount: Math.min(raiseTo, la.maxRaiseTo) },
                    )
                  }
                >
                  {st!.currentBet === 0 ? `Bet ${fmt(raiseTo)}` : `Raise to ${fmt(raiseTo)}`}
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className={cn('flex-1 text-sm', myTurn ? 'text-indigo-100' : 'text-slate-500')}>
            {handIdle
              ? balance === 0
                ? 'Out of chips. Chips menu → Buy points.'
                : hand.autoDealAt && hand.autoDealAt > Date.now()
                  ? 'Auto-dealing…'
                  : isHost
                    ? 'Deal when ready.'
                    : 'Host deals soon…'
              : disconnected.length > 0
                ? `Holding ~40s for ${disconnected.join(', ')}…`
                : st
                  ? `${
                      room?.players.find((p) => p.seat === st.toAct)?.displayName ??
                      `Seat ${st.toAct !== null ? st.toAct + 1 : '-'}`
                    }…`
                  : 'Shuffling…'}
          </div>
        )}

        {canPreAct && (
          <div className="flex items-center gap-2">
            <HourglassMedium size={15} className="text-slate-400" aria-label="Ahead of turn" />
            <button
              onClick={() => togglePreAction('call-any', st!, mySeat!)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                hand.preAction === 'call-any'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
              )}
            >
              Call any
            </button>
            {(() => {
              const toCall = myToCall(st!, mySeat!);
              const armedFold = hand.preAction === 'check-fold';
              const armedCall = hand.preAction === 'call' || hand.preAction === 'check';
              return (
                <>
                  <Button
                    variant="secondary"
                    className={cn(armedFold && 'ring-2 ring-indigo-500')}
                    title="Arms now, acts on your turn"
                    onClick={() => togglePreAction('check-fold', st!, mySeat!)}
                  >
                    {toCall > 0 ? 'Fold' : 'Check / Fold'}
                  </Button>
                  <Button
                    variant="success"
                    className={cn('opacity-90', armedCall && 'ring-2 ring-indigo-500')}
                    title="Arms now, acts on your turn"
                    onClick={() => togglePreAction(toCall > 0 ? 'call' : 'check', st!, mySeat!)}
                  >
                    {toCall > 0 ? `Call ${fmt(toCall)}` : 'Check'}
                  </Button>
                  <Button variant="secondary" disabled title="Raising unlocks on your turn">
                    Raise
                  </Button>
                </>
              );
            })()}
          </div>
        )}

        {canShow && (
          <Button
            variant="secondary"
            className={cn(
              myTurn &&
                'border-0 bg-white/15! text-white! hover:bg-white/25! dark:bg-white/15! dark:text-white! dark:hover:bg-white/25!',
            )}
            disabled={showSentFor === hand.handId}
            onClick={() => {
              setShowSentFor(hand.handId);
              showMyCards();
            }}
          >
            Show cards
          </Button>
        )}

        {handIdle && isHost && !hideIdleStart && (
          <Button
            variant="secondary"
            className="border-0 bg-white! text-indigo-700! dark:bg-white! dark:text-indigo-700!"
            onClick={startHand}
          >
            Start hand
          </Button>
        )}

        <div className="ml-auto text-right" title={`Your balance. Bought ${fmt(bought)} total.`}>
          <Wallet
            size={15}
            className={cn('ml-auto', myTurn ? 'text-indigo-200' : 'text-slate-400')}
            aria-label="Your balance"
          />
          <div
            className={cn(
              'font-display text-2xl font-bold',
              balance === 0 && (myTurn ? 'text-rose-300' : 'text-rose-500'),
            )}
          >
            <NumberFlow value={balance} />
          </div>
          {bought > 0 && (
            <div
              className={cn(
                'font-display text-xs font-bold',
                net >= 0
                  ? myTurn
                    ? 'text-emerald-300'
                    : 'text-emerald-600 dark:text-emerald-400'
                  : myTurn
                    ? 'text-rose-300'
                    : 'text-rose-600 dark:text-rose-400',
              )}
            >
              {net >= 0 ? `+${fmt(net)}` : `−${fmt(-net)}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
