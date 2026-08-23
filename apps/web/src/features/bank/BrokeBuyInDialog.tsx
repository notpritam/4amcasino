import { useState } from 'react';
import { api } from '../../shared/api.ts';
import { leaveSeat } from '../../shared/gameClient.ts';
import { useStore } from '../../shared/store.ts';
import { fmt } from '../../shared/lib/cn.ts';
import { Button, Dialog, Input } from '../../shared/ui/index.tsx';

/** Shown automatically when you are seated with zero chips between hands:
 *  request a buy-in from the banker, or stand up and watch as a viewer. */
export function BrokeBuyInDialog({
  roomId,
  open,
  onClose,
}: {
  roomId: string;
  open: boolean;
  onClose: () => void;
}) {
  const room = useStore((s) => s.room);
  const pushError = useStore((s) => s.pushError);
  const [amount, setAmount] = useState(() => (room?.room.bb ?? 20) * 50);
  const [sent, setSent] = useState(false);

  async function buy(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.buy(roomId, amount);
      setSent(true);
    } catch (err) {
      pushError(err instanceof Error ? err.message : 'buy request failed');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="You are out of chips">
      {sent ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-600">
            Buy-in request sent. As soon as the banker approves it, the points land on your stack
            and you are back in the next hand.
          </p>
          <Button variant="secondary" className="w-full" onClick={onClose}>
            Got it
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Your stack is empty, so the next hands will deal around you. Buy more points from the
            bank, or stand up and watch.
          </p>
          <form onSubmit={buy} className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-500">Buy-in amount</span>
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(+e.target.value)}
              />
            </label>
            <Button type="submit" className="w-full">
              Request {fmt(amount)} points
            </Button>
          </form>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              leaveSeat();
              onClose();
            }}
          >
            Watch as a viewer
          </Button>
        </div>
      )}
    </Dialog>
  );
}
