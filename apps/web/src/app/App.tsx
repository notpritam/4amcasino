import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { useStore } from '../shared/store.ts';
import { applyAppearance, loadPrefs } from '../shared/prefs.ts';
import { peekPendingJoin } from '../shared/pendingJoin.ts';
import { api } from '../shared/api.ts';
import { adminDestination, isAdminSite } from '../shared/adminSite.ts';
import { LandingPage } from '../pages/landing/LandingPage.tsx';

const LoginPage = lazy(() =>
  import('../pages/login/LoginPage.tsx').then((module) => ({ default: module.LoginPage })),
);
const WatchPage = lazy(() =>
  import('../pages/watch/WatchPage.tsx').then((module) => ({ default: module.WatchPage })),
);
const LobbyPage = lazy(() =>
  import('../pages/lobby/LobbyPage.tsx').then((module) => ({ default: module.LobbyPage })),
);
const TablePage = lazy(() =>
  import('../pages/table/TablePage.tsx').then((module) => ({ default: module.TablePage })),
);
const LedgerPage = lazy(() =>
  import('../pages/ledger/LedgerPage.tsx').then((module) => ({ default: module.LedgerPage })),
);
const HandsPage = lazy(() =>
  import('../pages/hands/HandsPage.tsx').then((module) => ({ default: module.HandsPage })),
);
const LeaderboardPage = lazy(() =>
  import('../pages/leaderboard/LeaderboardPage.tsx').then((module) => ({
    default: module.LeaderboardPage,
  })),
);
const PlayerPage = lazy(() =>
  import('../pages/player/PlayerPage.tsx').then((module) => ({ default: module.PlayerPage })),
);
const ReplayPage = lazy(() =>
  import('../pages/replay/ReplayPage.tsx').then((module) => ({ default: module.ReplayPage })),
);
const Table3DPage = lazy(() =>
  import('../pages/table3d/Table3DPage.tsx').then((module) => ({ default: module.Table3DPage })),
);
const SettingsPage = lazy(() =>
  import('../pages/settings/SettingsPage.tsx').then((module) => ({ default: module.SettingsPage })),
);
const FairPage = lazy(() =>
  import('../pages/fair/FairPage.tsx').then((module) => ({ default: module.FairPage })),
);
const JoinPage = lazy(() =>
  import('../pages/join/JoinPage.tsx').then((module) => ({ default: module.JoinPage })),
);
const SettlePage = lazy(() =>
  import('../pages/settle/SettlePage.tsx').then((module) => ({ default: module.SettlePage })),
);
const AdminPage = lazy(() =>
  import('../pages/admin/AdminPage.tsx').then((module) => ({ default: module.AdminPage })),
);
const AppShell = lazy(() =>
  import('../widgets/nav/AppShell.tsx').then((module) => ({ default: module.AppShell })),
);

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useStore((s) => s.auth.token);
  const location = useLocation();
  if (!token) {
    const admin = isAdminSite() || /^\/admin(?:\/|$)/.test(location.pathname);
    return (
      <Navigate
        to={admin ? `/login?admin=1&next=${encodeURIComponent(location.pathname)}` : '/login'}
        replace
      />
    );
  }
  return children;
}

/** The mirror of RequireAuth: someone already signed in has no business looking
 *  at a login form. If a share link sent them here, hand them to /j/CODE so they
 *  land at the table instead of the lobby - that route already knows how to join
 *  and forward. `?switch=1` opts out, so changing accounts is still possible. */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const token = useStore((s) => s.auth.token);
  const location = useLocation();
  if (!token) return children;
  const params = new URLSearchParams(location.search);
  if (params.has('switch')) return children;
  if (isAdminSite() || params.get('admin') === '1')
    return <Navigate to={adminDestination(location.search)} replace />;
  const code = params.get('join') ?? peekPendingJoin();
  return <Navigate to={code ? `/j/${code}` : '/lobby'} replace />;
}

export function App() {
  const token = useStore((s) => s.auth.token);
  const isPlatform = useStore((s) => s.auth.isPlatform);
  const setAuth = useStore((s) => s.setAuth);
  useEffect(() => {
    applyAppearance();
  }, []);
  useEffect(() => {
    if (!token) return;
    void loadPrefs();
    const refresh = () => void loadPrefs({ onlyHotkeys: true });
    const onStorage = (e: StorageEvent) => {
      if (e.key === '4am-hotkeys-changed') refresh();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, [token]);
  useEffect(() => {
    // The login response never carries platform status or leaderboard
    // placement, so a real admin's nav link wouldn't show up without this -
    // fetch once per session (fresh login or a page refresh) and merge it in.
    if (!token || isPlatform !== undefined) return;
    void api
      .me()
      .then((me) => {
        // A logout can race this in-flight request; without this guard, its
        // response would land after the token is cleared and re-populate a
        // logged-out auth object with stale isPlatform/leaderboardRank.
        if (!useStore.getState().auth.token) return;
        setAuth({
          ...useStore.getState().auth,
          isPlatform: me.isPlatform,
          leaderboardRank: me.leaderboardRank,
        });
      })
      .catch(() => {});
  }, [token, isPlatform, setAuth]);

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        {isAdminSite() ? (
          <Routes>
            <Route
              path="/login"
              element={
                <RedirectIfAuthed>
                  <LoginPage />
                </RedirectIfAuthed>
              }
            />
            <Route
              path="*"
              element={
                <RequireAuth>
                  <AdminPage />
                </RequireAuth>
              }
            />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route
              path="/watch/:token"
              element={
                <RequireAuth>
                  <WatchPage />
                </RequireAuth>
              }
            />
            <Route
              path="/login"
              element={
                <RedirectIfAuthed>
                  <LoginPage />
                </RedirectIfAuthed>
              }
            />
            <Route
              path="/lobby"
              element={
                <RequireAuth>
                  <AppShell>
                    <LobbyPage />
                  </AppShell>
                </RequireAuth>
              }
            />
            <Route
              path="/room/:id"
              element={
                <RequireAuth>
                  {/* the rail is here too, but every link opens a new tab: leaving
                    the page mid-hand would fold you by timeout */}
                  <AppShell newTab>
                    <TablePage />
                  </AppShell>
                </RequireAuth>
              }
            />
            <Route
              path="/room/:id/3d"
              element={
                <RequireAuth>
                  <Table3DPage />
                </RequireAuth>
              }
            />
            <Route
              path="/room/:id/ledger"
              element={
                <RequireAuth>
                  <AppShell>
                    <LedgerPage />
                  </AppShell>
                </RequireAuth>
              }
            />
            <Route
              path="/room/:id/hands"
              element={
                <RequireAuth>
                  <AppShell>
                    <HandsPage />
                  </AppShell>
                </RequireAuth>
              }
            />
            <Route
              path="/room/:id/replay/:handId"
              element={
                <RequireAuth>
                  <AppShell>
                    <ReplayPage />
                  </AppShell>
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <AppShell>
                    <SettingsPage />
                  </AppShell>
                </RequireAuth>
              }
            />
            <Route
              path="/settle"
              element={
                <RequireAuth>
                  <AppShell>
                    <SettlePage />
                  </AppShell>
                </RequireAuth>
              }
            />
            <Route
              path="/leaderboard"
              element={
                <RequireAuth>
                  <AppShell>
                    <LeaderboardPage />
                  </AppShell>
                </RequireAuth>
              }
            />
            <Route
              path="/players/:id"
              element={
                <RequireAuth>
                  <AppShell>
                    <PlayerPage />
                  </AppShell>
                </RequireAuth>
              }
            />
            <Route
              path="/admin/*"
              element={
                <RequireAuth>
                  <AdminPage />
                </RequireAuth>
              }
            />
            <Route path="/fair" element={<FairPage />} />
            {/* share link: works logged out, joins the table on the way back in */}
            <Route path="/j/:code" element={<JoinPage />} />
            <Route path="*" element={<Navigate to="/lobby" replace />} />
          </Routes>
        )}
      </Suspense>
    </BrowserRouter>
  );
}

function RouteFallback() {
  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center bg-background-primary-default text-text-secondary"
      role="status"
    >
      <span className="flex items-center gap-3 text-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" /> Loading…
      </span>
    </div>
  );
}
