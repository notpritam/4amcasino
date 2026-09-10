import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  commissionForPot,
  commissionRateLabel,
  type CommissionScope,
  type CommissionSettings,
} from '@4am/shared';
import { api } from '../../shared/api.ts';
import { Button, Input } from '../../shared/ui/index.tsx';
import { fmt } from '../../shared/lib/cn.ts';

export function CommissionControl({ onChanged }: { onChanged: () => void }) {
  const [settings, setSettings] = useState<CommissionSettings | null>(null);
  const [rate, setRate] = useState('');
  const [scope, setScope] = useState<CommissionScope>('all_rooms');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [stale, setStale] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.adminSettings();
      setSettings(data);
      setRate(String(data.commissionBps / 100));
      setStale(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the house cut.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const parsed = /^(?:\d+)(?:\.\d{1,2})?$/.test(rate.trim()) ? Math.round(Number(rate) * 100) : NaN;
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 10000;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings || busy || stale) return;
    if (!valid) {
      setError('Enter 0 to 100, using at most two decimal places.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.adminChangeCommission(parsed, scope, settings.revision);
      setSettings(result);
      setRate(String(result.commissionBps / 100));
      setSuccess(
        scope === 'all_rooms'
          ? `${commissionRateLabel(result.commissionBps)} saved. ${result.affectedRooms} existing room${result.affectedRooms === 1 ? '' : 's'} updated for their next hand.`
          : `${commissionRateLabel(result.commissionBps)} saved for newly created rooms.`,
      );
      onChanged();
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : 'Could not save the house cut. Reload to check the current value.';
      setError(message);
      // A failed write can be ambiguous (the connection can drop after commit).
      // Reload before another save so the operator sees the authoritative state.
      setStale(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-settings-grid">
      <section
        className="admin-panel"
        aria-labelledby="house-cut-heading"
        aria-busy={loading || busy}
      >
        <div className="admin-section-heading">
          <div>
            <h2 id="house-cut-heading">House cut</h2>
            <p>Change the platform commission directly from your account.</p>
          </div>
          <Button variant="secondary" onClick={() => void load()} disabled={busy || loading}>
            Reload settings
          </Button>
        </div>
        {loading && !settings ? (
          <div className="admin-loading" role="status">
            Loading settings…
          </div>
        ) : (
          settings && (
            <form onSubmit={(e) => void save(e)}>
              <div className="admin-rate-row">
                <label className="admin-rate-input">
                  Commission per pot
                  <div>
                    <Input
                      aria-label="House cut percentage"
                      inputMode="decimal"
                      value={rate}
                      disabled={busy || loading}
                      onChange={(e) => {
                        setRate(e.target.value);
                        setSuccess('');
                      }}
                    />
                    <span aria-hidden="true">%</span>
                  </div>
                </label>
                <div className="admin-rate-current">
                  <span>Current default</span>
                  <strong>{commissionRateLabel(settings.commissionBps)}</strong>
                </div>
              </div>
              <fieldset disabled={busy || loading} className="admin-scope">
                <legend>Apply this change to</legend>
                <label>
                  <input
                    type="radio"
                    name="commission-scope"
                    value="all_rooms"
                    checked={scope === 'all_rooms'}
                    onChange={() => setScope('all_rooms')}
                  />
                  <span>
                    <strong>All rooms</strong>
                    <span>
                      Existing rooms use this rate from their next hand. New rooms use it too.
                    </span>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="commission-scope"
                    value="new_rooms"
                    checked={scope === 'new_rooms'}
                    onChange={() => setScope('new_rooms')}
                  />
                  <span>
                    <strong>New rooms only</strong>
                    <span>Existing rooms keep their currently assigned rate.</span>
                  </span>
                </label>
              </fieldset>
              <div className="admin-rate-example">
                <span>On a 2,000-chip pot</span>
                <strong>
                  {valid
                    ? `${fmt(commissionForPot(2000, parsed))} chips to the house`
                    : 'Enter a valid rate'}
                </strong>
              </div>
              <p className="admin-help">
                Each pot is rounded down to whole chips. Completed hands and hands in progress keep
                their original rate.
              </p>
              {success && (
                <p className="admin-success" role="status">
                  {success}
                </p>
              )}
              <div className="admin-form-footer">
                <Button type="submit" disabled={busy || loading || !valid || stale}>
                  {busy ? 'Saving…' : 'Save house cut'}
                </Button>
                <span>Applies immediately. No redeploy needed.</span>
              </div>
            </form>
          )
        )}
        {error && (
          <p className="admin-error" role="alert">
            {error}{' '}
            <button type="button" onClick={() => void load()} disabled={busy}>
              Reload settings
            </button>
          </p>
        )}
      </section>
      <aside className="admin-panel admin-policy-note">
        <h2>Qualification rules</h2>
        <p>
          Rooms can require up to <strong>30 hands</strong> before winnings qualify.
        </p>
        <p>
          Hosts can choose a lower requirement or set it to zero. Existing requirements above 30
          have been reduced.
        </p>
      </aside>
      <section className="admin-panel admin-history" aria-labelledby="rate-history-heading">
        <div className="admin-section-heading">
          <div>
            <h2 id="rate-history-heading">Rate history</h2>
            <p>The latest 50 changes, with their scope and administrator.</p>
          </div>
        </div>
        {settings ? (
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Changed</th>
                  <th>House cut</th>
                  <th>Applies to</th>
                  <th>Changed by</th>
                </tr>
              </thead>
              <tbody>
                {settings.history.map((change) => (
                  <tr key={change.id}>
                    <td>
                      <time dateTime={new Date(change.createdAt).toISOString()}>
                        {new Date(change.createdAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </time>
                    </td>
                    <td className="admin-rate-history-value">
                      {change.previousBps !== null && (
                        <span>{commissionRateLabel(change.previousBps)} → </span>
                      )}
                      <strong>{commissionRateLabel(change.commissionBps)}</strong>
                    </td>
                    <td>
                      {change.scope === 'all_rooms' ? 'All rooms' : 'New rooms only'}
                      <small>{change.affectedRooms} existing rooms updated</small>
                    </td>
                    <td>{change.changedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-help">Load settings to view the change history.</p>
        )}
      </section>
    </div>
  );
}
