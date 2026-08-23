#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { HeadlessClient } from './client.js';

/**
 * MCP server for 4AM Casino: gives an AI agent a real seat at the table.
 * All mental-poker duties (shuffles, key commits, DLEQ unmask proofs) run
 * automatically inside the headless client - the agent only makes poker
 * decisions, exactly like a human player.
 *
 * Configuration (environment):
 *   FOURAM_URL       server, default https://fouramcasino.onrender.com
 *   FOURAM_USERNAME  account name (registered automatically if missing)
 *   FOURAM_PASSWORD  account password (derives the signing keys locally;
 *                    it is never sent to the game server)
 */

const baseUrl = (process.env.FOURAM_URL ?? 'https://fouramcasino.onrender.com').replace(/\/$/, '');
const username = process.env.FOURAM_USERNAME;
const password = process.env.FOURAM_PASSWORD;
if (!username || !password) {
  console.error('Set FOURAM_USERNAME and FOURAM_PASSWORD in the MCP server env.');
  process.exit(1);
}

const client = new HeadlessClient(baseUrl, username, password);
let loggedIn = false;
async function ready(): Promise<HeadlessClient> {
  if (!loggedIn) {
    await client.login();
    loggedIn = true;
  }
  return client;
}

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const run = async (fn: () => Promise<string> | string) => {
  try {
    return text(await fn());
  } catch (err) {
    return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
};

const server = new McpServer({ name: '4am-casino', version: '1.0.0' });

server.tool(
  'casino_state',
  'The full current view of the table: room, players, stacks, your cards, the board, whose turn it is, your legal actions, and recent events. Call this before every decision.',
  {},
  async () => run(async () => (await ready()).stateSummary()),
);

server.tool(
  'my_rooms',
  'List the rooms this account belongs to.',
  {},
  async () =>
    run(async () => {
      const c = await ready();
      const r = (await c.api('/api/my-rooms')) as { rooms: { id: string; name: string; joinCode: string; sb: number; bb: number; playerCount: number }[] };
      if (r.rooms.length === 0) return 'No rooms yet. Ask the host for a 6-letter join code and use join_room.';
      return r.rooms.map((x) => `${x.name} - code ${x.joinCode}, blinds ${x.sb}/${x.bb}, ${x.playerCount} players`).join('\n');
    }),
);

server.tool(
  'join_room',
  'Join a table by its 6-letter code and connect to the live game.',
  { joinCode: z.string().length(6) },
  async ({ joinCode }) =>
    run(async () => {
      const c = await ready();
      await c.joinByCode(joinCode.toUpperCase());
      await new Promise((r) => setTimeout(r, 600));
      return c.stateSummary();
    }),
);

server.tool(
  'take_seat',
  'Sit down at the table (seats 1-9). You need chips before you can be dealt in: use buy_points.',
  { seat: z.number().int().min(1).max(9) },
  async ({ seat }) =>
    run(async () => {
      const c = await ready();
      c.send({ t: 'sit', seat: seat - 1 });
      await new Promise((r) => setTimeout(r, 400));
      return c.stateSummary();
    }),
);

server.tool('leave_seat', 'Stand up from the table (between hands).', {}, async () =>
  run(async () => {
    const c = await ready();
    c.send({ t: 'leave_seat' });
    return 'stood up';
  }),
);

server.tool(
  'sit_out',
  'Skip the next hands without giving up the seat (true), or come back in (false).',
  { sittingOut: z.boolean() },
  async ({ sittingOut }) =>
    run(async () => {
      const c = await ready();
      c.send({ t: 'sit_out', sittingOut });
      return sittingOut ? 'sitting out from the next deal' : 'back in from the next deal';
    }),
);

server.tool(
  'act',
  'Make a betting decision when it is your turn. amount is the raise-to / bet total, only for bet and raise.',
  {
    action: z.enum(['fold', 'check', 'call', 'bet', 'raise']),
    amount: z.number().int().positive().optional(),
  },
  async ({ action, amount }) =>
    run(async () => {
      const c = await ready();
      return c.act(amount !== undefined ? { type: action, amount } : { type: action });
    }),
);

server.tool(
  'wait_for_turn',
  'Block until it is your turn, the hand ends, or the timeout passes, then return the fresh state. Use this instead of polling.',
  { timeoutSeconds: z.number().int().min(1).max(120).default(45) },
  async ({ timeoutSeconds }) =>
    run(async () => {
      const c = await ready();
      await c.waitForTurn(timeoutSeconds * 1000);
      return c.stateSummary();
    }),
);

server.tool('start_hand', 'Deal the next hand (host only; hands also auto-deal while the host is online).', {}, async () =>
  run(async () => {
    const c = await ready();
    c.send({ t: 'start_hand' });
    await new Promise((r) => setTimeout(r, 500));
    return 'deal requested';
  }),
);

server.tool(
  'send_chat',
  'Say something in the table chat.',
  { textMessage: z.string().min(1).max(500) },
  async ({ textMessage }) =>
    run(async () => {
      const c = await ready();
      c.send({ t: 'chat', text: textMessage, kind: 'text' });
      return 'sent';
    }),
);

server.tool(
  'show_cards',
  'Voluntarily reveal your hole cards to the whole table (after folding, or once the hand ends). Also how a fold-winner claims the 7-2 bounty.',
  {},
  async () =>
    run(async () => {
      (await ready()).showCards();
      return 'reveal sent (cryptographically proven)';
    }),
);

server.tool(
  'answer_peek',
  'Accept or decline a pending paid-peek offer on your cards (see casino_state for offerIds). Accepting collects the chips and shows your cards only to the buyer.',
  { offerId: z.string(), accept: z.boolean() },
  async ({ offerId, accept }) =>
    run(async () => {
      (await ready()).answerPeek(offerId, accept);
      return accept ? 'accepted - chips incoming' : 'declined';
    }),
);

server.tool(
  'buy_points',
  'Request play-money chips from the banker. They land on your stack once approved.',
  { amount: z.number().int().positive(), note: z.string().max(200).optional() },
  async ({ amount, note }) =>
    run(async () => {
      const c = await ready();
      const roomId = c.room?.room.id;
      if (!roomId) return 'Join a room first.';
      await c.api(`/api/rooms/${roomId}/buy`, { amount, note });
      return `requested ${amount} chips; waiting for the banker`;
    }),
);

server.tool('bank_requests', 'List purchases waiting for banker approval (bankers only).', {}, async () =>
  run(async () => {
    const c = await ready();
    const roomId = c.room?.room.id;
    if (!roomId) return 'Join a room first.';
    const r = (await c.api(`/api/rooms/${roomId}/requests`)) as { requests: { id: number; username: string; amount: number; note: string | null }[] };
    if (r.requests.length === 0) return 'Nothing waiting.';
    return r.requests.map((q) => `#${q.id}: ${q.username} wants ${q.amount}${q.note ? ` (${q.note})` : ''}`).join('\n');
  }),
);

server.tool(
  'approve_purchase',
  'Approve or reject a pending purchase by id (bankers only).',
  { requestId: z.number().int(), approve: z.boolean() },
  async ({ requestId, approve }) =>
    run(async () => {
      const c = await ready();
      const roomId = c.room?.room.id;
      if (!roomId) return 'Join a room first.';
      await c.api(`/api/rooms/${roomId}/approve`, { requestId, approve });
      return approve ? 'approved' : 'rejected';
    }),
);

server.tool('session_report', 'The session so far: time played, hands, biggest pot, per-player results.', {}, async () =>
  run(async () => {
    const c = await ready();
    const roomId = c.room?.room.id;
    if (!roomId) return 'Join a room first.';
    const s = (await c.api(`/api/rooms/${roomId}/session`)) as {
      hands: number;
      firstTs: number | null;
      lastTs: number | null;
      biggestPot: number;
      players: { displayName: string; handsPlayed: number; wins: number; net: number; stack: number; bought: number; hidden: boolean }[];
    };
    const mins = s.firstTs && s.lastTs ? Math.max(1, Math.round((s.lastTs - s.firstTs) / 60000)) : 0;
    const lines = [`${s.hands} hands over ~${mins} minutes; biggest pot ${s.biggestPot}.`];
    for (const p of s.players) {
      lines.push(
        p.hidden
          ? `  ${p.displayName}: private (stack ${p.stack})`
          : `  ${p.displayName}: net ${p.net >= 0 ? '+' : ''}${p.net}, ${p.wins}/${p.handsPlayed} hands won, bought ${p.bought}, stack ${p.stack}`,
      );
    }
    return lines.join('\n');
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`4AM Casino MCP ready as ${username} against ${baseUrl}`);
