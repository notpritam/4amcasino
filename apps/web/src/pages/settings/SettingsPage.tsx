import { useEffect, useState } from 'react';
import { loadPrefs } from '../../shared/prefs.ts';
import { Panel, Spinner } from '../../shared/ui/index.tsx';
import { ProfileEditor } from '../../features/profile/ProfileDialog.tsx';

/** Profile and preferences as a real page: linkable, refreshable, back-button friendly. */
export function SettingsPage() {
  const [ready, setReady] = useState(false);

  // pull the server's copy first so a direct visit never edits stale values
  useEffect(() => {
    void loadPrefs().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner label="Loading your profile…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Who you are at the table, and how the table behaves for you.
        </p>
      </div>
      <Panel>
        <ProfileEditor wide />
      </Panel>
    </div>
  );
}
