import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import { loadPrefs } from '../../shared/prefs.ts';
import { useStore } from '../../shared/store.ts';
import { Button, Spinner } from '../../shared/ui/index.tsx';
import { cn } from '../../shared/lib/cn.ts';
import { ProfileEditor } from '../../features/profile/ProfileDialog.tsx';
import { AccountSecurity } from '../../features/account/AccountSecurity.tsx';
import { SettingsCard } from '../../features/settings/SettingsCard.tsx';

/** Profile and preferences as a real page: linkable, refreshable, back-button
 *  friendly - and laid out as titled sections with a rail instead of one long
 *  undifferentiated form (requested by notpritam, docs/FEATURES.md). */

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: '👤' },
  { id: 'table', label: 'Table & play', icon: '🎴' },
  { id: 'account', label: 'Account & security', icon: '🔐' },
  { id: 'session', label: 'Session', icon: '🚪' },
] as const;

function SectionRail() {
  const [active, setActive] = useState<string>('profile');

  // highlight whichever card owns the top of the viewport
  useEffect(() => {
    const nodes = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (n): n is HTMLElement => !!n,
    );
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);

  return (
    <nav className="sticky top-6 hidden w-52 shrink-0 lg:block" aria-label="Settings sections">
      <ul className="space-y-0.5">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                history.replaceState(null, '', `#${s.id}`);
              }}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                active === s.id
                  ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
              )}
            >
              <span aria-hidden>{s.icon}</span>
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SettingsPage() {
  const [ready, setReady] = useState(false);
  const auth = useStore((s) => s.auth);
  const logout = useStore((s) => s.logout);
  const nav = useNavigate();

  // pull the server's copy first so a direct visit never edits stale values
  useEffect(() => {
    void loadPrefs().finally(() => setReady(true));
  }, []);

  // deep link straight to a section (/settings#account)
  useEffect(() => {
    if (!ready) return;
    const id = location.hash.slice(1);
    if (id) {
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    }
  }, [ready]);

  if (!ready) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner label="Loading your profile…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Signed in as <span className="font-medium text-slate-700 dark:text-slate-300">{auth.username}</span>.
          Who you are at the table, and how the table behaves for you.
        </p>
      </header>

      <div className="flex gap-8">
        <SectionRail />

        <div className="min-w-0 flex-1 space-y-6">
          <ProfileEditor sectioned />

          <SettingsCard
            id="account"
            title="Account & security"
            icon="🔐"
            desc="Your password derives the key that signs your cards, right here in this browser. Nothing on this card is ever sent to the server in the clear."
          >
            <AccountSecurity />
          </SettingsCard>

          <SettingsCard
            id="session"
            title="Session"
            icon="🚪"
            desc="Signing out clears your keys from this browser. You get them back by logging in again with the same password."
          >
            <Button
              variant="danger"
              onClick={() => {
                // kill the session server-side too, then clear this browser -
                // clearing localStorage alone left the token live forever
                void api
                  .logout()
                  .catch(() => {})
                  .finally(() => {
                    logout();
                    nav('/login');
                  });
              }}
            >
              Sign out
            </Button>
          </SettingsCard>
        </div>
      </div>
    </div>
  );
}
