import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus } from '@phosphor-icons/react';
import { api } from '../../shared/api.ts';
import { cn } from '../../shared/lib/cn.ts';
import { Avatar } from '../../entities/user/Avatar.tsx';
import { Badge, Button, Input, Panel } from '../../shared/ui/index.tsx';

interface FriendRow {
  userId: number;
  username: string;
  displayName: string;
  avatarVersion: number;
  online: boolean;
  lastSeen: number;
}

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span
      title={online ? 'online' : 'offline'}
      className={cn('h-2.5 w-2.5 shrink-0 rounded-full', online ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600')}
    />
  );
}

function lastSeenLabel(ts: number): string {
  if (!ts) return 'never seen';
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 3) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** Friends list with live presence, requests, and add-by-username. */
export function FriendsPanel() {
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incoming, setIncoming] = useState<FriendRow[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRow[]>([]);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const load = () =>
    api
      .friends()
      .then((r) => {
        setFriends(r.friends);
        setIncoming(r.incoming);
        setOutgoing(r.outgoing);
      })
      .catch(() => {});

  useEffect(() => {
    load();
    const iv = setInterval(load, 20_000);
    return () => clearInterval(iv);
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    try {
      const r = await api.addFriend(name.trim());
      setNote(r.accepted ? 'You are now friends.' : 'Request sent.');
      setName('');
      void load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'could not add');
    }
  }

  return (
    <Panel>
      <h2 className="mb-3 font-display font-semibold">Friends</h2>
      <form onSubmit={add} className="mb-3 flex gap-2">
        <Input
          placeholder="Add by username"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={name.trim().length < 2} aria-label="Send friend request">
          <UserPlus size={16} />
        </Button>
      </form>
      {note && <p className="mb-3 text-xs text-slate-500">{note}</p>}

      {incoming.map((f) => (
        <div key={f.userId} className="mb-2 flex items-center gap-2 rounded-xl bg-indigo-50 p-2.5 dark:bg-indigo-950/40">
          <Avatar userId={f.userId} name={f.displayName} version={f.avatarVersion} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm">
            <b>{f.displayName}</b> wants to be friends
          </span>
          <Button variant="success" onClick={() => void api.respondFriend(f.userId, true).then(load)}>
            Accept
          </Button>
          <Button variant="ghost" onClick={() => void api.respondFriend(f.userId, false).then(load)}>
            No
          </Button>
        </div>
      ))}

      {friends.length === 0 && incoming.length === 0 ? (
        <p className="text-sm text-slate-500">
          No friends yet. Add someone by username and play at the same tables.
        </p>
      ) : (
        <div className="space-y-1.5">
          {friends.map((f) => (
            <Link
              key={f.userId}
              to={`/players/${f.userId}`}
              className="flex items-center gap-2.5 rounded-xl p-2 hover:bg-slate-100 dark:hover:bg-slate-800/60"
            >
              <Avatar userId={f.userId} name={f.displayName} version={f.avatarVersion} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.displayName}</span>
              <span className="text-xs text-slate-400">{f.online ? 'online' : lastSeenLabel(f.lastSeen)}</span>
              <OnlineDot online={f.online} />
            </Link>
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          Waiting on: {outgoing.map((f) => f.displayName).join(', ')}
        </p>
      )}
    </Panel>
  );
}

interface Invite {
  id: number;
  roomId: string;
  roomName: string;
  joinCode: string;
  sb: number;
  bb: number;
  fromName: string;
}

/** Pending table invites, shown at the top of the lobby. */
export function InvitesPanel({ onJoined }: { onJoined: (roomId: string) => void }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const load = () => api.invites().then((r) => setInvites(r.invites)).catch(() => {});
  useEffect(() => {
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, []);

  if (invites.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {invites.map((i) => (
        <div
          key={i.id}
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950/40"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm">
              <b>{i.fromName}</b> invited you to <b>{i.roomName}</b>
            </div>
            <div className="text-xs text-slate-500">
              Blinds {i.sb}/{i.bb} · Code {i.joinCode}
            </div>
          </div>
          <Badge tone="indigo">invite</Badge>
          <Button
            onClick={() =>
              void api.respondInvite(i.id, true).then((r) => {
                void load();
                if (r.roomId) onJoined(r.roomId as string);
              })
            }
          >
            Join table
          </Button>
          <Button variant="ghost" onClick={() => void api.respondInvite(i.id, false).then(load)}>
            Decline
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Invite online friends into the current room (used from the table). */
export function InviteFriendsDialogBody({ roomId, memberIds }: { roomId: string; memberIds: number[] }) {
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [sent, setSent] = useState<Record<number, string>>({});
  useEffect(() => {
    api.friends().then((r) => setFriends(r.friends)).catch(() => {});
  }, []);

  const candidates = friends.filter((f) => !memberIds.includes(f.userId));
  if (candidates.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        All your friends are already here, or you have none yet. Add friends from the lobby, or just
        share the join code.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {candidates
        .sort((a, b) => Number(b.online) - Number(a.online))
        .map((f) => (
          <div key={f.userId} className="flex items-center gap-2.5 rounded-xl p-2">
            <Avatar userId={f.userId} name={f.displayName} version={f.avatarVersion} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.displayName}</span>
            <OnlineDot online={f.online} />
            <Button
              variant="secondary"
              disabled={!!sent[f.userId]}
              onClick={() =>
                void api
                  .inviteFriend(roomId, f.userId)
                  .then((r) => setSent((m) => ({ ...m, [f.userId]: r.autoJoined ? 'joined!' : 'invited' })))
                  .catch((e) => setSent((m) => ({ ...m, [f.userId]: e instanceof Error ? e.message : 'failed' })))
              }
            >
              {sent[f.userId] ?? 'Invite'}
            </Button>
          </div>
        ))}
    </div>
  );
}
