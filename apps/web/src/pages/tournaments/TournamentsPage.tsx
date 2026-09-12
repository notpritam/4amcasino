import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RiArrowRightLine, RiAddLine, RiRobot2Line } from '@remixicon/react';
import type { PlayerAction, TournamentState, TournamentSummary } from '@4am/shared';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { Button, Spinner } from '../../shared/ui/index.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import './arena.css';

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
  const [rows, setRows] = useState<TournamentSummary[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const load = useCallback(() => {
    setError('');
    void api
      .tournaments()
      .then((r) => setRows(r.tournaments))
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);
  return (
    <main className="arena-page">
      <header className="arena-header">
        <div>
          <h1>Tournaments</h1>
          <p className="arena-muted">
            Bring your agent. Take a seat. Compare decisions over a thousand hands.
          </p>
        </div>
        <div className="arena-controls">
          <Link className="arena-link" to="/agents">
            Connect an agent
          </Link>
          <Button type="button" onClick={() => setCreating((v) => !v)}>
            <RiAddLine size={18} />
            {creating ? 'Close form' : 'Create tournament'}
          </Button>
        </div>
      </header>
      {error && (
        <div role="alert" className="arena-error">
          {error} <button onClick={load}>Retry</button>
        </div>
      )}
      {creating && (
        <div className="arena-panel" style={{ marginBottom: 24 }}>
          <h2>Create a fixed-hand league</h2>
          <CreateForm onCreated={(id) => nav(`/tournaments/${id}`)} />
        </div>
      )}
      <div className="arena-grid">
        <section className="arena-panel" aria-label="Tournaments">
          {rows === null && !error ? (
            <Spinner label="Loading tournaments…" />
          ) : !rows?.length ? (
            <div className="arena-empty">
              <h2>The first seat is yours.</h2>
              <p className="arena-muted">
                Create a free league for friends or agents. Every player starts each hand with the
                same stack; the leaderboard tracks results across the full run.
              </p>
              <Button type="button" className="mt-5" onClick={() => setCreating(true)}>
                Create the first tournament
              </Button>
            </div>
          ) : (
            rows.map((t) => (
              <Link key={t.id} to={`/tournaments/${t.id}`} className="arena-row">
                <div>
                  <div className="arena-name">{t.name}</div>
                  <div className="arena-row-meta">
                    <span>
                      {t.entrantCount}/{t.capacity} entrants
                    </span>
                    <span>{number(t.handLimit)} hands</span>
                    <span>Free entry</span>
                  </div>
                  <div className="arena-row-meta">
                    <Status status={t.status} />
                    {t.prizeDescription && <span>Prizes announced</span>}
                  </div>
                </div>
                <RiArrowRightLine size={20} aria-hidden />
              </Link>
            ))
          )}
        </section>
        <aside className="arena-stack">
          <section className="arena-panel">
            <h2>One league. Equal stacks.</h2>
            <ol className="arena-help-list arena-muted">
              <li>Enroll yourself or your agent.</li>
              <li>Connect through MCP or the action API.</li>
              <li>Play the scheduled hands. Positions rotate and stacks reset.</li>
              <li>Compare net chips, BB/100 and timeouts.</li>
            </ol>
          </section>
          <section className="arena-panel">
            <h2>Know the format</h2>
            <p className="arena-muted">
              Arena games are server-dealt with competition chips. They do not affect your room
              balances or settlement dues.
            </p>
            <p className="arena-muted mt-3">
              Your ordinary poker rooms keep their encrypted dealing. A benchmark score describes
              this run, not a guarantee of future performance.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
function CreateForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="arena-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        const f = new FormData(e.currentTarget);
        try {
          const r = await api.createTournament({
            name: f.get('name'),
            description: f.get('description'),
            capacity: Number(f.get('capacity')),
            handLimit: Number(f.get('handLimit')),
            startingStack: Number(f.get('stack')),
            sb: 10,
            bb: 20,
            actionSeconds: Number(f.get('seconds')),
            prizeDescription: f.get('prizes'),
            rules: f.get('rules'),
          });
          onCreated(r.id);
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="arena-field wide">
        Tournament name
        <input
          className="arena-input"
          name="name"
          required
          minLength={3}
          maxLength={80}
          placeholder="e.g. Friday Agent League"
        />
      </label>
      <label className="arena-field wide">
        Description
        <textarea
          className="arena-input"
          name="description"
          rows={2}
          maxLength={2000}
          placeholder="Who is playing and what are you testing?"
        />
      </label>
      <label className="arena-field">
        Hands per entrant
        <select className="arena-input" name="handLimit" defaultValue="1000">
          <option value="1000">1,000 hands</option>
          <option value="10000">10,000 hands</option>
          <option value="100">100 hands · short league</option>
          <option value="10">10 hands · test run</option>
        </select>
      </label>
      <label className="arena-field">
        Seats
        <input
          className="arena-input"
          type="number"
          name="capacity"
          min={2}
          max={9}
          defaultValue={6}
          required
        />
      </label>
      <label className="arena-field">
        Stack at the start of every hand
        <input
          className="arena-input"
          type="number"
          name="stack"
          min={100}
          max={1000000}
          defaultValue={2000}
          required
        />
      </label>
      <label className="arena-field">
        Seconds per decision
        <input
          className="arena-input"
          type="number"
          name="seconds"
          min={10}
          max={300}
          defaultValue={60}
          required
        />
      </label>
      <label className="arena-field wide">
        Prizes (optional)
        <textarea
          className="arena-input"
          name="prizes"
          maxLength={1000}
          rows={2}
          placeholder="Describe confirmed rewards and which places receive them."
        />
      </label>
      <label className="arena-field wide">
        Entry and award rules (optional)
        <textarea
          className="arena-input"
          name="rules"
          maxLength={4000}
          rows={3}
          placeholder="Eligibility, agent restrictions, tie handling and how winners receive prizes."
        />
      </label>
      <p className="arena-muted wide" style={{ gridColumn: '1/-1' }}>
        Free entry · 10/20 blinds · No rebuys · No rake. Prize descriptions are published as
        organizer announcements; this app does not collect fees or send payouts.
      </p>
      {error && (
        <p role="alert" className="arena-error wide">
          {error}
        </p>
      )}
      <Button disabled={busy}>{busy ? 'Creating…' : 'Create and open enrollment'}</Button>
    </form>
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
            {state.description || 'A fixed-hand league for people and their agents.'}
          </p>
          <div className="arena-row-meta">
            <Status status={state.status} />
            <span>
              {state.entries.length}/{state.capacity} entrants
            </span>
            <span>Server-dealt · Free entry</span>
          </div>
        </div>
        <div className="arena-controls">
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
      <div className="arena-grid">
        <div className="arena-stack">
          <section className="arena-panel">
            <div className="arena-controls" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ marginBottom: 0 }}>
                {state.status === 'registration'
                  ? 'Take your place'
                  : state.status === 'completed'
                    ? 'League complete'
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
            {state.status === 'registration' ? (
              me ? (
                <div className="arena-empty">
                  <h3>You’re enrolled as {me.agentName}.</h3>
                  <p className="arena-muted">
                    {me.kind === 'agent'
                      ? 'Connect your agent before the organizer starts the league.'
                      : 'Keep this page open to take your turns.'}
                  </p>
                  <Button
                    className="mt-4"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void mutate(() => api.withdrawTournament(id))}
                  >
                    Withdraw
                  </Button>
                </div>
              ) : (
                <form
                  className="arena-form mt-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void mutate(() =>
                      api.enrollTournament(
                        id,
                        String(f.get('name')),
                        f.get('kind') as 'human' | 'agent',
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
                  <Button disabled={busy || state.entries.length >= state.capacity}>
                    {state.entries.length >= state.capacity
                      ? 'Tournament full'
                      : busy
                        ? 'Enrolling…'
                        : 'Enroll for free'}
                  </Button>
                </form>
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
                          {number(p.stack)} chips{p.committed ? ` · ${number(p.committed)} in` : ''}
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
              {['Standings', 'Last hand', 'Rules & prizes'].map((t) => (
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
                            <th>Net chips</th>
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
                                {signed(e.net)}
                              </td>
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
                    Ranked by net chips. Equal scores share a place. BB/100 is net big blinds per
                    100 hands.
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
              {tab === 'Rules & prizes' && (
                <>
                  <h2>Rules & prizes</h2>
                  <p className="arena-note">{state.prizeDescription || 'No prizes announced.'}</p>
                  <p className="arena-note mt-4">
                    {state.rules || 'No additional organizer rules.'}
                  </p>
                  <p className="arena-muted mt-4">
                    {number(state.startingStack)} chips reset every hand. {state.sb}/{state.bb}{' '}
                    blinds. {state.actionSeconds} seconds per decision. Timed-out turns check when
                    free, otherwise fold. Enrollment locks at start.
                  </p>
                  <p className="arena-muted mt-3">
                    Server-dealt competition chips are separate from your room balance. Prize
                    fulfillment is handled by the organizer.
                  </p>
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
          {organizer && (
            <section className="arena-panel">
              <h2>
                {state.status === 'completed'
                  ? 'Review awards'
                  : state.status === 'cancelled'
                    ? 'League cancelled'
                    : 'Organizer controls'}
              </h2>
              <div className="arena-controls">
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
                {state.status === 'registration' && (
                  <Button
                    disabled={busy || state.entries.length < 2}
                    onClick={() => void mutate(() => api.controlTournament(id, 'start'))}
                  >
                    Start league
                  </Button>
                )}
                {state.status === 'running' && (
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() => void mutate(() => api.controlTournament(id, 'pause'))}
                  >
                    Pause league
                  </Button>
                )}
                {state.status === 'paused' && (
                  <Button
                    disabled={busy}
                    onClick={() => void mutate(() => api.controlTournament(id, 'resume'))}
                  >
                    Resume league
                  </Button>
                )}
                {['registration', 'paused'].includes(state.status) && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Cancel this league? Saved results remain, but play cannot resume.',
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
                    ? 'Saved hands and standings remain available. This league cannot resume.'
                    : state.status === 'registration'
                      ? 'Connect at least two entrants before starting. Enrollment locks when play begins.'
                      : 'Pausing saves the current hand. Resume when entrants are ready to continue.'}
              </p>
            </section>
          )}
          {(state.status === 'registration' ||
            (me && ['running', 'paused'].includes(state.status))) && (
            <section className="arena-panel">
              <h2>
                {state.status === 'registration' ? 'Bring your own agent' : 'Your agent connection'}
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
