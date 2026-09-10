import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { commissionRateLabel, type HouseRoom, type PlatformDuesReport } from '@4am/shared';
import { isAdminSite } from '../../shared/adminSite.ts';
import { api } from '../../shared/api.ts';
import { fmt } from '../../shared/lib/cn.ts';
import { Button, Input, Panel } from '../../shared/ui/index.tsx';

export function HouseRooms({ rooms }: { rooms: HouseRoom[] }) {
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {rooms.map((room) => (
        <li
          key={`${room.roomId}-${room.commissionBps}`}
          className="flex items-start justify-between gap-3"
        >
          <span className="min-w-0 break-words">
            {room.roomName}
            <span className="ml-2 text-xs text-slate-500">
              {commissionRateLabel(room.commissionBps)}
            </span>
          </span>
          <span className="shrink-0 tabular-nums">{fmt(room.accrued)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The same receivables view lives in Admin, the house profile, and Settle up. */
export function PlatformDues({ initialReport }: { initialReport?: PlatformDuesReport }) {
  const id = useId();
  const [report, setReport] = useState<PlatformDuesReport | null>(initialReport ?? null);
  const [loading, setLoading] = useState(!initialReport);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showCleared, setShowCleared] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await api.adminHouse());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load platform dues.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!initialReport) void load();
  }, [initialReport, load]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (report?.people ?? []).filter(
      (person) =>
        (showCleared || person.outstanding > 0) &&
        (!q ||
          `${person.displayName} @${person.username} ${person.userId}`.toLowerCase().includes(q)),
    );
  }, [report, query, showCleared]);

  return (
    <section aria-labelledby={id} aria-busy={loading}>
      <Panel className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={id} className="font-display text-lg font-semibold">
              Platform dues
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Who needs to pay the house, across active rooms.
            </p>
          </div>
          <Button variant="secondary" disabled={loading} onClick={() => void load()}>
            {loading ? 'Refreshing…' : 'Refresh dues'}
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm text-rose-600 dark:text-rose-400">
            {error}{' '}
            {report
              ? 'The amounts below are from the last successful refresh.'
              : 'Use Refresh dues to try again.'}
          </p>
        )}
        {!report ? (
          !error && (
            <p role="status" className="mt-6 text-sm text-slate-500">
              Loading platform dues…
            </p>
          )
        ) : (
          <>
            <dl className="my-5 grid grid-cols-2 gap-x-4 gap-y-5 border-y border-slate-200 py-4 dark:border-slate-700 sm:grid-cols-4">
              {[
                ['Outstanding', report.totals.outstanding],
                ['Users owing', report.totals.usersOwing],
                ['Commission accrued', report.totals.accrued],
                ['Payments recorded', report.totals.paid],
              ].map(([label, amount]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="mt-1 break-words text-xl font-semibold tabular-nums">
                    {fmt(Number(amount))}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mb-4 text-xs leading-relaxed text-slate-500">
              Outstanding is commission minus payments recorded by each user. Payment records are
              self-reported; they are not bank confirmations.
              {report.totals.credit > 0 && <> Recorded credit: {fmt(report.totals.credit)}.</>}
            </p>
            {report.totals.unallocated > 0 && (
              <p className="mb-4 text-sm text-amber-700 dark:text-amber-300">
                {fmt(report.totals.unallocated)} in commission has no recorded winner to assign it
                to. It is excluded from user dues.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1 basis-48">
                <Input
                  aria-label="Find a user with platform dues"
                  type="search"
                  placeholder="Search name, username or ID"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showCleared}
                  onChange={(e) => setShowCleared(e.target.checked)}
                />
                Show cleared users
              </label>
            </div>
            <p role="status" className="mt-3 text-xs text-slate-500">
              {visible.length} user{visible.length === 1 ? '' : 's'} shown
            </p>
            {visible.length === 0 ? (
              <p className="py-6 text-sm text-slate-500">
                {query.trim()
                  ? 'No matching users. Try another name or include cleared users.'
                  : report.people.length
                    ? 'No outstanding platform dues. Include cleared users to see previous charges and payments.'
                    : 'No platform dues recorded yet. Commission from completed hands will appear here.'}
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-200 dark:divide-slate-700">
                {visible.map((person) => (
                  <li
                    key={person.userId}
                    className="py-4"
                    aria-label={`Dues for ${person.username}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          className="break-words font-semibold text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-300"
                          to={`${isAdminSite() ? 'https://4amcasino.com' : ''}/players/${person.userId}`}
                        >
                          {person.displayName}
                        </Link>
                        <p className="mt-0.5 break-words text-xs text-slate-500">
                          @{person.username} · ID {person.userId}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-lg font-semibold tabular-nums">
                          {fmt(person.outstanding)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {person.outstanding > 0 ? 'To pay' : 'Cleared'}
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Accrued: {fmt(person.accrued)} · Payments recorded: {fmt(person.paid)}
                      {person.credit > 0 && <> · {fmt(person.credit)} credit</>}
                    </p>
                    {person.rooms.length > 0 && (
                      <details className="mt-3 text-sm">
                        <summary className="w-fit cursor-pointer text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-300">
                          Commission by room ({person.rooms.length})
                        </summary>
                        <HouseRooms rooms={person.rooms} />
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>
    </section>
  );
}
