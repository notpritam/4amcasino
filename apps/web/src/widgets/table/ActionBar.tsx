import { useEffect, useMemo, useState } from 'react';
import NumberFlow from '@number-flow/react';
import { legalActions, type PlayerAction } from '@4am/shared';
import { act, showMyCards, startHand } from '../../shared/gameClient.ts';
import { useStore } from '../../shared/store.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Button } from '../../shared/ui/index.tsx';

const PRE_ACTIONS = [
  { key: 'check-fold', label: 'Check / Fold' },
  { key: 'check', label: 'Check' },
  { key: 'call-any', label: 'Call any' },
] as const;

export function ActionBar({ mySeat, isHost, urgent }: { mySeat: number | null; isHost: boolean; urgent: boolean }) {
  const hand = useStore((s) => s.hand);
  const room = useStore((s) => s.room);
  const patchHand = useStore((s) => s.patchHand);
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
  const dealtIn = mySeat !== null && hand.seats.some((s) => s.seat === mySeat) && hand.myCards.length > 0;
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
          .map(
            (s) => room.players.find((p) => p.userId === s.userId)?.displayName ?? s.username,
          )
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

  const quicks = la && st
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
    <div className={cn('rounded-2xl bg-indigo-600 p-4 text-white shadow-lg', myTurn && urgent && 'animate-urgent')}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-24">
          <div className="text-xs uppercase tracking-wide text-indigo-200">Your bet</div>
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
                      onClick={() => setRaiseTo(q.value)}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                        raiseTo === q.value
                          ? 'bg-white text-indigo-700'
                          : 'bg-white/15 text-white hover:bg-white/25',
                      )}
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
                className="border-0 bg-white/15 text-white hover:bg-white/25 dark:bg-white/15 dark:text-white dark:hover:bg-white/25"
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
                  className="border-0 bg-white text-indigo-700 hover:bg-indigo-50 dark:bg-white dark:text-indigo-700 dark:hover:bg-indigo-50"
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
          <div className="flex-1 text-sm text-indigo-100">
            {handIdle
              ? balance === 0
                ? 'You are out of chips. Buy points from the bank (top right) to keep playing.'
                : isHost
                  ? 'Deal when everyone is seated.'
                  : 'Waiting for the host to deal.'
              : disconnected.length > 0
                ? `${disconnected.join(', ')} lost connection. Holding the hand about 40 seconds for them to rejoin…`
                : st
                  ? `Waiting for ${
                      room?.players.find((p) => p.seat === st.toAct)?.displayName ??
                      `seat ${st.toAct !== null ? st.toAct + 1 : '-'}`
                    }…`
                  : 'Shuffling: everyone is encrypting the deck…'}
          </div>
        )}

        {canPreAct && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs uppercase tracking-wide text-indigo-200">Ahead of turn</span>
            {PRE_ACTIONS.map((pa) => (
              <button
                key={pa.key}
                onClick={() => patchHand({ preAction: hand.preAction === pa.key ? null : pa.key })}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                  hand.preAction === pa.key
                    ? 'bg-white text-indigo-700'
                    : 'bg-white/15 text-white hover:bg-white/25',
                )}
              >
                {pa.label}
              </button>
            ))}
          </div>
        )}

        {canShow && (
          <Button
            variant="secondary"
            className="border-0 bg-white/15 text-white hover:bg-white/25 dark:bg-white/15 dark:text-white dark:hover:bg-white/25"
            disabled={showSentFor === hand.handId}
            onClick={() => {
              setShowSentFor(hand.handId);
              showMyCards();
            }}
          >
            Show cards
          </Button>
        )}

        {handIdle && isHost && (
          <Button
            variant="secondary"
            className="border-0 bg-white text-indigo-700 dark:bg-white dark:text-indigo-700"
            onClick={startHand}
          >
            Start hand
          </Button>
        )}

        <div className="ml-auto text-right">
          <div className="text-xs uppercase tracking-wide text-indigo-200">Your balance</div>
          <div className={cn('font-display text-2xl font-bold', balance === 0 && 'text-rose-300')}>
            <NumberFlow value={balance} />
          </div>
          {bought > 0 && (
            <div className="text-xs text-indigo-200">
              bought {fmt(bought)} ·{' '}
              <span className={cn('font-display font-bold', net >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                {net >= 0 ? `up ${fmt(net)}` : `down ${fmt(-net)}`}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
