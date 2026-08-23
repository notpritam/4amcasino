import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CaretDown, ChartBar, Moon, PaintBrush, ShieldCheck, SignOut, Sun, UserCircle } from '@phosphor-icons/react';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { cn } from '../../shared/lib/cn.ts';
import { Avatar } from '../../entities/user/Avatar.tsx';
import { ProfileDialog } from '../../features/profile/ProfileDialog.tsx';

const itemCls =
  'flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

/** The signed-in chrome: brand, primary nav, and the account menu.
 *  Used by every page except login, the live table (own shell), and /design. */
export function AppShell({ children }: { children: ReactNode }) {
  const auth = useStore((s) => s.auth);
  const prefs = useStore((s) => s.prefs);
  const logout = useStore((s) => s.logout);
  const setPrefs = useStore((s) => s.setPrefs);
  const toggleTheme = () => {
    const theme = prefs.theme === 'dark' ? 'light' : 'dark';
    setPrefs({ theme });
    void api.updateProfile({ theme }).catch(() => {});
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();

  const navLink = (to: string, label: string) => (
    <Link
      to={to}
      className={cn(
        'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
        loc.pathname === to
          ? 'bg-indigo-600 text-white'
          : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800',
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-slate-100/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-1.5 px-4">
          <Link to="/lobby" className="flex items-center gap-2 font-display text-lg font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-base text-white">
              ♠
            </span>
            <span className="hidden sm:inline">4AM</span>
          </Link>
          <nav className="ml-2 flex items-center gap-1">
            {navLink('/lobby', 'Lobby')}
            {navLink('/leaderboard', 'Leaderboard')}
          </nav>
          <button
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            title="Toggle dark mode"
            className="ml-auto rounded-full p-2 text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {prefs.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Account menu"
              className="flex items-center gap-1.5 rounded-full p-1 pr-2 hover:bg-slate-200/70 dark:hover:bg-slate-800"
            >
              <Avatar
                userId={auth.userId ?? 0}
                name={prefs.displayName || auth.username || '?'}
                version={prefs.avatarVersion}
                size="sm"
              />
              <CaretDown size={12} className="text-slate-400" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl bg-white py-1.5 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                  <div className="px-3.5 pb-1.5 pt-2 text-xs text-slate-400">
                    {prefs.displayName || auth.username} · @{auth.username}
                  </div>
                  <button
                    className={itemCls}
                    onClick={() => {
                      setMenuOpen(false);
                      setProfileOpen(true);
                    }}
                  >
                    <UserCircle size={17} /> Edit profile
                  </button>
                  <Link to={`/players/${auth.userId}`} className={itemCls} onClick={() => setMenuOpen(false)}>
                    <ChartBar size={17} /> My stats
                  </Link>
                  <Link to="/fair" className={itemCls} onClick={() => setMenuOpen(false)}>
                    <ShieldCheck size={17} /> How it's fair
                  </Link>
                  <Link to="/design" className={itemCls} onClick={() => setMenuOpen(false)}>
                    <PaintBrush size={17} /> Design board
                  </Link>
                  <button
                    className={cn(itemCls, 'text-rose-600 dark:text-rose-400')}
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                      nav('/login');
                    }}
                  >
                    <SignOut size={17} /> Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      <main>{children}</main>
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
