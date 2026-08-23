import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { GithubLogo } from '@phosphor-icons/react';
import { cardFromName } from '@4am/shared';
import { useStore } from '../../shared/store.ts';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';

/** Public landing page: one line per section, the visuals do the talking.
 *  Deliberately always night mode. It is called 4AM. */

const CIPHER =
  'a3f29c 07d1be 5b88e4 c94a02 e17f6d 3c50a9 f8b217 640dce 9e2b73 b06f18 2ad594 8c31f7';

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

/** The product's whole argument in one picture: the table sees ciphertext, you see aces. */
function DealDemo() {
  const reduce = useReducedMotion();
  const mine = [cardFromName('As'), cardFromName('Kh')];
  return (
    <div className="relative mx-auto w-fit">
      <div className="flex items-end justify-center gap-2 sm:gap-3">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            initial={reduce ? false : { y: -24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 + i * 0.12, type: 'spring', stiffness: 260, damping: 20 }}
            className={i === 0 ? '-rotate-6' : i === 1 ? '-rotate-2' : 'rotate-1'}
          >
            <PlayingCard faceDown size="lg" />
          </motion.div>
        ))}
        {mine.map((c, i) => (
          <motion.div
            key={c}
            initial={reduce ? false : { rotateY: 180, y: -18, opacity: 0 }}
            animate={{ rotateY: 0, y: -10, opacity: 1 }}
            transition={{ delay: 0.85 + i * 0.25, type: 'spring', stiffness: 190, damping: 16 }}
            className={i === 0 ? 'rotate-2 drop-shadow-2xl' : 'rotate-6 drop-shadow-2xl'}
            style={{ transformStyle: 'preserve-3d' }}
          >
            <PlayingCard card={c} size="lg" />
          </motion.div>
        ))}
      </div>
      <motion.div
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.7 }}
        className="mt-6 text-center"
      >
        <p className="mx-auto max-w-md truncate font-mono text-[0.65rem] tracking-wider text-slate-600">{CIPHER}</p>
        <p className="mt-1.5 text-sm text-slate-500">
          What the table sees of your hand: ciphertext. What you see: aces.
        </p>
      </motion.div>
    </div>
  );
}

/** A miniature of the real session report: receipts, not vibes. */
function LedgerDemo() {
  const rows = [
    { name: 'Meera', net: 1240, w: 100 },
    { name: 'Ishaan', net: 380, w: 31 },
    { name: 'Zoya', net: -95, w: 8 },
    { name: 'Arjun', net: -1525, w: 100 },
  ];
  return (
    <div className="mx-auto w-full max-w-lg rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="font-display font-semibold">Session report</span>
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
          chain verified
        </span>
      </div>
      <div className="mb-5 grid grid-cols-3 gap-3 text-center">
        {[
          ['2h 14m', 'time played'],
          ['47', 'hands dealt'],
          ['1,900', 'biggest pot'],
        ].map(([v, l]) => (
          <div key={l} className="rounded-xl bg-white/[0.04] py-3">
            <div className="font-display text-lg font-bold">{v}</div>
            <div className="text-[0.65rem] uppercase tracking-wide text-slate-500">{l}</div>
          </div>
        ))}
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.name} className="grid grid-cols-[4.5rem_1fr_4rem] items-center gap-3 text-sm">
            <span className="truncate text-slate-300">{r.name}</span>
            <div className="relative h-2.5">
              <span className="absolute inset-y-0 left-1/2 w-px bg-white/15" />
              <span
                className={
                  r.net > 0
                    ? 'absolute inset-y-0 left-1/2 rounded-r-full bg-emerald-500'
                    : 'absolute inset-y-0 right-1/2 rounded-l-full bg-rose-500'
                }
                style={{ width: `${r.w / 2}%` }}
              />
            </div>
            <span
              className={`text-right font-display font-semibold ${r.net > 0 ? 'text-emerald-400' : 'text-rose-400'}`}
            >
              {r.net > 0 ? '+' : '−'}
              {Math.abs(r.net).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The social layer, sketched with the real chat vocabulary. */
function TableTalkDemo() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-3">
      <div className="flex flex-wrap justify-center gap-2">
        {['nice hand 👏', 'bluff! 🤨', 'run it again 🔁', 'ouch 💀', 'so lucky 🍀'].map((p) => (
          <span key={p} className="rounded-full bg-white/10 px-3.5 py-1.5 text-sm">
            {p}
          </span>
        ))}
      </div>
      <div className="mx-auto flex w-fit items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3.5 text-sm">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        voice is live · 4 at the table
      </div>
      <div className="mx-auto flex w-fit items-center gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-5 py-3 text-sm text-amber-200">
        7-2 offsuit! Meera collects 200 in bounties.
      </div>
    </div>
  );
}

function McpDemo() {
  return (
    <pre className="mx-auto w-full max-w-lg overflow-x-auto rounded-2xl bg-slate-900 p-6 text-left font-mono text-xs leading-relaxed text-slate-300 ring-1 ring-white/10">
      {`"4am-casino": {
  "command": "npx",
  "args": ["tsx", "apps/mcp/src/index.ts"],
  "env": {
    "FOURAM_USERNAME": "my_bot",
    "FOURAM_PASSWORD": "..."
  }
}

> casino_state
  Your cards: As Kh
  IT IS YOUR TURN. Options: fold | call 60
  | raise between 120 and 1,980`}
    </pre>
  );
}

function Cta({ label, to }: { label: string; to: string }) {
  return (
    <Link
      to={to}
      className="inline-block rounded-full bg-indigo-600 px-8 py-3.5 font-display font-semibold text-white transition-colors hover:bg-indigo-500"
    >
      {label}
    </Link>
  );
}

export function LandingPage() {
  const token = useStore((s) => s.auth.token);
  const playHref = token ? '/lobby' : '/login';
  const playLabel = token ? 'Back to your lobby' : 'Play now';

  const sections: { line: string; sub: string; demo: React.ReactNode }[] = [
    {
      line: 'Nobody sees your cards. Not even the house.',
      sub: 'Every player encrypts and shuffles the deck. Cryptographic proofs open your two cards for your eyes only.',
      demo: <DealDemo />,
    },
    {
      line: 'Every chip has a receipt.',
      sub: 'Buy-ins, pots, and bounties live on a tamper-evident ledger. Settling up after the game is one screen.',
      demo: <LedgerDemo />,
    },
    {
      line: 'The table still talks.',
      sub: 'Always-on voice, stickers, house rules like the 7-2 bounty, and a shareable card for every bad beat.',
      demo: <TableTalkDemo />,
    },
    {
      line: 'Deal in an AI.',
      sub: 'One config block gives any agent a real seat, playing under the same cryptography as everyone else.',
      demo: <McpDemo />,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* minimal nav: wordmark and the one action */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="flex items-center gap-2 font-display text-lg font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">♠</span>
          4AM Casino
        </span>
        <Link
          to={playHref}
          className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          {playLabel}
        </Link>
      </header>

      {/* hero: one line */}
      <section className="mx-auto max-w-5xl px-6 pb-24 pt-16 text-center sm:pt-24">
        <Reveal>
          <h1 className="mx-auto max-w-3xl font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
            Poker night, provably&nbsp;fair.
          </h1>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mx-auto mt-6 max-w-xl text-lg text-slate-400">
            Texas Hold&apos;em with your friends, running on cryptography instead of trust. Free,
            open source, play money.
          </p>
        </Reveal>
        <Reveal delay={0.2}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Cta label={playLabel} to={playHref} />
            <Link to="/fair" className="font-semibold text-slate-300 underline-offset-4 hover:underline">
              Watch the 60-second proof
            </Link>
          </div>
        </Reveal>
      </section>

      {/* one benefit per section, the visual carries it */}
      {sections.map((s, i) => (
        <section key={s.line} className={i % 2 ? '' : 'border-y border-white/5 bg-white/[0.02]'}>
          <div className="mx-auto max-w-5xl px-6 py-24 text-center">
            <Reveal>
              <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold leading-tight sm:text-4xl">
                {s.line}
              </h2>
            </Reveal>
            <Reveal delay={0.08}>
              <p className="mx-auto mt-4 max-w-xl text-slate-400">{s.sub}</p>
            </Reveal>
            <Reveal delay={0.16}>
              <div className="mt-12">{s.demo}</div>
            </Reveal>
          </div>
        </section>
      ))}

      {/* closing block */}
      <section className="mx-auto max-w-5xl px-6 py-28 text-center">
        <Reveal>
          <h2 className="font-display text-4xl font-bold sm:text-5xl">Free poker with your friends.</h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mx-auto mt-5 max-w-xl text-lg text-slate-400">
            Online poker doesn&apos;t have to mean trusting a server. 4AM Casino replaces trust with
            math and leaves the fun part alone.
          </p>
        </Reveal>
        <Reveal delay={0.2}>
          <div className="mt-9">
            <Cta label={playLabel} to={playHref} />
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-sm text-slate-500">
          <span>♠ 4AM Casino</span>
          <Link to="/fair" className="hover:text-slate-300">
            How it&apos;s fair
          </Link>
          <a
            href="https://github.com/notpritam/4amcasino"
            className="flex items-center gap-1.5 hover:text-slate-300"
          >
            <GithubLogo size={15} /> GitHub
          </a>
          <span className="ml-auto">Play money only. The stakes are bragging rights.</span>
        </div>
      </footer>
    </div>
  );
}
