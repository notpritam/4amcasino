import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { useStore } from '../shared/store.ts';
import { applyTheme, loadPrefs } from '../shared/prefs.ts';
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
const AppShell = lazy(() =>
  import('../widgets/nav/AppShell.tsx').then((module) => ({ default: module.AppShell })),
);

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useStore((s) => s.auth.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  const token = useStore((s) => s.auth.token);
  const theme = useStore((s) => s.prefs.theme);
  useEffect(() => {
    applyTheme(theme); // applies on load and every toggle
  }, [theme]);
  useEffect(() => {
    if (token) void loadPrefs(); // refresh prefs from the server
  }, [token]);

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
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
          <Route path="/login" element={<LoginPage />} />
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
                <TablePage />
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
          <Route path="/fair" element={<FairPage />} />
          {/* share link: works logged out, joins the table on the way back in */}
          <Route path="/j/:code" element={<JoinPage />} />
          <Route path="*" element={<Navigate to="/lobby" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function RouteFallback() {
  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center bg-slate-950 text-slate-400"
      role="status"
    >
      <span className="flex items-center gap-3 text-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" /> Loading table…
      </span>
    </div>
  );
}
