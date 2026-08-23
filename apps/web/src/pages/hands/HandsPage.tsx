import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { verifyHandTranscript, type TranscriptEntry } from '@4am/mental-poker';
import { api } from '../../shared/api.ts';
import { Badge, Button, Dialog, Panel, Spinner } from '../../shared/ui/index.tsx';

interface HandRef {
  handId: string;
  head: string;
  ts: number;
}

interface HandDetail {
  handId: string;
  head: string;
  entries: TranscriptEntry[];
}

export function HandsPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const [hands, setHands] = useState<HandRef[] | null>(null);
  const [detail, setDetail] = useState<HandDetail | null>(null);

  useEffect(() => {
    api.hands(roomId!).then((r) => setHands(r.hands));
  }, [roomId]);

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
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        <Link to={`/room/${roomId}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to table
        </Link>
        <h1 className="font-display text-xl font-bold">Hand history</h1>
      </header>
      <p className="text-sm text-slate-500">
        Every completed hand stores its full signed transcript. Download one to audit the shuffle,
        every unmask proof, and every action offline.
      </p>

      {hands.length === 0 ? (
        <Panel className="text-sm text-slate-500">No completed hands yet.</Panel>
      ) : (
        <div className="space-y-2">
          {hands.map((h) => (
            <button
              key={h.handId}
              onClick={() => api.hand(roomId!, h.handId).then(setDetail)}
              className="flex w-full items-center justify-between rounded-xl bg-white p-4 text-left ring-1 ring-slate-200/70 hover:shadow-md"
            >
              <div>
                <div className="font-display text-sm font-semibold">hand {h.handId.slice(0, 8)}</div>
                <div className="text-xs text-slate-500">{new Date(h.ts).toLocaleString()}</div>
              </div>
              <span className="font-mono text-xs text-slate-400">{h.head.slice(0, 12)}…</span>
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
                  <Badge tone="rose">TAMPERED — {v.reason ?? 'invalid'} at entry {v.badSeq}</Badge>
                );
              })()}
              <span className="font-mono text-xs text-slate-400">head {detail.head.slice(0, 16)}…</span>
            </div>
            <Link to={`/room/${roomId}/replay/${detail.handId}`}>
              <Button variant="secondary" className="w-full">
                ▶ Watch replay
              </Button>
            </Link>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-3">
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
