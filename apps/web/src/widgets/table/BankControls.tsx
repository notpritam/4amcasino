import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Dialog, Input } from '../../shared/ui/index.tsx';
import { CaretDown, Coins, HandCoins, Tray } from '@phosphor-icons/react';

interface BuyRequest {
  id: number;
  userId: number;
  username: string;
  amount: number;
  note: string | null;
  ts: number;
}

export function BankControls({
  roomId,
  mode = 'expanded',
}: {
  roomId: string;
  mode?: 'expanded' | 'hub';
}) {
  const room = useStore((s) => s.room);
  const userId = useStore((s) => s.auth.userId);
  const pushError = useStore((s) => s.pushError);
  const [buyOpen, setBuyOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState<number | ''>('');
  const [sendAmount, setSendAmount] = useState(100);
  const [sendNote, setSendNote] = useState('');
  const [sendDone, setSendDone] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [amount, setAmount] = useState(500);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [requests, setRequests] = useState<BuyRequest[]>([]);
  const [hubOpen, setHubOpen] = useState(false);
  const hubTriggerRef = useRef<HTMLButtonElement>(null);
  const firstHubActionRef = useRef<HTMLButtonElement>(null);
  const restoreHubFocus = useRef(true);
  const isMainBanker = room?.room.bankerId === userId;
  const isBanker = isMainBanker || room?.room.coBankerId === userId;

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

  useEffect(() => {
    if (!hubOpen) return;
    firstHubActionRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHubOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      if (restoreHubFocus.current) hubTriggerRef.current?.focus();
    };
  }, [hubOpen]);

  function openFromHub(openDialog: (open: boolean) => void) {
    restoreHubFocus.current = false;
    setHubOpen(false);
    openDialog(true);
    requestAnimationFrame(() => {
      restoreHubFocus.current = true;
    });
  }

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
      {mode === 'hub' ? (
        <div className="relative">
          <button
            ref={hubTriggerRef}
            type="button"
            className={cn(
              'relative inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 transition-[color,background-color,transform] duration-200',
              'hover:bg-slate-50 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
              'dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
            )}
            onClick={() => setHubOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={hubOpen}
          >
            <Coins size={17} weight="bold" />
            Chips
            <CaretDown
              size={13}
              weight="bold"
              className={hubOpen ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
            {requests.length > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[0.65rem] font-bold text-white ring-2 ring-white dark:ring-slate-950">
                {requests.length > 9 ? '9+' : requests.length}
              </span>
            )}
          </button>
          {hubOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-20 cursor-default"
                aria-label="Close chips menu"
                onClick={() => setHubOpen(false)}
              />
              <div
                role="menu"
                aria-label="Chip controls"
                className="absolute right-0 top-12 z-30 w-56 rounded-2xl bg-white p-1.5 shadow-[0_20px_60px_rgba(15,23,42,0.18)] ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
              >
                <button
                  ref={firstHubActionRef}
                  type="button"
                  role="menuitem"
                  onClick={() => openFromHub(setBuyOpen)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500 dark:hover:bg-slate-800"
                >
                  <Coins size={18} /> Buy points
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openFromHub(setSendOpen)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500 dark:hover:bg-slate-800"
                >
                  <HandCoins size={18} /> Send chips
                </button>
                {isBanker && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openFromHub(setInboxOpen)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500 dark:hover:bg-slate-800"
                  >
                    <Tray size={18} />
                    <span className="flex-1">Bank inbox</span>
                    {requests.length > 0 && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 font-display text-xs font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                        {requests.length}
                      </span>
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <Button variant="secondary" onClick={() => setBuyOpen(true)}>
            <Coins size={17} /> Buy points
          </Button>
          <Button variant="secondary" onClick={() => setSendOpen(true)}>
            <HandCoins size={17} /> Send chips
          </Button>
          {isBanker && (
            <Button variant="secondary" onClick={() => setInboxOpen(true)} className="relative">
              <Tray size={17} /> Bank inbox
              {requests.length > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[0.65rem] font-bold text-white">
                  {requests.length}
                </span>
              )}
            </Button>
          )}
        </>
      )}

      <Dialog open={buyOpen} onClose={() => setBuyOpen(false)} title="Buy points from the bank">
        {sent ? (
          <p className="text-sm text-emerald-600">
            {room?.room.autoApproveBuys
              ? 'Approved. The points are already in your stack.'
              : 'Request sent. The banker will review it.'}
          </p>
        ) : (
          <form onSubmit={buy} className="space-y-3">
            <p className="text-sm text-slate-500">
              Points are play money. Every purchase is written to the room ledger so the group can
              settle up later.
              {room?.room.autoApproveBuys
                ? ' This table auto-approves buys, so they land instantly.'
                : ''}
            </p>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-500">Amount</span>
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(+e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-500">Note (optional)</span>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="paid via UPI"
              />
            </label>
            <Button type="submit" className="w-full">
              Request {fmt(amount)} points
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog open={sendOpen} onClose={() => setSendOpen(false)} title="Send chips to a player">
        {sendDone ? (
          <p className="text-sm text-emerald-600">{sendDone}</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (sendTo === '') return;
              void api
                .transfer(roomId, sendTo, sendAmount, sendNote || undefined)
                .then(() => {
                  setSendDone('Sent. It is on the ledger.');
                  setTimeout(() => {
                    setSendOpen(false);
                    setSendDone(null);
                    setSendNote('');
                  }, 1200);
                })
                .catch((err) => pushError(err instanceof Error ? err.message : 'transfer failed'));
            }}
            className="space-y-3"
          >
            <p className="text-sm text-slate-500">
              Lend a short-stacked friend some chips or settle a side bet. Every transfer is written
              to the room ledger. Chips move between hands only.
            </p>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-500">To</span>
              <select
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value === '' ? '' : +e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                required
              >
                <option value="">Pick a player</option>
                {room?.players
                  .filter((p) => p.userId !== userId)
                  .map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-500">Amount</span>
              <Input
                type="number"
                min={1}
                value={sendAmount}
                onChange={(e) => setSendAmount(Math.max(1, +e.target.value))}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-500">Note (optional)</span>
              <Input
                value={sendNote}
                onChange={(e) => setSendNote(e.target.value)}
                placeholder="loan until next buy-in"
              />
            </label>
            <Button type="submit" className="w-full" disabled={sendTo === ''}>
              Send {fmt(sendAmount)}
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog open={inboxOpen} onClose={() => setInboxOpen(false)} title="Pending purchases">
        {isBanker && (
          <label className="mb-4 flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={!!room?.room.autoApproveBuys}
              onChange={(e) =>
                void api
                  .setAutoApproveBuys(roomId, e.target.checked)
                  .catch((err) => pushError(err instanceof Error ? err.message : 'update failed'))
              }
              className="mt-0.5"
            />
            <span>
              Auto-approve buys: credit every purchase request instantly, in your name, instead of
              waiting for you to review it. Everything still lands on the ledger and stays
              revertable.
            </span>
          </label>
        )}
        {isBanker && (
          <label className="mb-4 flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={!!room?.room.tvReplays}
              onChange={(e) =>
                void api
                  .setTvReplays(roomId, e.target.checked)
                  .catch((err) => pushError(err instanceof Error ? err.message : 'update failed'))
              }
              className="mt-0.5"
            />
            <span>
              TV replays: after every hand each player&apos;s hand key is saved, so replays show
              ALL hole cards - broadcast style, ready to cut a video from. Folded cards stop being
              secret from this table&apos;s replays.
            </span>
          </label>
        )}
        {isBanker && (
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-500">
                Hands required before winnings count in settle-up (0 = everyone counts)
              </span>
              <Input
                type="number"
                min={0}
                max={500}
                defaultValue={room?.room.minSettleHands ?? 0}
                onBlur={(e) =>
                  void api.setMinSettleHands(roomId, Math.max(0, +e.target.value)).catch(() => {})
                }
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-500">
                7-2 offsuit bounty per player (0 = off). Winning with 7-2 offsuit collects this from
                everyone; fold-winners claim it by showing their cards.
              </span>
              <Input
                type="number"
                min={0}
                max={100000}
                defaultValue={room?.room.sevenDeuceBonus ?? 0}
                onBlur={(e) =>
                  void api.setSevenDeuceBonus(roomId, Math.max(0, +e.target.value)).catch(() => {})
                }
              />
            </label>
          </div>
        )}
        {isMainBanker && (
          <label className="mb-4 block text-sm">
            <span className="mb-1 block text-slate-500">
              Backup banker (same powers, so the bank keeps working when you are away)
            </span>
            <select
              value={room?.room.coBankerId ?? ''}
              onChange={(e) =>
                void api.setCoBanker(roomId, e.target.value ? +e.target.value : null)
              }
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">None</option>
              {room?.players
                .filter((p) => p.userId !== userId)
                .map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.displayName}
                  </option>
                ))}
            </select>
          </label>
        )}
        {requests.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing waiting for approval.</p>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"
              >
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
