import { useRef, useState } from 'react';
import { DEFAULT_TOURNAMENT_POLICY, type TournamentSummary } from '@4am/shared';
import { Button, Input } from '../../shared/ui/index.tsx';
import './tournament-operations.css';

export const chips = (n: number) => n.toLocaleString();
export const signedChips = (n: number) => `${n > 0 ? '+' : ''}${chips(n)}`;
export const tournamentError = (e: unknown) =>
  e instanceof Error ? e.message : 'Request failed. Please try again.';
export const formatName = (format: string) =>
  format === 'knockout' ? 'Knockout' : 'Fixed-hand league';
export const localDateInput = (value: number | null) =>
  value === null
    ? ''
    : new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export const eventDate = (value: number | null) =>
  value === null
    ? 'Organizer starts when ready'
    : new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function supportedStreamUrl(value: string): boolean {
  if (!value) return true;
  if (!safeExternalUrl(value)) return false;
  const url = new URL(value);
  return (
    !url.port &&
    ['youtube.com', 'www.youtube.com', 'youtu.be', 'twitch.tv', 'www.twitch.tv'].includes(
      url.hostname,
    )
  );
}
export function ApprovalStatus({ tournament }: { tournament: TournamentSummary }) {
  const status = tournament.approvalStatus;
  return (
    <span className={`arena-status tournament-approval ${status}`}>
      {status === 'approved'
        ? 'Published'
        : status === 'pending'
          ? 'Awaiting approval'
          : 'Changes requested'}
    </span>
  );
}
export function TournamentTerms({ tournament: t }: { tournament: TournamentSummary }) {
  const p = t.policy;
  return (
    <div className="tournament-terms">
      <div className="tournament-section-head">
        <h3>Entry terms · revision {t.revision}</h3>
        <span className="arena-muted">
          {t.termsLocked ? 'Locked on first enrollment' : 'Locks on first enrollment'}
        </span>
      </div>
      <dl className="tournament-facts">
        <div>
          <dt>Format</dt>
          <dd>{formatName(p.format)}</dd>
        </div>
        <div>
          <dt>Scheduled start</dt>
          <dd>{eventDate(p.startsAt)}</dd>
        </div>
        <div>
          <dt>Entry fee</dt>
          <dd>{p.entryFee ? `${chips(p.entryFee)} chips` : 'Free entry'}</dd>
        </div>
        <div>
          <dt>Joining reward</dt>
          <dd>{chips(p.joiningReward)} chips · vests at start</dd>
        </div>
        <div>
          <dt>Organizer guarantee</dt>
          <dd>{chips(p.guaranteedPool)} chips</dd>
        </div>
        <div>
          <dt>Payout places</dt>
          <dd>{p.payoutBps.map((bps, i) => `${i + 1}: ${bps / 100}%`).join(' · ')}</dd>
        </div>
        <div>
          <dt>Pot deductions</dt>
          <dd>
            House {p.houseBps / 100}% · prize pool {p.prizeBps / 100}%
          </dd>
        </div>
        <div>
          <dt>Blinds</dt>
          <dd>
            {t.sb}/{t.bb}
            {p.format === 'knockout'
              ? ` · double every ${p.blindEveryHands} hands`
              : ' · fixed throughout'}
          </dd>
        </div>
        <div>
          <dt>Starting stack</dt>
          <dd>
            {chips(t.startingStack)} chips
            {p.format === 'fixed-hand-league' ? ' · reset every hand' : ' · carried between hands'}
          </dd>
        </div>
        <div>
          <dt>Hand limit</dt>
          <dd>
            {chips(t.handLimit)}
            {p.format === 'knockout' ? ' · then ranked by remaining stack' : ' hands'}
          </dd>
        </div>
        <div>
          <dt>Decision timer</dt>
          <dd>{t.actionSeconds} seconds · timeout checks when free, otherwise folds</dd>
        </div>
        <div>
          <dt>Watching & disclosure</dt>
          <dd>
            {p.publicWatch ? 'Public watching enabled.' : 'Public watching disabled.'}{' '}
            {p.revealAllAfterHand
              ? 'All hole cards, including folded cards, revealed after each hand.'
              : 'Only showdown cards revealed.'}
          </dd>
        </div>
      </dl>
      {t.prizeDescription && (
        <p className="arena-note">
          <strong>Prizes:</strong> {t.prizeDescription}
        </p>
      )}
      {t.rules && (
        <p className="arena-note mt-3">
          <strong>Organizer rules:</strong> {t.rules}
        </p>
      )}
      <p className="arena-muted mt-4">
        Whole competition chips, settled manually. These amounts are separate from cash and ordinary
        room balances. Entry obligations reverse if cancelled before play. After play, cancellation
        allocates the earned pool by current standings. Tied places share their combined prize
        allocation.
      </p>
      <p className="arena-muted mt-3">
        Deductions apply once to each contested pot; uncalled returns are exempt. The organizer
        guarantee funds joining rewards and the starting prize pool. Recorded payments are platform
        records of settlement.
      </p>
    </div>
  );
}

export function TournamentTermsForm({
  tournament,
  platform,
  onSave,
  onCancel,
}: {
  tournament?: TournamentSummary;
  platform: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
}) {
  const p = tournament?.policy ?? DEFAULT_TOURNAMENT_POLICY;
  const [format, setFormat] = useState(p.format);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  return (
    <form
      className="tournament-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current) return;
        const f = new FormData(event.currentTarget);
        setError('');
        try {
          const payoutBps = String(f.get('payouts'))
            .split(',')
            .map((value) => Math.round(Number(value.trim()) * 100));
          if (
            !payoutBps.length ||
            payoutBps.some((v) => !Number.isInteger(v) || v <= 0) ||
            payoutBps.reduce((sum, n) => sum + n, 0) !== 10000
          )
            throw new Error(
              'Payout percentages must be positive and add up to 100%. Separate each place with a comma.',
            );
          const policy = {
            ...p,
            format,
            startsAt: f.get('startsAt') ? new Date(String(f.get('startsAt'))).getTime() : null,
            entryFee: Number(f.get('entryFee')),
            joiningReward: Number(f.get('joiningReward')),
            guaranteedPool: Number(f.get('guaranteedPool')),
            houseBps: Math.round(Number(f.get('houseRate')) * 100),
            prizeBps: Math.round(Number(f.get('prizeRate')) * 100),
            payoutBps,
            blindEveryHands: Number(f.get('blindEveryHands')),
            publicWatch: f.get('publicWatch') === 'on',
            revealAllAfterHand: true,
            streamUrl: String(f.get('streamUrl')).trim(),
            meetUrl: String(f.get('meetUrl')).trim(),
          };
          const capacity = Number(f.get('capacity'));
          if (policy.guaranteedPool < capacity * policy.joiningReward)
            throw new Error(
              `The organizer guarantee must cover joining rewards for all ${capacity} seats (${chips(capacity * policy.joiningReward)} chips).`,
            );
          for (const url of [policy.streamUrl, policy.meetUrl])
            if (url && !safeExternalUrl(url))
              throw new Error(
                'Broadcast links must use HTTPS and contain no embedded credentials.',
              );
          if (!supportedStreamUrl(policy.streamUrl))
            throw new Error('Use a YouTube or Twitch HTTPS link for the stream.');
          if (
            policy.meetUrl &&
            (new URL(policy.meetUrl).hostname !== 'meet.google.com' || new URL(policy.meetUrl).port)
          )
            throw new Error('Use a meet.google.com link for Google Meet.');
          const body: Record<string, unknown> = {
            name: String(f.get('name')).trim(),
            description: String(f.get('description')).trim(),
            rules: String(f.get('rules')).trim(),
            prizeDescription: String(f.get('prizeDescription')).trim(),
            policy,
          };
          if (tournament) body.revision = tournament.revision;
          Object.assign(body, {
            capacity: Number(f.get('capacity')),
            handLimit: Number(f.get('handLimit')),
            startingStack: Number(f.get('startingStack')),
            sb: Number(f.get('sb')),
            bb: Number(f.get('bb')),
            actionSeconds: Number(f.get('actionSeconds')),
          });
          pending.current = true;
          setBusy(true);
          await onSave(body);
        } catch (e) {
          setError(tournamentError(e));
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="tournament-fieldset arena-form">
        <legend>Event details</legend>
        <label className="arena-field wide">
          Tournament name
          <Input
            name="name"
            required
            minLength={3}
            maxLength={80}
            defaultValue={tournament?.name ?? ''}
            placeholder="Friday Agent League"
          />
        </label>
        <label className="arena-field wide">
          Description
          <textarea
            className="arena-input"
            name="description"
            rows={2}
            maxLength={2000}
            defaultValue={tournament?.description ?? ''}
          />
        </label>
        <label className="arena-field">
          Format
          <select
            className="arena-input"
            value={format}
            onChange={(e) => setFormat(e.target.value as typeof format)}
          >
            <option value="fixed-hand-league">Fixed-hand league · equal stacks</option>
            <option value="knockout">Knockout · last player standing</option>
          </select>
        </label>
        <label className="arena-field">
          Scheduled start · your local time
          <Input type="datetime-local" name="startsAt" defaultValue={localDateInput(p.startsAt)} />
          <span className="arena-muted">
            Optional. Approved events start with at least two entrants.
          </span>
        </label>
        <>
          <label className="arena-field">
            Seats
            <Input
              name="capacity"
              type="number"
              min={2}
              max={9}
              step={1}
              defaultValue={tournament?.capacity ?? 6}
              required
            />
          </label>
          <label className="arena-field">
            {format === 'knockout' ? 'Maximum hands' : 'Hands per entrant'}
            <Input
              name="handLimit"
              type="number"
              min={10}
              max={10000}
              step={1}
              defaultValue={tournament?.handLimit ?? 1000}
              required
            />
          </label>
          <label className="arena-field">
            {format === 'knockout' ? 'Starting stack' : 'Stack reset every hand'}
            <Input
              name="startingStack"
              type="number"
              min={100}
              max={1000000}
              step={1}
              defaultValue={tournament?.startingStack ?? 2000}
              required
            />
          </label>
          <label className="arena-field">
            Seconds per decision
            <Input
              name="actionSeconds"
              type="number"
              min={10}
              max={300}
              step={1}
              defaultValue={tournament?.actionSeconds ?? 60}
              required
            />
          </label>
          <label className="arena-field">
            Small blind
            <Input
              name="sb"
              type="number"
              min={1}
              max={10000}
              step={1}
              defaultValue={tournament?.sb ?? 10}
              required
            />
          </label>
          <label className="arena-field">
            Big blind
            <Input
              name="bb"
              type="number"
              min={2}
              max={20000}
              step={1}
              defaultValue={tournament?.bb ?? 20}
              required
            />
          </label>
        </>
        <label className="arena-field">
          Blind increase interval · hands
          <Input
            name="blindEveryHands"
            type="number"
            min={1}
            max={10000}
            step={1}
            defaultValue={p.blindEveryHands}
            required
          />
          <span className="arena-muted">Blinds double at this interval in knockout events.</span>
        </label>
      </fieldset>
      <fieldset disabled={busy} className="tournament-fieldset arena-form">
        <legend>Chips & payouts</legend>
        <p className="arena-muted tournament-wide">
          Whole competition chips. No cash collection or automated payment occurs here.
        </p>
        <label className="arena-field">
          Entry fee · chips
          <Input
            name="entryFee"
            type="number"
            min={0}
            max={1000000000}
            step={1}
            defaultValue={p.entryFee}
            required
          />
        </label>
        <label className="arena-field">
          Joining reward · chips
          <Input
            name="joiningReward"
            type="number"
            min={0}
            max={1000000000}
            step={1}
            defaultValue={p.joiningReward}
            required
          />
        </label>
        <label className="arena-field">
          Organizer guarantee · chips
          <Input
            name="guaranteedPool"
            type="number"
            min={0}
            max={1000000000}
            step={1}
            defaultValue={p.guaranteedPool}
            required
          />
          <span className="arena-muted">Funds joining rewards and any starting prize pool.</span>
        </label>
        {(
          [
            ['houseRate', 'House', p.houseBps],
            ['prizeRate', 'Prize pool', p.prizeBps],
          ] as const
        ).map(([name, label, value]) => (
          <label className="arena-field" key={name}>
            {label} cut · %
            <Input
              name={name}
              type="number"
              min={0}
              max={10}
              step={0.01}
              defaultValue={value / 100}
              required
            />
          </label>
        ))}
        <label className="arena-field wide">
          Payout percentages · first place onward
          <Input
            name="payouts"
            defaultValue={p.payoutBps.map((v) => v / 100).join(', ')}
            required
            placeholder="60, 30, 10"
          />
          <span className="arena-muted">
            Comma-separated percentages adding to 100. Ties split affected places.
          </span>
        </label>
        <label className="arena-field wide">
          Prize description
          <textarea
            className="arena-input"
            name="prizeDescription"
            rows={2}
            maxLength={1000}
            defaultValue={tournament?.prizeDescription ?? ''}
          />
        </label>
        <label className="arena-field wide">
          Additional entry & award rules
          <textarea
            className="arena-input"
            name="rules"
            rows={3}
            maxLength={4000}
            defaultValue={tournament?.rules ?? ''}
          />
        </label>
      </fieldset>
      <fieldset disabled={busy} className="tournament-fieldset arena-form">
        <legend>Watching & broadcast</legend>
        <label className="tournament-checkbox tournament-wide">
          <input name="publicWatch" type="checkbox" defaultChecked={p.publicWatch} />
          Allow anonymous public watching
        </label>
        <p className="arena-muted tournament-wide">
          Saving these terms publishes all hole cards, including folded hands, after each hand. This
          disclosure is included in the entry terms accepted by entrants.
        </p>
        <label className="arena-field">
          YouTube or Twitch stream URL
          <Input name="streamUrl" type="url" defaultValue={p.streamUrl} placeholder="https://" />
        </label>
        <label className="arena-field">
          Google Meet URL
          <Input
            name="meetUrl"
            maxLength={1000}
            type="url"
            defaultValue={p.meetUrl}
            placeholder="https://meet.google.com/…"
          />
        </label>
      </fieldset>
      <p className="arena-muted">
        {platform
          ? 'Publishing opens enrollment. '
          : 'Your proposal stays private until the platform approves it. Changes return it for review. '}
        Published terms permanently lock when the first entrant enrolls.
      </p>
      {error && (
        <p className="arena-error" role="alert">
          {error}
        </p>
      )}
      <div className="arena-controls">
        <Button disabled={busy}>
          {busy
            ? 'Saving…'
            : tournament
              ? platform
                ? 'Save published terms'
                : 'Save & submit for review'
              : platform
                ? 'Publish tournament'
                : 'Submit for approval'}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel editing
          </Button>
        )}
      </div>
    </form>
  );
}

export function TournamentMediaForm({
  tournament,
  onSave,
}: {
  tournament: TournamentSummary;
  onSave: (body: { streamUrl: string; meetUrl: string }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  return (
    <form
      className="tournament-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current) return;
        const f = new FormData(event.currentTarget);
        const body = {
          streamUrl: String(f.get('streamUrl')).trim(),
          meetUrl: String(f.get('meetUrl')).trim(),
        };
        if ([body.streamUrl, body.meetUrl].some((url) => url && !safeExternalUrl(url))) {
          setError('Use HTTPS links without embedded credentials.');
          return;
        }
        if (!supportedStreamUrl(body.streamUrl)) {
          setError('Use a YouTube or Twitch HTTPS link for the stream.');
          return;
        }
        if (
          body.meetUrl &&
          (new URL(body.meetUrl).hostname !== 'meet.google.com' || new URL(body.meetUrl).port)
        ) {
          setError('Use a meet.google.com link for Google Meet.');
          return;
        }
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
      <label className="arena-field">
        YouTube or Twitch stream URL
        <Input
          name="streamUrl"
          maxLength={1000}
          type="url"
          disabled={busy}
          defaultValue={tournament.policy.streamUrl}
          placeholder="https://"
        />
      </label>
      <label className="arena-field">
        Google Meet URL
        <Input
          name="meetUrl"
          maxLength={1000}
          type="url"
          disabled={busy}
          defaultValue={tournament.policy.meetUrl}
          placeholder="https://meet.google.com/…"
        />
      </label>
      <p className="arena-muted">
        Broadcast links can be updated after entry terms lock. Clear a field to remove its link.
      </p>
      {error && (
        <p role="alert" className="arena-error">
          {error}
        </p>
      )}
      <Button disabled={busy}>{busy ? 'Saving links…' : 'Save broadcast links'}</Button>
    </form>
  );
}
