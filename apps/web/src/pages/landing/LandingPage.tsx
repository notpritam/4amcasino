import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowDown,
  ArrowUpRight,
  CheckCircle,
  GithubLogo,
  LockKey,
  Play,
  Receipt,
  Robot,
  ShieldCheck,
  SpeakerHigh,
  UsersThree,
  Waveform,
} from '@phosphor-icons/react';
import { cardFromName } from '@4am/shared';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { useStore } from '../../shared/store.ts';

const ease = [0.22, 1, 0.36, 1] as const;

const players = [
  { name: 'Meera', initials: 'M', stack: '2,840', tone: 'bg-amber-300 text-amber-950' },
  { name: 'Ishaan', initials: 'I', stack: '1,920', tone: 'bg-sky-300 text-sky-950' },
  { name: 'Zoya', initials: 'Z', stack: '3,160', tone: 'bg-rose-300 text-rose-950' },
] as const;

const board = ['2h', '5s', '8d'].map(cardFromName);
const myHand = ['Jc', 'Jh'].map(cardFromName);

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-72px' }}
      transition={{ duration: 0.72, delay, ease }}
    >
      {children}
    </motion.div>
  );
}

function Brand() {
  return (
    <span className="flex items-center gap-2.5 font-display font-semibold tracking-[-0.03em] text-white">
      <span className="flex h-9 w-9 items-center justify-center rounded-[0.7rem] bg-indigo-500 text-lg text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]">
        ♠
      </span>
      <span>4AM Casino</span>
    </span>
  );
}

function PrimaryLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="landing-primary group">
      <span>{children}</span>
      <span className="landing-primary-icon" aria-hidden="true">
        <ArrowUpRight size={17} weight="bold" />
      </span>
    </Link>
  );
}

function Player({
  player,
  active = false,
  delay,
}: {
  player: (typeof players)[number];
  active?: boolean;
  delay: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: -12, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, delay, ease }}
      className={`landing-player ${active ? 'landing-player-active' : ''}`}
    >
      <span className={`landing-avatar ${player.tone}`}>{player.initials}</span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-slate-200">{player.name}</span>
        <span className="block font-display text-[0.68rem] tabular-nums text-slate-500">
          {player.stack}
        </span>
      </span>
      {active && <span className="landing-turn-dot" aria-label="taking their turn" />}
    </motion.div>
  );
}

function LiveTablePreview() {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      id="gameplay"
      initial={reduceMotion ? false : { opacity: 0, y: 32, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.9, delay: 0.18, ease }}
      className="landing-stage-shell"
      aria-label="Example of a hand in progress"
    >
      <div className="landing-stage">
        <div className="flex items-center justify-between border-b border-indigo-400/20 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2 text-[0.68rem] font-medium text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]" />
            Product preview
          </div>
          <div className="flex items-center gap-1.5 font-display text-[0.68rem] tabular-nums text-slate-500">
            <LockKey size={13} weight="duotone" /> <span className="uppercase tracking-[0.12em]">encrypted_hand // 07d1</span>
          </div>
        </div>

        <div className="landing-table">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {players.map((player, index) => (
              <Player
                key={player.name}
                player={player}
                active={index === 1}
                delay={0.48 + index * 0.09}
              />
            ))}
          </div>

          <div className="flex flex-1 flex-col items-center justify-center py-7 sm:py-9">
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.82, ease }}
              className="mb-4 rounded-full bg-white/[0.07] px-3 py-1 font-display text-[0.68rem] tabular-nums text-slate-300 ring-1 ring-white/10"
            >
              POT&nbsp; 340
            </motion.div>

            <div className="flex items-center justify-center gap-1.5 sm:gap-2">
              {board.map((card, index) => (
                <PlayingCard
                  key={card}
                  card={card}
                  size="sm"
                  deal
                  className={`cyber-card-pop landing-board-card-${index}`}
                />
              ))}
              <div
                className="card-hatch h-14 w-10 rounded-lg opacity-35 ring-1 ring-white/10"
                aria-label="turn card"
              />
              <div
                className="card-hatch h-14 w-10 rounded-lg opacity-20 ring-1 ring-white/10"
                aria-label="river card"
              />
            </div>
          </div>

          <div className="landing-hand-panel">
            <div className="flex items-end gap-3">
              <div className="flex -space-x-2.5" aria-label="Your hand: pair of jacks">
                {myHand.map((card, index) => (
                  <motion.div
                    key={card}
                    initial={reduceMotion ? false : { opacity: 0, y: 18, rotate: index ? 4 : -4 }}
                    animate={{ opacity: 1, y: 0, rotate: index ? 2 : -2 }}
                    transition={{ duration: 0.58, delay: 1.02 + index * 0.1, ease }}
                    className="cyber-card-pop"
                  >
                    <PlayingCard card={card} size="sm" />
                  </motion.div>
                ))}
              </div>
              <div className="pb-1">
                <span className="block text-[0.64rem] text-slate-500">Your hand</span>
                <span className="block text-xs font-medium text-slate-200">Pair of jacks</span>
              </div>
            </div>

            <div className="landing-actions" aria-label="Example betting controls">
              <span className="landing-action-secondary">Fold</span>
              <span className="landing-action-secondary">Call 40</span>
              <span className="landing-action-primary">Raise 120</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ProofItem({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3.5 py-5 sm:py-6">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-indigo-300 ring-1 ring-white/[0.08]">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-medium text-slate-100">{title}</span>
        <span className="mt-1 block max-w-[17rem] text-xs leading-5 text-slate-500">{text}</span>
      </span>
    </div>
  );
}

function InviteVisual() {
  return (
    <div
      className="landing-visual landing-invite-visual"
      aria-label="Example private table invitation"
    >
      <span className="cyber-comment" aria-hidden="true">// invite_node</span>
      <div className="relative z-10 w-full max-w-sm rounded-md bg-slate-900 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.28)] ring-1 ring-indigo-400/25">
        <div className="mb-6 flex items-center justify-between">
          <span className="text-xs text-slate-500">Friday game</span>
          <span className="flex items-center gap-1.5 text-[0.68rem] text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> private
          </span>
        </div>
        <div className="mb-6 flex -space-x-2">
          {players.map((player) => (
            <span
              key={player.name}
              className={`landing-avatar h-10 w-10 ring-4 ring-slate-900 ${player.tone}`}
            >
              {player.initials}
            </span>
          ))}
          <span className="landing-avatar h-10 w-10 bg-indigo-500 text-indigo-950 ring-4 ring-slate-900">
            +2
          </span>
        </div>
        <div className="rounded-xl bg-black/25 p-3.5 ring-1 ring-white/[0.07]">
          <span className="block text-[0.62rem] uppercase tracking-[0.16em] text-slate-600">
            Table code
          </span>
          <span className="mt-1.5 block font-display text-xl tracking-[0.24em] text-white">
            NIGHT6
          </span>
        </div>
      </div>
    </div>
  );
}

function ReplayVisual() {
  return (
    <div className="landing-visual landing-replay-visual" aria-label="Example hand replay timeline">
      <span className="cyber-comment" aria-hidden="true">// hand_log</span>
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs text-slate-400">
            <Play size={14} weight="fill" className="text-indigo-300" /> Hand replay
          </span>
          <span className="font-display text-xs tabular-nums text-slate-500">00:18 / 00:31</span>
        </div>
        <div className="relative mb-7 h-1 rounded-full bg-white/10">
          <div className="absolute inset-y-0 left-0 w-[58%] rounded-full bg-indigo-400" />
          <span className="absolute left-[58%] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_5px_rgba(92,255,114,0.22)]" />
          {[18, 39, 78].map((position) => (
            <span
              key={position}
              className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-white/40"
              style={{ left: `${position}%` }}
            />
          ))}
        </div>
        <div className="space-y-3">
          {[
            ['00:06', 'Meera raised to 120'],
            ['00:18', 'You called 120'],
            ['00:24', 'River dealt'],
          ].map(([time, action], index) => (
            <div
              key={time}
              className={`flex items-center gap-4 rounded-xl px-3.5 py-3 ${index === 1 ? 'bg-indigo-400/10 ring-1 ring-indigo-300/20' : 'bg-white/[0.025]'}`}
            >
              <span className="font-display text-[0.68rem] tabular-nums text-slate-500">
                {time}
              </span>
              <span className="text-xs text-slate-300">{action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LedgerVisual() {
  const rows = [
    { name: 'Meera', amount: '+1,240', width: 'w-[82%]', color: 'bg-emerald-400' },
    { name: 'Ishaan', amount: '+380', width: 'w-[38%]', color: 'bg-emerald-400' },
    { name: 'Zoya', amount: '−95', width: 'w-[19%]', color: 'bg-rose-400' },
  ] as const;

  return (
    <div
      className="landing-visual landing-ledger-visual"
      aria-label="Example verified session report"
    >
      <span className="cyber-comment" aria-hidden="true">// settle_proof</span>
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <span className="block text-xs text-slate-500">Session report</span>
            <span className="mt-1 block font-display text-xl text-white">Friday game</span>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[0.65rem] text-emerald-300 ring-1 ring-emerald-300/20">
            <CheckCircle size={13} weight="fill" /> verified
          </span>
        </div>
        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.name} className="grid grid-cols-[4rem_1fr_3.6rem] items-center gap-3">
              <span className="text-xs text-slate-400">{row.name}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                <span className={`block h-full rounded-full ${row.width} ${row.color}`} />
              </span>
              <span
                className={`text-right font-display text-xs tabular-nums ${row.amount.startsWith('+') ? 'text-emerald-300' : 'text-rose-300'}`}
              >
                {row.amount}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-7 flex items-center gap-2 border-t border-indigo-400/15 pt-4 text-[0.66rem] text-slate-500">
          <Receipt size={14} /> every buy-in and pot is hash-chained
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const token = useStore((state) => state.auth.token);
  const playHref = token ? '/lobby' : '/login';
  const playLabel = token ? 'Open your lobby' : 'Start a table';

  return (
    <div className="landing-root cyber min-h-screen bg-slate-950 font-sans text-slate-100">
      <a href="#main-content" className="landing-skip-link">
        Skip to content
      </a>
      <div className="landing-grain" aria-hidden="true" />

      <header className="relative z-20 mx-auto max-w-[82rem] px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        <nav className="landing-nav" aria-label="Primary navigation">
          <Link to="/" aria-label="4AM Casino home">
            <Brand />
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            <a href="#sessions" className="landing-nav-link">
              Sessions
            </a>
            <a href="#trust" className="landing-nav-link">
              How it works
            </a>
            <Link to="/fair" className="landing-nav-link">
              Fairness
            </Link>
            <a
              href="https://github.com/notpritam/4amcasino"
              target="_blank"
              rel="noreferrer"
              className="landing-nav-link flex items-center gap-1.5"
            >
              <GithubLogo size={15} /> GitHub
            </a>
          </div>
          <Link to={playHref} className="landing-nav-cta">
            {token ? 'Lobby' : 'Play now'}
            <ArrowUpRight size={15} weight="bold" />
          </Link>
        </nav>
      </header>

      <main id="main-content">
        <section className="relative mx-auto grid min-h-[calc(100dvh-5.5rem)] max-w-[82rem] items-center gap-14 px-4 pb-20 pt-16 sm:px-6 sm:pt-20 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16 lg:px-8 lg:pb-28 lg:pt-24">
          <div className="relative z-10 max-w-xl">
            <Reveal>
              <span className="landing-eyebrow">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-300" />
                Free, private Texas Hold&apos;em
              </span>
            </Reveal>
            <Reveal delay={0.06}>
              <h1 className="mt-6 max-w-[13ch] font-display text-[clamp(2.3rem,5.4vw,4.6rem)] font-medium leading-[1.08] tracking-[-0.015em] text-white text-balance">
                Poker night <span className="cyber-chroma">without the house.</span>
              </h1>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-7 max-w-[34rem] text-base leading-7 text-slate-400 sm:text-lg sm:leading-8">
                Create a table, invite your people, and deal. Your cards stay private, every chip
                has a receipt, and nobody plays with real money.
              </p>
            </Reveal>
            <Reveal delay={0.18} className="mt-8 flex flex-wrap items-center gap-4">
              <PrimaryLink to={playHref}>{playLabel}</PrimaryLink>
              <a href="#sessions" className="landing-text-link group">
                See a game night
                <ArrowDown
                  size={16}
                  className="transition-transform duration-500 group-hover:translate-y-1"
                />
              </a>
            </Reveal>
            <Reveal
              delay={0.24}
              className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500"
            >
              {['Play money only', 'No download', 'Open source'].map((item) => (
                <span key={item} className="flex items-center gap-1.5">
                  <CheckCircle size={13} weight="fill" className="text-indigo-300" /> {item}
                </span>
              ))}
            </Reveal>
          </div>

          <LiveTablePreview />
        </section>

        <section
          className="border-y border-indigo-400/15 bg-indigo-400/[0.03]"
          aria-label="Product principles"
        >
          <div className="mx-auto grid max-w-[82rem] divide-y divide-indigo-400/15 px-4 sm:grid-cols-2 sm:divide-x sm:divide-y-0 sm:px-6 lg:grid-cols-4 lg:px-8">
            <ProofItem
              icon={<UsersThree size={17} weight="duotone" />}
              title="Built for friends"
              text="Private rooms, table codes, voice, chat, and house rules."
            />
            <ProofItem
              icon={<LockKey size={17} weight="duotone" />}
              title="Cards stay private"
              text="Every browser helps encrypt and shuffle the deck."
            />
            <ProofItem
              icon={<Receipt size={17} weight="duotone" />}
              title="Chips stay accountable"
              text="A shared ledger records buy-ins and every settled pot."
            />
            <ProofItem
              icon={<GithubLogo size={17} weight="duotone" />}
              title="Open by default"
              text="Inspect the code, self-host it, or give an AI a seat."
            />
          </div>
        </section>

        <section
          id="sessions"
          className="mx-auto max-w-[82rem] px-4 py-28 sm:px-6 sm:py-36 lg:px-8 lg:py-44"
        >
          <Reveal className="max-w-3xl">
            <span className="landing-kicker">A whole game night, one link</span>
            <h2 className="landing-section-title mt-5">The table gets out of the way.</h2>
            <p className="landing-section-copy mt-6">
              The controls stay clear when the hand gets tense. Everything around them helps your
              group join, talk, remember, and settle the session.
            </p>
          </Reveal>

          <div className="mt-20 space-y-24 sm:mt-24 sm:space-y-32">
            <article className="landing-story-grid">
              <Reveal className="landing-story-copy">
                <span className="landing-story-number">01</span>
                <UsersThree size={22} weight="duotone" className="mt-10 text-indigo-300" />
                <h3 className="landing-story-title">Send the code. Everyone&apos;s in.</h3>
                <p className="landing-story-body">
                  Start a private room in seconds. Friends join from any browser, choose a seat, buy
                  play chips, and keep talking with built-in voice.
                </p>
              </Reveal>
              <Reveal delay={0.08}>
                <InviteVisual />
              </Reveal>
            </article>

            <article className="landing-story-grid landing-story-reverse">
              <Reveal delay={0.08}>
                <ReplayVisual />
              </Reveal>
              <Reveal className="landing-story-copy">
                <span className="landing-story-number">02</span>
                <Waveform size={22} weight="duotone" className="mt-10 text-indigo-300" />
                <h3 className="landing-story-title">Every hand leaves a replay.</h3>
                <p className="landing-story-body">
                  Revisit the betting, reveal the showdown, and share the hand that changed the
                  night. The replay is built from the real game record, not a screen recording.
                </p>
              </Reveal>
            </article>

            <article className="landing-story-grid">
              <Reveal className="landing-story-copy">
                <span className="landing-story-number">03</span>
                <Receipt size={22} weight="duotone" className="mt-10 text-indigo-300" />
                <h3 className="landing-story-title">Finish with one clean receipt.</h3>
                <p className="landing-story-body">
                  Buy-ins, pots, bounties, and transfers resolve into a verified session report, so
                  the group can settle outside the app without rebuilding the night in a
                  spreadsheet.
                </p>
              </Reveal>
              <Reveal delay={0.08}>
                <LedgerVisual />
              </Reveal>
            </article>
          </div>
        </section>

        <section id="trust" className="border-y border-indigo-400/15 bg-[#070f0a]">
          <div className="mx-auto grid max-w-[82rem] gap-16 px-4 py-28 sm:px-6 sm:py-36 lg:grid-cols-[0.85fr_1.15fr] lg:gap-24 lg:px-8">
            <Reveal>
              <span className="landing-kicker">Under the table</span>
              <h2 className="landing-section-title mt-5">Trust the proof, not the host.</h2>
              <p className="landing-section-copy mt-6">
                4AM uses mental poker: every player encrypts and shuffles the same deck. The server
                coordinates the hand but never gets the keys to your cards.
              </p>
              <Link to="/fair" className="landing-text-link mt-8 w-fit">
                See how a hand stays private <ArrowUpRight size={16} />
              </Link>
            </Reveal>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  icon: <LockKey size={20} weight="duotone" />,
                  title: 'Encrypted dealing',
                  text: 'Your hole cards open in your browser and nowhere else.',
                },
                {
                  icon: <ShieldCheck size={20} weight="duotone" />,
                  title: 'Proof with every reveal',
                  text: 'Invalid shuffle and unmask actions are rejected and attributed.',
                },
                {
                  icon: <Robot size={20} weight="duotone" />,
                  title: 'A real seat for AI',
                  text: 'Agents play through the same protocol and rules as people.',
                },
                {
                  icon: <SpeakerHigh size={20} weight="duotone" />,
                  title: 'Still feels social',
                  text: 'Voice, reactions, bounties, and bad beats stay in the room.',
                },
              ].map((item, index) => (
                <Reveal key={item.title} delay={index * 0.05} className="landing-tech-card">
                  <span className="text-indigo-300">{item.icon}</span>
                  <h3 className="mt-8 font-display text-lg font-medium tracking-[-0.03em] text-white">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-500">{item.text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[82rem] px-4 py-28 sm:px-6 sm:py-40 lg:px-8">
          <Reveal className="relative overflow-hidden rounded-md bg-indigo-500 px-6 py-16 text-center shadow-[0_32px_100px_rgba(92,255,114,0.12)] sm:px-12 sm:py-24">
            <div className="landing-cta-grid" aria-hidden="true" />
            <p className="relative z-10 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-950/70">
              Your table is ready
            </p>
            <h2 className="relative z-10 mx-auto mt-5 max-w-[14ch] font-display text-3xl font-medium uppercase leading-[1.1] tracking-[-0.01em] text-white sm:text-5xl">
              Deal the first hand tonight.
            </h2>
            <div className="relative z-10 mt-9">
              <Link to={playHref} className="landing-final-cta group">
                {playLabel}
                <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-indigo-400 text-indigo-950 transition-transform duration-500 group-hover:translate-x-1 group-hover:-translate-y-0.5">
                  <ArrowUpRight size={17} weight="bold" />
                </span>
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-indigo-400/15">
        <div className="mx-auto flex max-w-[82rem] flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-8">
          <div>
            <Brand />
            <p className="mt-3 text-xs text-slate-600">
              Play money only. The stakes are bragging rights.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs text-slate-500">
            <Link to="/fair" className="hover:text-slate-200">
              Fairness
            </Link>
            <a
              href="https://github.com/notpritam/4amcasino"
              target="_blank"
              rel="noreferrer"
              className="hover:text-slate-200"
            >
              GitHub
            </a>
            <a
              href="https://github.com/notpritam/4amcasino/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
              className="hover:text-slate-200"
            >
              MIT License
            </a>
            <span>© 2026 4AM Casino</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
