import { memo, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  CaretDown,
  CaretRight,
  ChartBar,
  Club,
  DotsThreeVertical,
  Gavel,
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
import { useStore, type AuthState, type Prefs } from '../../shared/store.ts';
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

/** Everything waiting on you - drives the sidebar badge and the nudge card. */
interface PendingTasks {
  settlementsAwaitingMe: number;
  openDebts: number;
  iOweCount: number;
  invites: number;
  friendRequests: number;
  houseOutstanding: number;
}

/** A grouped block of nav rows with a small uppercase label (hidden in the
 *  collapsed icon rail, where the grouping is expressed as spacing alone). */
const NavSection = memo(function NavSection({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: ReactNode;
}) {
  return (
    <div className={collapsed ? 'mt-3 first:mt-0' : 'mt-4 first:mt-0'}>
      {!collapsed && (
        <div className="px-2.5 pb-1 text-[0.68rem] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {label}
        </div>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
});
NavSection.displayName = 'NavSection';

/** One row in the rail: icon + label + an optional red count badge. `nested`
 *  renders it as a sub-item of an expandable group (indented, no icon, and -
 *  when active - a filled pill instead of the flat highlight main rows get). */
const NavRow = memo(function NavRow({
  to,
  label,
  icon,
  active,
  badge,
  collapsed,
  newTab,
  nested,
}: {
  to: string;
  label: string;
  icon?: ReactNode;
  active: boolean;
  badge?: number;
  collapsed: boolean;
  newTab: boolean;
  nested?: boolean;
}) {
  return (
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
        nested && !collapsed && 'pl-4',
        active
          ? nested
            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
            : 'bg-slate-200/80 text-slate-900 dark:bg-slate-800 dark:text-white'
          : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200',
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {!collapsed && <span className="truncate">{label}</span>}
      {!!badge && !collapsed && (
        <span className="ml-auto rounded-full bg-rose-500 px-1.5 py-0.5 text-[0.65rem] font-bold text-white">
          {badge}
        </span>
      )}
    </Link>
  );
});
NavRow.displayName = 'NavRow';

/** Avatar + online dot + name + handle, with an overflow menu (theme, GitHub,
 *  sign out) tucked behind a three-dot button. Pinned to the bottom of the
 *  rail; collapses to just the avatar (itself the menu trigger) in the icon
 *  rail, where there is no room for the name or a separate overflow button. */
const SidebarFooter = memo(function SidebarFooter({
  auth,
  prefs,
  collapsed,
  nextTheme,
  themeIcon,
  onToggleTheme,
  onLogout,
}: {
  auth: AuthState;
  prefs: Prefs;
  collapsed: boolean;
  nextTheme: 'light' | 'dark' | 'cyber';
  themeIcon: ReactNode;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const profileHref = `/players/${auth.userId}`;
  const name = prefs.displayName || auth.username || '?';

  const menu = open && (
    <>
      <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
      <div
        className={cn(
          'absolute bottom-full z-40 mb-1.5 overflow-hidden rounded-xl bg-white py-1.5 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700',
          collapsed ? 'left-1 w-52' : 'inset-x-1',
        )}
      >
        {collapsed && (
          <Link
            to={profileHref}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-[0.86rem] font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ChartBar size={17} /> Profile
          </Link>
        )}
        <button
          onClick={() => {
            onToggleTheme();
            setOpen(false);
          }}
          className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[0.86rem] font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span className="shrink-0">{themeIcon}</span>
          <span className="capitalize">{nextTheme} mode</span>
        </button>
        <a
          href="https://github.com/notpritam/4amcasino"
          target="_blank"
          rel="noreferrer"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2.5 px-3.5 py-2 text-[0.86rem] font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <GithubLogo size={17} /> GitHub
        </a>
        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[0.86rem] font-medium text-rose-600 hover:bg-slate-100 dark:text-rose-400 dark:hover:bg-slate-800"
        >
          <SignOut size={17} /> Log out
        </button>
      </div>
    </>
  );

  if (collapsed) {
    return (
      <div className="relative shrink-0 border-t border-slate-200/70 py-2.5 dark:border-slate-800/80">
        {menu}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Account menu"
          title={name}
          className="mx-auto block rounded-full"
        >
          <span className="relative block">
            <Avatar userId={auth.userId ?? 0} name={name} version={prefs.avatarVersion} size="sm" />
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-slate-100 dark:ring-slate-950" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative shrink-0 border-t border-slate-200/70 py-2.5 dark:border-slate-800/80">
      {menu}
      <div className="flex items-center gap-1">
        <Link
          to={profileHref}
          title={name}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-200/50 dark:hover:bg-slate-800/60"
        >
          <span className="relative shrink-0">
            <Avatar userId={auth.userId ?? 0} name={name} version={prefs.avatarVersion} size="sm" />
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-slate-100 dark:ring-slate-950" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold">{name}</span>
            <span className="block truncate text-[0.68rem] text-slate-400">@{auth.username}</span>
          </span>
        </Link>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Account menu"
          title="Account menu"
          className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <DotsThreeVertical size={16} weight="bold" />
        </button>
      </div>
    </div>
  );
});
SidebarFooter.displayName = 'SidebarFooter';

/** The signed-in chrome, BB-style: a persistent icon-led left sidebar - a
 *  grouped nav on top (Play / Money / Account / Admin), your rooms as an
 *  expandable thread list, a contextual nudge, and a user footer - collapsible
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
  const [roomsOpen, setRoomsOpen] = useState(true);
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

  const profileHref = `/players/${auth.userId}`;
  const waitingSettle = pending ? pending.settlementsAwaitingMe + pending.iOweCount : 0;

  const sidebar = (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-slate-200/70 bg-slate-100/80 backdrop-blur md:flex dark:border-slate-800/80 dark:bg-slate-950/80',
        collapsed ? 'w-14 px-2' : 'w-60 px-3',
      )}
    >
      {/* brand + subtitle + collapse */}
      <div
        className={cn('flex h-14 shrink-0 items-center', collapsed ? 'justify-center' : 'justify-between gap-2')}
      >
        <Link
          to="/lobby"
          className={cn('flex min-w-0 items-center gap-2.5', collapsed && 'justify-center')}
          title="4AM Casino"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 font-display text-sm text-white">
            ♠
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate font-display text-[0.95rem] font-bold leading-tight">
                4AM Casino
              </span>
              <span className="block truncate text-[0.65rem] leading-tight text-slate-400 dark:text-slate-500">
                Private Texas Hold'em
              </span>
            </span>
          )}
        </Link>
        {!collapsed && (
          <button
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <Sidebar size={17} />
          </button>
        )}
      </div>
      {collapsed && (
        <button
          onClick={toggleCollapsed}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="mx-auto mb-1 shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <Sidebar size={17} />
        </button>
      )}

      {/* grouped nav + rooms, scrollable if the viewport is short */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NavSection label="Play" collapsed={collapsed}>
          <NavRow
            to="/lobby"
            label="Lobby"
            icon={<HouseSimple size={17} />}
            active={loc.pathname === '/lobby'}
            collapsed={collapsed}
            newTab={newTab}
          />
          <NavRow
            to="/leaderboard"
            label="Leaderboard"
            icon={<Trophy size={17} />}
            active={loc.pathname === '/leaderboard'}
            collapsed={collapsed}
            newTab={newTab}
          />
        </NavSection>

        <NavSection label="Money" collapsed={collapsed}>
          <NavRow
            to="/settle"
            label="Settle up"
            icon={<HandCoins size={17} />}
            active={loc.pathname === '/settle'}
            badge={waitingSettle}
            collapsed={collapsed}
            newTab={newTab}
          />
        </NavSection>

        <NavSection label="Account" collapsed={collapsed}>
          <NavRow
            to={profileHref}
            label="Profile"
            icon={<ChartBar size={17} />}
            active={loc.pathname === profileHref}
            collapsed={collapsed}
            newTab={newTab}
          />
          <NavRow
            to="/settings"
            label="Settings"
            icon={<GearSix size={17} />}
            active={loc.pathname === '/settings'}
            collapsed={collapsed}
            newTab={newTab}
          />
          <NavRow
            to="/fair"
            label="How it's fair"
            icon={<ShieldCheck size={17} />}
            active={loc.pathname === '/fair'}
            collapsed={collapsed}
            newTab={newTab}
          />
        </NavSection>

        {auth.isPlatform && (
          <NavSection label="Admin" collapsed={collapsed}>
            <NavRow
              to="/admin"
              label="Admin console"
              icon={<Gavel size={17} />}
              active={loc.pathname === '/admin'}
              collapsed={collapsed}
              newTab={newTab}
            />
          </NavSection>
        )}

        {rooms.length > 0 && (
          <div className={collapsed ? 'mt-3' : 'mt-4'}>
            {collapsed ? (
              <div className="space-y-0.5">
                {rooms.map((r) => (
                  <NavRow
                    key={r.id}
                    to={`/room/${r.id}`}
                    label={r.name}
                    icon={<Club size={17} />}
                    active={loc.pathname.startsWith(`/room/${r.id}`)}
                    collapsed
                    newTab={newTab}
                  />
                ))}
              </div>
            ) : (
              <>
                <button
                  onClick={() => setRoomsOpen((v) => !v)}
                  aria-expanded={roomsOpen}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[0.86rem] font-medium text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                >
                  <Club size={17} className="shrink-0" />
                  <span className="flex-1 truncate text-left">Your tables</span>
                  {roomsOpen ? (
                    <CaretDown size={12} weight="bold" />
                  ) : (
                    <CaretRight size={12} weight="bold" />
                  )}
                </button>
                {roomsOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    {rooms.map((r) => (
                      <NavRow
                        key={r.id}
                        to={`/room/${r.id}`}
                        label={r.name}
                        active={loc.pathname.startsWith(`/room/${r.id}`)}
                        collapsed={false}
                        newTab={newTab}
                        nested
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <SidebarFooter
        auth={auth}
        prefs={prefs}
        collapsed={collapsed}
        nextTheme={nextTheme}
        themeIcon={themeIcon}
        onToggleTheme={toggleTheme}
        onLogout={doLogout}
      />
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
                {auth.isPlatform && drawerLink('/admin', 'Admin', <Gavel size={19} />)}
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
    </div>
  );
}
