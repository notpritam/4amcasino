import { useEffect, useState } from 'react';

/** True for a beat after the action options change under the cursor.
 *  Buttons stay put but go dead during the swap, so a click aimed at the old
 *  layout can never fire the new button (requested by notpritam,
 *  docs/FEATURES.md). */
export function useSettling(sig: string, ms = 400): boolean {
  const [settled, setSettled] = useState(sig);
  useEffect(() => {
    if (settled === sig) return;
    const t = setTimeout(() => setSettled(sig), ms);
    return () => clearTimeout(t);
  }, [sig, settled, ms]);
  return settled !== sig;
}
