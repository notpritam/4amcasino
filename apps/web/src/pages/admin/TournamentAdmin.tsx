import { useCallback, useEffect, useRef, useState } from 'react';
import type { SponsorCampaign, TournamentEarning, TournamentSummary } from '@4am/shared';
import { api } from '../../shared/api.ts';
import { isAdminSite } from '../../shared/adminSite.ts';
import { useStore } from '../../shared/store.ts';
import { Button, Input, Spinner } from '../../shared/ui/index.tsx';
import {
  ApprovalStatus,
  TournamentTerms,
  chips,
  eventDate,
  formatName,
  localDateInput,
  safeExternalUrl,
  signedChips,
  tournamentError,
} from '../tournaments/TournamentTerms.tsx';
import '../tournaments/arena.css';
import '../tournaments/tournament-operations.css';

type Overview = Awaited<ReturnType<typeof api.adminTournaments>>;
type Sponsors = Awaited<ReturnType<typeof api.adminSponsors>>;
const definiteWriteFailure = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  typeof error.status === 'number' &&
  error.status >= 400 &&
  error.status < 500;
const sponsorBody = (c: SponsorCampaign) => ({
  tournamentId: c.tournamentId,
  name: c.name,
  headline: c.headline,
  description: c.description,
  destinationUrl: c.destinationUrl,
  placement: c.placement,
  startsAt: c.startsAt,
  endsAt: c.endsAt,
  active: c.active,
  bookedAmount: c.bookedAmount,
  note: c.note,
  revision: c.revision,
});
const tournamentHref = (id: string) =>
  `${isAdminSite() ? 'https://4amcasino.com' : ''}/tournaments/${encodeURIComponent(id)}`;

export function TournamentAdmin() {
  const [tab, setTab] = useState('Approvals');
  const [data, setData] = useState<Overview | null>(null);
  const [sponsors, setSponsors] = useState<Sponsors | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const results = await Promise.allSettled([api.adminTournaments(), api.adminSponsors()]);
    const errors: string[] = [];
    if (results[0].status === 'fulfilled') setData(results[0].value);
    else errors.push(tournamentError(results[0].reason));
    if (results[1].status === 'fulfilled') setSponsors(results[1].value);
    else errors.push(tournamentError(results[1].reason));
    setError(errors.join(' '));
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const updated = async (message: string) => {
    setNotice(message);
    await load();
  };
  const pending =
    data?.tournaments.filter((t) => t.approvalStatus === 'pending' && t.status === 'pending') ?? [];
  return (
    <div className="tournament-admin">
      <div className="tournament-section-head">
        <p className="arena-muted">
          Approve proposals, inspect chip accounting and record manual settlements. All amounts are
          competition chips.
        </p>
        <Button type="button" variant="secondary" disabled={loading} onClick={() => void load()}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      <div className="arena-tabs tournament-filter" aria-label="Tournament administration sections">
        {['Approvals', 'Tournaments', 'Earnings', 'Sponsors'].map((name) => (
          <button type="button" key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>
            {name}
            {name === 'Approvals' && pending.length > 0 ? ` (${pending.length})` : ''}
          </button>
        ))}
      </div>
      {error && (
        <p className="arena-error" role="alert">
          {error} Use Refresh to retry.
        </p>
      )}
      {notice && (
        <p className="tournament-notice" role="status">
          {notice}
        </p>
      )}
      {!data && loading && <Spinner label="Loading tournament operations…" />}
      {tab === 'Approvals' && data && (
        <section className="arena-panel">
          <h2>Proposals to review</h2>
          <p className="arena-muted mb-5">
            Approval publishes this revision and opens enrollment. The first enrollment permanently
            locks the terms.
          </p>
          {pending.length ? (
            <div className="tournament-admin-list">
              {pending.map((t) => (
                <ReviewProposal key={`${t.id}:${t.revision}`} tournament={t} onUpdated={updated} />
              ))}
            </div>
          ) : (
            <div className="arena-empty">
              <h3>No proposals awaiting review.</h3>
              <p className="arena-muted">Member proposals appear here before they become public.</p>
            </div>
          )}
        </section>
      )}
      {tab === 'Tournaments' && data && <TournamentDirectory rows={data.tournaments} />}
      {tab === 'Earnings' && data && <EarningsAdmin data={data} onUpdated={updated} />}
      {tab === 'Sponsors' && sponsors && (
        <SponsorsAdmin data={sponsors} tournaments={data?.tournaments ?? []} onUpdated={updated} />
      )}
    </div>
  );
}

function ReviewProposal({
  tournament: t,
  onUpdated,
}: {
  tournament: TournamentSummary;
  onUpdated: (notice: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  return (
    <article className="tournament-review">
      <div className="tournament-section-head">
        <div>
          <h3>{t.name}</h3>
          <p className="arena-muted">
            Organizer #{t.ownerId} · revision {t.revision}
          </p>
        </div>
        <a href={tournamentHref(t.id)} className="arena-link">
          Open tournament
        </a>
      </div>
      {t.description && <p className="arena-note mb-5">{t.description}</p>}
      <TournamentTerms tournament={t} />
      {t.reviewNote && (
        <p className="arena-note mt-3">
          <strong>Previous review:</strong> {t.reviewNote}
        </p>
      )}
      <form
        className="tournament-review-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          const f = new FormData(event.currentTarget);
          const approve =
            (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'approve';
          const note = String(f.get('note')).trim();
          if (!approve && !note) {
            setError('Add a review note explaining what needs to change.');
            return;
          }
          pending.current = true;
          setBusy(true);
          setError('');
          try {
            await api.reviewTournament(t.id, t.revision, approve, note);
            await onUpdated(
              approve ? `${t.name} published.` : `${t.name} returned with a review note.`,
            );
          } catch (e) {
            setError(tournamentError(e));
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <label className="arena-field">
          Review note
          <textarea
            className="arena-input"
            name="note"
            maxLength={1000}
            rows={2}
            placeholder="Required when requesting changes"
            disabled={busy}
          />
        </label>
        {error && (
          <p className="arena-error" role="alert">
            {error}
          </p>
        )}
        <div className="arena-controls">
          <Button name="decision" value="approve" disabled={busy}>
            {busy ? 'Saving review…' : `Approve revision ${t.revision}`}
          </Button>
          <Button name="decision" value="reject" variant="secondary" disabled={busy}>
            Request changes
          </Button>
        </div>
      </form>
    </article>
  );
}

function TournamentDirectory({ rows }: { rows: TournamentSummary[] }) {
  const [query, setQuery] = useState('');
  const filtered = rows.filter((t) =>
    `${t.name} ${t.id} ${t.ownerId} ${t.approvalStatus} ${t.status}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="arena-panel">
      <div className="tournament-admin-toolbar">
        <div>
          <h2>All tournaments</h2>
          <p className="arena-muted">Open an event to edit unlocked terms or control play.</p>
        </div>
        <label className="arena-field">
          Search tournaments
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, organizer ID or status"
          />
        </label>
      </div>
      {filtered.length ? (
        <div className="arena-table-wrap">
          <table className="arena-table">
            <thead>
              <tr>
                <th>Tournament</th>
                <th>Format</th>
                <th>Review</th>
                <th>Status</th>
                <th>Entrants</th>
                <th>Entry</th>
                <th>Schedule</th>
                <th>Terms</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td className="name">
                    <a href={tournamentHref(t.id)} className="arena-link">
                      {t.name}
                    </a>
                    <div className="arena-muted">Organizer #{t.ownerId}</div>
                  </td>
                  <td>{formatName(t.format)}</td>
                  <td>
                    <ApprovalStatus tournament={t} />
                  </td>
                  <td>{t.status}</td>
                  <td>
                    {t.entrantCount ?? 0}/{t.capacity}
                  </td>
                  <td>{t.entryFee ? `${chips(t.entryFee)} chips` : 'Free'}</td>
                  <td>{eventDate(t.policy.startsAt)}</td>
                  <td>
                    Revision {t.revision}
                    <div className="arena-muted">{t.termsLocked ? 'Locked' : 'Editable'}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="arena-muted">
          {rows.length ? 'No tournaments match this search.' : 'No tournaments have been created.'}
        </p>
      )}
    </section>
  );
}

/** An uncertain write keeps its exact body and request ID, including across tab changes. */
function useRecordedAttempt<T extends { requestId: string }>(kind: string) {
  const userId = useStore((s) => s.auth.userId);
  const key = `4am:tournament-${kind}:v1:${userId}`;
  const [attempt, setAttempt] = useState<T | null>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      return value && typeof value.requestId === 'string' ? (value as T) : null;
    } catch {
      return null;
    }
  });
  const hold = (value: T | null) => {
    setAttempt(value);
    try {
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    } catch {
      /* In-memory state still prevents duplicate submission. */
    }
  };
  return [attempt, hold] as const;
}
type SettlementAttempt = {
  tournamentId: string;
  userId: number;
  amount: number;
  note: string;
  requestId: string;
};
function EarningsAdmin({
  data,
  onUpdated,
}: {
  data: Overview;
  onUpdated: (notice: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TournamentEarning | null>(null);
  const [attempt, hold] = useRecordedAttempt<SettlementAttempt>('settlement');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const filtered = data.earnings.filter((r) =>
    `${r.playerName} ${r.userId} ${r.tournamentName} ${r.tournamentId}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const current = attempt
    ? (data.earnings.find(
        (r) => r.tournamentId === attempt.tournamentId && r.userId === attempt.userId,
      ) ?? null)
    : selected;
  return (
    <section className="arena-panel">
      <h2>Tournament earnings</h2>
      <dl className="tournament-totals">
        {(
          [
            ['House accrued', data.totals.house],
            ['Available pools', data.totals.pool],
            ['Prizes allocated', data.totals.prizes],
            ['Recorded paid', data.totals.recordedPaid],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{chips(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="tournament-admin-toolbar">
        <p className="arena-muted">
          Positive outstanding is due to the entrant. Negative is due from the entrant. Play net is
          separate from settlement.
        </p>
        <label className="arena-field">
          Search earnings
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Player, user ID or tournament"
          />
        </label>
      </div>
      {filtered.length ? (
        <div className="arena-table-wrap">
          <table className="arena-table">
            <caption className="tournament-table-caption">All amounts in competition chips</caption>
            <thead>
              <tr>
                <th>Entrant / tournament</th>
                <th>Entry</th>
                <th>Reward</th>
                <th>Prize</th>
                <th>Play net</th>
                <th>Settlement net</th>
                <th>Recorded paid</th>
                <th>Outstanding</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.tournamentId}:${r.userId}`}>
                  <td className="name">
                    {r.playerName} · #{r.userId}
                    <div>
                      <a className="arena-link" href={tournamentHref(r.tournamentId)}>
                        {r.tournamentName}
                      </a>
                    </div>
                  </td>
                  <td>{chips(r.entryFee)}</td>
                  <td>{chips(r.joiningReward)}</td>
                  <td>{chips(r.prize)}</td>
                  <td>{signedChips(r.playNet)}</td>
                  <td>{signedChips(r.settlementNet)}</td>
                  <td>{signedChips(r.recordedPaid)}</td>
                  <td>{signedChips(r.outstanding)}</td>
                  <td>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy || !!attempt || !r.outstanding}
                      onClick={() => {
                        setSelected(r);
                        setError('');
                      }}
                    >
                      Record settlement
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="arena-muted">
          {data.earnings.length
            ? 'No earnings match this search.'
            : 'Earnings appear when entrants enroll.'}
        </p>
      )}
      {(current || attempt) && (
        <form
          key={attempt?.requestId ?? `${current!.tournamentId}:${current!.userId}`}
          className="tournament-inline-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (sending.current) return;
            const f = new FormData(event.currentTarget);
            const payload = attempt ?? {
              tournamentId: current!.tournamentId,
              userId: current!.userId,
              amount: Number(f.get('amount')),
              note: String(f.get('note')).trim(),
              requestId: crypto.randomUUID(),
            };
            if (!Number.isSafeInteger(payload.amount) || payload.amount === 0) {
              setError('Enter a non-zero whole number of chips.');
              return;
            }
            hold(payload);
            sending.current = true;
            setBusy(true);
            setError('');
            try {
              await api.recordTournamentSettlement(payload.tournamentId, {
                userId: payload.userId,
                amount: payload.amount,
                note: payload.note,
                requestId: payload.requestId,
              });
              hold(null);
              setSelected(null);
              await onUpdated('Tournament settlement recorded. No automated payment was sent.');
            } catch (e) {
              if (definiteWriteFailure(e)) {
                hold(null);
                setSelected(current);
                setError(tournamentError(e));
              } else
                setError(
                  `${tournamentError(e)} The result is unconfirmed. Retry the same record below; its request ID is retained.`,
                );
            } finally {
              sending.current = false;
              setBusy(false);
            }
          }}
        >
          <h3>Record settlement · {current?.playerName ?? `User #${attempt!.userId}`}</h3>
          <p className="arena-muted mb-4">
            {current?.tournamentName ?? attempt!.tournamentId}. Record positive chips paid to this
            entrant, or negative chips received from them.
          </p>
          <fieldset disabled={busy || !!attempt} className="tournament-fieldset arena-form">
            <label className="arena-field">
              Signed amount · chips
              <Input
                name="amount"
                type="number"
                step={1}
                required
                defaultValue={attempt?.amount ?? current?.outstanding}
              />
            </label>
            <label className="arena-field">
              Settlement note
              <Input
                name="note"
                maxLength={500}
                required
                defaultValue={attempt?.note ?? ''}
                placeholder="Reference for this manual settlement"
              />
            </label>
          </fieldset>
          {error && (
            <p className="arena-error mt-4" role="alert">
              {error}
            </p>
          )}
          {attempt && !error && (
            <p className="arena-muted mt-4">
              A previous record is awaiting confirmation. Retry with its retained request ID.
            </p>
          )}
          <div className="arena-controls mt-4">
            <Button disabled={busy}>
              {busy
                ? 'Recording…'
                : attempt
                  ? 'Retry same settlement record'
                  : 'Record manual settlement'}
            </Button>
            {!attempt && (
              <Button type="button" variant="secondary" onClick={() => setSelected(null)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

type ReceiptAttempt = {
  sponsorId: string;
  amount: number;
  prizeContribution: number;
  tournamentId: string | null;
  note: string;
  requestId: string;
};
function SponsorsAdmin({
  data,
  tournaments,
  onUpdated,
}: {
  data: Sponsors;
  tournaments: TournamentSummary[];
  onUpdated: (notice: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<SponsorCampaign | 'new' | null>(null);
  const [receipt, setReceipt] = useState<SponsorCampaign | null>(null);
  const [attempt, hold] = useRecordedAttempt<ReceiptAttempt>('sponsor-receipt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const selected = attempt
    ? (data.campaigns.find((c) => c.id === attempt.sponsorId) ?? null)
    : receipt;
  return (
    <section className="arena-panel">
      <div className="tournament-section-head">
        <div>
          <h2>Sponsors & placements</h2>
          <p className="arena-muted">
            Publish plain-text sponsor creative and track booked chips separately from recorded
            receipts.
          </p>
        </div>
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            setEditing('new');
            setError('');
          }}
        >
          Create campaign
        </Button>
      </div>
      <dl className="tournament-totals">
        <div>
          <dt>Booked</dt>
          <dd>{chips(data.totals.booked)}</dd>
        </div>
        <div>
          <dt>Received · recorded</dt>
          <dd>{chips(data.totals.received)}</dd>
        </div>
        <div>
          <dt>Prize contributions</dt>
          <dd>{chips(data.totals.prizeContributions)}</dd>
        </div>
      </dl>
      {error && (
        <p role="alert" className="arena-error">
          {error}
        </p>
      )}
      {data.campaigns.length ? (
        <div className="arena-table-wrap">
          <table className="arena-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Placement</th>
                <th>Window</th>
                <th>Booked</th>
                <th>Received</th>
                <th>To prizes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="name">
                    {c.name}
                    <div className="arena-muted">
                      {c.active ? 'Active' : 'Inactive'} · revision {c.revision}
                    </div>
                  </td>
                  <td>
                    {c.placement}
                    <div className="arena-muted">
                      {c.tournamentId
                        ? (tournaments.find((t) => t.id === c.tournamentId)?.name ?? c.tournamentId)
                        : 'All tournaments'}
                    </div>
                  </td>
                  <td>
                    {eventDate(c.startsAt)}
                    <div className="arena-muted">to {eventDate(c.endsAt)}</div>
                  </td>
                  <td>{chips(c.bookedAmount)}</td>
                  <td>{chips(c.receivedAmount)}</td>
                  <td>{chips(c.prizeContribution)}</td>
                  <td>
                    <div className="arena-controls">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          setEditing(c);
                          setError('');
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy || !!attempt}
                        onClick={() => {
                          setReceipt(c);
                          setError('');
                        }}
                      >
                        Record receipt
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        onClick={async () => {
                          if (pending.current) return;
                          pending.current = true;
                          setBusy(true);
                          setError('');
                          try {
                            await api.saveSponsor({ ...sponsorBody(c), active: !c.active }, c.id);
                            await onUpdated(`${c.name} ${c.active ? 'deactivated' : 'activated'}.`);
                          } catch (e) {
                            setError(tournamentError(e));
                          } finally {
                            pending.current = false;
                            setBusy(false);
                          }
                        }}
                      >
                        {c.active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="arena-muted">
          No sponsor campaigns yet. Create a campaign with a destination, placement and publication
          window.
        </p>
      )}
      {editing && (
        <SponsorForm
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.revision}`}
          campaign={editing === 'new' ? undefined : editing}
          tournaments={tournaments}
          onCancel={() => setEditing(null)}
          onSave={async (body) => {
            await api.saveSponsor(body, editing === 'new' ? undefined : editing.id);
            setEditing(null);
            await onUpdated('Sponsor campaign saved.');
          }}
        />
      )}
      {(selected || attempt) && (
        <form
          key={attempt?.requestId ?? selected!.id}
          className="tournament-inline-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending.current) return;
            const f = new FormData(event.currentTarget);
            const payload = attempt ?? {
              sponsorId: selected!.id,
              amount: Number(f.get('amount')),
              prizeContribution: Number(f.get('prizeContribution')),
              tournamentId: String(f.get('tournamentId')) || null,
              note: String(f.get('note')).trim(),
              requestId: crypto.randomUUID(),
            };
            if (
              !Number.isSafeInteger(payload.amount) ||
              payload.amount <= 0 ||
              !Number.isSafeInteger(payload.prizeContribution) ||
              payload.prizeContribution < 0 ||
              payload.prizeContribution > payload.amount
            ) {
              setError(
                'Receipt amount must be positive whole chips. Prize contribution must be between zero and the receipt amount.',
              );
              return;
            }
            if (payload.prizeContribution > 0 && !payload.tournamentId) {
              setError('Choose a tournament for this prize contribution.');
              return;
            }
            hold(payload);
            pending.current = true;
            setBusy(true);
            setError('');
            try {
              await api.sponsorReceipt(payload.sponsorId, {
                amount: payload.amount,
                prizeContribution: payload.prizeContribution,
                tournamentId: payload.tournamentId,
                note: payload.note,
                requestId: payload.requestId,
              });
              hold(null);
              setReceipt(null);
              await onUpdated('Sponsor receipt and prize contribution recorded.');
            } catch (e) {
              if (definiteWriteFailure(e)) {
                hold(null);
                setReceipt(selected);
                setError(tournamentError(e));
              } else
                setError(
                  `${tournamentError(e)} The result is unconfirmed. Retry this receipt with the same retained request ID.`,
                );
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        >
          <h3>Record receipt · {selected?.name ?? attempt!.sponsorId}</h3>
          <p className="arena-muted mb-4">
            An immutable platform record of received competition chips. A contribution transfers
            part of this receipt to the selected tournament pool.
          </p>
          <fieldset disabled={busy || !!attempt} className="tournament-fieldset arena-form">
            <label className="arena-field">
              Received amount · chips
              <Input
                name="amount"
                type="number"
                min={1}
                max={1000000000}
                step={1}
                required
                defaultValue={attempt?.amount ?? ''}
              />
            </label>
            <label className="arena-field">
              Prize contribution · chips
              <Input
                name="prizeContribution"
                type="number"
                min={0}
                max={1000000000}
                step={1}
                required
                defaultValue={attempt?.prizeContribution ?? 0}
              />
            </label>
            <label className="arena-field">
              Tournament receiving contribution
              <select
                name="tournamentId"
                className="arena-input"
                defaultValue={attempt?.tournamentId ?? selected?.tournamentId ?? ''}
              >
                <option value="">No tournament contribution</option>
                {tournaments
                  .filter(
                    (t) =>
                      (t.approvalStatus === 'approved' &&
                        !['completed', 'cancelled'].includes(t.status)) ||
                      t.id === attempt?.tournamentId,
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="arena-field">
              Receipt reference or note
              <Input name="note" maxLength={1000} defaultValue={attempt?.note ?? ''} />
            </label>
          </fieldset>
          {attempt && (
            <p className="arena-muted mt-4">
              The pending receipt is preserved until its result is confirmed. Retrying reuses the
              same request ID.
            </p>
          )}
          <div className="arena-controls mt-4">
            <Button disabled={busy}>
              {busy
                ? 'Recording…'
                : attempt
                  ? 'Retry same receipt record'
                  : 'Record received chips'}
            </Button>
            {!attempt && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setReceipt(null)}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function SponsorForm({
  campaign: c,
  tournaments,
  onSave,
  onCancel,
}: {
  campaign?: SponsorCampaign;
  tournaments: TournamentSummary[];
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  return (
    <form
      className="tournament-inline-form tournament-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current) return;
        const f = new FormData(event.currentTarget);
        const startsAt = new Date(String(f.get('startsAt'))).getTime(),
          endsAt = new Date(String(f.get('endsAt'))).getTime();
        const destinationUrl = String(f.get('destinationUrl')).trim();
        if (!safeExternalUrl(destinationUrl)) {
          setError('Use an HTTPS destination without embedded credentials.');
          return;
        }
        if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
          setError('The end of the publication window must be after its start.');
          return;
        }
        const body = {
          name: String(f.get('name')).trim(),
          headline: String(f.get('headline')).trim(),
          description: String(f.get('description')).trim(),
          destinationUrl,
          placement: String(f.get('placement')),
          tournamentId: String(f.get('tournamentId')) || null,
          startsAt,
          endsAt,
          active: f.get('active') === 'on',
          bookedAmount: Number(f.get('bookedAmount')),
          note: String(f.get('note')).trim(),
          ...(c ? { revision: c.revision } : {}),
        };
        pending.current = true;
        setBusy(true);
        setError('');
        try {
          await onSave(body);
        } catch (e) {
          setError(tournamentError(e));
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      <h3>{c ? `Edit ${c.name}` : 'New sponsor campaign'}</h3>
      <fieldset disabled={busy} className="tournament-fieldset arena-form">
        <legend>Public creative</legend>
        <label className="arena-field">
          Sponsor name
          <Input name="name" required minLength={2} maxLength={100} defaultValue={c?.name ?? ''} />
        </label>
        <label className="arena-field">
          Headline
          <Input name="headline" required maxLength={160} defaultValue={c?.headline ?? ''} />
        </label>
        <label className="arena-field wide">
          Description
          <textarea
            className="arena-input"
            name="description"
            rows={2}
            maxLength={500}
            defaultValue={c?.description ?? ''}
          />
        </label>
        <label className="arena-field wide">
          Destination URL · HTTPS
          <Input
            name="destinationUrl"
            type="url"
            required
            defaultValue={c?.destinationUrl ?? ''}
            placeholder="https://"
          />
        </label>
        <label className="arena-field">
          Placement
          <select
            className="arena-input"
            name="placement"
            defaultValue={c?.placement ?? 'directory'}
          >
            <option value="directory">Tournament directory</option>
            <option value="tournament">Tournament page</option>
            <option value="watch">Public watch page</option>
          </select>
        </label>
        <label className="arena-field">
          Tournament scope
          <select className="arena-input" name="tournamentId" defaultValue={c?.tournamentId ?? ''}>
            <option value="">All tournaments</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="arena-field">
          Publish from · local time
          <Input
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={c ? localDateInput(c.startsAt) : ''}
          />
        </label>
        <label className="arena-field">
          Publish until · local time
          <Input
            name="endsAt"
            type="datetime-local"
            required
            defaultValue={c ? localDateInput(c.endsAt) : ''}
          />
        </label>
        <label className="tournament-checkbox tournament-wide">
          <input type="checkbox" name="active" defaultChecked={c?.active ?? true} />
          Active during the publication window
        </label>
      </fieldset>
      <fieldset disabled={busy} className="tournament-fieldset arena-form">
        <legend>Private accounting</legend>
        <label className="arena-field">
          Booked amount · chips
          <Input
            name="bookedAmount"
            type="number"
            min={0}
            max={1000000000}
            step={1}
            required
            defaultValue={c?.bookedAmount ?? 0}
          />
        </label>
        <label className="arena-field wide">
          Internal note
          <textarea
            className="arena-input"
            name="note"
            rows={2}
            maxLength={2000}
            defaultValue={c?.note ?? ''}
          />
        </label>
        <p className="arena-muted tournament-wide">
          Booked amounts and internal notes stay in administration. Received amounts and prize
          contributions are added through immutable receipt records.
        </p>
      </fieldset>
      {error && (
        <p className="arena-error" role="alert">
          {error}
        </p>
      )}
      <div className="arena-controls">
        <Button disabled={busy}>
          {busy ? 'Saving…' : c ? 'Save campaign' : 'Create campaign'}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel editing
        </Button>
      </div>
    </form>
  );
}
