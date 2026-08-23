import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useStore } from '../shared/store.ts';
import { applyTheme, loadPrefs } from '../shared/prefs.ts';
import { LoginPage } from '../pages/login/LoginPage.tsx';
import { LobbyPage } from '../pages/lobby/LobbyPage.tsx';
import { TablePage } from '../pages/table/TablePage.tsx';
import { LedgerPage } from '../pages/ledger/LedgerPage.tsx';
import { HandsPage } from '../pages/hands/HandsPage.tsx';
import { LeaderboardPage } from '../pages/leaderboard/LeaderboardPage.tsx';
import { PlayerPage } from '../pages/player/PlayerPage.tsx';
import { ReplayPage } from '../pages/replay/ReplayPage.tsx';
import { DesignBoardPage } from '../pages/design/DesignBoardPage.tsx';
import { AppShell } from '../widgets/nav/AppShell.tsx';

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useStore((s) => s.auth.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  const token = useStore((s) => s.auth.token);
  const theme = useStore((s) => s.prefs.theme);
  useEffect(() => {
    applyTheme(theme); // persisted prefs apply instantly on load
    if (token) void loadPrefs(); // then refresh from the server
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BrowserRouter>
      <Routes>
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
        <Route path="/design" element={<DesignBoardPage />} />
        <Route path="*" element={<Navigate to="/lobby" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
