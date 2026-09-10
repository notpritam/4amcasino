import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  RiDashboardLine,
  RiExchangeDollarLine,
  RiGroupLine,
  RiInboxLine,
  RiSettings3Line,
  RiPokerClubsLine,
  RiArrowRightUpLine,
  RiLogoutBoxLine,
  RiShieldCheckLine,
  RiRefreshLine,
} from '@remixicon/react';
import { commissionRateLabel, type AdminOverview } from '@4am/shared';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { isAdminSite } from '../../shared/adminSite.ts';
import { fmt } from '../../shared/lib/cn.ts';
import { Button, Input } from '../../shared/ui/index.tsx';
import { AppearanceToggle } from '../../shared/ui/AppearanceToggle.tsx';
import { PlatformDues } from '../../features/house/PlatformDues.tsx';
import { CommissionControl } from './CommissionControl.tsx';
import {
  LifecycleSection,
  MergeSection,
  RoomsSection,
  UserAdminSection,
  type AdminTarget,
} from './AdminSections.tsx';
import './admin.css';

// Operate surface: a dedicated Zeus control center. Persistent navigation leads
// to real account, room, receivables and rate controls; no player-game chrome.
const sections = [
  {
    id: '',
    name: 'Overview',
    icon: RiDashboardLine,
    description: 'The platform at a glance, with the work that needs your attention.',
  },
  {
    id: 'revenue',
    name: 'Revenue & dues',
    icon: RiExchangeDollarLine,
    description: 'Find who needs to pay, review recorded payments, and inspect each room.',
  },
  {
    id: 'rooms',
    name: 'Rooms',
    icon: RiPokerClubsLine,
    description: 'Manage tables and see the house cut assigned to each room.',
  },
  {
    id: 'users',
    name: 'Users',
    icon: RiGroupLine,
    description: 'Find an account by name or ID, then manage it directly.',
  },
  {
    id: 'requests',
    name: 'Requests',
    icon: RiInboxLine,
    description: 'Review room lifecycle requests and account merges.',
  },
  {
    id: 'settings',
    name: 'Platform settings',
    icon: RiSettings3Line,
    description: 'Control the house cut without a deployment.',
  },
];

function RevenueChart({ data }: { data: AdminOverview['revenue'] }) {
  const max = Math.max(1, ...data.map((d) => d.commission));
  const total = data.reduce((sum, d) => sum + d.commission, 0);
  return (
    <figure className="admin-chart">
      <div className="admin-section-heading">
        <div>
          <h2>Commission activity</h2>
          <p>Actual deductions in active rooms · last 14 days · UTC</p>
        </div>
        <strong className="admin-chart-total">
          {fmt(total)} <span>chips</span>
        </strong>
      </div>
      <svg
        viewBox="0 0 720 200"
        role="img"
        aria-label={`${fmt(total)} chips accrued over the last 14 days`}
      >
        {[0, 1, 2].map((n) => (
          <g key={n}>
            <line x1="42" x2="715" y1={20 + n * 76} y2={20 + n * 76} className="admin-chart-grid" />
            <text x="35" y={24 + n * 76} textAnchor="end">
              {fmt(Math.round(max * (1 - n / 2)))}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <rect
            key={d.date}
            x={52 + i * 47}
            y={172 - (d.commission / max) * 152}
            width="25"
            height={(d.commission / max) * 152}
            rx="3"
            className="admin-chart-bar"
          >
            <title>
              {d.date}: {fmt(d.commission)} chips
            </title>
          </rect>
        ))}
      </svg>
      <figcaption>
        <span>{data[0]?.date}</span>
        <span>
          {total
            ? 'Each bar is one day of commission.'
            : 'Commission will appear after qualifying pots are settled.'}
        </span>
        <span>{data.at(-1)?.date}</span>
      </figcaption>
      <details className="admin-chart-data">
        <summary>View daily amounts</summary>
        <table>
          <thead>
            <tr>
              <th>Date (UTC)</th>
              <th>Commission</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{fmt(d.commission)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function Overview({ data, base }: { data: AdminOverview; base: string }) {
  return (
    <>
      <dl className="admin-metrics">
        {[
          [
            'Outstanding dues',
            fmt(data.dues.outstanding),
            `${data.dues.usersOwing} users need to pay`,
            'revenue',
          ],
          ['Active rooms', fmt(data.activeRooms), `${data.rooms} rooms in total`, 'rooms'],
          [
            'Player accounts',
            fmt(data.users),
            `${fmt(data.hands)} settled hands in active rooms`,
            'users',
          ],
          [
            'House cut',
            commissionRateLabel(data.commissionBps),
            'Default for newly created rooms',
            'settings',
          ],
        ].map(([label, value, detail, route]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
            <Link to={`${base}/${route}`}>
              {detail}
              <RiArrowRightUpLine size={14} aria-hidden="true" />
            </Link>
          </div>
        ))}
      </dl>
      <div className="admin-overview-grid">
        <section className="admin-panel">
          <RevenueChart data={data.revenue} />
        </section>
        <section className="admin-panel admin-attention">
          <h2>Needs attention</h2>
          <Link to={`${base}/requests`}>
            <RiInboxLine size={21} />
            <span>
              <strong>{data.pendingRequests} pending requests</strong>
              <small>Room changes and account merges</small>
            </span>
            <RiArrowRightUpLine size={18} />
          </Link>
          <Link to={`${base}/revenue`}>
            <RiExchangeDollarLine size={21} />
            <span>
              <strong>{data.dues.usersOwing} users with dues</strong>
              <small>{fmt(data.dues.outstanding)} chips outstanding</small>
            </span>
            <RiArrowRightUpLine size={18} />
          </Link>
          <div className="admin-attention-note">
            <RiShieldCheckLine size={20} />
            <p>
              Payments shown here are recorded by users. Confirm receipt separately before treating
              them as paid.
            </p>
          </div>
        </section>
      </div>
      <section className="admin-panel admin-revenue-summary">
        <div>
          <h2>House accounting</h2>
          <p>Active rooms, excluding voided hands. Amounts are in chips.</p>
        </div>
        <dl>
          <div>
            <dt>Accrued commission</dt>
            <dd>{fmt(data.dues.accrued + data.dues.unallocated)}</dd>
          </div>
          <div>
            <dt>Payments recorded</dt>
            <dd>{fmt(data.dues.paid)}</dd>
          </div>
          <div>
            <dt>User credits</dt>
            <dd>{fmt(data.dues.credit)}</dd>
          </div>
        </dl>
        <Link to={`${base}/revenue`}>
          Open dues breakdown <RiArrowRightUpLine size={16} />
        </Link>
      </section>
    </>
  );
}

interface UserRow extends AdminTarget {
  disabled: number;
  createdAt: number;
  rooms: number;
}
function UsersDirectory() {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [result, setResult] = useState<{
    users: UserRow[];
    total: number;
    offset: number;
    hasMore: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<UserRow | null>(null);
  const load = useCallback(async (q = '', offset = 0) => {
    setBusy(true);
    setError('');
    try {
      setResult(await api.adminUsers(q, offset));
      setAppliedQuery(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load users.');
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  function search(e: FormEvent) {
    e.preventDefault();
    void load(query);
  }
  return (
    <div className="admin-users-stack">
      <section className="admin-panel" aria-busy={busy}>
        <div className="admin-section-heading">
          <div>
            <h2>User directory</h2>
            <p>Search all accounts, including users without outstanding dues.</p>
          </div>
        </div>
        <form className="admin-search" onSubmit={search}>
          <Input
            type="search"
            aria-label="Search users by name or ID"
            placeholder="Name, @username, or user ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? 'Searching…' : 'Search users'}
          </Button>
        </form>
        {error && (
          <p className="admin-error" role="alert">
            {error} <button onClick={() => void load(query)}>Retry</button>
          </p>
        )}
        {!result ? (
          <p className="admin-loading" role="status">
            {error ? 'Search again to load the directory.' : 'Loading accounts…'}
          </p>
        ) : result.users.length === 0 ? (
          <p className="admin-empty">No accounts match this search. Try a username or user ID.</p>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Status</th>
                    <th>Rooms</th>
                    <th>Joined</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.users.map((u) => (
                    <tr key={u.userId}>
                      <td>
                        <strong>{u.displayName}</strong>
                        <small>
                          @{u.username} · ID {u.userId}
                        </small>
                      </td>
                      <td>
                        <span
                          className={`admin-status ${u.disabled ? 'admin-status-disabled' : ''}`}
                        >
                          {u.isPlatform ? 'Platform' : u.disabled ? 'Disabled' : 'Active'}
                        </span>
                      </td>
                      <td>{u.rooms}</td>
                      <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td>
                        <Button
                          variant="secondary"
                          onClick={() => setTarget(u)}
                          aria-label={`Manage ${u.username}`}
                        >
                          Manage
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-pagination">
              <span>
                {result.offset + 1}–{result.offset + result.users.length} of {result.total} accounts
              </span>
              <div>
                <Button
                  variant="secondary"
                  disabled={busy || result.offset === 0}
                  onClick={() => void load(appliedQuery, Math.max(0, result.offset - 50))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !result.hasMore}
                  onClick={() => void load(appliedQuery, result.offset + 50)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
      {target && (
        <section className="admin-user-actions">
          <div className="admin-section-heading">
            <h2>Manage @{target.username}</h2>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Close account controls
            </Button>
          </div>
          <UserAdminSection key={target.userId} initialTarget={target} />
        </section>
      )}
    </div>
  );
}

export function AdminPage() {
  const token = useStore((s) => s.auth.token);
  const username = useStore((s) => s.auth.username);
  const logout = useStore((s) => s.logout);
  const nav = useNavigate();
  const location = useLocation();
  const base = isAdminSite() ? '' : '/admin';
  const sectionId = location.pathname.slice(base.length).replace(/^\/+|\/+$/g, '');
  const section = sections.find((s) => s.id === sectionId);
  const [access, setAccess] = useState<{ token: string | null; allowed: boolean } | null>(null);
  const [accessError, setAccessError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [logoutBusy, setLogoutBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setAccess(null);
    setAccessError('');
    void api
      .me()
      .then((me) => {
        if (active) setAccess({ token, allowed: !!me.isPlatform });
      })
      .catch((e) => {
        if (active) setAccessError(e instanceof Error ? e.message : 'Could not check access.');
      });
    return () => {
      active = false;
    };
  }, [token, attempt]);
  const allowed = access?.token === token && access?.allowed;
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.adminOverview());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);
  async function signOut() {
    setLogoutBusy(true);
    setError('');
    try {
      await api.logout();
      logout();
      nav('/login?admin=1', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign out. Try again.');
    } finally {
      setLogoutBusy(false);
    }
  }
  if (!access || access.token !== token)
    return (
      <div className="admin-gate">
        <RiShieldCheckLine size={34} />
        <h1>Platform access</h1>
        <p role={accessError ? 'alert' : 'status'}>
          {accessError || 'Checking your platform account…'}
        </p>
        {accessError && (
          <Button onClick={() => setAttempt((a) => a + 1)}>Retry access check</Button>
        )}
      </div>
    );
  if (!allowed)
    return (
      <div className="admin-gate">
        <RiShieldCheckLine size={34} />
        <h1>Platform account required</h1>
        <p>
          This dashboard is only available to the platform account. Your player account can continue
          on the main site.
        </p>
        <Button onClick={() => void signOut()} disabled={logoutBusy}>
          Sign in with another account
        </Button>
        <a href="https://4amcasino.com">Back to 4AM Casino</a>
        {error && <p role="alert">{error}</p>}
      </div>
    );

  return (
    <div className="admin-app">
      <a className="admin-skip" href="#admin-content">
        Skip to dashboard content
      </a>
      <aside className="admin-sidebar">
        <Link className="admin-brand" to={base || '/'}>
          <span>
            <RiPokerClubsLine size={25} />
          </span>
          <strong>
            4AM Casino<small>Administration</small>
          </strong>
        </Link>
        <nav aria-label="Admin navigation">
          {sections.map((item) => (
            <NavLink key={item.id} to={item.id ? `${base}/${item.id}` : base || '/'} end>
              <item.icon size={20} />
              <span>{item.name}</span>
              {item.id === 'requests' && !!data?.pendingRequests && <b>{data.pendingRequests}</b>}
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <a href="https://4amcasino.com">
            <RiArrowRightUpLine size={19} />
            Open casino
          </a>
          <div className="admin-account">
            <RiShieldCheckLine size={19} />
            <span>
              <strong>{username || 'Platform account'}</strong>
              <small>Platform administrator</small>
            </span>
          </div>
          <button onClick={() => void signOut()} disabled={logoutBusy}>
            <RiLogoutBoxLine size={19} />
            {logoutBusy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <span>
            <RiShieldCheckLine size={17} />
            Platform workspace
          </span>
          <div>
            <AppearanceToggle compact />
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => {
                void load();
                setRefresh((n) => n + 1);
              }}
            >
              <RiRefreshLine size={16} />
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </header>
        <main id="admin-content" tabIndex={-1} className="admin-content">
          <header className="admin-page-heading">
            <div>
              <h1>{section?.name ?? 'Page not found'}</h1>
              <p>{section?.description ?? 'Choose a dashboard section from the navigation.'}</p>
            </div>
            {data && sectionId !== 'settings' && (
              <Link className="admin-rate-shortcut" to={`${base}/settings`}>
                House cut <strong>{commissionRateLabel(data.commissionBps)}</strong>
                <RiSettings3Line size={16} />
              </Link>
            )}
          </header>
          {error && (
            <p className="admin-error" role="alert">
              {error} <button onClick={() => void load()}>Retry</button>
            </p>
          )}
          {!section && <Link to={base || '/'}>Return to overview</Link>}
          {sectionId === '' &&
            (data ? (
              <Overview data={data} base={base} />
            ) : (
              !error && (
                <div className="admin-loading" role="status">
                  Loading platform activity…
                </div>
              )
            ))}
          {sectionId === 'revenue' && <PlatformDues key={refresh} />}
          {sectionId === 'rooms' && <RoomsSection key={refresh} />}
          {sectionId === 'users' && <UsersDirectory key={refresh} />}
          {sectionId === 'requests' && (
            <div className="admin-requests" key={refresh}>
              <LifecycleSection />
              <MergeSection />
            </div>
          )}
          {sectionId === 'settings' && (
            <CommissionControl key={refresh} onChanged={() => void load()} />
          )}
        </main>
      </div>
    </div>
  );
}
