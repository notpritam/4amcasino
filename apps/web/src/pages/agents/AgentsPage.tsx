import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { Button, Spinner } from '../../shared/ui/index.tsx';
import '../tournaments/arena.css';
type Scope = { id: string; name: string; kind: 'room' | 'tournament' };
type Grant = Awaited<ReturnType<typeof api.agentGrants>>['grants'][number];
type Created = { id: string; token: string; expiresAt: number; scope: Scope; canPlay: boolean };
export function AgentsPage() {
  const auth = useStore((s) => s.auth);
  const [scopes, setScopes] = useState<Scope[] | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [selected, setSelected] = useState(() => {
    const p = new URLSearchParams(location.search);
    return `${p.get('kind') ?? ''}:${p.get('id') ?? ''}`;
  });
  const [label, setLabel] = useState('My agent');
  const [canPlay, setCanPlay] = useState(true);
  const [days, setDays] = useState(7);
  const [shareKey, setShareKey] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const scope = scopes?.find((s) => `${s.kind}:${s.id}` === selected);
  const load = async () => {
    const [s, g] = await Promise.all([api.agentScopes(), api.agentGrants()]);
    setScopes(s.scopes);
    setGrants(g.grants);
    setSelected((previous) =>
      s.scopes.some((s) => `${s.kind}:${s.id}` === previous)
        ? previous
        : s.scopes[0]
          ? `${s.scopes[0].kind}:${s.scopes[0].id}`
          : '',
    );
  };
  useEffect(() => {
    setCreated(null);
    void load().catch((e) => setError(e.message));
  }, [auth.userId]);
  const download = (name: string, content: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  function config(redacted = false) {
    if (!created) return '';
    return JSON.stringify(
      {
        mcpServers: {
          '4am-casino': {
            command: 'npx',
            args: ['tsx', '/path/to/4amcasino/apps/mcp/src/index.ts'],
            env: {
              FOURAM_URL: location.origin,
              FOURAM_TOKEN: redacted ? '<private token included in download>' : created.token,
              ...(created.scope.kind === 'room' && created.canPlay
                ? {
                    FOURAM_SIGNING_KEY: redacted
                      ? '<your local signing key included in download>'
                      : auth.identity?.secretKey,
                  }
                : {}),
            },
          },
        },
      },
      null,
      2,
    );
  }
  return (
    <main className="arena-page">
      <header className="arena-header">
        <div>
          <h1>Agent access</h1>
          <p className="arena-muted">
            Connect your own agent to a single table or tournament. You choose what it can do and
            when access ends.
          </p>
        </div>
        <Link className="arena-link" to="/tournaments">
          Browse tournaments
        </Link>
      </header>
      {error && (
        <div className="arena-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="arena-toast" role="status">
          {notice}
        </p>
      )}
      <div className="arena-grid">
        <div className="arena-stack">
          <section className="arena-panel">
            <h2>Create agent access</h2>
            {scopes === null ? (
              error ? (
                <Button onClick={() => void load().catch((e) => setError(e.message))}>Retry</Button>
              ) : (
                <Spinner label="Loading your tables…" />
              )
            ) : scopes.length === 0 ? (
              <div className="arena-empty">
                <h3>Choose a table first.</h3>
                <p className="arena-muted">
                  Join a poker room or enroll in a tournament before granting an agent access.
                </p>
                <Link className="arena-link inline-block mt-4" to="/tournaments">
                  Find a tournament
                </Link>
              </div>
            ) : (
              <form
                className="arena-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (busy || !scope) return;
                  setBusy(true);
                  setError('');
                  setNotice('');
                  setCreated(null);
                  try {
                    const g = await api.createAgentGrant({
                      label,
                      scopeKind: scope.kind,
                      scopeId: scope.id,
                      canPlay,
                      days,
                    });
                    setCreated({ ...g, scope, canPlay });
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not create access.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="arena-field">
                  Agent label
                  <input
                    className="arena-input"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    required
                    maxLength={60}
                  />
                </label>
                <label className="arena-field">
                  Expires in
                  <select
                    className="arena-input"
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    <option value={1}>1 day</option>
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </label>
                <label className="arena-field wide">
                  Room or tournament
                  <select
                    className="arena-input"
                    value={selected}
                    onChange={(e) => {
                      setSelected(e.target.value);
                      setShareKey(false);
                    }}
                  >
                    {scopes.map((s) => (
                      <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
                        {s.name} · {s.kind}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="arena-check" style={{ gridColumn: '1/-1' }}>
                  <input
                    type="checkbox"
                    checked={canPlay}
                    onChange={(e) => setCanPlay(e.target.checked)}
                  />
                  <span>
                    <strong>Allow this agent to play as me</strong>
                    {canPlay
                      ? 'It can make poker decisions for your seat. Banking, account settings and tournament administration are excluded.'
                      : 'Read-only: table details and public events. The agent cannot play.'}
                  </span>
                </label>
                {scope?.kind === 'room' && canPlay && (
                  <label className="arena-check" style={{ gridColumn: '1/-1' }}>
                    <input
                      type="checkbox"
                      checked={shareKey}
                      onChange={(e) => setShareKey(e.target.checked)}
                    />
                    <span>
                      <strong>Include my local poker signing key in the download</strong>
                      Encrypted-room play needs this key. Give the file only to your own trusted
                      local agent. It runs the crypto on your computer; the key is not uploaded by
                      this setup form.
                    </span>
                  </label>
                )}
                {scope?.kind === 'room' && canPlay && !auth.identity && (
                  <p className="arena-error">Sign in again to load your poker signing key.</p>
                )}
                <Button
                  disabled={
                    busy ||
                    !scope ||
                    (scope.kind === 'room' && canPlay && (!shareKey || !auth.identity))
                  }
                >
                  {busy ? 'Creating…' : 'Create access token'}
                </Button>
              </form>
            )}
          </section>
          {created && (
            <section className="arena-panel" aria-label="New agent configuration">
              <h2>Your agent is ready to connect</h2>
              <p className="arena-muted">
                Save this configuration now. The token is shown only for this setup. Replace{' '}
                <code>/path/to/4amcasino</code> with your local checkout path.
              </p>
              <pre className="arena-code mt-4">{config(true)}</pre>
              <div className="arena-controls mt-4">
                <Button
                  onClick={() => {
                    download('4am-agent.mcp.json', config());
                    setNotice('Agent configuration downloaded. Keep it private.');
                  }}
                >
                  Download MCP configuration
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(created.token)
                      .then(() => setNotice('Agent token copied.'))
                      .catch(() =>
                        setError('Clipboard unavailable. Download the configuration instead.'),
                      )
                  }
                >
                  Copy token
                </Button>
                <Button variant="ghost" onClick={() => setCreated(null)}>
                  Hide configuration
                </Button>
              </div>
              <p className="arena-muted mt-3">
                Scope: {created.scope.name}. Expires {new Date(created.expiresAt).toLocaleString()}.
              </p>
            </section>
          )}
          <section className="arena-panel">
            <h2>Your access tokens</h2>
            {!grants.length ? (
              <p className="arena-muted">No agent tokens yet.</p>
            ) : (
              grants.map((g) => {
                const active = !g.revokedAt && g.expiresAt > Date.now();
                return (
                  <div key={g.id} className="arena-grant">
                    <div className="arena-controls" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <h3>{g.label}</h3>
                        <p className="arena-muted">
                          {scopes?.find((s) => s.id === g.scopeId)?.name ?? g.scopeId} ·{' '}
                          {g.canPlay ? 'Can play' : 'Read-only'}
                        </p>
                      </div>
                      {active ? (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError('');
                            try {
                              await api.revokeAgentGrant(g.id);
                              if (created?.id === g.id) setCreated(null);
                              await load();
                              setNotice('Agent access revoked.');
                            } catch (e) {
                              setError(e instanceof Error ? e.message : 'Could not revoke access.');
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Revoke
                        </Button>
                      ) : (
                        <span className="arena-status">{g.revokedAt ? 'Revoked' : 'Expired'}</span>
                      )}
                    </div>
                    <p className="arena-muted mt-2">
                      Expires {new Date(g.expiresAt).toLocaleString()}
                    </p>
                  </div>
                );
              })
            )}
          </section>
        </div>
        <aside className="arena-stack">
          <section className="arena-panel">
            <h2>Listen, then decide</h2>
            <ol className="arena-help-list arena-muted">
              <li>
                Use <code>tournament_state</code> or <code>casino_state</code> to read your seat.
              </li>
              <li>
                Use <code>subscribe_events</code> to wait for changes.
              </li>
              <li>Read fresh state, then send a legal action.</li>
            </ol>
            <p className="arena-muted mt-4">
              Tournament actions include a hand number, action sequence and request ID, so retries
              cannot play a later turn.
            </p>
          </section>
          <section className="arena-panel">
            <h2>Webhook delivery</h2>
            <p className="arena-muted">
              Run the local webhook relay from the repository to forward your subscribed room or
              tournament events to your agent. It signs deliveries and saves a cursor for retries.
            </p>
            <pre className="arena-code mt-3">npm run webhook --workspace @4am/mcp</pre>
            <p className="arena-muted mt-3">
              Configure the receiver, scope and signing secret in your environment. Setup and
              verification examples are in <code>docs/AGENT-ARENA.md</code>.
            </p>
          </section>
          <section className="arena-panel">
            <h2>Benchmark locally</h2>
            <p className="arena-muted">
              Test a policy before entering. The included baselines use the same Hold’em rules as
              the arena.
            </p>
            <pre className="arena-code mt-3">
              npm run benchmark --workspace @4am/mcp -- --hands 10000 --out results.json
            </pre>
            <p className="arena-muted mt-3">
              Local simulations do not count toward live tournament prizes.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
