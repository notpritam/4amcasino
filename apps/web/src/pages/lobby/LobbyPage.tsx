import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { Badge, Button, Dialog, Input, Panel } from '../../shared/ui/index.tsx';
import { FriendsPanel, InvitesPanel } from '../../features/friends/FriendsPanel.tsx';
import { NetAreaChart } from '../../features/stats/charts.tsx';
import { CopyInvite } from '../../features/share/ShareRoom.tsx';
import { fmt } from '../../shared/lib/cn.ts';

interface RoomSummary {
  id: string;
  name: string;
  joinCode: string;
  sb: number;
  bb: number;
  playerCount: number;
}

export function LobbyPage() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [name, setName] = useState('');
  const [sb, setSb] = useState(10);
  const [bb, setBb] = useState(20);
  const [actionSecs, setActionSecs] = useState(45);
  const [minSettleHands, setMinSettleHands] = useState(0);
  const [meetLink, setMeetLink] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [timeline, setTimeline] = useState<{ ts: number; net: number }[]>([]);
  const [myStats, setMyStats] = useState<{ net: number; handsPlayed: number; biggestWin: number } | null>(null);
  const [publicRooms, setPublicRooms] = useState<
    { id: string; name: string; sb: number; bb: number; playerCount: number; hostName: string; meetLink: string | null }[]
  >([]);
  const [strictAudit, setStrictAudit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefs = useStore((s) => s.prefs);
  const username = useStore((s) => s.auth.username);
  const nav = useNavigate();

  useEffect(() => {
    api.myRooms().then((r) => setRooms(r.rooms)).catch(() => {});
    api.publicRooms().then((r) => setPublicRooms(r.rooms)).catch(() => {});
    api.timeline().then((r) => setTimeline(r.points)).catch(() => {});
  }, []);
  const userId = useStore((s) => s.auth.userId);
  useEffect(() => {
    if (userId) api.userProfile(userId).then((r) => setMyStats(r.stats)).catch(() => {});
  }, [userId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const room = await api.createRoom(name, sb, bb, strictAudit ? 'strict-audit' : undefined, actionSecs, minSettleHands);
      const extras: Record<string, unknown> = {};
      if (meetLink.trim()) extras.meetLink = meetLink.trim();
      if (visibility === 'public') extras.visibility = 'public';
      if (Object.keys(extras).length) await api.roomExtras(room.id, extras);
      nav(`/room/${room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not create room');
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const room = await api.joinRoom(joinCode.trim());
      nav(`/room/${room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not join');
    }
  }

  // the lobby uses the whole screen, Linear-style: actions down the left,
  // your game and rooms in the middle, people down the right
  // (requested by notpritam, docs/FEATURES.md)
  return (
    <div className="mx-auto max-w-[1600px] p-4 md:p-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Good evening, {prefs.displayName || username}</h1>
        <p className="mt-1 text-sm text-slate-500">Start a table or join one with a code.</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <Panel>
          <h2 className="mb-1 font-display font-semibold">Start a table</h2>
          <p className="mb-4 text-sm text-slate-500">You become host and banker.</p>
          <Button className="w-full" onClick={() => setCreateOpen(true)}>Create room</Button>
        </Panel>
        <Panel>
          <h2 className="mb-1 font-display font-semibold">Join a table</h2>
          <p className="mb-4 text-sm text-slate-500">Ask the host for the 6-letter code.</p>
          <form onSubmit={join} className="flex gap-2">
            <Input
              placeholder="ABC123"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="font-display uppercase tracking-widest"
            />
            <Button type="submit" variant="secondary" disabled={joinCode.length !== 6}>
              Join
            </Button>
          </form>
        </Panel>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>

      <div className="min-w-0 space-y-5">
      {timeline.length >= 2 && myStats && (
        <Panel>
          <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <h2 className="font-display font-semibold">Your game so far</h2>
            <span
              className={
                myStats.net > 0
                  ? 'font-display text-lg font-bold text-emerald-600'
                  : myStats.net < 0
                    ? 'font-display text-lg font-bold text-rose-600'
                    : 'font-display text-lg font-bold text-slate-400'
              }
            >
              {myStats.net > 0 ? '+' : ''}
              {fmt(myStats.net)}
            </span>
            <span className="text-sm text-slate-500">
              {fmt(myStats.handsPlayed)} hands · best pot +{fmt(myStats.biggestWin)}
            </span>
          </div>
          <NetAreaChart points={timeline} />
        </Panel>
      )}

      <div>
          <h2 className="mb-3 font-display font-semibold">Your rooms</h2>
          {rooms.length === 0 ? (
            <p className="text-sm text-slate-500">No rooms yet. Create one and share the code.</p>
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {rooms.map((r) => (
                // the whole card is the link, but the share control has to sit
                // above it - an interactive element cannot nest inside an anchor
                <div
                  key={r.id}
                  className="relative flex items-center justify-between rounded-xl bg-white p-4 ring-1 ring-slate-200/70 transition-shadow hover:shadow-md dark:bg-slate-900 dark:ring-slate-700/70"
                >
                  <Link to={`/room/${r.id}`} className="absolute inset-0 rounded-xl" aria-label={`Open ${r.name}`} />
                  <div className="min-w-0">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-slate-500">
                      Blinds {r.sb}/{r.bb} · Code {r.joinCode}
                    </div>
                  </div>
                  <div className="relative z-10 flex items-center gap-2">
                    <CopyInvite joinCode={r.joinCode} roomName={r.name} />
                    <Badge tone="indigo">{r.playerCount} players</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
          {publicRooms.length > 0 && (
            <>
              <h2 className="mb-3 mt-8 font-display font-semibold">Public tables</h2>
              <div className="space-y-2">
                {publicRooms.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200/70 dark:bg-slate-900 dark:ring-slate-700/70"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.name}</div>
                      <div className="text-xs text-slate-500">
                        Hosted by {r.hostName} · Blinds {r.sb}/{r.bb} · {r.playerCount} players
                      </div>
                    </div>
                    {r.meetLink && (
                      <a
                        href={r.meetLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        Join call
                      </a>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => void api.joinPublic(r.id).then(() => nav(`/room/${r.id}`))}
                    >
                      Join
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-5 lg:col-span-2 xl:col-span-1">
        <InvitesPanel onJoined={(roomId) => nav(`/room/${roomId}`)} />
        <FriendsPanel />
      </div>
      </div>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Create room">
        <form onSubmit={create} className="space-y-3">
          <Input placeholder="Room name" value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Small blind</span>
              <Input type="number" min={1} value={sb} onChange={(e) => setSb(+e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Big blind</span>
              <Input type="number" min={1} value={bb} onChange={(e) => setBb(+e.target.value)} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Turn timer</span>
            <select
              value={actionSecs}
              onChange={(e) => setActionSecs(+e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              {[15, 30, 45, 60, 90, 120].map((s) => (
                <option key={s} value={s}>
                  {s} seconds per decision
                </option>
              ))}
              <option value={0}>No limit</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Video call link (Meet or Zoom, optional)</span>
            <Input
              placeholder="https://meet.google.com/..."
              value={meetLink}
              onChange={(e) => setMeetLink(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Who can find this table</span>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="private">Private: join with the 6-letter code only</option>
              <option value="public">Public: listed in every lobby, anyone can join</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Hands required before winnings count in settle-up</span>
            <Input
              type="number"
              min={0}
              max={500}
              value={minSettleHands}
              onChange={(e) => setMinSettleHands(Math.max(0, +e.target.value))}
            />
            <span className="mt-1 block text-xs text-slate-400">
              0 means everyone counts right away. The banker can change this later.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={strictAudit}
              onChange={(e) => setStrictAudit(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Strict audit: everyone's cards become checkable after each hand (folded cards included)
            </span>
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" className="w-full">
            Create
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
