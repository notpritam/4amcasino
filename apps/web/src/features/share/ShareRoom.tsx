import { useState } from 'react';
import { shareLinkFor, shareMessageFor } from '../../shared/pendingJoin.ts';
import { cn } from '../../shared/lib/cn.ts';

/** Copy the code, copy the link, or hand the whole invite to the OS share sheet
 *  (requested by notpritam, docs/FEATURES.md). The link works for someone who
 *  has never signed up: they log in and land in the room. */

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API needs a secure context and permission; fall back to the
    // ancient trick so this still works on http://<lan-ip> during a house game
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** One-tap "copy the invite link" for dense lists like the lobby's room cards. */
export function CopyInvite({ joinCode, roomName }: { joinCode: string; roomName: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy the invite link for ${roomName}`}
      aria-label={`Copy the invite link for ${roomName}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void copy(shareLinkFor(joinCode)).then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      {copied ? '✓ Copied' : '🔗 Invite'}
    </button>
  );
}

export function ShareRoom({
  joinCode,
  roomName,
  compact = false,
  className,
}: {
  joinCode: string;
  roomName: string;
  compact?: boolean;
  className?: string;
}) {
  const [flash, setFlash] = useState<string | null>(null);
  const link = shareLinkFor(joinCode);
  const message = shareMessageFor(roomName, joinCode);

  function done(label: string) {
    setFlash(label);
    setTimeout(() => setFlash(null), 1800);
  }

  async function nativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `4AM Casino · ${roomName}`, text: message, url: link });
        return;
      } catch {
        /* user dismissed the sheet */
      }
    }
    if (await copy(message)) done('Invite copied');
  }

  if (compact) {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <button
          type="button"
          onClick={() => void copy(joinCode).then((ok) => ok && done('Code copied'))}
          title="Copy the table code"
          className="rounded-md bg-white/10 px-2 py-1 font-mono text-xs font-bold tracking-widest text-white hover:bg-white/20"
        >
          {joinCode}
        </button>
        <button
          type="button"
          onClick={() => void copy(link).then((ok) => ok && done('Link copied'))}
          title="Copy the invite link"
          aria-label="Copy the invite link"
          className="rounded-md px-1.5 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
        >
          🔗
        </button>
        {flash && <span className="text-xs text-emerald-400">{flash}</span>}
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2">
        <code className="flex-1 select-all rounded-lg bg-slate-100 px-3 py-2 text-center font-mono text-lg font-bold tracking-[0.3em] text-slate-900 dark:bg-slate-800 dark:text-slate-100">
          {joinCode}
        </code>
        <button
          type="button"
          onClick={() => void copy(joinCode).then((ok) => ok && done('Code copied'))}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Copy code
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copy(link).then((ok) => ok && done('Link copied'))}
          className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Copy invite link
        </button>
        <button
          type="button"
          onClick={() => void nativeShare()}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Share…
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          WhatsApp
        </a>
      </div>
      <p className="text-xs text-slate-400">
        {flash ? (
          <span className="font-medium text-emerald-600 dark:text-emerald-400">✓ {flash}</span>
        ) : (
          <>Anyone with this link joins the table right after they log in — no account needed first.</>
        )}
      </p>
    </div>
  );
}
