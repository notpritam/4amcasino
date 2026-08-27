import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { verifyHandTranscript, type TranscriptEntry } from '@4am/mental-poker';
import { api } from '../../shared/api.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Dialog, Panel, Spinner } from '../../shared/ui/index.tsx';

interface HandRef {
  handId: string;
  head: string;
  ts: number;
  /** Your net chips for the hand from the settlement ledger; null if you had no stake. */
  myNet: number | null;
  /** How the hand ended for you: folded (and where), showdown, quiet win, sat out. */
  outcome: string;
  voided: boolean;
}

interface HandDetail {
  handId: string;
  head: string;
  entries: TranscriptEntry[];
}

function netTone(net: number | null): string {
  if (net === null || net === 0) return 'text-slate-400';
  return net > 0 ? 'text-emerald-500' : 'text-rose-500';
}

function netLabel(net: number | null): string {
  if (net === null) return '—';
  if (net === 0) return '±0';
  return `${net > 0 ? '+' : '−'}${fmt(Math.abs(net))}`;
}

const FILTERS = ['all', 'won', 'lost', 'folded', 'showdown'] as const;
type Filter = (typeof FILTERS)[number];

export function HandsPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const [hands, setHands] = useState<HandRef[] | null>(null);
  const [detail, setDetail] = useState<HandDetail | null>(null);
  // which hands you want to relive rides the URL, so the view is shareable
  // (filters requested by notpritam, docs/FEATURES.md)
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.includes(params.get('f') as Filter) ? params.get('f') : 'all') as Filter;
  const setFilter = (f: Filter) => {
    const next = new URLSearchParams(params);
    if (f === 'all') next.delete('f');
    else next.set('f', f);
    setParams(next, { replace: true });
  };
  const matchesFilter = (h: HandRef) =>
    filter === 'all' ||
    (filter === 'won' && (h.myNet ?? 0) > 0) ||
    (filter === 'lost' && (h.myNet ?? 0) < 0 && !h.outcome.startsWith('folded')) ||
    (filter === 'folded' && h.outcome.startsWith('folded')) ||
    (filter === 'showdown' && h.outcome.includes('showdown'));

  useEffect(() => {
    api.hands(roomId!).then((r) => setHands(r.hands));
  }, [roomId]);

  // your session in numbers, voided hands excluded (they cancel on the ledger)
  const totals = useMemo(() => {
    const live = (hands ?? []).filter((h) => !h.voided && h.outcome !== 'sat out');
    const net = live.reduce((sum, h) => sum + (h.myNet ?? 0), 0);
    const folded = live.filter((h) => h.outcome.startsWith('folded'));
    const foldBleed = folded.reduce((sum, h) => sum + Math.min(0, h.myNet ?? 0), 0);
    const showdowns = live.filter((h) => h.outcome.includes('showdown'));
    const won = live.filter((h) => (h.myNet ?? 0) > 0).length;
    return { played: live.length, net, folds: folded.length, foldBleed, showdowns: showdowns.length, won };
  }, [hands]);

  function download(d: HandDetail) {
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `4am-hand-${d.handId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!hands) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading hands…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <Link to={`/room/${roomId}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to table
        </Link>
        <h1 className="font-display text-xl font-bold">Hand history</h1>
      </header>
      <p className="text-sm text-slate-500">
        Every completed hand stores its full signed transcript with your result on it. Download one
        to audit the shuffle, every unmask proof, and every action offline.
      </p>

      {totals.played > 0 && (
        <Panel className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500">Your net · {totals.played} hands</div>
            <div className={cn('font-display text-lg font-bold', netTone(totals.net))}>
              {netLabel(totals.net)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Hands won</div>
            <div className="font-display text-lg font-bold">{totals.won}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Folds</div>
            <div className="font-display text-lg font-bold">{totals.folds}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Paid to fold (blinds and bets)</div>
            <div className={cn('font-display text-lg font-bold', netTone(totals.foldBleed))}>
              {netLabel(totals.foldBleed)}
            </div>
          </div>
        </Panel>
      )}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-semibold capitalize',
              filter === f
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-500 ring-1 ring-slate-200/70 hover:text-slate-700 dark:bg-slate-900 dark:ring-slate-700/70 dark:hover:text-slate-300',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {hands.length === 0 ? (
        <Panel className="text-sm text-slate-500">No completed hands yet.</Panel>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
          {hands.filter(matchesFilter).map((h) => (
            <button
              key={h.handId}
              onClick={() => api.hand(roomId!, h.handId).then(setDetail)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-xl bg-white p-4 text-left ring-1 ring-slate-200/70 hover:shadow-md dark:bg-slate-900 dark:ring-slate-700/70',
                h.voided && 'opacity-60',
              )}
            >
              <div className="min-w-0">
                <div className="font-display text-sm font-semibold">hand {h.handId.slice(0, 8)}</div>
                <div className="text-xs text-slate-500">{new Date(h.ts).toLocaleString()}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2.5">
                {h.voided && <Badge tone="rose">voided</Badge>}
                <span className="text-xs text-slate-500">{h.outcome}</span>
                <span
                  className={cn(
                    'w-16 text-right font-display text-sm font-bold tabular-nums',
                    netTone(h.myNet),
                  )}
                >
                  {netLabel(h.myNet)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={detail !== null} onClose={() => setDetail(null)} title="Hand transcript">
        {detail && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone="slate">{detail.entries.length} entries</Badge>
              {(() => {
                const v = verifyHandTranscript(detail.handId, detail.entries, detail.head);
                return v.ok ? (
                  <Badge tone="emerald">✓ verified in your browser</Badge>
                ) : (
                  <Badge tone="rose">TAMPERED. {v.reason ?? 'invalid'} at entry {v.badSeq}</Badge>
                );
              })()}
              <span className="font-mono text-xs text-slate-400">head {detail.head.slice(0, 16)}…</span>
            </div>
            <Link to={`/room/${roomId}/replay/${detail.handId}`}>
              <Button variant="secondary" className="w-full">
                ▶ Watch replay
              </Button>
            </Link>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-3 dark:bg-slate-950/60">
              {detail.entries.map((e) => (
                <div key={e.seq} className="flex gap-2 text-xs">
                  <span className="w-8 text-right font-mono text-slate-400">{e.seq}</span>
                  <span className="w-32 font-medium">{e.type}</span>
                  <span className="truncate font-mono text-slate-400">{e.from.slice(0, 12)}</span>
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={() => download(detail)}>
              Download JSON
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
