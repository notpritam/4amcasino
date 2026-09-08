import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { ButtonLink, LinkButton } from '@zeus/ui/base';
import {
  RiArrowRightLine,
  RiArrowRightUpLine,
  RiArrowDownSLine,
  RiCheckLine,
  RiGithubLine,
  RiPokerClubsLine,
  RiRestartLine,
  RiVolumeUpLine,
} from '@remixicon/react';
import { cardFromName } from '@4am/shared';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { useStore } from '../../shared/store.ts';
import { Button, Input } from '../../shared/ui/index.tsx';
import './landing.css';
import { AppearanceToggle } from '../../shared/ui/AppearanceToggle.tsx';

const community = ['2h', '5s', '8d', 'Jd', '3c'].map(cardFromName);
const hole = ['Jc', 'Jh'].map(cardFromName);
const streets = [
  {
    name: 'Before the flop',
    count: 0,
    next: 'Deal the flop',
    copy: 'Two cards, just for you. The community cards come next.',
  },
  {
    name: 'The flop',
    count: 3,
    next: 'Deal the turn',
    copy: 'Three cards on the table. Everyone can use them.',
  },
  {
    name: 'The turn',
    count: 4,
    next: 'Deal the river',
    copy: 'A third jack. Your best hand is now three of a kind.',
  },
  {
    name: 'The river',
    count: 5,
    next: 'Try again',
    copy: 'Five community cards. Make your best five-card hand.',
  },
];
const questions = [
  [
    'Is this real-money poker?',
    'No. 4AM uses play-money chips. It does not take deposits, pay out winnings, or process real-money bets.',
  ],
  [
    'Does everyone need to download an app?',
    'No download is needed. Open 4AM in your browser, sign in, and join your friend’s table using its invite link or room code.',
  ],
  [
    'Do I have to play in 3D?',
    'You can use the focused 2D table or the 3D lounge, and switch between them in the same room. The 3D view includes camera presets and the same game controls.',
  ],
  [
    'Can we talk while we play?',
    'Yes. Rooms have text chat and voice controls. You can also react at the table, customise your character, and take a break to explore the lounge.',
  ],
  [
    'How can I check what happened in a hand?',
    'Finished hands have replays and a recorded action history. The room ledger tracks chip movement. Our fair-play guide explains the encrypted deal and what the verification checks cover.',
  ],
];

function Brand() {
  return (
    <span className="home-brand">
      <RiPokerClubsLine aria-hidden />
      <span>
        4AM<span className="home-brand-name"> Casino</span>
      </span>
    </span>
  );
}
function JoinTable() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const navigate = useNavigate();
  function join(event: FormEvent) {
    event.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(clean)) {
      setError('Enter the 6-letter or number code from your host.');
      form.current?.querySelector('input')?.focus();
      return;
    }
    navigate(`/j/${clean}`);
  }
  return (
    <div className="home-join">
      <button
        type="button"
        className="home-join-toggle"
        aria-expanded={open}
        aria-controls="home-join-form"
        onClick={() => setOpen(!open)}
      >
        Have a room code?{' '}
        <span>
          Join your friends <RiArrowRightLine aria-hidden />
        </span>
      </button>
      <form
        ref={form}
        id="home-join-form"
        className="home-join-form"
        hidden={!open}
        onSubmit={join}
        noValidate
      >
        <label htmlFor="room-code">Room code</label>
        <div className="home-join-fields">
          <Input
            id="room-code"
            name="code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setError('');
            }}
            placeholder="ABC123"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={6}
            aria-invalid={!!error}
            aria-describedby={error ? 'room-code-error' : undefined}
          />
          <Button type="submit">
            Join table <RiArrowRightLine aria-hidden />
          </Button>
        </div>
        {error && (
          <p id="room-code-error" className="home-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
function RoomPreview() {
  const [view, setView] = useState<'lounge' | 'overhead'>('lounge');
  return (
    <figure className="home-room" id="experience">
      <div className="home-room-image">
        <img
          src={`/media/landing-${view}.webp`}
          width="1440"
          height="810"
          fetchPriority="high"
          alt={
            view === 'lounge'
              ? 'Six colourful characters sitting around the poker table in the warmly lit 4AM lounge.'
              : 'The same six-player table seen from above, with community cards clearly visible on the felt.'
          }
        />
        <div className="home-room-note">
          <RiVolumeUpLine aria-hidden />
          <span>
            A place to play.
            <br />
            <strong>A reason to hang out.</strong>
          </span>
        </div>
      </div>
      <figcaption>
        <span>
          Inside 4AM <span className="home-caption-detail">— an example room</span>
        </span>
        <div className="home-view-switch" role="group" aria-label="Preview camera view">
          <button type="button" aria-pressed={view === 'lounge'} onClick={() => setView('lounge')}>
            The lounge
          </button>
          <button
            type="button"
            aria-pressed={view === 'overhead'}
            onClick={() => setView('overhead')}
          >
            The table
          </button>
        </div>
      </figcaption>
    </figure>
  );
}
function HandPreview() {
  const [step, setStep] = useState(0);
  const reducedMotion = useReducedMotion();
  const street = streets[step]!;
  return (
    <div className="home-hand" role="group" aria-label="Interactive example hand">
      <div className="home-hand-header">
        <span>Texas Hold’em</span>
        <span>Example hand</span>
      </div>
      <div className="home-hand-play">
        <div className="home-hand-street" aria-live="polite" aria-atomic="true">
          <h3>{street.name}</h3>
          <p>{street.copy}</p>
        </div>
        <div className="home-board" role="group" aria-label="Community cards">
          {community.map((card, index) => (
            <div className="home-card-slot" key={index}>
              <PlayingCard
                card={index < street.count ? card : undefined}
                size="md"
                className="home-preview-card"
                deal={index < street.count && !reducedMotion}
              />
            </div>
          ))}
        </div>
        <div className="home-hole">
          <div className="home-hole-cards">
            {hole.map((card) => (
              <PlayingCard key={card} card={card} size="md" className="home-preview-card" />
            ))}
          </div>
          <span>
            Your cards
            <br />
            <strong>Only you can see these.</strong>
          </span>
        </div>
      </div>
      <div className="home-hand-footer">
        <span>
          Try a deal <RiArrowRightUpLine aria-hidden />
        </span>
        <Button type="button" onClick={() => setStep((step + 1) % streets.length)}>
          {step === 3 ? <RiRestartLine aria-hidden /> : null}
          {street.next}
          {step < 3 ? <RiArrowRightLine aria-hidden /> : null}
        </Button>
      </div>
    </div>
  );
}
export function LandingPage() {
  const signedIn = useStore((s) => !!s.auth.token);
  const destination = signedIn ? '/lobby' : '/login';
  const action = signedIn ? 'Open your lobby' : 'Start a table';
  return (
    <div className="home-page">
      <a className="home-skip" href="#main">
        Skip to content
      </a>
      <header className="home-header home-wrap">
        <Link to="/" aria-label="4AM Casino home">
          <Brand />
        </Link>
        <nav aria-label="Main navigation">
          <a href="#experience">The experience</a>
          <a href="#how-it-works">How it works</a>
          <a href="#questions">Questions</a>
        </nav>
        <div className="home-header-actions">
          <AppearanceToggle compact />
          <ButtonLink
            href={destination}
            variant="secondary"
            className="home-login"
            trailingIcon={RiArrowRightUpLine}
          >
            {signedIn ? 'Your lobby' : 'Log in'}
          </ButtonLink>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="home-hero home-wrap" aria-labelledby="home-title">
          <div className="home-hero-copy">
            <h1 id="home-title">
              Your people.
              <br />
              Your poker night.
            </h1>
            <div className="home-hero-invite">
              <p>
                Pull up a chair. Play a few hands. Stay for the conversation. Your favourite group
                chat now has a poker table.
              </p>
              <div className="home-start">
                <ButtonLink
                  href={destination}
                  trailingIcon={RiArrowRightUpLine}
                  className="home-primary"
                >
                  {action}
                </ButtonLink>
                <span>
                  Play-money poker.
                  <br />
                  Right in your browser.
                </span>
              </div>
              <JoinTable />
            </div>
          </div>
          <RoomPreview />
          <div className="home-essentials" role="group" aria-label="Included at every table">
            <span>
              <RiCheckLine aria-hidden />
              Private rooms
            </span>
            <span>
              <RiCheckLine aria-hidden />
              Voice & chat
            </span>
            <span>
              <RiCheckLine aria-hidden />
              2D & 3D views
            </span>
            <span>
              <RiCheckLine aria-hidden />
              Hand replays
            </span>
          </div>
        </section>
        <section className="home-setup home-wrap" id="how-it-works" aria-labelledby="setup-title">
          <div>
            <h2 id="setup-title">
              The plan is simple.
              <br />
              Get everyone in.
            </h2>
            <p className="home-section-lead">
              No venue to book. No chips to count out. Just a table with room for your friends.
            </p>
            <LinkButton href={destination} trailingIcon={RiArrowRightLine}>
              Make tonight poker night
            </LinkButton>
          </div>
          <ol className="home-steps">
            <li>
              <h3>Make it your table.</h3>
              <p>
                Create a private room and choose your blinds. The host gets things ready for the
                first hand.
              </p>
            </li>
            <li>
              <h3>Drop the link in the chat.</h3>
              <p>
                Share the invite link or room code. Your friends sign in, join the room, and pick a
                seat.
              </p>
            </li>
            <li>
              <h3>Deal. Talk. Run it back.</h3>
              <p>
                Play Texas Hold’em together. Switch views, react to a hand, or get up and explore
                between games.
              </p>
            </li>
          </ol>
        </section>
        <section className="home-game-section" aria-labelledby="game-title">
          <div className="home-wrap home-game">
            <HandPreview />
            <div className="home-game-copy">
              <h2 id="game-title">
                All the tension.
                <br />
                None of the stakes.
              </h2>
              <p className="home-section-lead">
                The hopeful flop. The unexpected river. The friend who definitely has it this time.
                Real poker moments, play-money chips.
              </p>
              <p>
                Keep your focus on the cards in 2D, or settle into the lounge in 3D. It’s the same
                hand, with everyone at the same table.
              </p>
              <a className="home-text-link" href="#experience">
                Take a look around <RiArrowRightLine aria-hidden />
              </a>
            </div>
          </div>
        </section>
        <section className="home-trust home-wrap" aria-labelledby="trust-title">
          <div>
            <h2 id="trust-title">
              Good games.
              <br />
              Nothing swept under the table.
            </h2>
            <p className="home-section-lead">
              An encrypted deal, a record of every chip, and replays for the hands you’re still
              talking about.
            </p>
            <LinkButton href="/fair" trailingIcon={RiArrowRightLine}>
              Read the fair-play guide
            </LinkButton>
          </div>
          <div className="home-trust-details">
            <div>
              <h3>Your cards stay yours.</h3>
              <p>
                Players participate in an encrypted shuffle. The fair-play guide explains how cards
                are dealt and verified.
              </p>
            </div>
            <div>
              <h3>The night adds up.</h3>
              <p>
                Follow buy-ins, chip transfers, and settlement in the room ledger. Revisit finished
                hands in the replay viewer.
              </p>
            </div>
            <a
              href="https://github.com/notpritam/4amcasino"
              target="_blank"
              rel="noreferrer"
              className="home-source"
            >
              <RiGithubLine aria-hidden />
              Open source. Open to a closer look.
              <RiArrowRightUpLine aria-hidden />
            </a>
          </div>
        </section>
        <section className="home-faq home-wrap" id="questions" aria-labelledby="faq-title">
          <h2 id="faq-title">Before you sit down.</h2>
          <div>
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <RiArrowDownSLine aria-hidden />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="home-close home-wrap" aria-labelledby="close-title">
          <div>
            <h2 id="close-title">
              Same friends.
              <br />
              New favourite place.
            </h2>
            <p>Someone has to start the group chat. Make it you.</p>
          </div>
          <ButtonLink href={destination} trailingIcon={RiArrowRightUpLine} className="home-primary">
            {action}
          </ButtonLink>
        </section>
      </main>
      <footer className="home-footer home-wrap">
        <Link to="/" aria-label="4AM Casino home">
          <Brand />
        </Link>
        <p>For the love of the game. Play-money only.</p>
        <nav aria-label="Footer">
          <Link to="/fair">Fair play</Link>
          <a href="https://github.com/notpritam/4amcasino">GitHub</a>
          <a href="https://github.com/notpritam/4amcasino/blob/main/LICENSE">License</a>
        </nav>
      </footer>
    </div>
  );
}
