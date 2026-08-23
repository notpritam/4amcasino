import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  CaretDown,
  ChartBar,
  GearSix,
  GithubLogo,
  List,
  Moon,
  ShieldCheck,
  SignOut,
  Sun,
  X,
} from '@phosphor-icons/react';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { cn } from '../../shared/lib/cn.ts';
import { Avatar } from '../../entities/user/Avatar.tsx';

const itemCls =
  'flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

const drawerItemCls =
  'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[0.95rem] font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

/** The signed-in chrome: brand, primary nav, account menu, and a slide-in
 *  sidebar on small screens. Used by every page except login, the live
 *  table (own shell), and the public landing. */
export function AppShell({ children }: { children: ReactNode }) {
  const auth = useStore((s) => s.auth);
  const prefs = useStore((s) => s.prefs);
  const logout = useStore((s) => s.logout);
  const setPrefs = useStore((s) => s.setPrefs);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const reduce = useReducedMotion();

  const toggleTheme = () => {
    const theme = prefs.theme === 'dark' ? 'light' : 'dark';
    setPrefs({ theme });
    void api.updateProfile({ theme }).catch(() => {});
  };

  const doLogout = () => {
    setMenuOpen(false);
    setDrawerOpen(false);
    logout();
    nav('/login');
  };

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

  const drawerLink = (to: string, label: string, icon: ReactNode) => (
    <Link
      to={to}
      onClick={() => setDrawerOpen(false)}
      className={cn(drawerItemCls, loc.pathname === to && 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300')}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-slate-100/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-1.5 px-4">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-200/70 sm:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <List size={20} />
          </button>
          <Link to="/lobby" className="flex items-center gap-2 font-display text-lg font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-base text-white">
              ♠
            </span>
            <span className="hidden sm:inline">4AM</span>
          </Link>
          <nav className="ml-2 hidden items-center gap-1 sm:flex">
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
          <div className="relative hidden sm:block">
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
                  <Link to="/settings" className={itemCls} onClick={() => setMenuOpen(false)}>
                    <GearSix size={17} /> Settings
                  </Link>
                  <Link to={`/players/${auth.userId}`} className={itemCls} onClick={() => setMenuOpen(false)}>
                    <ChartBar size={17} /> My stats
                  </Link>
                  <Link to="/fair" className={itemCls} onClick={() => setMenuOpen(false)}>
                    <ShieldCheck size={17} /> How it's fair
                  </Link>
                  <button className={cn(itemCls, 'text-rose-600 dark:text-rose-400')} onClick={doLogout}>
                    <SignOut size={17} /> Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* mobile sidebar: quiet slide-over with the whole map of the app */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-black/40 sm:hidden"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.aside
              initial={reduce ? false : { x: '-100%' }}
              animate={{ x: 0 }}
              exit={reduce ? undefined : { x: '-100%' }}
              transition={{ type: 'tween', ease: [0.22, 1, 0.36, 1], duration: 0.25 }}
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-white p-4 shadow-2xl sm:hidden dark:bg-slate-900"
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="flex items-center gap-2 font-display text-lg font-bold">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-base text-white">
                    ♠
                  </span>
                  4AM Casino
                </span>
                <button
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close menu"
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X size={18} />
                </button>
              </div>

              <Link
                to="/settings"
                onClick={() => setDrawerOpen(false)}
                className="mb-3 flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"
              >
                <Avatar
                  userId={auth.userId ?? 0}
                  name={prefs.displayName || auth.username || '?'}
                  version={prefs.avatarVersion}
                  size="md"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {prefs.displayName || auth.username}
                  </span>
                  <span className="block text-xs text-slate-400">@{auth.username}</span>
                </span>
              </Link>

              <nav className="space-y-0.5">
                {drawerLink('/lobby', 'Lobby', <span className="text-base">♠</span>)}
                {drawerLink('/leaderboard', 'Leaderboard', <ChartBar size={19} />)}
                {drawerLink('/settings', 'Settings', <GearSix size={19} />)}
                {drawerLink('/fair', "How it's fair", <ShieldCheck size={19} />)}
                <a
                  href="https://github.com/notpritam/4amcasino"
                  className={drawerItemCls}
                  onClick={() => setDrawerOpen(false)}
                >
                  <GithubLogo size={19} /> GitHub
                </a>
              </nav>

              <div className="mt-auto space-y-0.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                <button className={drawerItemCls} onClick={toggleTheme}>
                  {prefs.theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
                  {prefs.theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
                <button className={cn(drawerItemCls, 'text-rose-600 dark:text-rose-400')} onClick={doLogout}>
                  <SignOut size={19} /> Log out
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main>{children}</main>
    </div>
  );
}
