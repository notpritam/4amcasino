import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { Badge, Button, Dialog, Input, Panel } from '../../shared/ui/index.tsx';

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
  const [strictAudit, setStrictAudit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const username = useStore((s) => s.auth.username);
  const logout = useStore((s) => s.logout);
  const nav = useNavigate();

  useEffect(() => {
    api.myRooms().then((r) => setRooms(r.rooms)).catch(() => {});
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const room = await api.createRoom(name, sb, bb, strictAudit ? 'strict-audit' : undefined);
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

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">4AM Casino</h1>
          <p className="text-sm text-slate-500">Signed in as {username}</p>
        </div>
        <Button variant="ghost" onClick={logout}>
          Log out
        </Button>
      </header>

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <Panel>
          <h2 className="mb-1 font-display font-semibold">Start a table</h2>
          <p className="mb-4 text-sm text-slate-500">You become host and banker.</p>
          <Button onClick={() => setCreateOpen(true)}>Create room</Button>
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
      </div>
      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      <h2 className="mb-3 font-display font-semibold">Your rooms</h2>
      {rooms.length === 0 ? (
        <p className="text-sm text-slate-500">No rooms yet — create one and share the code.</p>
      ) : (
        <div className="space-y-2">
          {rooms.map((r) => (
            <Link
              key={r.id}
              to={`/room/${r.id}`}
              className="flex items-center justify-between rounded-xl bg-white p-4 ring-1 ring-slate-200/70 transition-shadow hover:shadow-md"
            >
              <div>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-slate-500">
                  Blinds {r.sb}/{r.bb} · Code {r.joinCode}
                </div>
              </div>
              <Badge tone="indigo">{r.playerCount} players</Badge>
            </Link>
          ))}
        </div>
      )}

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
          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={strictAudit}
              onChange={(e) => setStrictAudit(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Strict audit — everyone's cards become checkable after each hand (folded cards included)
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
