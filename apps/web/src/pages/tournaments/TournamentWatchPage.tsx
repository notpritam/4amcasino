import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  RiArrowLeftLine,
  RiDownloadLine,
  RiExternalLinkLine,
  RiRecordCircleLine,
  RiStopCircleLine,
} from '@remixicon/react';
import type { ArenaResult, PlayerAction, TournamentState } from '@4am/shared';
import { carriesStacks, tournamentFormatLabel } from '@4am/shared';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { Button, Spinner } from '../../shared/ui/index.tsx';
import { AppearanceToggle } from '../../shared/ui/AppearanceToggle.tsx';
import { safeExternalUrl, SponsorPlacements } from './SponsorPlacements.tsx';
import './broadcast.css';

type HandReplay = {
  result: ArenaResult;
  actions: {
    userId: number;
    actionSeq: number;
    action: PlayerAction;
    timedOut: boolean;
    ts: number;
  }[];
};
const number = (value: number) => value.toLocaleString();
const signed = (value: number) => `${value > 0 ? '+' : ''}${number(value)}`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Connection interrupted. Please try again.';
const time = (value: number) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

class PublicRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Never use the signed-in API client here, even when the viewer is a player. */
async function publicRequest<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { credentials: 'omit', signal, cache: 'no-store' });
  if (!response.ok) {
    throw new PublicRequestError(
      response.status,
      response.status === 404 || response.status === 403
        ? 'This tournament is not available for public watching. It may be private or awaiting approval.'
        : response.status === 409
          ? 'This hand is still in progress. Its replay becomes available after it finishes.'
          : 'Public updates are temporarily unavailable. We’ll keep trying.',
    );
  }
  return response.json() as Promise<T>;
}

export function TournamentWatchPage() {
  const { id } = useParams();
  return id ? (
    <PublicTournament key={id} id={id} />
  ) : (
    <main className="broadcast-page">
      <h1>Tournament not found</h1>
      <Link to="/tournaments">Browse tournaments</Link>
    </main>
  );
}

function PublicTournament({ id }: { id: string }) {
  const [state, setState] = useState<TournamentState | null>(null);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [hidden, setHidden] = useState(document.hidden);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending || document.hidden || controller.signal.aborted) return;
      pending = true;
      try {
        const next = await publicRequest<TournamentState>(
          `/api/tournaments/${encodeURIComponent(id)}/watch`,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setState(next);
          setLastUpdated(Date.now());
          setError('');
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          if (cause instanceof PublicRequestError && [403, 404].includes(cause.status))
            setState(null);
          setError(errorText(cause));
        }
      } finally {
        pending = false;
      }
    };
    const onVisibility = () => {
      setHidden(document.hidden);
      if (!document.hidden) void load();
    };
    void load();
    const timer = window.setInterval(() => void load(), 1500);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [id, retry]);

  const streamUrl = safeExternalUrl(state?.policy.streamUrl);
  const meetUrl = safeExternalUrl(state?.policy.meetUrl);
  return (
    <main className="broadcast-page">
      <nav className="broadcast-nav" aria-label="Tournament navigation">
        <Link className="broadcast-brand" to="/">
          4AM Casino
        </Link>
        <div className="broadcast-controls">
          <Link className="broadcast-link" to={`/tournaments/${encodeURIComponent(id)}`}>
            <RiArrowLeftLine size={16} aria-hidden="true" /> Tournament details
          </Link>
          <AppearanceToggle compact />
        </div>
      </nav>
      {!state ? (
        <section className="broadcast-unavailable">
          {error ? (
            <>
              <h1>Public watch unavailable</h1>
              <p className="broadcast-muted" role="alert">
                {error}
              </p>
              <div className="broadcast-controls">
                <Button
                  onClick={() => {
                    setError('');
                    setRetry((value) => value + 1);
                  }}
                >
                  Try again
                </Button>
                <Link className="broadcast-link" to="/tournaments">
                  Browse tournaments
                </Link>
              </div>
            </>
          ) : (
            <Spinner label="Loading public tournament…" />
          )}
        </section>
      ) : (
        <>
          <header className="broadcast-header">
            <div>
              <h1>{state.name}</h1>
              <p className="broadcast-muted">
                {state.description ||
                  'Watch the table, follow the standings, and review every completed hand.'}
              </p>
            </div>
            <span
              className={`broadcast-status ${state.status === 'running' && !error && !hidden ? 'is-live' : ''}`}
            >
              {error
                ? 'Updates interrupted'
                : hidden
                  ? 'Updates paused'
                  : state.status === 'running'
                    ? 'Live · public table'
                    : state.status === 'registration'
                      ? 'Enrollment open'
                      : state.status === 'completed'
                        ? 'Tournament complete'
                        : state.status === 'cancelled'
                          ? 'Tournament cancelled'
                          : 'Tournament paused'}
            </span>
          </header>
          {error && (
            <p className="broadcast-error" role="alert">
              {error} {lastUpdated && `Showing the last update from ${time(lastUpdated)}.`}
            </p>
          )}
          <div className="broadcast-layout">
            <div className="broadcast-main">
              <LiveTable state={state} />
              <CompletedHands id={id} state={state} />
            </div>
            <aside className="broadcast-sidebar" aria-label="Tournament information">
              <Standings state={state} />
              {(streamUrl || meetUrl) && (
                <section className="broadcast-panel">
                  <h2>Join the broadcast</h2>
                  <div className="broadcast-external-links">
                    {streamUrl && (
                      <a
                        className="broadcast-link"
                        href={streamUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open stream <RiExternalLinkLine size={16} aria-label="Opens in a new tab" />
                      </a>
                    )}
                    {meetUrl && (
                      <a
                        className="broadcast-link"
                        href={meetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Google Meet{' '}
                        <RiExternalLinkLine size={16} aria-label="Opens in a new tab" />
                      </a>
                    )}
                  </div>
                  <p className="broadcast-muted broadcast-small">
                    External links open separately. This page does not control recording in Google
                    Meet.
                  </p>
                </section>
              )}
              <LocalRecording tournamentId={id} />
              <SponsorPlacements placement="watch" tournamentId={id} />
            </aside>
          </div>
          <footer className="broadcast-footer">
            <span>Public view · Live hole cards stay hidden, including your own.</span>
            <span>
              {lastUpdated ? `Updated ${time(lastUpdated)}` : 'Connecting…'} · Competition chips
            </span>
          </footer>
        </>
      )}
    </main>
  );
}

function LiveTable({ state }: { state: TournamentState }) {
  const round = state.round;
  const name = (userId: number) =>
    state.entries.find((entry) => entry.userId === userId)?.agentName ?? `Player ${userId}`;
  const complete = !!round?.result;
  const running = state.status === 'running' && !complete;
  return (
    <section className="broadcast-panel broadcast-table" aria-labelledby="broadcast-table-title">
      <div className="broadcast-section-heading">
        <h2 id="broadcast-table-title">
          {state.status === 'registration'
            ? 'The table is assembling'
            : round
              ? `Hand ${number(round.handNumber)}${complete ? ' · finished' : ''}`
              : 'Waiting for the table'}
        </h2>
        <span className="broadcast-muted broadcast-small">
          {number(state.completedHands)} / {number(state.handLimit)} hands
        </span>
      </div>
      {state.status === 'registration' ? (
        <div className="broadcast-waiting">
          <p>
            {state.policy.startsAt
              ? `Scheduled for ${new Date(state.policy.startsAt).toLocaleString()}.`
              : 'Play begins when the organizer starts the tournament.'}
          </p>
          <p className="broadcast-muted">
            {state.entries.length} of {state.capacity} seats filled.{' '}
            {state.scheduleNote || 'The live board and decisions appear here when play starts.'}
          </p>
          <Link className="broadcast-link" to={`/tournaments/${encodeURIComponent(state.id)}`}>
            View rules and enroll <RiExternalLinkLine size={16} aria-hidden="true" />
          </Link>
        </div>
      ) : !round ? (
        <p className="broadcast-muted broadcast-waiting">
          {state.status === 'cancelled'
            ? 'This tournament has ended.'
            : 'The next hand will appear here when it starts.'}
        </p>
      ) : (
        <>
          <div className="broadcast-table-meta">
            <span>
              {round.betting.street[0]!.toUpperCase() + round.betting.street.slice(1)}
              {complete ? ' · final board' : ''}
            </span>
            <span>
              Blinds {number(round.betting.sb)} / {number(round.betting.bb)}
            </span>
            <strong>
              {complete
                ? 'Hand settled'
                : `Pot ${number(round.seats.reduce((sum, seat) => sum + seat.total, 0))}`}
            </strong>
          </div>
          <div
            className="broadcast-board"
            aria-label={
              complete
                ? `Final community cards for completed hand ${round.handNumber}`
                : 'Live community cards'
            }
          >
            {round.board.length ? (
              round.board.map((card) => <PlayingCard key={card} card={card} size="md" />)
            ) : (
              <p className="broadcast-muted">
                {complete
                  ? 'The hand ended before the flop.'
                  : 'Preflop · Waiting for community cards'}
              </p>
            )}
          </div>
          <div className="broadcast-turn" role="status">
            {complete ? (
              'Hand finished. Review the disclosed cards and decisions below.'
            ) : running && round.toActUserId !== null ? (
              <>
                <strong>{name(round.toActUserId)}</strong> to act{' '}
                <span className="broadcast-muted">
                  · Decision {round.actionSeq + 1}
                  {state.deadline ? ` · due ${time(state.deadline)}` : ''}
                </span>
              </>
            ) : state.status === 'paused' ? (
              'Play is paused.'
            ) : state.status === 'cancelled' || state.status === 'completed' ? (
              'The tournament has ended.'
            ) : (
              'Waiting for the next hand.'
            )}
          </div>
          <ol className="broadcast-seats" aria-label="Table seats">
            {round.seats.map((seat) => (
              <li
                key={seat.userId}
                className={running && round.toActUserId === seat.userId ? 'is-acting' : ''}
              >
                <div className="broadcast-seat-name">
                  <span className="broadcast-seat-number">{seat.seat + 1}</span>
                  <strong>{name(seat.userId)}</strong>
                  {seat.seat === round.betting.buttonSeat && (
                    <span className="broadcast-dealer" title="Dealer button">
                      D
                    </span>
                  )}
                </div>
                <div className="broadcast-seat-chips">
                  <strong>
                    {number(
                      complete
                        ? (round.result?.net.find((entry) => entry.userId === seat.userId)
                            ?.endStack ??
                            seat.stack +
                              (round.result?.net.find((entry) => entry.userId === seat.userId)
                                ?.won ?? 0))
                        : seat.stack,
                    )}
                  </strong>
                  <span className="broadcast-muted">
                    {seat.folded
                      ? 'Folded'
                      : seat.allIn
                        ? 'All-in'
                        : complete
                          ? 'Final stack'
                          : `${number(seat.committed)} committed`}
                  </span>
                </div>
                {!complete && (
                  <div className="broadcast-hole-backs" aria-label="Live hole cards hidden">
                    <PlayingCard faceDown size="xs" />
                    <PlayingCard faceDown size="xs" />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function Standings({ state }: { state: TournamentState }) {
  const knockout = carriesStacks(state.policy.format);
  return (
    <section className="broadcast-panel">
      <div className="broadcast-section-heading">
        <h2>{state.status === 'completed' ? 'Final standings' : 'Standings'}</h2>
        <span className="broadcast-muted broadcast-small">
          {tournamentFormatLabel(state.policy.format)}
        </span>
      </div>
      {state.entries.length ? (
        <table className="broadcast-standings">
          <caption className="sr-only">Tournament standings in competition chips</caption>
          <thead>
            <tr>
              <th scope="col">Place / player</th>
              <th scope="col">{knockout ? 'Stack' : 'Net chips'}</th>
            </tr>
          </thead>
          <tbody>
            {state.entries.map((entry) => (
              <tr key={entry.userId}>
                <td>
                  <div className="broadcast-standing-name">
                    <span className="broadcast-rank">{entry.rank}</span>
                    <div>
                      <strong>{entry.agentName}</strong>
                      <span className="broadcast-muted broadcast-small">
                        {entry.eliminatedHand !== null
                          ? `Out · Hand ${entry.eliminatedHand}`
                          : `${entry.hands} hands · ${entry.wins} wins`}
                      </span>
                    </div>
                  </div>
                </td>
                <td
                  className={
                    !knockout && entry.net > 0
                      ? 'broadcast-positive'
                      : !knockout && entry.net < 0
                        ? 'broadcast-negative'
                        : ''
                  }
                >
                  {knockout ? number(entry.stack) : signed(entry.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="broadcast-muted">No entrants yet. The standings appear as players enroll.</p>
      )}
    </section>
  );
}

function CompletedHands({ id, state }: { id: string; state: TournamentState }) {
  const [results, setResults] = useState<ArenaResult[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [followLatest, setFollowLatest] = useState(true);
  const [replay, setReplay] = useState<HandReplay | null>(null);
  const [listError, setListError] = useState('');
  const [handError, setHandError] = useState('');
  const [retry, setRetry] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const cursor = useRef(0);
  const actionList = useRef<HTMLOListElement | null>(null);
  const finished = state.completedHands;

  useEffect(() => {
    if (!finished) return;
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending || document.hidden || controller.signal.aborted) return;
      pending = true;
      try {
        let batch: ArenaResult[];
        do {
          const body = await publicRequest<{ results: ArenaResult[] }>(
            `/api/tournaments/${encodeURIComponent(id)}/results?after=${cursor.current}`,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          batch = body.results.filter((result) => result.handNumber <= finished);
          const nextCursor = Math.max(cursor.current, ...batch.map((result) => result.handNumber));
          if (nextCursor === cursor.current) break;
          cursor.current = nextCursor;
          setResults((previous) =>
            [
              ...new Map(
                [...previous, ...batch].map((result) => [result.handNumber, result]),
              ).values(),
            ].sort((a, b) => b.handNumber - a.handNumber),
          );
        } while (batch.length === 100 && cursor.current < finished && !document.hidden);
        setListError('');
      } catch (cause) {
        if (!controller.signal.aborted) setListError(errorText(cause));
      } finally {
        pending = false;
      }
    };
    void load();
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id, finished, retry]);

  const latest =
    results[0]?.handNumber ??
    (state.lastResult && state.lastResult.handNumber <= finished
      ? state.lastResult.handNumber
      : null);
  const selectedHand = followLatest ? latest : selected;
  useEffect(() => {
    setReplay(null);
    setHandError('');
    setStep(0);
    setPlaying(false);
    if (selectedHand === null) return;
    const controller = new AbortController();
    void publicRequest<HandReplay>(
      `/api/tournaments/${encodeURIComponent(id)}/hands/${selectedHand}`,
      controller.signal,
    )
      .then((body) => {
        if (!controller.signal.aborted)
          setReplay({
            result: body.result,
            actions: [...body.actions].sort((a, b) => a.actionSeq - b.actionSeq),
          });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setHandError(errorText(cause));
      });
    return () => controller.abort();
  }, [id, selectedHand, retry]);

  const actionCount = replay?.actions.length ?? 0;
  useEffect(() => {
    if (!playing || !actionCount) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setStep((value) => Math.min(value + 1, actionCount));
    }, 1000);
    const onVisible = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [playing, actionCount]);
  useEffect(() => {
    if (step >= actionCount) setPlaying(false);
  }, [step, actionCount]);
  useEffect(() => {
    if (actionList.current) actionList.current.scrollTop = actionList.current.scrollHeight;
  }, [step]);

  const name = (userId: number) =>
    state.entries.find((entry) => entry.userId === userId)?.agentName ?? `Player ${userId}`;
  const options =
    latest !== null && !results.some((result) => result.handNumber === latest)
      ? [latest, ...results.map((result) => result.handNumber)]
      : results.map((result) => result.handNumber);
  return (
    <section className="broadcast-panel broadcast-review" aria-labelledby="broadcast-review-title">
      <div className="broadcast-section-heading">
        <div>
          <h2 id="broadcast-review-title">Completed-hand review</h2>
          <p className="broadcast-muted broadcast-small">
            Historical cards and decisions. The live table above stays separate.
          </p>
        </div>
        {!!finished && (
          <label className="broadcast-hand-select">
            Hand
            <select
              value={selectedHand ?? ''}
              onChange={(event) => {
                setSelected(Number(event.target.value));
                setFollowLatest(false);
              }}
            >
              {options.map((hand) => (
                <option value={hand} key={hand}>
                  Hand {number(hand)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!finished ? (
        <p className="broadcast-muted broadcast-waiting">
          The first replay appears after a hand finishes. Live hole cards are never shown here.
        </p>
      ) : (
        <>
          <label className="broadcast-checkbox">
            <input
              type="checkbox"
              checked={followLatest}
              onChange={(event) => {
                setSelected(selectedHand);
                setFollowLatest(event.target.checked);
              }}
            />
            Follow the latest finished hand
          </label>
          {listError && (
            <p className="broadcast-error" role="alert">
              Could not load the hand list. {listError}{' '}
              <button className="broadcast-link" onClick={() => setRetry((value) => value + 1)}>
                Retry
              </button>
            </p>
          )}
          {handError ? (
            <p className="broadcast-error" role="alert">
              {handError}{' '}
              <button className="broadcast-link" onClick={() => setRetry((value) => value + 1)}>
                Retry replay
              </button>
            </p>
          ) : !replay ? (
            <Spinner label="Loading completed hand…" />
          ) : (
            <>
              <div className="broadcast-final-label">
                <strong>Hand {replay.result.handNumber} · Final reveal</strong>
                <span>These cards are shown after the hand, including disclosed folded hands.</span>
              </div>
              <div
                className="broadcast-board broadcast-final-board"
                aria-label={`Completed hand ${replay.result.handNumber} final board`}
              >
                {replay.result.board.length ? (
                  replay.result.board.map((card) => (
                    <PlayingCard key={card} card={card} size="sm" />
                  ))
                ) : (
                  <p className="broadcast-muted">No community cards were dealt.</p>
                )}
              </div>
              <div className="broadcast-reveals">
                {replay.result.net.map((entry) => {
                  const cards =
                    replay.result.revealed.find((reveal) => reveal.userId === entry.userId)
                      ?.cards ?? [];
                  return (
                    <div className="broadcast-reveal" key={entry.userId}>
                      <div>
                        <strong>{name(entry.userId)}</strong>
                        <span
                          className={
                            entry.net > 0
                              ? 'broadcast-positive'
                              : entry.net < 0
                                ? 'broadcast-negative'
                                : 'broadcast-muted'
                          }
                        >
                          {signed(entry.net)} chips
                          {entry.won > 0 ? ` · Won ${number(entry.won)}` : ''}
                        </span>
                      </div>
                      <div className="broadcast-reveal-cards">
                        {cards.length ? (
                          cards.map((card) => <PlayingCard card={card} key={card} size="sm" />)
                        ) : (
                          <span className="broadcast-muted broadcast-small">Not disclosed</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="broadcast-decisions">
                <div className="broadcast-section-heading">
                  <div>
                    <h3>Decision replay</h3>
                    <p className="broadcast-muted broadcast-small">
                      Step through recorded actions. The final cards above do not change.
                    </p>
                  </div>
                  <span className="broadcast-muted broadcast-small" aria-live="polite">
                    {step} / {actionCount}
                  </span>
                </div>
                {actionCount ? (
                  <>
                    <div className="broadcast-controls">
                      <Button
                        variant="secondary"
                        disabled={step === 0}
                        onClick={() => {
                          setPlaying(false);
                          setStep((value) => Math.max(0, value - 1));
                        }}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (step >= actionCount) setStep(0);
                          setPlaying((value) => !value);
                        }}
                      >
                        {playing
                          ? 'Pause replay'
                          : step >= actionCount
                            ? 'Play again'
                            : 'Play decisions'}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={step >= actionCount}
                        onClick={() => {
                          setPlaying(false);
                          setStep((value) => Math.min(actionCount, value + 1));
                        }}
                      >
                        Next
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={step >= actionCount}
                        onClick={() => {
                          setPlaying(false);
                          setStep(actionCount);
                        }}
                      >
                        Show all
                      </Button>
                    </div>
                    <ol
                      ref={actionList}
                      className="broadcast-action-list"
                      aria-label="Recorded actions"
                    >
                      {step === 0 ? (
                        <li className="broadcast-muted">
                          Ready to replay {actionCount} decisions. Select Next or Play decisions.
                        </li>
                      ) : (
                        replay.actions.slice(0, step).map((item, index) => (
                          <li
                            key={`${item.actionSeq}-${index}`}
                            aria-current={index === step - 1 ? 'step' : undefined}
                          >
                            <span className="broadcast-action-seq">{index + 1}</span>
                            <div>
                              <strong>{name(item.userId)}</strong>
                              <span>
                                {item.action.type === 'raise'
                                  ? 'Raise to'
                                  : item.action.type === 'bet'
                                    ? 'Bet'
                                    : item.action.type === 'fold'
                                      ? 'Fold'
                                      : item.action.type === 'call'
                                        ? 'Call'
                                        : 'Check'}
                                {item.action.amount !== undefined
                                  ? ` ${number(item.action.amount)}`
                                  : ''}
                                {item.timedOut ? ' · Automatic action after timeout' : ''}
                              </span>
                            </div>
                            <time dateTime={new Date(item.ts).toISOString()}>{time(item.ts)}</time>
                          </li>
                        ))
                      )}
                    </ol>
                  </>
                ) : (
                  <p className="broadcast-muted">
                    No player decisions were recorded for this hand.
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

const MAX_RECORDING_MS = 20 * 60 * 1000;
const MAX_RECORDING_BYTES = 200 * 1024 * 1024;
type RecordingPhase = 'idle' | 'choosing' | 'recording' | 'stopping';

function LocalRecording({ tournamentId }: { tournamentId: string }) {
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [includeAudio, setIncludeAudio] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState('');
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const interval = useRef<number | null>(null);
  const deadline = useRef<number | null>(null);
  const objectUrl = useRef<string | null>(null);
  const mounted = useRef(true);
  const request = useRef(0);
  const pending = useRef(false);
  const supported =
    typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  function clearTimers() {
    if (interval.current !== null) window.clearInterval(interval.current);
    if (deadline.current !== null) window.clearTimeout(deadline.current);
    interval.current = null;
    deadline.current = null;
  }
  function stopTracks() {
    stream.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stream.current = null;
  }
  function stop(message?: string) {
    clearTimers();
    if (message && mounted.current) setNotice(message);
    if (recorder.current && recorder.current.state !== 'inactive') {
      if (mounted.current) setPhase('stopping');
      recorder.current.stop();
    }
    stopTracks();
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
      pending.current = false;
      clearTimers();
      const current = recorder.current;
      if (current) {
        current.ondataavailable = null;
        current.onstop = null;
        current.onerror = null;
        if (current.state !== 'inactive') current.stop();
      }
      recorder.current = null;
      stopTracks();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    };
  }, []);

  async function start() {
    if (!supported || pending.current) return;
    pending.current = true;
    const token = ++request.current;
    setPhase('choosing');
    setNotice('Choose the tab, window, or screen to record in the browser picker.');
    setElapsed(0);
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setDownload(null);
    let captured: MediaStream | null = null;
    try {
      // This call stays directly inside the user click. These are picker hints,
      // never a substitute for the browser's explicit surface selection.
      const options: DisplayMediaStreamOptions & {
        systemAudio: string;
        windowAudio: string;
        surfaceSwitching: string;
        preferCurrentTab: boolean;
      } = {
        video: { displaySurface: 'browser', frameRate: 30 },
        audio: includeAudio,
        systemAudio: 'exclude',
        windowAudio: 'exclude',
        surfaceSwitching: 'exclude',
        preferCurrentTab: true,
      };
      captured = await navigator.mediaDevices.getDisplayMedia(options);
      if (!mounted.current || token !== request.current) {
        captured.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = captured.getVideoTracks()[0];
      if (!video || video.readyState !== 'live')
        throw new Error('The selected surface is no longer available. Try recording again.');
      // Only tab audio is eligible. Remove every audio track for screen/window
      // capture, and conservatively remove it when the browser cannot identify the surface.
      if (!includeAudio || video.getSettings().displaySurface !== 'browser') {
        captured.getAudioTracks().forEach((track) => {
          captured!.removeTrack(track);
          track.stop();
        });
      }
      const mime = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ].find((value) => MediaRecorder.isTypeSupported(value));
      const current = new MediaRecorder(captured, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: 1_000_000,
      });
      recorder.current = current;
      stream.current = captured;
      const chunks: Blob[] = [];
      let bytes = 0;
      let failed = false;
      const began = Date.now();
      current.ondataavailable = (event) => {
        if (!mounted.current || token !== request.current || failed || !event.data.size) return;
        if (bytes + event.data.size > MAX_RECORDING_BYTES) {
          failed = true;
          chunks.length = 0;
          stop(
            'The browser exceeded the 200 MB recording limit. This clip could not be saved; try a shorter recording.',
          );
          return;
        }
        chunks.push(event.data);
        bytes += event.data.size;
        if (bytes >= MAX_RECORDING_BYTES * 0.95)
          stop('Recording stopped near the 200 MB limit. Download your clip below.');
        else if (Date.now() - began >= MAX_RECORDING_MS)
          stop('Recording stopped at the 20-minute limit. Download your clip below.');
      };
      current.onerror = () => {
        failed = true;
        chunks.length = 0;
        stop('The browser could not finish this recording. Choose a surface and try again.');
      };
      current.onstop = () => {
        clearTimers();
        stopTracks();
        recorder.current = null;
        pending.current = false;
        if (!mounted.current || token !== request.current) return;
        setPhase('idle');
        if (failed) return;
        if (!chunks.length) {
          setNotice('No video was captured. Choose a surface and try again.');
          return;
        }
        const type = current.mimeType || chunks.find((chunk) => chunk.type)?.type || mime || '';
        const extension = type.includes('mp4') ? 'mp4' : type.includes('webm') ? 'webm' : null;
        if (!extension) {
          chunks.length = 0;
          setNotice('This browser selected an unsupported video format. Try another browser.');
          return;
        }
        const blob = new Blob(chunks, { type });
        chunks.length = 0;
        const url = URL.createObjectURL(blob);
        objectUrl.current = url;
        setDownload({
          url,
          filename: `4am-${tournamentId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)}-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`,
        });
        setNotice((previous) =>
          /limit|stopped|ended/.test(previous)
            ? previous
            : 'Your clip is ready. Download it before leaving or starting another recording.',
        );
      };
      video.onended = () => stop('Screen sharing ended. Download your clip below.');
      current.start(1000);
      setPhase('recording');
      setNotice(
        captured.getAudioTracks().length
          ? 'Recording the selected tab with its shared audio.'
          : includeAudio
            ? 'Recording video only. The selected surface did not provide tab audio.'
            : 'Recording the selected surface without audio.',
      );
      interval.current = window.setInterval(() => {
        const duration = Date.now() - began;
        setElapsed(Math.floor(duration / 1000));
        if (duration >= MAX_RECORDING_MS)
          stop('Recording stopped at the 20-minute limit. Download your clip below.');
      }, 1000);
      deadline.current = window.setTimeout(
        () => stop('Recording stopped at the 20-minute limit. Download your clip below.'),
        MAX_RECORDING_MS,
      );
    } catch (cause) {
      captured?.getTracks().forEach((track) => track.stop());
      clearTimers();
      stopTracks();
      recorder.current = null;
      pending.current = false;
      if (!mounted.current || token !== request.current) return;
      setPhase('idle');
      setNotice(
        cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? 'Recording was cancelled or permission was denied. Select Record tab to try again.'
          : cause instanceof DOMException && cause.name === 'NotReadableError'
            ? 'The browser could not capture that surface. Check screen-recording permissions and try again.'
            : errorText(cause),
      );
    }
  }

  return (
    <section
      className="broadcast-panel broadcast-recording"
      aria-labelledby="broadcast-recording-title"
    >
      <h2 id="broadcast-recording-title">Record a local clip</h2>
      <p className="broadcast-muted broadcast-small">
        Choose a surface in your browser’s picker. Only that selection is recorded; the file stays
        on this device.
      </p>
      {supported ? (
        <>
          <label className="broadcast-checkbox">
            <input
              type="checkbox"
              checked={includeAudio}
              disabled={phase !== 'idle'}
              onChange={(event) => setIncludeAudio(event.target.checked)}
            />
            Include shared tab audio
          </label>
          <p className="broadcast-muted broadcast-small">
            No microphone capture. Up to 20 minutes or 200 MB per clip.
          </p>
          <div className="broadcast-controls">
            {phase === 'recording' || phase === 'stopping' ? (
              <>
                <Button
                  variant="danger"
                  disabled={phase === 'stopping'}
                  onClick={() => stop('Recording stopped. Download your clip below.')}
                >
                  <RiStopCircleLine size={17} aria-hidden="true" />
                  {phase === 'stopping' ? 'Finishing…' : 'Stop recording'}
                </Button>
                <span
                  className="broadcast-recording-time"
                  aria-label={`${elapsed} seconds recorded`}
                >
                  {Math.floor(elapsed / 60)
                    .toString()
                    .padStart(2, '0')}
                  :{(elapsed % 60).toString().padStart(2, '0')}
                </span>
              </>
            ) : (
              <Button
                variant="secondary"
                disabled={phase === 'choosing'}
                onClick={() => void start()}
              >
                <RiRecordCircleLine size={17} aria-hidden="true" />
                {phase === 'choosing'
                  ? 'Choose a surface…'
                  : download
                    ? 'Record new clip'
                    : 'Record tab'}
              </Button>
            )}
          </div>
          {notice && (
            <p className="broadcast-recording-notice" role="status">
              {notice}
            </p>
          )}
          {download && (
            <a className="broadcast-download" href={download.url} download={download.filename}>
              <RiDownloadLine size={18} aria-hidden="true" />
              Download recording
            </a>
          )}
        </>
      ) : (
        <p className="broadcast-recording-notice">
          Tab recording is unavailable in this browser. Open this page in a browser with screen
          capture support to record a local clip.
        </p>
      )}
    </section>
  );
}
