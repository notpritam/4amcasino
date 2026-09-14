import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TournamentEarning } from '@4am/shared';
import { api } from '../../shared/api.ts';
import { Button, Spinner } from '../../shared/ui/index.tsx';
import { chips, signedChips, tournamentError } from './TournamentTerms.tsx';
import './arena.css';
import './tournament-operations.css';

export function TournamentEarnings() {
  const [rows, setRows] = useState<TournamentEarning[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows((await api.tournamentEarnings()).earnings);
    } catch (e) {
      setError(tournamentError(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const total = rows?.reduce(
    (sum, row) => ({
      net: sum.net + row.settlementNet,
      recorded: sum.recorded + row.recordedPaid,
      outstanding: sum.outstanding + row.outstanding,
    }),
    { net: 0, recorded: 0, outstanding: 0 },
  );
  return (
    <section
      className="arena-panel tournament-earnings"
      aria-labelledby="tournament-earnings-heading"
    >
      <div className="tournament-section-head">
        <div>
          <h2 id="tournament-earnings-heading">Tournament earnings</h2>
          <p className="arena-muted">
            Your entry fees, joining rewards, prizes, banker commissions and recorded settlements in
            competition chips.
          </p>
        </div>
        <Button type="button" variant="secondary" disabled={loading} onClick={() => void load()}>
          {loading && rows ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {error && (
        <p className="arena-error mt-4" role="alert">
          {error}
        </p>
      )}
      {rows === null && loading ? (
        <Spinner label="Loading tournament earnings…" />
      ) : rows?.length ? (
        <>
          <dl className="tournament-totals">
            <div>
              <dt>Settlement net</dt>
              <dd>{signedChips(total!.net)}</dd>
            </div>
            <div>
              <dt>Recorded paid</dt>
              <dd>{signedChips(total!.recorded)}</dd>
            </div>
            <div>
              <dt>Outstanding</dt>
              <dd>{signedChips(total!.outstanding)}</dd>
            </div>
          </dl>
          <div className="arena-table-wrap">
            <table className="arena-table">
              <caption className="tournament-table-caption">
                Competition chips · positive outstanding is due to you; negative is due from you
              </caption>
              <thead>
                <tr>
                  <th>Tournament</th>
                  <th>Entry fee</th>
                  <th>Joining reward</th>
                  <th>Prize</th>
                  <th>Banker commission</th>
                  <th>Play net</th>
                  <th>Settlement net</th>
                  <th>Recorded paid</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.tournamentId}>
                    <td className="name">
                      <Link className="arena-link" to={`/tournaments/${row.tournamentId}`}>
                        {row.tournamentName}
                      </Link>
                      <div className="arena-muted">{row.status}</div>
                    </td>
                    <td>{chips(row.entryFee)}</td>
                    <td>{chips(row.joiningReward)}</td>
                    <td>{chips(row.prize)}</td>
                    <td>{chips(row.bankerCommission)}</td>
                    <td>{signedChips(row.playNet)}</td>
                    <td>{signedChips(row.settlementNet)}</td>
                    <td>{signedChips(row.recordedPaid)}</td>
                    <td>{signedChips(row.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="arena-muted mt-4">
            Settlement net is joining reward + prize + banker commission − entry fee. Play net
            measures performance separately. Prizes are final when the tournament ends; recorded
            payments are platform attestations of manual settlement.
          </p>
        </>
      ) : (
        rows && (
          <div className="arena-empty">
            <h3>No tournament earnings yet.</h3>
            <p className="arena-muted">Your entry accounting appears here after you enroll.</p>
            <Link className="arena-link inline-block mt-4" to="/tournaments">
              Browse tournaments
            </Link>
          </div>
        )
      )}
    </section>
  );
}
