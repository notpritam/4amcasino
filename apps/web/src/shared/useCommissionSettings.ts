import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';

export function useCommissionSettings(enabled = true) {
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof api.platformSettings>> | null>(
    null,
  );
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setSettings(await api.platformSettings());
      setError('');
    } catch {
      setError('Could not load the current house cut. Try again.');
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(onFocus, 30000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [enabled, refresh]);
  return { settings, error, refresh };
}
