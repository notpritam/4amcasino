import { useCallback, useRef, useState } from 'react';

/** Runs an async action at most once at a time (requested by notpritam,
 *  docs/FEATURES.md).
 *
 *  Every money button in the app was a plain onClick, so a double-tap fired the
 *  request twice - two buy-ins, two transfers - and on a slow connection that is
 *  the natural thing for a person to do. The server now refuses the duplicate
 *  too; this is the half that stops it being sent, and gives the button
 *  something honest to show while it waits.
 *
 *  The ref, not the state, is what guards: setState is async, so two clicks in
 *  the same tick would both read `busy === false` and both go through. */
export function useAsyncGuard(): {
  busy: boolean;
  run: (fn: () => Promise<unknown>) => void;
} {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const run = useCallback((fn: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    void Promise.resolve()
      .then(fn)
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  }, []);

  return { busy, run };
}
