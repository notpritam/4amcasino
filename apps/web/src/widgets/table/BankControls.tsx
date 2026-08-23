import { useEffect, useState } from 'react';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Dialog, Input } from '../../shared/ui/index.tsx';

interface BuyRequest {
  id: number;
  userId: number;
  username: string;
  amount: number;
  note: string | null;
  ts: number;
}

export function BankControls({ roomId }: { roomId: string }) {
  const room = useStore((s) => s.room);
  const userId = useStore((s) => s.auth.userId);
  const pushError = useStore((s) => s.pushError);
  const [buyOpen, setBuyOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [amount, setAmount] = useState(500);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [requests, setRequests] = useState<BuyRequest[]>([]);
  const isBanker = room?.room.bankerId === userId;

  useEffect(() => {
    if (!isBanker) return;
    let live = true;
    const poll = () =>
      api
        .requests(roomId)
        .then((r) => live && setRequests(r.requests))
        .catch(() => {});
    poll();
    const iv = setInterval(poll, 4000);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, [isBanker, roomId]);

  async function buy(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.buy(roomId, amount, note || undefined);
      setSent(true);
      setTimeout(() => {
        setBuyOpen(false);
        setSent(false);
        setNote('');
      }, 1200);
    } catch (err) {
      pushError(err instanceof Error ? err.message : 'buy failed');
    }
  }

  async function decide(id: number, approve: boolean) {
    try {
      await api.approve(roomId, id, approve);
      setRequests((rs) => rs.filter((r) => r.id !== id));
    } catch (err) {
      pushError(err instanceof Error ? err.message : 'approval failed');
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setBuyOpen(true)}>
        Buy points
      </Button>
      {isBanker && (
        <Button variant="secondary" onClick={() => setInboxOpen(true)} className="relative">
          Bank inbox
          {requests.length > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[0.65rem] font-bold text-white">
              {requests.length}
            </span>
          )}
        </Button>
      )}

      <Dialog open={buyOpen} onClose={() => setBuyOpen(false)} title="Buy points from the bank">
        {sent ? (
          <p className="text-sm text-emerald-600">Request sent. The banker will review it.</p>
        ) : (
          <form onSubmit={buy} className="space-y-3">
            <p className="text-sm text-slate-500">
              Points are play money. Every purchase is written to the room ledger so the group can
              settle up later.
            </p>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-500">Amount</span>
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(+e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-500">Note (optional)</span>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="paid via UPI" />
            </label>
            <Button type="submit" className="w-full">
              Request {fmt(amount)} points
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog open={inboxOpen} onClose={() => setInboxOpen(false)} title="Pending purchases">
        {requests.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing waiting for approval.</p>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <div className="flex-1">
                  <div className="text-sm font-semibold">
                    {r.username} · <span className="font-display">{fmt(r.amount)}</span>
                  </div>
                  {r.note && <div className="text-xs text-slate-500">{r.note}</div>}
                </div>
                <Button variant="danger" onClick={() => decide(r.id, false)}>
                  Reject
                </Button>
                <Button variant="success" onClick={() => decide(r.id, true)}>
                  Approve
                </Button>
              </div>
            ))}
            <Badge tone="slate">Approved points land on the player's stack between hands</Badge>
          </div>
        )}
      </Dialog>
    </>
  );
}
