import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Button, Dialog, Input, Panel, Spinner } from '../../shared/ui/index.tsx';
import { Avatar } from '../../entities/user/Avatar.tsx';

/** Settling up, in one place (requested by notpritam, docs/FEATURES.md).
 *
 *  One line per person across every room, the redirects that let a debt you are
 *  owed pay off a debt you owe without the money passing through you, and what
 *  you owe the house for keeping the servers on. */

interface NetLine {
  otherUserId: number;
  otherName: string;
  otherAvatarVersion: number;
  net: number;
  rooms: { roomId: string; roomName: string; amount: number; direction: 'owe' | 'owed' }[];
}

interface Redirect {
  payerUserId: number;
  payerName: string;
  payeeUserId: number;
  payeeName: string;
  amount: number;
}

interface SettleView {
  people: NetLine[];
  redirects: Redirect[];
  totals: { owedToMe: number; iOwe: number; net: number };
  house: { accrued: number; paid: number; outstanding: number };
}

/** Downscale a photo of a transfer to something worth storing. */
async function toProofDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

function Money({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        'font-display font-bold tabular-nums',
        value > 0 ? 'text-emerald-600 dark:text-emerald-400' : value < 0 ? 'text-rose-600 dark:text-rose-400' : '',
        className,
      )}
    >
      {value > 0 ? '+' : ''}
      {fmt(value)}
    </span>
  );
}

/** Shared by "mark settled" and "record a house payment": a remark and a photo. */
function ProofFields({
  note,
  setNote,
  fileName,
  onPick,
  placeholder,
}: {
  note: string;
  setNote: (v: string) => void;
  fileName: string | null;
  onPick: (f: File | undefined) => void;
  placeholder: string;
}) {
  return (
    <>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-500">Remark</span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={placeholder} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-500">Photo of the transfer (optional)</span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => onPick(e.target.files?.[0])}
          className="block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium dark:file:bg-slate-800 dark:file:text-slate-200"
        />
        {fileName && <span className="mt-1 block text-xs text-emerald-600">✓ {fileName}</span>}
      </label>
    </>
  );
}

export function SettlePage() {
  const [view, setView] = useState<SettleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<NetLine | null>(null);
  const [houseOpen, setHouseOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(() => {
    api
      .settleView()
      .then(setView)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'could not load'));
  }, []);
  useEffect(load, [load]);

  if (error) return <p className="p-6 text-sm text-rose-600">{error}</p>;
  if (!view) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner label="Working out who owes whom…" />
      </div>
    );
  }

  const { totals, house } = view;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold">Settle up</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every room you have played, netted down to one number per person.
        </p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Panel className="p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">You are owed</div>
          <Money value={totals.owedToMe} className="text-2xl" />
        </Panel>
        <Panel className="p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">You owe</div>
          <Money value={-totals.iOwe} className="text-2xl" />
        </Panel>
        <Panel className="p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">Net position</div>
          <Money value={totals.net} className="text-2xl" />
        </Panel>
      </div>

      {view.redirects.length > 0 && (
        <Panel className="mb-6 border border-indigo-200 dark:border-indigo-900">
          <h2 className="font-display text-base font-semibold">Close two debts with one payment</h2>
          <p className="mb-3 mt-0.5 text-xs text-slate-500">
            Money owed to you can go straight to someone you owe — it never has to pass through your
            hands. Send them this and both debts clear at once.
          </p>
          <ul className="space-y-2">
            {view.redirects.map((r, i) => (
              <li
                key={`${r.payerUserId}-${r.payeeUserId}-${i}`}
                className="flex flex-wrap items-center gap-2 rounded-xl bg-indigo-50/70 px-3 py-2.5 text-sm dark:bg-indigo-950/40"
              >
                <span className="font-semibold">{r.payerName}</span>
                <span className="text-slate-400">pays</span>
                <span className="font-semibold">{r.payeeName}</span>
                <span className="font-display font-bold tabular-nums text-indigo-600 dark:text-indigo-300">
                  {fmt(r.amount)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      `${r.payerName} → ${r.payeeName}: ${fmt(r.amount)} (settling up through me on 4AM Casino)`,
                    )
                  }
                  className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:text-indigo-300 dark:hover:bg-indigo-900"
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold">The house</h2>
            <p className="mt-0.5 max-w-md text-xs leading-relaxed text-slate-500">
              Every pot pays 1% to keep the servers running. This is your share of it — the rake came
              off pots you won, so it is what you actually contributed.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-400">Outstanding</div>
            <span className="font-display text-2xl font-bold tabular-nums">
              {fmt(house.outstanding)}
            </span>
            <div className="text-xs text-slate-400">
              {fmt(house.accrued)} accrued · {fmt(house.paid)} paid
            </div>
          </div>
        </div>
        <Button className="mt-3" variant="secondary" onClick={() => setHouseOpen(true)}>
          Record a payment
        </Button>
      </Panel>

      <h2 className="mb-3 font-display font-semibold">Per person</h2>
      {view.people.length === 0 ? (
        <Panel>
          <p className="text-sm text-slate-500">
            Nothing outstanding anywhere. Every table you have played is square.
          </p>
        </Panel>
      ) : (
        <div className="space-y-2">
          {view.people.map((p) => (
            <Panel key={p.otherUserId} className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Avatar userId={p.otherUserId} name={p.otherName} version={p.otherAvatarVersion} />
                <Link to={`/players/${p.otherUserId}`} className="font-medium hover:underline">
                  {p.otherName}
                </Link>
                <span className="text-xs text-slate-400">
                  {p.net > 0 ? 'owes you' : 'you owe'} · across {p.rooms.length} room
                  {p.rooms.length === 1 ? '' : 's'}
                </span>
                <Money value={p.net} className="ml-auto text-lg" />
                <Button variant="secondary" onClick={() => setOpen(p)}>
                  Mark settled
                </Button>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(expanded === p.otherUserId ? null : p.otherUserId)}
                className="mt-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {expanded === p.otherUserId ? 'Hide' : 'Show'} the rooms behind this
              </button>
              {expanded === p.otherUserId && (
                <ul className="mt-2 space-y-1 border-t border-slate-200/70 pt-2 text-xs dark:border-slate-700/70">
                  {p.rooms.map((r) => (
                    <li key={r.roomId} className="flex items-center gap-2">
                      <Link to={`/room/${r.roomId}/ledger`} className="hover:underline">
                        {r.roomName}
                      </Link>
                      <span className="ml-auto tabular-nums">
                        <Money value={r.direction === 'owe' ? -r.amount : r.amount} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ))}
        </div>
      )}

      {open && <SettleDialog line={open} onClose={() => setOpen(null)} onDone={load} />}
      {houseOpen && <HousePayDialog onClose={() => setHouseOpen(false)} onDone={load} />}
    </div>
  );
}

function SettleDialog({
  line,
  onClose,
  onDone,
}: {
  line: NetLine;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      // a settlement is per room, so marking "settled with this person" marks
      // every room they and I still have open between us
      let anySettled = false;
      for (const r of line.rooms) {
        const res = await api.markSettled(r.roomId, line.otherUserId, note || undefined, proof ?? undefined);
        anySettled ||= !!res.settled;
      }
      setMsg(
        anySettled
          ? 'Settled — both of you have confirmed.'
          : `Marked. It clears once ${line.otherName} confirms too.`,
      );
      onDone();
      setTimeout(onClose, 1600);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'could not mark it');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Settle with ${line.otherName}`}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {line.net > 0 ? (
            <>
              <span className="font-semibold">{line.otherName}</span> owes you{' '}
              <span className="font-semibold">{fmt(line.net)}</span>.
            </>
          ) : (
            <>
              You owe <span className="font-semibold">{line.otherName}</span>{' '}
              <span className="font-semibold">{fmt(-line.net)}</span>.
            </>
          )}{' '}
          Both of you have to confirm before it clears on the platform.
        </p>
        <ProofFields
          note={note}
          setNote={setNote}
          fileName={fileName}
          placeholder="paid on UPI, 9:40pm"
          onPick={(f) => {
            if (!f) return;
            setFileName(f.name);
            void toProofDataUrl(f).then(setProof);
          }}
        />
        {msg && <p className="text-sm text-emerald-600">{msg}</p>}
        <Button onClick={() => void submit()} disabled={busy} className="w-full">
          {busy ? <Spinner label="Recording…" /> : 'Mark settled'}
        </Button>
      </div>
    </Dialog>
  );
}

function HousePayDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Dialog open onClose={onClose} title="Record a payment to the house">
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This keeps 4AM Casino online. Record what you sent and it comes off your outstanding
          balance.
        </p>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-500">Amount</span>
          <Input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="500"
          />
        </label>
        <ProofFields
          note={note}
          setNote={setNote}
          fileName={fileName}
          placeholder="UPI to notpritam@…"
          onPick={(f) => {
            if (!f) return;
            setFileName(f.name);
            void toProofDataUrl(f).then(setProof);
          }}
        />
        {msg && <p className="text-sm text-rose-600">{msg}</p>}
        <Button
          className="w-full"
          disabled={busy || !(Number(amount) > 0)}
          onClick={() => {
            setBusy(true);
            setMsg(null);
            api
              .payHouse(Math.floor(Number(amount)), note || undefined, proof ?? undefined)
              .then(() => {
                onDone();
                onClose();
              })
              .catch((e: unknown) => setMsg(e instanceof Error ? e.message : 'could not record it'))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <Spinner label="Recording…" /> : 'Record payment'}
        </Button>
      </div>
    </Dialog>
  );
}
