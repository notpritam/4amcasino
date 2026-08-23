import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HAND_CATEGORY_NAMES, cardFromName, handCategory } from '@4am/shared';
import { useStore } from '../../shared/store.ts';
import { applyTheme } from '../../shared/prefs.ts';
import { play, type SoundName } from '../../shared/sounds.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Input, Panel } from '../../shared/ui/index.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { Avatar } from '../../entities/user/Avatar.tsx';
import { PlayerRow, YouRow, type SeatView } from '../../widgets/table/players.tsx';
import { ActionBar } from '../../widgets/table/ActionBar.tsx';
import { ChatPanel } from '../../widgets/table/ChatPanel.tsx';
import { MobileTable } from '../../widgets/table/MobileTable.tsx';
import { ProfileDialog } from '../../features/profile/ProfileDialog.tsx';
import { LeaderboardTable } from '../leaderboard/LeaderboardPage.tsx';
import {
  MY_SEAT,
  SCENARIOS,
  applyScenario,
  buildSeatViews,
  clearScenario,
  type ScenarioName,
} from './scenarios.ts';

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold">{title}</h2>
        {note && <p className="mt-1 text-sm text-slate-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Spec({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      {children}
    </div>
  );
}

function seatVariant(over: Partial<SeatView>): SeatView {
  return {
    seat: 3,
    userId: 9002,
    username: 'meera',
    displayName: 'Meera',
    avatarVersion: 0,
    stack: 1830,
    isButton: false,
    isToAct: false,
    folded: false,
    allIn: false,
    inHand: true,
    connected: true,
    speaking: false,
    voiceMuted: false,
    won: false,
    ...over,
  };
}

const NAV = [
  ['foundations', 'Foundations'],
  ['cards', 'Cards'],
  ['controls', 'Controls'],
  ['seats', 'Seat rows'],
  ['desktop', 'Desktop table'],
  ['mobile', 'Phone'],
  ['dialogs', 'Dialogs'],
  ['stats', 'Leaderboard'],
] as const;

export function DesignBoardPage() {
  const [scenario, setScenario] = useState<ScenarioName>('yourTurn');
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const hand = useStore((s) => s.hand);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    applyScenario(scenario);
  }, [scenario]);
  useEffect(() => () => clearScenario(), []);

  const urgent = scenario === 'urgent';
  const seatViews = buildSeatViews(scenario, urgent);
  const me = seatViews.find((s) => s.seat === MY_SEAT);
  const opponents = seatViews.filter((s) => s.seat !== MY_SEAT);
  const pot = hand.betting ? hand.betting.seats.reduce((s, x) => s + x.total, 0) : 0;
  const showResult = hand.result !== null || hand.abort !== null;

  return (
    <div className="min-h-screen pb-24">
      {/* control bar */}
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-slate-100/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
          <Link to="/lobby" className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            ← App
          </Link>
          <h1 className="font-display text-lg font-bold">Design board</h1>
          <div className="flex flex-wrap gap-1.5">
            {SCENARIOS.map((sc) => (
              <button
                key={sc.name}
                onClick={() => setScenario(sc.name)}
                title={sc.blurb}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                  scenario === sc.name
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700',
                )}
              >
                {sc.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={prefs.theme === 'dark'}
                onChange={(e) => {
                  const theme = e.target.checked ? 'dark' : 'light';
                  setPrefs({ theme });
                  applyTheme(theme);
                }}
              />
              Dark
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={prefs.fourColor}
                onChange={(e) => setPrefs({ fourColor: e.target.checked })}
              />
              4-color
            </label>
            <div className="flex gap-1">
              {(['indigo', 'crimson', 'emerald', 'slate'] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setPrefs({ cardBack: b })}
                  aria-label={`${b} back`}
                  className={cn('card-back h-6 w-4 rounded-sm', `card-back-${b}`, prefs.cardBack === b && 'ring-2 ring-indigo-500')}
                />
              ))}
            </div>
          </div>
          <nav className="flex w-full flex-wrap gap-3 text-xs text-slate-500">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="hover:text-indigo-600">
                {label}
              </a>
            ))}
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-14 px-4 pt-8 sm:px-6">
        <p className="text-sm text-slate-500">
          Every element below is the real shipped component fed with dummy data. Flip the scenario,
          theme, and deck controls above; approve a section, then move to the next.
        </p>

        <Section id="foundations" title="Foundations" note="Palette, type, and the voice of the numbers.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Panel>
              <Spec label="Palette">
                <div className="flex flex-wrap gap-2">
                  {[
                    ['indigo-600', 'bg-indigo-600'],
                    ['slate-950', 'bg-slate-950'],
                    ['slate-100', 'bg-slate-100 ring-1 ring-slate-300'],
                    ['rose-600', 'bg-rose-600'],
                    ['emerald-500', 'bg-emerald-500'],
                    ['amber-400', 'bg-amber-400'],
                  ].map(([name, cls]) => (
                    <div key={name} className="text-center">
                      <div className={cn('h-10 w-16 rounded-lg', cls)} />
                      <div className="mt-1 font-mono text-[0.6rem] text-slate-400">{name}</div>
                    </div>
                  ))}
                </div>
              </Spec>
            </Panel>
            <Panel className="space-y-2">
              <Spec label="Type">
                <div className="font-display text-2xl font-bold">Space Grotesk carries the numbers</div>
                <div className="text-sm text-slate-600 dark:text-slate-300">
                  Inter carries the sentences. Amounts always use the display face:
                </div>
                <div className="font-display text-3xl font-bold">
                  {fmt(126500)} <span className="text-emerald-600">+{fmt(2340)}</span>{' '}
                  <span className="text-rose-600">-{fmt(890)}</span>
                </div>
              </Spec>
            </Panel>
          </div>
        </Section>

        <Section id="cards" title="Cards" note="Sizes, the four backs, four-color deck, and the hatched placeholder.">
          <Panel className="space-y-6">
            <Spec label="Face-up sizes (xs / sm / md / lg / xl)">
              <div className="flex flex-wrap items-end gap-3">
                <PlayingCard card={cardFromName('As')} size="xs" />
                <PlayingCard card={cardFromName('Kh')} size="sm" />
                <PlayingCard card={cardFromName('Qd')} size="md" />
                <PlayingCard card={cardFromName('Jc')} size="lg" />
                <PlayingCard card={cardFromName('Td')} size="xl" />
              </div>
            </Spec>
            <Spec label="Backs (your pick is highlighted in the toolbar)">
              <div className="flex flex-wrap gap-3">
                {(['indigo', 'crimson', 'emerald', 'slate'] as const).map((b) => (
                  <div key={b} className={cn('card-back h-24 w-[4.2rem] rounded-xl ring-1 ring-black/10', `card-back-${b}`)} />
                ))}
                <div className="card-hatch h-24 w-[4.2rem] rounded-xl shadow" title="face-down board slot (phone)" />
              </div>
            </Spec>
          </Panel>
        </Section>

        <Section id="controls" title="Controls" note="Buttons, badges, inputs. Both themes via the Dark toggle.">
          <Panel className="space-y-5">
            <Spec label="Buttons">
              <div className="flex flex-wrap items-center gap-2">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="success">Call 120</Button>
                <Button variant="danger">Reject</Button>
                <Button variant="ghost">Ghost</Button>
                <Button disabled>Disabled</Button>
              </div>
            </Spec>
            <Spec label="Badges / action chips">
              <div className="flex flex-wrap gap-2">
                <Badge tone="indigo">DESIGN</Badge>
                <Badge tone="slate">CHECK</Badge>
                <Badge tone="amber">RAISE 120</Badge>
                <Badge tone="rose">FOLD</Badge>
                <Badge tone="emerald">+480</Badge>
              </div>
            </Spec>
            <Spec label="Input">
              <div className="max-w-xs">
                <Input placeholder="ABC123" />
              </div>
            </Spec>
            <Spec label="Sounds (tap to hear)">
              <div className="flex flex-wrap gap-1.5">
                {(['shuffle', 'deal', 'flip', 'chip', 'knock', 'muck', 'turn', 'urgent', 'win'] as SoundName[]).map((n) => (
                  <button
                    key={n}
                    onClick={() => play(n)}
                    className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Spec>
          </Panel>
        </Section>

        <Section id="seats" title="Seat rows (desktop)" note="Every state a player row can be in.">
          <div className="grid gap-2.5 lg:grid-cols-2">
            <PlayerRow p={seatVariant({})} urgent={false} />
            <PlayerRow p={seatVariant({ isToAct: true, displayName: 'Ishaan', userId: 9003 })} urgent={false} />
            <PlayerRow p={seatVariant({ isToAct: true, displayName: 'Urgent turn' })} urgent />
            <PlayerRow p={seatVariant({ folded: true, displayName: 'Folded', lastAction: { type: 'fold' } })} urgent={false} />
            <PlayerRow p={seatVariant({ allIn: true, displayName: 'All-in', stack: 0 })} urgent={false} />
            <PlayerRow p={seatVariant({ won: true, displayName: 'Winner', revealed: [cardFromName('9c'), cardFromName('9d')] })} urgent={false} />
            <PlayerRow p={seatVariant({ voiceMuted: true, speaking: false, displayName: 'Muted' })} urgent={false} />
            <PlayerRow p={seatVariant({ connected: false, displayName: 'Disconnected' })} urgent={false} />
          </div>
        </Section>

        <Section
          id="desktop"
          title="Desktop table"
          note={`Live composition in the "${SCENARIOS.find((s) => s.name === scenario)?.label}" scenario. Change it in the toolbar.`}
        >
          <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
            <div className="space-y-2.5">
              {opponents.map((p) => (
                <PlayerRow key={p.seat} p={p} urgent={urgent} />
              ))}
            </div>
            <div className="relative flex min-h-[360px] flex-col items-center justify-center gap-6 rounded-3xl bg-slate-200/50 p-6 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:ring-slate-800">
              <div className="rounded-xl bg-indigo-600 px-6 py-2 font-display text-xl font-bold text-white shadow">
                POT {fmt(pot)}
              </div>
              <div className="flex gap-2">
                {[0, 1, 2, 3, 4].map((i) =>
                  hand.board[i] !== undefined ? (
                    <PlayingCard key={`${i}-${hand.board[i]}`} card={hand.board[i]} size="lg" />
                  ) : (
                    <div key={i} className="h-32 w-[5.6rem] rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700" />
                  ),
                )}
              </div>
            </div>
          </div>
          {showResult && (
            <Panel>
              {hand.abort ? (
                <div className="text-sm">
                  <span className="font-semibold text-rose-600">Hand aborted:</span> {hand.abort.reason}. Caused by seat{' '}
                  {(hand.abort.blamedSeat ?? 0) + 1}; stacks rolled back.
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <span className="font-display font-semibold">Showdown</span>
                  {hand.showdown?.reveals.map((r) => (
                    <span key={r.seat} className="flex items-center gap-1.5 text-sm">
                      <span className="text-slate-500">{seatViews.find((s) => s.seat === r.seat)?.displayName}</span>
                      <Badge tone="slate">{HAND_CATEGORY_NAMES[handCategory(r.score)]}</Badge>
                    </span>
                  ))}
                  <span className="font-display text-sm font-bold text-emerald-600">You +240</span>
                  <span className="font-display text-sm font-bold text-rose-600">Meera -240</span>
                </div>
              )}
            </Panel>
          )}
          {me && <YouRow p={me} cards={hand.myCards} urgent={urgent} />}
          <ActionBar mySeat={MY_SEAT} isHost urgent={urgent} />
        </Section>

        <Section id="mobile" title="Phone" note="The Offsuit-style table and the chat sheet, framed at 390px.">
          <div className="flex items-start justify-center gap-8 overflow-x-auto max-lg:justify-start">
            <div className="w-[390px] shrink-0 overflow-hidden rounded-[2.5rem] bg-slate-950 p-2 shadow-2xl ring-4 ring-slate-300 dark:ring-slate-700">
              <MobileTable
                opponents={opponents}
                me={me}
                mySeat={MY_SEAT}
                isHost
                myCards={hand.myCards}
                board={hand.board}
                pot={pot}
                urgent={urgent}
                statusText={scenario === 'waiting' ? 'Waiting for Ishaan…' : null}
              />
            </div>
            <div className="h-[600px] w-[390px] shrink-0 overflow-hidden rounded-[2.5rem] p-2 shadow-2xl ring-4 ring-slate-300 dark:ring-slate-700">
              <ChatPanel />
            </div>
          </div>
        </Section>

        <Section id="dialogs" title="Dialogs" note="The profile editor, exactly as it ships.">
          <Button variant="secondary" onClick={() => setProfileOpen(true)}>
            Open profile dialog
          </Button>
          <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
        </Section>

        <Section id="stats" title="Leaderboard rows" note="Ranked rows with medals, hands, and nets.">
          <LeaderboardTable
            rows={[
              { userId: 9003, username: 'ishaan', displayName: 'Ishaan', avatarVersion: 0, net: 1240, handsPlayed: 62, biggestWin: 450 },
              { userId: 9001, username: 'you', displayName: 'You', avatarVersion: 0, net: 380, handsPlayed: 54, biggestWin: 240 },
              { userId: 9002, username: 'meera', displayName: 'Meera', avatarVersion: 0, net: -95, handsPlayed: 41, biggestWin: 120 },
              { userId: 9004, username: 'zoya', displayName: 'Zoya', avatarVersion: 0, net: -1525, handsPlayed: 87, biggestWin: 90 },
            ]}
          />
        </Section>

        <div className="flex justify-center">
          <div className="flex items-center gap-2">
            <Avatar userId={9001} name="4AM" version={0} size="sm" />
            <span className="text-xs text-slate-400">4AM Casino design board. Real components, dummy chips.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
