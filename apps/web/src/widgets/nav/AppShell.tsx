import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  ChartBar,
  Club,
  GearSix,
  GithubLogo,
  HandCoins,
  HouseSimple,
  List,
  Moon,
  ShieldCheck,
  Sidebar,
  SignOut,
  Sun,
  TerminalWindow,
  Trophy,
  X,
} from '@phosphor-icons/react';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { cn } from '../../shared/lib/cn.ts';
import { Avatar } from '../../entities/user/Avatar.tsx';

const drawerItemCls =
  'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[0.95rem] font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

const SIDEBAR_KEY = '4am-sidebar';

interface RoomRow {
  id: string;
  name: string;
  playerCount: number;
}

/** Everything waiting on you - drives the sidebar badge and the nudge banner. */
interface PendingTasks {
  settlementsAwaitingMe: number;
  openDebts: number;
  iOweCount: number;
  invites: number;
  friendRequests: number;
  houseOutstanding: number;
}

/** The signed-in chrome, BB-style: a persistent icon-led left sidebar - nav
 *  on top, your rooms as a thread list, utilities at the bottom - collapsible
 *  to an icon rail. Small screens keep the slide-over drawer. Used by every
 *  page except login, the live table (own shell), and the public landing.
 *  (requested by notpritam, docs/FEATURES.md) */
export function AppShell({
  children,
  newTab = false,
}: {
  children: ReactNode;
  /** At a live table every nav click would otherwise abandon the hand, so the
   *  rail opens elsewhere in a new tab and the felt stays put. */
  newTab?: boolean;
}) {
  const auth = useStore((s) => s.auth);
  const prefs = useStore((s) => s.prefs);
  const logout = useStore((s) => s.logout);
  const setPrefs = useStore((s) => s.setPrefs);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'rail');
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [pending, setPending] = useState<PendingTasks | null>(null);
  const loc = useLocation();
  const nav = useNavigate();
  const reduce = useReducedMotion();

  useEffect(() => {
    void api
      .myRooms()
      .then((r) => setRooms((r.rooms as RoomRow[]).slice(0, 12)))
      .catch(() => {});
    void api
      .pendingTasks()
      .then(setPending)
      .catch(() => {});
  }, [loc.pathname]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(SIDEBAR_KEY, next ? 'rail' : 'full');
  };

  // cycle light -> dark -> cyber; the icon shows where the click takes you
  const nextTheme = prefs.theme === 'light' ? 'dark' : prefs.theme === 'dark' ? 'cyber' : 'light';
  const themeIcon =
    nextTheme === 'dark' ? (
      <Moon size={17} />
    ) : nextTheme === 'cyber' ? (
      <TerminalWindow size={17} />
    ) : (
      <Sun size={17} />
    );
  const toggleTheme = () => {
    setPrefs({ theme: nextTheme });
    void api.updateProfile({ theme: nextTheme }).catch(() => {});
  };

  const doLogout = () => {
    setMenuOpen(false);
    setDrawerOpen(false);
    logout();
    nav('/login');
  };

  const railItem = (
    to: string,
    label: string,
    icon: ReactNode,
    active: boolean,
    badge?: number,
  ) => (
    <Link
      to={to}
      {...(newTab && !active ? { target: '_blank', rel: 'noreferrer' } : {})}
      title={
        newTab && !active
          ? `${label} — opens in a new tab${badge ? ` (${badge} waiting)` : ''}`
          : badge
            ? `${label} (${badge} waiting)`
            : label
      }
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[0.86rem] font-medium transition-colors',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-slate-200/80 text-slate-900 dark:bg-slate-800 dark:text-white'
          : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200',
      )}
    >
      <span className="relative shrink-0">
        {icon}
        {/* collapsed to an icon rail there is no room for a count, but the dot
            still says "something is waiting in here" */}
        {!!badge && collapsed && (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-slate-100 dark:ring-slate-900" />
        )}
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
      {!!badge && !collapsed && (
        <span className="ml-auto rounded-full bg-indigo-100 px-1.5 py-0.5 text-[0.65rem] font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          {badge}
        </span>
      )}
    </Link>
  );

  const drawerLink = (to: string, label: string, icon: ReactNode) => (
    <Link
      to={to}
      onClick={() => setDrawerOpen(false)}
      className={cn(
        drawerItemCls,
        loc.pathname === to && 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
      )}
    >
      {icon}
      {label}
    </Link>
  );

  const sidebar = (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-slate-200/70 bg-slate-100/80 backdrop-blur md:flex dark:border-slate-800/80 dark:bg-slate-950/80',
        collapsed ? 'w-14 px-2' : 'w-60 px-3',
      )}
    >
      {/* brand + collapse */}
      <div className={cn('flex h-14 items-center', collapsed ? 'justify-center' : 'justify-between')}>
        {!collapsed && (
          <Link to="/lobby" className="flex items-center gap-2 font-display text-lg font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-sm text-white">
              ♠
            </span>
            4AM
          </Link>
        )}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <Sidebar size={17} />
        </button>
      </div>

      {/* primary nav */}
      <nav className="space-y-0.5">
        {railItem('/lobby', 'Lobby', <HouseSimple size={17} />, loc.pathname === '/lobby')}
        {railItem(
          '/settle',
          'Settle up',
          <HandCoins size={17} />,
          loc.pathname === '/settle',
          pending ? pending.settlementsAwaitingMe + pending.iOweCount : 0,
        )}
        {railItem('/leaderboard', 'Leaderboard', <Trophy size={17} />, loc.pathname === '/leaderboard')}
        {railItem(
          `/players/${auth.userId}`,
          'My stats',
          <ChartBar size={17} />,
          loc.pathname === `/players/${auth.userId}`,
        )}
        {railItem('/fair', "How it's fair", <ShieldCheck size={17} />, loc.pathname === '/fair')}
      </nav>

      {/* your rooms, like a thread list */}
      {rooms.length > 0 && (
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
          {!collapsed && (
            <div className="px-2.5 pb-1.5 text-[0.68rem] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Rooms
            </div>
          )}
          <div className="space-y-0.5">
            {rooms.map((r) =>
              railItem(
                `/room/${r.id}`,
                r.name,
                <Club size={16} className="text-slate-400" />,
                loc.pathname.startsWith(`/room/${r.id}`),
              ),
            )}
          </div>
        </div>
      )}
      {rooms.length === 0 && <div className="flex-1" />}

      {/* utilities */}
      <div
        className={cn(
          'space-y-0.5 border-t border-slate-200/70 py-2.5 dark:border-slate-800/80',
        )}
      >
        {railItem('/settings', 'Settings', <GearSix size={17} />, loc.pathname === '/settings')}
        <button
          onClick={toggleTheme}
          title={`Switch to ${nextTheme} theme`}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[0.86rem] font-medium text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200',
            collapsed && 'justify-center px-0',
          )}
        >
          <span className="shrink-0">{themeIcon}</span>
          {!collapsed && <span className="capitalize">{nextTheme} mode</span>}
        </button>
        <a
          href="https://github.com/notpritam/4amcasino"
          title="GitHub"
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[0.86rem] font-medium text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200',
            collapsed && 'justify-center px-0',
          )}
        >
          <GithubLogo size={17} className="shrink-0" />
          {!collapsed && 'GitHub'}
        </a>
        <div className={cn('flex items-center gap-2 pt-1.5', collapsed && 'flex-col')}>
          <Link
            to={`/players/${auth.userId}`}
            title={prefs.displayName || auth.username || 'profile'}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-200/50 dark:hover:bg-slate-800/60',
              collapsed && 'flex-none px-0',
            )}
          >
            <Avatar
              userId={auth.userId ?? 0}
              name={prefs.displayName || auth.username || '?'}
              version={prefs.avatarVersion}
              size="sm"
            />
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">
                  {prefs.displayName || auth.username}
                </span>
                <span className="block truncate text-[0.68rem] text-slate-400">@{auth.username}</span>
              </span>
            )}
          </Link>
          <button
            onClick={doLogout}
            aria-label="Log out"
            title="Log out"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-rose-600 dark:hover:bg-slate-800"
          >
            <SignOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen">
      {sidebar}

      {/* small screens keep a slim top bar + the slide-over drawer */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-slate-100/90 backdrop-blur md:hidden dark:border-slate-800 dark:bg-slate-950/90">
        <div className="flex h-14 items-center gap-1.5 px-4">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <List size={20} />
          </button>
          <Link to="/lobby" className="flex items-center gap-2 font-display text-lg font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-base text-white">
              ♠
            </span>
            4AM
          </Link>
          <button
            onClick={toggleTheme}
            aria-label={`Switch to ${nextTheme} theme`}
            className="ml-auto rounded-full p-2 text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {themeIcon}
          </button>
          <button onClick={() => setMenuOpen((v) => !v)} aria-label="Account menu" className="p-1">
            <Avatar
              userId={auth.userId ?? 0}
              name={prefs.displayName || auth.username || '?'}
              version={prefs.avatarVersion}
              size="sm"
            />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-3 top-12 z-40 w-56 overflow-hidden rounded-xl bg-white py-1.5 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                <Link
                  to={`/players/${auth.userId}`}
                  className={drawerItemCls}
                  onClick={() => setMenuOpen(false)}
                >
                  <ChartBar size={17} /> My stats
                </Link>
                <Link to="/settings" className={drawerItemCls} onClick={() => setMenuOpen(false)}>
                  <GearSix size={17} /> Settings
                </Link>
                <button
                  className={cn(drawerItemCls, 'w-full text-rose-600 dark:text-rose-400')}
                  onClick={doLogout}
                >
                  <SignOut size={17} /> Log out
                </button>
              </div>
            </>
          )}
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
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.aside
              initial={reduce ? false : { x: '-100%' }}
              animate={{ x: 0 }}
              exit={reduce ? undefined : { x: '-100%' }}
              transition={{ type: 'tween', ease: [0.22, 1, 0.36, 1], duration: 0.25 }}
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-white p-4 shadow-2xl md:hidden dark:bg-slate-900"
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

              <nav className="space-y-0.5">
                {drawerLink('/lobby', 'Lobby', <HouseSimple size={19} />)}
                {drawerLink('/leaderboard', 'Leaderboard', <Trophy size={19} />)}
                {drawerLink(`/players/${auth.userId}`, 'My stats', <ChartBar size={19} />)}
                {drawerLink('/settings', 'Settings', <GearSix size={19} />)}
                {drawerLink('/fair', "How it's fair", <ShieldCheck size={19} />)}
              </nav>

              {rooms.length > 0 && (
                <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
                  <div className="px-3.5 pb-1 text-[0.68rem] font-semibold uppercase tracking-wider text-slate-400">
                    Rooms
                  </div>
                  <div className="space-y-0.5">
                    {rooms.map((r) => (
                      <Link
                        key={r.id}
                        to={`/room/${r.id}`}
                        onClick={() => setDrawerOpen(false)}
                        className={drawerItemCls}
                      >
                        <Club size={17} className="text-slate-400" />
                        <span className="truncate">{r.name}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-auto space-y-0.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                <button className={cn(drawerItemCls, 'w-full')} onClick={toggleTheme}>
                  {themeIcon}
                  <span className="capitalize">{nextTheme} mode</span>
                </button>
                <button
                  className={cn(drawerItemCls, 'w-full text-rose-600 dark:text-rose-400')}
                  onClick={doLogout}
                >
                  <SignOut size={19} /> Log out
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className={cn('md:transition-[padding]', collapsed ? 'md:pl-14' : 'md:pl-60')}>
        {children}
      </main>

      <PendingNudge pending={pending} />
    </div>
  );
}

const NUDGE_KEY = '4am-nudge-seen';

/** A single, dismissible prompt for the things that actually need a decision.
 *
 *  Deliberately narrow: it fires when someone is waiting on YOU to confirm a
 *  settlement, or when there is a real invite to answer. Owing money is not a
 *  reason to interrupt someone every time they open the app - that lives in the
 *  sidebar badge instead. Once dismissed it stays quiet for the session. */
function PendingNudge({ pending }: { pending: PendingTasks | null }) {
  const [dismissed, setDismissed] = useState(() => !!sessionStorage.getItem(NUDGE_KEY));
  if (!pending || dismissed) return null;
  const waiting = pending.settlementsAwaitingMe;
  const invites = pending.invites;
  const friendRequests = pending.friendRequests;
  if (waiting + invites + friendRequests === 0) return null;

  const close = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(NUDGE_KEY, '1');
    } catch {
      /* storage disabled: it just reappears next navigation */
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-100 dark:bg-indigo-950">
          <HandCoins size={17} className="text-indigo-600 dark:text-indigo-300" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Waiting on you</h3>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
            {waiting > 0 && (
              <li>
                {waiting} settlement{waiting === 1 ? '' : 's'} the other side already confirmed
              </li>
            )}
            {invites > 0 && (
              <li>
                {invites} table invite{invites === 1 ? '' : 's'}
              </li>
            )}
            {friendRequests > 0 && (
              <li>
                {friendRequests} friend request{friendRequests === 1 ? '' : 's'}
              </li>
            )}
          </ul>
          <div className="mt-3 flex gap-2">
            <Link
              to={waiting > 0 ? '/settle' : '/lobby'}
              onClick={close}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            >
              {waiting > 0 ? 'Review settlements' : 'Take a look'}
            </Link>
            <button
              onClick={close}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
