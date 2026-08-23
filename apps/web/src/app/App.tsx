import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useStore } from '../shared/store.ts';
import { LoginPage } from '../pages/login/LoginPage.tsx';
import { LobbyPage } from '../pages/lobby/LobbyPage.tsx';
import { TablePage } from '../pages/table/TablePage.tsx';
import { LedgerPage } from '../pages/ledger/LedgerPage.tsx';
import { HandsPage } from '../pages/hands/HandsPage.tsx';

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useStore((s) => s.auth.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/lobby"
          element={
            <RequireAuth>
              <LobbyPage />
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
              <LedgerPage />
            </RequireAuth>
          }
        />
        <Route
          path="/room/:id/hands"
          element={
            <RequireAuth>
              <HandsPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/lobby" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
