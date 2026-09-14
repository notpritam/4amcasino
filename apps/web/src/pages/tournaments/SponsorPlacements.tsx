import { useEffect, useState } from 'react';
import type { SponsorPlacement } from '@4am/shared';
import { RiExternalLinkLine } from '@remixicon/react';
import './broadcast.css';

export function safeExternalUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Public creative only. Ad requests must never sign a viewer out or block the table. */
export function SponsorPlacements({
  placement,
  tournamentId,
}: {
  placement: SponsorPlacement['placement'];
  tournamentId?: string;
}) {
  const [placements, setPlacements] = useState<SponsorPlacement[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    setPlacements([]);
    const query = new URLSearchParams({ placement });
    if (tournamentId) query.set('tournamentId', tournamentId);
    let pending = false;
    const load = async () => {
      if (pending || document.hidden || controller.signal.aborted) return;
      pending = true;
      try {
        const response = await fetch(`/api/sponsors?${query}`, {
          credentials: 'omit',
          signal: controller.signal,
          cache: 'no-store',
        });
        const body = response.ok
          ? ((await response.json()) as { placements?: SponsorPlacement[] })
          : null;
        if (!controller.signal.aborted)
          setPlacements(Array.isArray(body?.placements) ? body.placements : []);
      } catch {
        if (!controller.signal.aborted) setPlacements([]);
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [placement, tournamentId]);

  const now = Date.now();
  const visible = placements.filter(
    (item) =>
      item.active &&
      item.startsAt <= now &&
      item.endsAt > now &&
      safeExternalUrl(item.destinationUrl),
  );
  if (!visible.length) return null;
  return (
    <aside className="broadcast-sponsors" aria-label="Sponsors">
      {visible.map((item) => (
        <div className="broadcast-sponsor" key={item.id}>
          <div className="broadcast-sponsor-disclosure">Sponsored · {item.name}</div>
          <a
            href={safeExternalUrl(item.destinationUrl)!}
            target="_blank"
            rel="sponsored noopener noreferrer"
          >
            {item.headline} <RiExternalLinkLine size={15} aria-label="Opens in a new tab" />
          </a>
          {item.description && <p>{item.description}</p>}
        </div>
      ))}
    </aside>
  );
}
