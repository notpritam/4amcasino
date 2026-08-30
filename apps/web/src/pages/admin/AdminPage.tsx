import { type FormEvent, type ReactNode, memo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import { deriveAuthKey, deriveIdentity } from '../../shared/crypto.ts';
import { fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Dialog, Input, Panel, Spinner } from '../../shared/ui/index.tsx';

/** Lets the spinner paint before scrypt blocks the main thread deriving keys. */
const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 30));

const netStr = (n: number) => `${n > 0 ? '+' : ''}${fmt(n)}`;

function Note({ kind, children }: { kind: 'ok' | 'bad'; children: ReactNode }) {
  return (
    <p className={kind === 'ok' ? 'mt-2 text-xs text-emerald-600 dark:text-emerald-400' : 'mt-2 text-xs text-rose-600 dark:text-rose-400'}>
      {children}
    </p>
  );
}

interface LifecycleRequest {
  id: number;
  roomId: string;
  roomName: string;
  action: string;
  requestedBy: number;
  requesterName: string;
  note: string | null;
  createdAt: number;
}

function LifecycleSection() {
  const [requests, setRequests] = useState<LifecycleRequest[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    void api
      .adminLifecycle()
      .then((r) => setRequests(r.requests ?? []))
      .catch(() => setRequests([]));
  }
  useEffect(load, []);

  async function decide(id: number, approve: boolean) {
    setErr(null);
    setBusyId(id);
    try {
      await api.adminDecideLifecycle(id, approve);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not decide that request');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel>
      <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">Room requests</h2>
      <p className="mt-1 text-sm text-slate-500">Hosts asking to archive, restore, or delete a table.</p>

      {requests === null ? (
        <div className="mt-4">
          <Spinner label="Loading requests…" />
        </div>
      ) : requests.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">Nothing waiting on you.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {requests.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200/70 dark:bg-slate-900/60 dark:ring-slate-700/70"
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-900 dark:text-slate-100">{r.roomName}</div>
                <div className="text-xs text-slate-400">
                  {r.requesterName} asked to {r.action} this table
                  {r.note ? `, note: ${r.note}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="success" disabled={busyId === r.id} onClick={() => void decide(r.id, true)}>
                  {busyId === r.id ? <Spinner label="Working…" /> : 'Approve'}
                </Button>
                <Button variant="danger" disabled={busyId === r.id} onClick={() => void decide(r.id, false)}>
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {err && <Note kind="bad">{err}</Note>}
    </Panel>
  );
}

interface MergeRequestRow {
  id: number;
  fromUser: number;
  fromUsername: string;
  intoUser: number;
  intoUsername: string;
  note: string | null;
  createdAt: number;
  fromBalance: number;
  fromRooms: number;
  intoBalance: number;
  intoRooms: number;
}

function MergeSection() {
  const [requests, setRequests] = useState<MergeRequestRow[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<MergeRequestRow | null>(null);

  const [directFrom, setDirectFrom] = useState('');
  const [directInto, setDirectInto] = useState('');
  const [directNote, setDirectNote] = useState('');
  const [directConfirm, setDirectConfirm] = useState(false);
  const [directBusy, setDirectBusy] = useState(false);
  const [directMsg, setDirectMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  function load() {
    void api
      .adminMerges()
      .then((r) => setRequests(r.requests ?? []))
      .catch(() => setRequests([]));
  }
  useEffect(load, []);

  async function decide(id: number, approve: boolean) {
    setErr(null);
    setBusyId(id);
    try {
      await api.adminDecideMerge(id, approve);
      setConfirmTarget(null);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not decide that request');
    } finally {
      setBusyId(null);
    }
  }

  function openDirectConfirm(e: FormEvent) {
    e.preventDefault();
    setDirectMsg(null);
    if (!directFrom.trim() || !directInto.trim()) {
      setDirectMsg({ kind: 'bad', text: 'enter both usernames' });
      return;
    }
    setDirectConfirm(true);
  }

  async function mergeNow() {
    setDirectBusy(true);
    setDirectMsg(null);
    try {
      const from = directFrom.trim();
      const into = directInto.trim();
      await api.adminMergeNow(from, into, directNote.trim() || undefined);
      setDirectMsg({ kind: 'ok', text: `Merged @${from} into @${into}.` });
      setDirectFrom('');
      setDirectInto('');
      setDirectNote('');
      setDirectConfirm(false);
      load();
    } catch (e) {
      setDirectMsg({ kind: 'bad', text: e instanceof Error ? e.message : 'could not merge those accounts' });
    } finally {
      setDirectBusy(false);
    }
  }

  return (
    <Panel>
      <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">Merge requests</h2>
      <p className="mt-1 text-sm text-slate-500">Folding one account into another. Approving cannot be undone.</p>

      {requests === null ? (
        <div className="mt-4">
          <Spinner label="Loading requests…" />
        </div>
      ) : requests.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">Nothing waiting on you.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {requests.map((r) => (
            <li
              key={r.id}
              className="rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200/70 dark:bg-slate-900/60 dark:ring-slate-700/70"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    @{r.fromUsername} <span className="text-slate-400">into</span> @{r.intoUsername}
                  </div>
                  {r.note && <div className="text-xs text-slate-400">note: {r.note}</div>}
                  <div className="mt-1.5 grid grid-cols-1 gap-1 text-xs text-slate-500 sm:grid-cols-2">
                    <div>
                      @{r.fromUsername}: {netStr(r.fromBalance)} net, {r.fromRooms} room{r.fromRooms === 1 ? '' : 's'}
                    </div>
                    <div>
                      @{r.intoUsername}: {netStr(r.intoBalance)} net, {r.intoRooms} room{r.intoRooms === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="success" disabled={busyId === r.id} onClick={() => setConfirmTarget(r)}>
                    Approve
                  </Button>
                  <Button variant="danger" disabled={busyId === r.id} onClick={() => void decide(r.id, false)}>
                    Reject
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {err && <Note kind="bad">{err}</Note>}

      <form
        onSubmit={openDirectConfirm}
        className="mt-5 border-t border-slate-200/70 pt-4 dark:border-slate-700/70"
      >
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Merge accounts directly</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Skips the request queue and folds one account into another immediately. Approving cannot be undone.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            placeholder="From username"
            value={directFrom}
            onChange={(e) => setDirectFrom(e.target.value)}
            disabled={directBusy}
          />
          <Input
            placeholder="Into username"
            value={directInto}
            onChange={(e) => setDirectInto(e.target.value)}
            disabled={directBusy}
          />
        </div>
        <div className="mt-2">
          <Input
            placeholder="Note (optional)"
            value={directNote}
            onChange={(e) => setDirectNote(e.target.value)}
            disabled={directBusy}
          />
        </div>
        <div className="mt-2">
          <Button type="submit" variant="secondary" disabled={directBusy}>
            {directBusy ? <Spinner label="Merging…" /> : 'Merge now'}
          </Button>
        </div>
        {directMsg && <Note kind={directMsg.kind}>{directMsg.text}</Note>}
      </form>

      <Dialog open={confirmTarget !== null} onClose={() => setConfirmTarget(null)} title="Approve this merge?">
        {confirmTarget && (
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Everything @{confirmTarget.fromUsername} owns moves to @{confirmTarget.intoUsername}, and @{confirmTarget.fromUsername} is
              retired. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmTarget(null)} disabled={busyId === confirmTarget.id}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void decide(confirmTarget.id, true)} disabled={busyId === confirmTarget.id}>
                {busyId === confirmTarget.id ? <Spinner label="Merging…" /> : 'Merge accounts'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={directConfirm} onClose={() => setDirectConfirm(false)} title="Merge these accounts now?">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Everything @{directFrom} owns moves to @{directInto}, and @{directFrom} is retired. This takes effect immediately and cannot
          be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDirectConfirm(false)} disabled={directBusy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void mergeNow()} disabled={directBusy}>
            {directBusy ? <Spinner label="Merging…" /> : 'Merge accounts'}
          </Button>
        </div>
      </Dialog>
    </Panel>
  );
}

interface AdminTarget {
  userId: number;
  username: string;
  displayName: string;
  isPlatform?: boolean;
}

function UserAdminSection() {
  const [idInput, setIdInput] = useState('');
  const [target, setTarget] = useState<AdminTarget | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  const [disableConfirm, setDisableConfirm] = useState(false);
  const [disableBusy, setDisableBusy] = useState(false);
  const [disableMsg, setDisableMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    setLookupErr(null);
    setTarget(null);
    setDisableMsg(null);
    setPwMsg(null);
    const id = Number(idInput);
    if (!Number.isInteger(id) || id <= 0) {
      setLookupErr('enter a valid user ID');
      return;
    }
    setLookupBusy(true);
    try {
      const p = await api.userProfile(id);
      setTarget({ userId: p.userId, username: p.username, displayName: p.displayName, isPlatform: p.isPlatform });
    } catch (e2) {
      setLookupErr(e2 instanceof Error ? e2.message : 'could not find that user');
    } finally {
      setLookupBusy(false);
    }
  }

  async function disable() {
    if (!target) return;
    setDisableBusy(true);
    setDisableMsg(null);
    try {
      await api.adminDisableUser(target.userId);
      setDisableMsg({ kind: 'ok', text: `@${target.username} is disabled and signed out everywhere.` });
      setDisableConfirm(false);
    } catch (e) {
      setDisableMsg({ kind: 'bad', text: e instanceof Error ? e.message : 'could not disable that account' });
    } finally {
      setDisableBusy(false);
    }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (!target) return;
    if (newPassword.length < 6) {
      setPwMsg({ kind: 'bad', text: 'use at least 6 characters' });
      return;
    }
    setPwBusy(true);
    try {
      await yieldFrame();
      const newAuthKey = deriveAuthKey(target.username, newPassword);
      const identity = deriveIdentity(target.username, newPassword);
      await api.adminSetUserPassword(target.userId, newAuthKey, identity.publicKey);
      setNewPassword('');
      setPwMsg({ kind: 'ok', text: `Password reset for @${target.username}. Tell them the new password directly, they were signed out everywhere.` });
    } catch (e2) {
      setPwMsg({ kind: 'bad', text: e2 instanceof Error ? e2.message : 'could not reset that password' });
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <Panel>
      <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">User admin</h2>
      <p className="mt-1 text-sm text-slate-500">
        Look a player up by their user ID. It's visible in the URL of their profile page, /players/ID.
      </p>

      <form onSubmit={(e) => void lookup(e)} className="mt-4 flex max-w-sm gap-2">
        <Input
          type="number"
          min={1}
          placeholder="User ID"
          value={idInput}
          onChange={(e) => setIdInput(e.target.value)}
          disabled={lookupBusy}
        />
        <Button type="submit" variant="secondary" disabled={lookupBusy}>
          {lookupBusy ? <Spinner label="Looking up…" /> : 'Look up'}
        </Button>
      </form>
      {lookupErr && <Note kind="bad">{lookupErr}</Note>}

      {target && (
        <div className="mt-5 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/70 dark:bg-slate-900/60 dark:ring-slate-700/70">
          <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
            {target.displayName}
            <span className="font-normal text-slate-400">@{target.username}</span>
            {target.isPlatform && <Badge tone="indigo">House account</Badge>}
          </div>

          {target.isPlatform ? (
            <p className="mt-2 text-xs text-slate-400">The house account can't be disabled or reset from here.</p>
          ) : (
            <>
              <div className="mt-3 border-t border-slate-200/70 pt-3 dark:border-slate-700/70">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Disable account</h3>
                <p className="mt-0.5 text-xs text-slate-500">Signs them out everywhere and blocks further logins. Nothing is deleted.</p>
                <div className="mt-2">
                  <Button variant="danger" onClick={() => setDisableConfirm(true)} disabled={disableBusy}>
                    Disable @{target.username}
                  </Button>
                </div>
                {disableMsg && <Note kind={disableMsg.kind}>{disableMsg.text}</Note>}
              </div>

              <form onSubmit={(e) => void resetPassword(e)} className="mt-3 border-t border-slate-200/70 pt-3 dark:border-slate-700/70">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Reset password</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Sets a new password and signing key for @{target.username}. They must not be seated at a table when you do this.
                </p>
                <div className="mt-2 flex max-w-sm gap-2">
                  <Input
                    type="password"
                    placeholder="New password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={6}
                    disabled={pwBusy}
                  />
                  <Button type="submit" disabled={pwBusy}>
                    {pwBusy ? <Spinner label="Re-keying…" /> : 'Reset password'}
                  </Button>
                </div>
                {pwMsg && <Note kind={pwMsg.kind}>{pwMsg.text}</Note>}
              </form>
            </>
          )}
        </div>
      )}

      <Dialog open={disableConfirm} onClose={() => setDisableConfirm(false)} title={`Disable @${target?.username ?? ''}?`}>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          They're signed out everywhere and can't log back in until re-enabled. Nothing they own is deleted.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDisableConfirm(false)} disabled={disableBusy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void disable()} disabled={disableBusy}>
            {disableBusy ? <Spinner label="Working…" /> : 'Disable account'}
          </Button>
        </div>
      </Dialog>
    </Panel>
  );
}

interface AdminRoomRow {
  id: string;
  name: string;
  archived: number; // sqlite INTEGER 0/1 round-trips as a number over JSON
  hostName: string;
  playerCount: number;
}

const RoomsSection = memo(function RoomsSection() {
  const [query, setQuery] = useState('');
  const [rooms, setRooms] = useState<AdminRoomRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminRoomRow | null>(null);

  function load(q?: string) {
    void api
      .adminRooms(q)
      .then((r) => setRooms(r.rooms ?? []))
      .catch(() => setRooms([]));
  }
  useEffect(() => load(), []);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    load(query.trim() || undefined);
  }

  async function toggleArchive(room: AdminRoomRow) {
    setErr(null);
    setBusyId(room.id);
    try {
      await api.adminArchiveRoom(room.id, !room.archived);
      load(query.trim() || undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not update that room');
    } finally {
      setBusyId(null);
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    setErr(null);
    setBusyId(deleteTarget.id);
    try {
      await api.adminDeleteRoom(deleteTarget.id);
      setDeleteTarget(null);
      load(query.trim() || undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not delete that room');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel>
      <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">Rooms</h2>
      <p className="mt-1 text-sm text-slate-500">Archive or delete any table directly. Delete cannot be undone.</p>

      <form onSubmit={onSearch} className="mt-4 flex max-w-sm gap-2">
        <Input placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {rooms === null ? (
        <div className="mt-4">
          <Spinner label="Loading rooms…" />
        </div>
      ) : rooms.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">No rooms found.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rooms.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200/70 dark:bg-slate-900/60 dark:ring-slate-700/70"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                  {r.name}
                  {!!r.archived && <Badge tone="amber">Archived</Badge>}
                </div>
                <div className="text-xs text-slate-400">
                  Hosted by {r.hostName} &middot; {r.playerCount} player{r.playerCount === 1 ? '' : 's'}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" disabled={busyId === r.id} onClick={() => void toggleArchive(r)}>
                  {busyId === r.id ? <Spinner label="Working…" /> : r.archived ? 'Unarchive' : 'Archive'}
                </Button>
                <Button variant="danger" disabled={busyId === r.id} onClick={() => setDeleteTarget(r)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {err && <Note kind="bad">{err}</Note>}

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete this room?">
        {deleteTarget && (
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              "{deleteTarget.name}" will be removed from every list. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={busyId === deleteTarget.id}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void doDelete()} disabled={busyId === deleteTarget.id}>
                {busyId === deleteTarget.id ? <Spinner label="Deleting…" /> : 'Delete room'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Panel>
  );
});
RoomsSection.displayName = 'RoomsSection';

export function AdminPage() {
  const nav = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void api
      .me()
      .then((me) => {
        if (!me.isPlatform) nav('/lobby', { replace: true });
        else setChecked(true);
      })
      .catch(() => nav('/lobby', { replace: true }));
  }, [nav]);

  if (!checked) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner label="Checking access…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">Admin</h1>
        <p className="mt-1 text-sm text-slate-500">Platform-only. Room requests, account merges, and user accounts.</p>
      </header>
      <LifecycleSection />
      <MergeSection />
      <RoomsSection />
      <UserAdminSection />
    </div>
  );
}
