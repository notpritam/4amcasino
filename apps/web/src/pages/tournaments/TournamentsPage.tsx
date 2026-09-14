import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RiArrowRightLine, RiAddLine, RiRobot2Line } from '@remixicon/react';
import type { PlayerAction, TournamentState, TournamentSummary } from '@4am/shared';
import { carriesStacks } from '@4am/shared';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { Button, Input, Spinner } from '../../shared/ui/index.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import './arena.css';
import { SponsorPlacements } from './SponsorPlacements.tsx';
import {
  ApprovalStatus,
  TournamentTerms,
  TournamentTermsForm,
  TournamentMediaForm,
  eventDate,
  formatName,
  safeExternalUrl,
} from './TournamentTerms.tsx';

const number = (n: number) => n.toLocaleString();
const signed = (n: number) => `${n > 0 ? '+' : ''}${number(n)}`;
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Request failed. Please try again.';
function Status({ status }: { status: string }) {
  return (
    <span className={`arena-status ${status}`}>
      {status === 'registration' ? 'Enrollment open' : status[0]!.toUpperCase() + status.slice(1)}
    </span>
  );
}

export function TournamentsPage() {
  const { id } = useParams();
  return id ? <TournamentDetail key={id} id={id} /> : <TournamentList />;
}
function TournamentList() {
  const auth = useStore((s) => s.auth);
  const [rows, setRows] = useState<TournamentSummary[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('Upcoming');
  const nav = useNavigate();
  const load = useCallback(() => {
    setError('');
    void api
      .tournaments()
      .then((r) => setRows(r.tournaments))
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);
  const visible = rows?.filter((t) =>
    filter === 'My proposals'
      ? t.ownerId === auth.userId
      : t.approvalStatus === 'approved' &&
        (filter === 'Upcoming'
          ? t.status === 'registration'
          : filter === 'Live'
            ? ['running', 'paused'].includes(t.status)
            : ['completed', 'cancelled'].includes(t.status)),
  );
  return (
    <main className="arena-page">
      <header className="arena-header">
        <div>
          <h1>Tournaments</h1>
          <p className="arena-muted">
            Find your next table. Read the terms, bring your agent, and play for the published
            prizes.
          </p>
        </div>
        <div className="arena-controls">
          {auth.token ? (
            <>
              <Link className="arena-link" to="/agents">
                Connect an agent
              </Link>
              <Button
                type="button"
                variant={creating ? 'secondary' : 'primary'}
                onClick={() => setCreating((v) => !v)}
              >
                <RiAddLine size={18} />
                {creating
                  ? 'Close form'
                  : auth.isPlatform
                    ? 'Create tournament'
                    : 'Propose a tournament'}
              </Button>
            </>
          ) : (
            <Link className="arena-link" to="/login?next=%2Ftournaments">
              Sign in to propose a tournament
            </Link>
          )}
        </div>
      </header>
      {error && (
        <div role="alert" className="arena-error">
          {error}{' '}
          <Button variant="ghost" onClick={load}>
            Retry
          </Button>
        </div>
      )}
      {creating && auth.token && (
        <section className="arena-panel tournament-create">
          <h2>{auth.isPlatform ? 'Publish a tournament' : 'Propose a tournament'}</h2>
          <TournamentTermsForm
            platform={!!auth.isPlatform}
            onSave={async (body) => {
              const result = await api.createTournament(body);
              nav(`/tournaments/${result.id}`);
            }}
          />
        </section>
      )}
      <div className="arena-grid">
        <section className="arena-panel" aria-label="Tournaments">
          <div className="arena-tabs tournament-filter" aria-label="Filter tournaments">
            {['Upcoming', 'Live', 'Past', ...(auth.token ? ['My proposals'] : [])].map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={filter === name}
                onClick={() => setFilter(name)}
              >
                {name}
              </button>
            ))}
          </div>
          {rows === null && !error ? (
            <Spinner label="Loading tournaments…" />
          ) : !visible?.length ? (
            <div className="arena-empty">
              <h2>
                {filter === 'My proposals'
                  ? 'Your next tournament starts here.'
                  : `No ${filter.toLowerCase()} tournaments yet.`}
              </h2>
              <p className="arena-muted">
                {filter === 'My proposals'
                  ? 'Set the format, schedule, entry terms and prizes, then submit your proposal for platform review.'
                  : filter === 'Upcoming'
                    ? 'Propose a fixed-hand league, knockout or freezeout to bring players together.'
                    : filter === 'Live'
                      ? 'Events appear here when play begins. Check upcoming tournaments for your next seat.'
                      : 'Completed and cancelled tournaments stay here with their saved standings and prizes.'}
              </p>
            </div>
          ) : (
            visible.map((t) => (
              <Link key={t.id} to={`/tournaments/${t.id}`} className="arena-row">
                <div>
                  <div className="arena-name">{t.name}</div>
                  <div className="arena-row-meta">
                    <span>{formatName(t.format)}</span>
                    <span>
                      {t.entrantCount ?? 0}/{t.capacity} entrants
                    </span>
                    <span>{t.entryFee ? `${number(t.entryFee)} chips entry` : 'Free entry'}</span>
                  </div>
                  <div className="arena-row-meta">
                    <Status status={t.status} />
                    {t.approvalStatus !== 'approved' && <ApprovalStatus tournament={t} />}
                    <span>
                      {t.status === 'completed'
                        ? 'Final standings available'
                        : t.status === 'cancelled'
                          ? 'Event closed'
                          : t.status === 'running'
                            ? 'Play in progress'
                            : t.status === 'paused'
                              ? 'Play paused'
                              : eventDate(t.policy.startsAt)}
                    </span>
                  </div>
                  {t.policy.guaranteedPool > 0 && (
                    <div className="arena-row-meta">
                      Organizer guarantee · {number(t.policy.guaranteedPool)} chips
                    </div>
                  )}
                </div>
                <RiArrowRightLine size={20} aria-hidden />
              </Link>
            ))
          )}
        </section>
        <aside className="arena-stack">
          <SponsorPlacements placement="directory" />
          <section className="arena-panel">
            <h2>Choose your format</h2>
            <h3>Fixed-hand league</h3>
            <p className="arena-muted">
              Stacks reset each hand. Compare net chips and BB/100 over a fixed run.
            </p>
            <h3 className="mt-5">Knockout</h3>
            <p className="arena-muted">
              Keep your stack between hands. Blinds rise on schedule and eliminated players leave
              play.
            </p>
          </section>
          <section className="arena-panel">
            <h2>Read before you enroll</h2>
            <p className="arena-muted">
              Entry fees, rewards, pot cuts and payout places are published before enrollment. Your
              accepted rule revision locks the terms.
            </p>
            <p className="arena-muted mt-3">
              All accounting uses competition chips and manual settlement, separate from cash and
              ordinary poker room balances.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
function TournamentDetail({ id }: { id: string }) {
  const auth = useStore((s) => s.auth);
  const [state, setState] = useState<TournamentState | null>(null);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [tab, setTab] = useState('Standings');
  const [amount, setAmount] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [acceptedRevision, setAcceptedRevision] = useState<number | null>(null);
  const refresh = useCallback(async () => {
    const s = await api.tournament(id);
    setState(s);
    return s;
  }, [id]);
  useEffect(() => {
    let active = true,
      loading = false;
    const load = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try {
        const s = await api.tournament(id);
        if (active) {
          setState(s);
          setPollError('');
        }
      } catch (e) {
        if (active) setPollError(errorText(e));
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);
  useEffect(() => setAmount(''), [state?.round?.handNumber, state?.round?.actionSeq]);
  async function mutate(fn: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (!state)
    return (
      <main className="arena-page">
        {error || pollError ? (
          <div role="alert" className="arena-error">
            {error || pollError}{' '}
            <Button onClick={() => void refresh().catch((e) => setError(errorText(e)))}>
              Retry
            </Button>
          </div>
        ) : (
          <Spinner label="Loading tournament…" />
        )}
      </main>
    );
  const me = state.entries.find((e) => e.userId === auth.userId);
  const organizer = state.ownerId === auth.userId || auth.isPlatform;
  const preStart = ['registration', 'pending', 'rejected'].includes(state.status);
  const round = state.round;
  const legal = state.status === 'running' ? round?.legalActions : null;
  const act = (action: PlayerAction) => {
    if (!round) return;
    void mutate(() =>
      api.tournamentAction(id, round.handNumber, round.actionSeq, crypto.randomUUID(), action),
    );
  };
  return (
    <main className="arena-page">
      <Link className="arena-link arena-detail-nav" to="/tournaments">
        All tournaments
      </Link>
      <header className="arena-header">
        <div>
          <h1>{state.name}</h1>
          <p className="arena-muted">
            {state.description || `${formatName(state.format)} for people and their agents.`}
          </p>
          <div className="arena-row-meta">
            <Status status={state.status} />
            <span>
              {state.entries.length}/{state.capacity} entrants
            </span>
            <span>
              {formatName(state.format)} ·{' '}
              {state.entryFee ? `${number(state.entryFee)} chips entry` : 'Free entry'}
            </span>
            <ApprovalStatus tournament={state} />
          </div>
        </div>
        <div className="arena-controls">
          {state.policy.publicWatch && state.approvalStatus === 'approved' && (
            <Link className="arena-link" to={`/tournaments/${id}/watch`}>
              Public watch page
            </Link>
          )}
          <Button
            variant="secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(location.href)
                .then(() => setNotice('Tournament link copied.'))
                .catch(() => setError('Could not copy. Copy the address from your browser.'))
            }
          >
            Copy invite link
          </Button>
          {me && (
            <Link className="arena-link" to={`/agents?kind=tournament&id=${id}`}>
              <RiRobot2Line size={18} className="inline mr-1" />
              Connect my agent
            </Link>
          )}
        </div>
      </header>
      {error && (
        <div className="arena-error" role="alert">
          {error}
        </div>
      )}
      {pollError && (
        <div className="arena-error" role="alert">
          Live updates interrupted: {pollError}
        </div>
      )}
      {notice && (
        <p className="arena-toast" role="status">
          {notice}
        </p>
      )}
      {state.approvalStatus !== 'approved' && state.status !== 'cancelled' && (
        <section className="arena-panel tournament-create">
          <h2>
            {state.approvalStatus === 'pending'
              ? 'Proposal awaiting approval'
              : 'Changes requested'}
          </h2>
          <p className="arena-muted">
            This proposal is private. Enrollment opens after platform approval.
          </p>
          {state.reviewNote && (
            <p className="arena-note mt-3">
              <strong>Platform review:</strong> {state.reviewNote}
            </p>
          )}
        </section>
      )}
      {editing && organizer && !state.termsLocked && (
        <section className="arena-panel tournament-create">
          <h2>Edit tournament terms</h2>
          <TournamentTermsForm
            key={state.revision}
            tournament={state}
            platform={!!auth.isPlatform}
            onCancel={() => setEditing(false)}
            onSave={async (body) => {
              await api.tournamentTerms(id, body);
              setEditing(false);
              await refresh();
              setNotice(
                auth.isPlatform ? 'Published terms updated.' : 'Proposal submitted for review.',
              );
            }}
          />
        </section>
      )}
      <div className="arena-grid">
        <div className="arena-stack">
          <section className="arena-panel">
            <div className="arena-controls" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ marginBottom: 0 }}>
                {preStart
                  ? state.approvalStatus === 'approved'
                    ? 'Take your place'
                    : 'Enrollment pending approval'
                  : state.status === 'completed'
                    ? 'Tournament complete'
                    : state.status === 'cancelled'
                      ? 'Tournament cancelled'
                      : `Hand ${round?.handNumber ?? 0}`}
              </h2>
              <span className="arena-muted">
                {number(state.completedHands)} / {number(state.handLimit)} hands
              </span>
            </div>
            <progress
              className="arena-progress"
              value={state.completedHands}
              max={state.handLimit}
              aria-label="Tournament hand progress"
            />
            {preStart ? (
              state.approvalStatus !== 'approved' ? (
                <p className="arena-muted mt-4">
                  The platform must approve this revision before entrants can accept the terms.
                </p>
              ) : me ? (
                <div className="arena-empty">
                  <h3>You’re enrolled as {me.agentName}.</h3>
                  <p className="arena-muted">
                    {me.kind === 'agent'
                      ? 'Connect your agent before the tournament starts.'
                      : 'Keep this page open to take your turns.'}
                  </p>
                  {state.status === 'registration' && (
                    <Button
                      className="mt-4"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void mutate(() => api.withdrawTournament(id))}
                    >
                      Withdraw
                    </Button>
                  )}
                  {state.status === 'running' && me.eliminatedHand === null && (
                    <form
                      className="mt-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const hands = Number(new FormData(e.currentTarget).get('hands'));
                        void mutate(() => api.sitOutTournament(id, hands));
                      }}
                    >
                      <label className="arena-field">
                        Sit out · hands
                        <Input
                          name="hands"
                          type="number"
                          min={1}
                          max={Math.max(
                            1,
                            Math.min(state.policy.maxSitOutPerRequest, me.sitOutRemaining),
                          )}
                          step={1}
                          defaultValue={1}
                          disabled={busy || me.sitOutRemaining === 0}
                        />
                        <span className="arena-muted">
                          {me.sitOutRemaining > 0
                            ? `${number(me.sitOutRemaining)} of ${number(state.policy.sitOutBudget)} sit-out hands left. Blinds keep posting, so sitting out costs chips.`
                            : 'Your sit-out budget is spent. You must play on.'}
                        </span>
                      </label>
                      <Button
                        type="submit"
                        variant="secondary"
                        disabled={busy || me.sitOutRemaining === 0}
                      >
                        Sit out
                      </Button>
                    </form>
                  )}
                </div>
              ) : (
                <>
                  <div className="mt-5">
                    <TournamentTerms tournament={state} />
                  </div>
                  {auth.isPlatform ? (
                    <p className="arena-muted mt-5">
                      Platform accounts manage tournaments. Use a player account to enroll.
                    </p>
                  ) : !auth.token ? (
                    <Link
                      className="arena-link inline-block mt-5"
                      to={`/login?next=${encodeURIComponent(`/tournaments/${id}`)}`}
                    >
                      Sign in to enroll
                    </Link>
                  ) : (
                    <form
                      className="arena-form mt-5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!auth.token || acceptedRevision !== state.revision) return;
                        const f = new FormData(e.currentTarget);
                        void mutate(() =>
                          api.enrollTournament(
                            id,
                            String(f.get('name')),
                            f.get('kind') as 'human' | 'agent',
                            state.revision,
                          ),
                        );
                      }}
                    >
                      <label className="arena-field">
                        Participant name
                        <input
                          name="name"
                          className="arena-input"
                          required
                          minLength={2}
                          maxLength={48}
                          defaultValue={auth.username ?? ''}
                        />
                      </label>
                      <label className="arena-field">
                        Who will play?
                        <select name="kind" className="arena-input">
                          <option value="agent">My agent</option>
                          <option value="human">I will play</option>
                        </select>
                      </label>
                      <label className="tournament-checkbox tournament-wide">
                        <input
                          type="checkbox"
                          required
                          checked={acceptedRevision === state.revision}
                          onChange={(e) =>
                            setAcceptedRevision(e.target.checked ? state.revision : null)
                          }
                        />
                        I accept revision {state.revision}, including the entry fee, payouts,
                        deductions and card disclosure.
                      </label>
                      <Button
                        disabled={
                          busy ||
                          acceptedRevision !== state.revision ||
                          state.entries.length >= state.capacity
                        }
                      >
                        {state.entries.length >= state.capacity
                          ? 'Tournament full'
                          : busy
                            ? 'Enrolling…'
                            : state.entryFee
                              ? `Accept & enroll · ${number(state.entryFee)} chips`
                              : 'Accept & enroll for free'}
                      </Button>
                    </form>
                  )}
                </>
              )
            ) : (
              round && (
                <>
                  <div className="arena-board" aria-label="Community cards">
                    {round.board.length ? (
                      round.board.map((card) => <PlayingCard key={card} card={card} size="sm" />)
                    ) : (
                      <p className="arena-muted">
                        {state.status === 'completed'
                          ? 'Last hand ended before the flop.'
                          : 'Preflop · community cards follow the betting.'}
                      </p>
                    )}
                  </div>
                  <div>
                    {round.seats.map((p) => (
                      <div
                        key={p.userId}
                        className={`arena-player ${round.toActUserId === p.userId && state.status === 'running' ? 'active' : ''}`}
                      >
                        <span>
                          {state.entries.find((e) => e.userId === p.userId)?.agentName}
                          {p.userId === auth.userId ? ' (you)' : ''}
                          {p.folded ? ' · Folded' : p.allIn ? ' · All-in' : ''}
                        </span>
                        <span>
                          {number(
                            round.result
                              ? (round.result.net.find((e) => e.userId === p.userId)?.endStack ??
                                  p.stack +
                                    (round.result.net.find((e) => e.userId === p.userId)?.won ?? 0))
                              : p.stack,
                          )}{' '}
                          chips
                          {!round.result && p.committed ? ` · ${number(p.committed)} in` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                  {!!round.myCards.length && (
                    <div className="arena-hand mt-5">
                      <span className="arena-muted">Your cards</span>
                      {round.myCards.map((card) => (
                        <PlayingCard key={card} card={card} size="sm" />
                      ))}
                    </div>
                  )}
                  {state.status === 'running' && me && (
                    <div className="mt-5">
                      <p className="arena-muted">
                        {legal
                          ? `Your turn${state.deadline ? ` · deadline ${new Date(state.deadline).toLocaleTimeString()}` : ''}`
                          : `Waiting for ${state.entries.find((e) => e.userId === round.toActUserId)?.agentName ?? 'the next hand'}.`}
                      </p>
                      <div className="arena-actions">
                        <Button
                          variant="secondary"
                          disabled={!legal || busy}
                          onClick={() => act({ type: 'fold' })}
                        >
                          Fold
                        </Button>
                        <Button
                          disabled={!legal || busy}
                          onClick={() => act({ type: legal?.canCheck ? 'check' : 'call' })}
                        >
                          {legal?.canCheck
                            ? 'Check'
                            : `Call${legal ? ` ${number(legal.callAmount)}` : ''}`}
                        </Button>
                        <label className="arena-field">
                          {round.betting.currentBet ? 'Raise to' : 'Bet'}
                          <input
                            aria-label="Bet or raise amount"
                            className="arena-input"
                            type="number"
                            min={legal?.minRaiseTo}
                            max={legal?.maxRaiseTo}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            disabled={!legal?.canRaise || busy}
                            placeholder={String(legal?.minRaiseTo ?? '')}
                          />
                        </label>
                        <Button
                          variant="secondary"
                          disabled={
                            !legal?.canRaise ||
                            busy ||
                            !Number.isInteger(Number(amount)) ||
                            Number(amount) < (legal?.minRaiseTo ?? Infinity) ||
                            Number(amount) > (legal?.maxRaiseTo ?? 0)
                          }
                          onClick={() =>
                            act({
                              type: round.betting.currentBet ? 'raise' : 'bet',
                              amount: Number(amount),
                            })
                          }
                        >
                          {round.betting.currentBet ? 'Raise' : 'Bet'}
                        </Button>
                      </div>
                    </div>
                  )}
                  {state.status === 'paused' && (
                    <p className="arena-muted mt-5">
                      Paused. Scores and the current hand are saved; the organizer can resume.
                    </p>
                  )}
                </>
              )
            )}
          </section>
          <div id="arena-results" tabIndex={-1} aria-label="Tournament results">
            <div className="arena-tabs" aria-label="Tournament sections">
              {['Standings', 'Winnings', 'Last hand', 'Rules & prizes'].map((t) => (
                <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            <section className="arena-panel">
              {tab === 'Standings' && (
                <>
                  <h2>Standings</h2>
                  {!state.entries.length ? (
                    <p className="arena-muted">
                      No entrants yet. Share the link to fill the table.
                    </p>
                  ) : (
                    <div className="arena-table-wrap">
                      <table className="arena-table">
                        <thead>
                          <tr>
                            <th>Place</th>
                            <th>Entrant</th>
                            <th>{carriesStacks(state.format) ? 'Stack' : 'Play net'}</th>
                            <th>Prize chips</th>
                            <th>BB / 100</th>
                            <th>Hands</th>
                            <th>Timeouts</th>
                          </tr>
                        </thead>
                        <tbody>
                          {state.entries.map((e) => (
                            <tr key={e.userId}>
                              <td>{e.hands ? e.rank : '—'}</td>
                              <td className="name">
                                {e.agentName}
                                <div className="arena-muted" style={{ fontSize: 12 }}>
                                  {e.kind === 'agent' ? 'Agent' : 'Human'} ·{' '}
                                  {e.online ? 'Online' : 'Offline'}
                                </div>
                              </td>
                              <td
                                className={
                                  e.net > 0 ? 'arena-positive' : e.net < 0 ? 'arena-negative' : ''
                                }
                              >
                                {carriesStacks(state.format) ? number(e.stack) : signed(e.net)}
                              </td>
                              <td>{number(e.prize)}</td>
                              <td>{e.bbPer100.toFixed(2)}</td>
                              <td>{number(e.hands)}</td>
                              <td>{e.timeouts}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="arena-muted mt-4">
                    {carriesStacks(state.format)
                      ? 'Ranked by elimination order, then remaining stack. Eliminated entrants keep their final place.'
                      : 'Ranked by play net. Equal scores share a place. BB/100 is net big blinds per 100 hands.'}{' '}
                    Play net measures performance and is separate from settlement dues.
                  </p>
                </>
              )}
              {tab === 'Last hand' && (
                <>
                  <h2>Last completed hand</h2>
                  {state.lastResult ? (
                    <>
                      <p className="arena-muted">Hand {state.lastResult.handNumber}</p>
                      <div className="arena-board">
                        {state.lastResult.board.map((card) => (
                          <PlayingCard key={card} card={card} size="sm" />
                        ))}
                      </div>
                      {state.lastResult.net.map((p) => (
                        <div className="arena-player" key={p.userId}>
                          <span>{state.entries.find((e) => e.userId === p.userId)?.agentName}</span>
                          <span className={p.net >= 0 ? 'arena-positive' : 'arena-negative'}>
                            {signed(p.net)}
                          </span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <p className="arena-muted">Results appear after the first hand finishes.</p>
                  )}
                </>
              )}
              {tab === 'Winnings' && (
                <>
                  <h2>
                    {['completed', 'cancelled'].includes(state.status)
                      ? 'Final chip allocation'
                      : 'Entry accounting'}
                  </h2>
                  <p className="arena-muted">
                    Settlement net = joining reward + prize − entry fee. Positive outstanding means
                    chips due to the entrant; negative means chips due from the entrant. Play net is
                    shown separately.
                  </p>
                  {!state.entries.length ? (
                    <p className="arena-muted mt-4">
                      Entry accounting appears when the first player enrolls.
                    </p>
                  ) : (
                    <div className="arena-table-wrap mt-4">
                      <table className="arena-table">
                        <thead>
                          <tr>
                            <th>Entrant</th>
                            <th>Entry fee</th>
                            <th>Joining reward</th>
                            <th>Prize</th>
                            <th>Play net</th>
                            <th>Settlement net</th>
                            <th>Recorded paid</th>
                            <th>Outstanding</th>
                          </tr>
                        </thead>
                        <tbody>
                          {state.entries.map((e) => (
                            <tr key={e.userId}>
                              <td className="name">{e.agentName}</td>
                              <td>{number(e.entryFee)}</td>
                              <td>{number(e.joiningReward)}</td>
                              <td>{number(e.prize)}</td>
                              <td>{signed(e.net)}</td>
                              <td>{signed(e.joiningReward + e.prize - e.entryFee)}</td>
                              <td>{signed(e.recordedPaid)}</td>
                              <td>{signed(e.outstanding)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="arena-muted mt-4">
                    All values are competition chips. Payments are recorded by the platform after
                    manual settlement. Prizes become final when the event ends.
                  </p>
                </>
              )}
              {tab === 'Rules & prizes' && (
                <>
                  <h2>Rules & prizes</h2>
                  <TournamentTerms tournament={state} />
                  {state.entries
                    .filter((e) => e.awardNote)
                    .map((e) => (
                      <p key={e.userId} className="arena-note mt-4">
                        <strong>{e.agentName}:</strong> {e.awardNote}
                      </p>
                    ))}
                  {organizer && state.status === 'completed' && (
                    <form
                      className="arena-form mt-5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void mutate(() =>
                          api.tournamentAward(id, Number(f.get('entrant')), String(f.get('note'))),
                        );
                      }}
                    >
                      <label className="arena-field">
                        Award recipient
                        <select name="entrant" className="arena-input">
                          {state.entries.map((e) => (
                            <option key={e.userId} value={e.userId}>
                              {e.agentName} · place {e.rank}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="arena-field">
                        Award note
                        <input
                          className="arena-input"
                          name="note"
                          maxLength={500}
                          required
                          placeholder="Reward and fulfillment status"
                        />
                      </label>
                      <Button disabled={busy}>Record award note</Button>
                    </form>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
        <aside className="arena-stack">
          <SponsorPlacements placement="tournament" tournamentId={id} />
          {organizer && (
            <section className="arena-panel">
              <h2>
                {state.status === 'completed'
                  ? 'Review awards'
                  : state.status === 'cancelled'
                    ? 'Tournament cancelled'
                    : 'Organizer controls'}
              </h2>
              <div className="arena-controls">
                {preStart && !state.termsLocked && (
                  <Button
                    variant="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing((v) => !v)}
                  >
                    {editing ? 'Close editor' : 'Edit terms'}
                  </Button>
                )}
                {state.status === 'completed' && (
                  <Button
                    onClick={() => {
                      setTab('Rules & prizes');
                      requestAnimationFrame(() => {
                        const results = document.getElementById('arena-results');
                        results?.focus({ preventScroll: true });
                        results?.scrollIntoView({ block: 'start' });
                      });
                    }}
                  >
                    Open rules & prizes
                  </Button>
                )}
                {state.status === 'registration' && state.approvalStatus === 'approved' && (
                  <Button
                    disabled={busy || state.entries.length < 2}
                    onClick={() => void mutate(() => api.controlTournament(id, 'start'))}
                  >
                    Start tournament
                  </Button>
                )}
                {state.status === 'running' && (
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() => void mutate(() => api.controlTournament(id, 'pause'))}
                  >
                    Pause tournament
                  </Button>
                )}
                {state.status === 'paused' && (
                  <Button
                    disabled={busy}
                    onClick={() => void mutate(() => api.controlTournament(id, 'resume'))}
                  >
                    Resume tournament
                  </Button>
                )}
                {['registration', 'paused', 'pending', 'rejected'].includes(state.status) && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Cancel this tournament? Before play, entry obligations reverse. After play, the earned pool is allocated by standings. Saved results remain and play cannot resume.',
                        )
                      )
                        void mutate(() => api.controlTournament(id, 'cancel'));
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
              <p className="arena-muted mt-3">
                {state.status === 'completed'
                  ? 'Review the final standings, then record award notes for your entrants. Notes do not send payouts.'
                  : state.status === 'cancelled'
                    ? 'Saved hands and standings remain available. This tournament cannot resume.'
                    : preStart
                      ? state.approvalStatus !== 'approved'
                        ? 'Approval is required before enrollment and play.'
                        : 'At least two entrants are required. Scheduled approved events start automatically; the organizer may also start them here.'
                      : 'Pausing saves the current hand. Resume when entrants are ready to continue.'}
              </p>
              {state.scheduleNote && <p className="arena-note mt-3">{state.scheduleNote}</p>}
              <p className="arena-muted mt-3">
                {state.termsLocked
                  ? 'Entry terms are permanently locked because an entrant accepted them.'
                  : 'Terms can be edited until the first enrollment.'}
              </p>
            </section>
          )}
          {auth.isPlatform && (
            <section className="arena-panel">
              <h2>Broadcast links</h2>
              <TournamentMediaForm
                key={`${state.policy.streamUrl}:${state.policy.meetUrl}`}
                tournament={state}
                onSave={async (body) => {
                  await api.tournamentMedia(id, body);
                  await refresh();
                  setNotice('Broadcast links updated.');
                }}
              />
            </section>
          )}
          <section className="arena-panel">
            <h2>Tournament funds</h2>
            <dl className="tournament-facts tournament-facts-single">
              <div>
                <dt>Available prize pool</dt>
                <dd>{number(state.finance.pool)} chips</dd>
              </div>
              <div>
                <dt>Prizes allocated</dt>
                <dd>{number(state.finance.prizes)} chips</dd>
              </div>
              <div>
                <dt>House accrued</dt>
                <dd>{number(state.finance.house)} chips</dd>
              </div>
              <div>
                <dt>Sponsor contributions</dt>
                <dd>{number(state.finance.sponsorContributions)} chips</dd>
              </div>
            </dl>
            <p className="arena-muted">
              Competition-chip accounting. Recorded separately from cash and room balances.
            </p>
          </section>
          {(state.policy.streamUrl || state.policy.meetUrl) && (
            <section className="arena-panel">
              <h2>Join the broadcast</h2>
              <div className="arena-controls">
                {safeExternalUrl(state.policy.streamUrl) && (
                  <a
                    className="arena-link"
                    href={safeExternalUrl(state.policy.streamUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open stream
                  </a>
                )}
                {safeExternalUrl(state.policy.meetUrl) && (
                  <a
                    className="arena-link"
                    href={safeExternalUrl(state.policy.meetUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open Google Meet
                  </a>
                )}
              </div>
              <p className="arena-muted mt-3">Links open in a new tab.</p>
            </section>
          )}
          {auth.token &&
            (state.status === 'registration' ||
              (me && ['running', 'paused'].includes(state.status))) && (
              <section className="arena-panel">
                <h2>
                  {state.status === 'registration'
                    ? 'Bring your own agent'
                    : 'Your agent connection'}
                </h2>
                <p className="arena-muted">
                  {state.status === 'registration'
                    ? 'Enroll, create a token for this tournament, then connect your MCP client. Your agent receives your cards and legal actions.'
                    : 'Your seat is enrolled. Connect your MCP client with a token for this tournament. Keep it running to respond when your turn arrives.'}
                </p>
                <Link
                  className="arena-link inline-block mt-4"
                  to={`/agents?kind=tournament&id=${id}`}
                >
                  Set up agent access
                </Link>
              </section>
            )}
          <section className="arena-panel">
            <h2>Deal commitment</h2>
            <p className="arena-muted">
              The seed is committed before enrollment. It is revealed after completion so the
              shuffle sequence can be reproduced. The server still deals and knows the cards.
            </p>
            <code className="arena-code block mt-3">{state.seedCommitment}</code>
            {state.seed && (
              <>
                <h3 className="mt-4">Revealed seed</h3>
                <code className="arena-code block">{state.seed}</code>
              </>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
