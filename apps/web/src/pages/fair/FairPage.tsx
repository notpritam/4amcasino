// ABOUTME: Animated explainer arguing why no one, including the server, can see or fake cards.
// ABOUTME: Five steps, one visual pattern each: transform, assembly line, side-by-side, unlock convergence, hash chain.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight,
  CaretLeft,
  CaretRight,
  EyeSlash,
  LinkSimple,
  Lock,
  LockOpen,
  SealCheck,
} from '@phosphor-icons/react';
import { cardFromName } from '@4am/shared';
import { cn } from '../../shared/lib/cn.ts';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';

const PLAYERS = [
  { name: 'You', color: 'bg-indigo-500', ring: 'ring-indigo-400', text: 'text-indigo-300' },
  { name: 'Meera', color: 'bg-emerald-500', ring: 'ring-emerald-400', text: 'text-emerald-300' },
  { name: 'Ishaan', color: 'bg-amber-500', ring: 'ring-amber-400', text: 'text-amber-300' },
] as const;

const spring = { type: 'spring', stiffness: 260, damping: 24 } as const;

function SealedCard({ locks, delay = 0 }: { locks: number; delay?: number }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      className="relative h-20 w-14 shrink-0 rounded-lg bg-slate-800 ring-1 ring-white/15"
    >
      <div className="absolute inset-0 rounded-lg opacity-40 [background-image:repeating-linear-gradient(45deg,transparent_0_4px,rgba(255,255,255,0.12)_4px_6px)]" />
      <div className="absolute inset-x-0 bottom-1 flex justify-center gap-0.5">
        {PLAYERS.slice(0, locks).map((p, i) => (
          <motion.span
            key={p.name}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ ...spring, delay: delay + 0.25 + i * 0.18 }}
            className={cn('flex h-4 w-4 items-center justify-center rounded-full text-white', p.color)}
          >
            <Lock size={9} weight="bold" />
          </motion.span>
        ))}
      </div>
    </motion.div>
  );
}

/* Step 1: face-up cards flip into sealed math objects */
function StepDeck() {
  const [flipped, setFlipped] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    const t = setTimeout(() => setFlipped(true), reduce ? 0 : 1100);
    return () => clearTimeout(t);
  }, [reduce]);
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="flex items-center gap-3">
        {(['As', 'Kh', 'Qd', 'Jc'] as const).map((n, i) => (
          <motion.div key={n} style={{ perspective: 600 }}>
            <motion.div
              animate={{ rotateY: flipped ? 180 : 0 }}
              transition={{ ...spring, delay: i * 0.12 }}
              style={{ transformStyle: 'preserve-3d' }}
              className="relative"
            >
              <div style={{ backfaceVisibility: 'hidden' }}>
                <PlayingCard card={cardFromName(n)} size="md" />
              </div>
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-slate-800 ring-1 ring-white/15"
                style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
              >
                {[0, 1, 2].map((row) => (
                  <span key={row} className="font-mono text-[0.55rem] text-white/50">
                    {((0x9f3ac1 + i * 0x2b467 + row * 0x11f3d) >>> 0).toString(16).slice(0, 6)}
                  </span>
                ))}
              </div>
            </motion.div>
          </motion.div>
        ))}
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: flipped ? 1 : 0 }}
          transition={{ delay: 0.5 }}
          className="ml-2 text-white/40"
        >
          <ArrowRight size={22} />
        </motion.span>
        <motion.p
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: flipped ? 1 : 0, x: flipped ? 0 : -8 }}
          transition={{ delay: 0.6 }}
          className="max-w-40 text-sm text-white/70"
        >
          52 cards become 52 points on an elliptic curve
        </motion.p>
      </div>
      <p className="max-w-md text-center text-sm leading-relaxed text-white/60">
        There is no physical deck and no dealer. Before every hand, each card is encoded as pure
        math (a point on the ristretto255 curve). Math can be locked; paper cannot.
      </p>
    </div>
  );
}

/* Step 2: assembly line — each player adds a lock and scrambles the order */
function StepShuffle() {
  const [stage, setStage] = useState(0); // 0..3 = locks applied
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      setStage(3);
      return;
    }
    const timers = [1, 2, 3].map((i) => setTimeout(() => setStage(i), 900 * i));
    return () => timers.forEach(clearTimeout);
  }, [reduce]);
  const order = useMemo(() => {
    const orders = [
      [0, 1, 2, 3, 4],
      [3, 0, 4, 2, 1],
      [1, 4, 0, 3, 2],
      [2, 3, 1, 0, 4],
    ];
    return orders[stage]!;
  }, [stage]);
  return (
    <div className="flex flex-col items-center gap-7">
      <div className="flex items-center gap-6">
        {PLAYERS.map((p, i) => (
          <div key={p.name} className="flex flex-col items-center gap-1.5">
            <motion.div
              animate={{ scale: stage === i + 1 ? 1.15 : 1, opacity: stage >= i + 1 ? 1 : 0.35 }}
              transition={spring}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-full font-display text-sm font-bold text-white ring-2',
                p.color,
                stage >= i + 1 ? p.ring : 'ring-transparent',
              )}
            >
              {p.name[0]}
            </motion.div>
            <span className={cn('text-xs', stage >= i + 1 ? 'text-white/80' : 'text-white/30')}>
              {p.name}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {order.map((cardIdx) => (
          <motion.div key={cardIdx} layout transition={spring}>
            <SealedCard locks={stage} />
          </motion.div>
        ))}
      </div>
      <p className="max-w-md text-center text-sm leading-relaxed text-white/60">
        In turn, every player scrambles the whole deck and seals every card with their own secret
        key. Watch the locks stack up. After the last player, the order is unknown to everyone at
        the table, and to us.
      </p>
    </div>
  );
}

/* Step 3: side-by-side — what you see vs what the server sees */
function StepBlind() {
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="grid grid-cols-2 gap-10">
        <motion.div
          initial={{ opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={spring}
          className="flex flex-col items-center gap-3"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
            Your screen
          </span>
          <div className="flex gap-1.5">
            <PlayingCard card={cardFromName('As')} size="md" deal />
            <PlayingCard card={cardFromName('Ks')} size="md" deal />
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...spring, delay: 0.2 }}
          className="flex flex-col items-center gap-3"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/50">
            <EyeSlash size={14} /> The server
          </span>
          <div className="flex gap-1.5">
            {['c41b9e02a7f3', '5d80cc19e4b6'].map((hex) => (
              <div
                key={hex}
                className="flex h-24 w-[4.2rem] flex-col items-center justify-center gap-1 rounded-xl bg-slate-800 ring-1 ring-white/15"
              >
                {[0, 4, 8].map((o) => (
                  <span key={o} className="font-mono text-[0.55rem] text-white/45">
                    {hex.slice(o, o + 4)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
      <p className="max-w-md text-center text-sm leading-relaxed text-white/60">
        The server only passes locked messages around. It never holds a single key, so even the
        person hosting the game (or anyone who hacks the server) sees exactly this: noise.
      </p>
    </div>
  );
}

/* Step 4: convergence — locks pop off with proofs; only your lock opens the card */
function StepDeal() {
  const [removed, setRemoved] = useState(0); // locks removed
  const reduce = useReducedMotion();
  const done = removed >= PLAYERS.length;
  useEffect(() => {
    if (reduce) {
      setRemoved(PLAYERS.length);
      return;
    }
    const timers = [1, 2, 3].map((i) => setTimeout(() => setRemoved(i), 950 * i));
    return () => timers.forEach(clearTimeout);
  }, [reduce]);
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="flex items-center gap-8">
        <div className="flex flex-col gap-2.5">
          {[...PLAYERS].reverse().map((p, i) => {
            const idx = PLAYERS.length - 1 - i; // unlock order: Ishaan, Meera, then You
            const isOpen = removed > PLAYERS.length - 1 - idx;
            const isYou = p.name === 'You';
            return (
              <div key={p.name} className="flex items-center gap-2 text-sm">
                <motion.span
                  animate={{ opacity: isOpen ? 1 : 0.4 }}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-white',
                    p.color,
                  )}
                >
                  {isOpen ? <LockOpen size={13} weight="bold" /> : <Lock size={13} weight="bold" />}
                </motion.span>
                <span className={cn(isOpen ? 'text-white/85' : 'text-white/40')}>
                  {p.name} {isOpen ? 'unlocked' : 'still locked'}
                </span>
                <AnimatePresence>
                  {isOpen && !isYou && (
                    <motion.span
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={spring}
                      className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-300"
                    >
                      <SealCheck size={11} weight="fill" /> proof verified
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
        <div style={{ perspective: 600 }}>
          <motion.div
            animate={{ rotateY: done ? 0 : 180 }}
            transition={{ ...spring, stiffness: 180 }}
            style={{ transformStyle: 'preserve-3d' }}
            className="relative"
          >
            <div style={{ backfaceVisibility: 'hidden' }}>
              <PlayingCard card={cardFromName('As')} size="lg" />
            </div>
            <div
              className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-800 ring-1 ring-white/15 md:rounded-2xl"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <Lock size={26} className="text-white/40" />
            </div>
          </motion.div>
        </div>
      </div>
      <p className="max-w-md text-center text-sm leading-relaxed text-white/60">
        To deal you a card, everyone else removes their lock, and each removal carries a
        mathematical proof it was done with the exact committed key. A faked unlock is impossible to
        sneak in: it is rejected instantly and the cheater is named. Your own lock comes off last,
        on your device, so only you ever see the card.
      </p>
    </div>
  );
}

/* Step 5: the signed hash chain — tamper one block and the chain breaks */
function StepChain() {
  const [tampered, setTampered] = useState(false);
  const blocks = ['shuffle', 'deal', 'bet 60', 'flop', 'reveal'];
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="flex items-center">
        {blocks.map((b, i) => (
          <div key={b} className="flex items-center">
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: i * 0.12 }}
              onClick={() => setTampered((v) => !v)}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 ring-1 transition-colors',
                tampered && i === 2
                  ? 'bg-rose-500/20 ring-rose-400'
                  : 'bg-white/5 ring-white/15 hover:bg-white/10',
              )}
            >
              <span className="text-xs font-semibold text-white/85">
                {tampered && i === 2 ? 'bet 6,000' : b}
              </span>
              <span
                className={cn(
                  'font-mono text-[0.55rem]',
                  tampered && i >= 2 ? 'text-rose-300' : 'text-white/35',
                )}
              >
                {tampered && i >= 2 ? 'BROKEN' : `#${(0xa3f1 + i * 0x11d).toString(16)}`}
              </span>
            </motion.button>
            {i < blocks.length - 1 && (
              <LinkSimple
                size={16}
                className={cn('mx-1', tampered && i >= 2 ? 'text-rose-400' : 'text-white/30')}
              />
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-white/40">tap any block to try tampering with it</p>
      <p className="max-w-md text-center text-sm leading-relaxed text-white/60">
        Every move of every hand is signed by its player and chained by hashes. Change one bet after
        the fact and every later link breaks, visibly, for everyone. Finished hands can be replayed
        and re-verified in your own browser. The one thing math cannot stop: a friend showing their
        screen to another friend. That part runs on friendship.
      </p>
    </div>
  );
}

const STEPS = [
  { id: 'deck', title: 'A deck with no dealer', el: StepDeck },
  { id: 'shuffle', title: 'Everyone locks, everyone shuffles', el: StepShuffle },
  { id: 'blind', title: 'The server is blind', el: StepBlind },
  { id: 'deal', title: 'Dealing without revealing', el: StepDeal },
  { id: 'chain', title: 'Every move on the record', el: StepChain },
];

export function FairPage() {
  const [step, setStep] = useState(0);
  const Current = STEPS[step]!.el;
  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-6">
        <div className="flex items-center gap-3">
          <Link to="/login" className="rounded-full p-1.5 text-white/60 hover:bg-white/10">
            <CaretLeft size={18} weight="bold" />
          </Link>
          <h1 className="font-display text-lg font-bold">How can this be fair?</h1>
        </div>
        <p className="mt-1 pl-10 text-sm text-white/50">
          Mental poker, in five steps. No trust in the server required.
        </p>

        <div className="mt-6 flex min-h-[540px] flex-col rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
          <div className="flex items-center justify-between gap-3">
            <span className="font-display text-sm font-bold text-indigo-300">
              {step + 1} / {STEPS.length}
            </span>
            <h2 className="flex-1 truncate text-center font-display text-base font-bold sm:text-lg">
              {STEPS[step]!.title}
            </h2>
            <span className="w-10" />
          </div>

          <div className="flex min-h-[380px] flex-1 items-center justify-center py-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25 }}
                className="w-full"
              >
                <div className="flex justify-center">
                  <Current />
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="flex items-center gap-1 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold disabled:opacity-30"
            >
              <CaretLeft size={14} weight="bold" /> Back
            </button>
            <div className="flex gap-1.5">
              {STEPS.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setStep(i)}
                  aria-label={s.title}
                  className={cn(
                    'h-2 rounded-full transition-all',
                    i === step ? 'w-6 bg-indigo-400' : 'w-2 bg-white/20 hover:bg-white/40',
                  )}
                />
              ))}
            </div>
            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                className="flex items-center gap-1 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-900 active:scale-[0.98]"
              >
                Next <CaretRight size={14} weight="bold" />
              </button>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-1 rounded-full bg-indigo-500 px-4 py-2 text-sm font-bold text-white active:scale-[0.98]"
              >
                Deal me in <ArrowRight size={14} weight="bold" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
