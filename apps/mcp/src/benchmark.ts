#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  actArena,
  arenaView,
  createArenaRound,
  type ArenaView,
  type PlayerAction,
} from '@4am/shared';
import { arenaDeck, seedCommitment } from '../../server/src/arenaRandom.js';
export interface BenchmarkAgent {
  name: string;
  decide: (state: ArenaView) => PlayerAction | Promise<PlayerAction>;
}
export const baselineAgents: BenchmarkAgent[] = [
  { name: 'Check / call', decide: (s) => ({ type: s.legalActions!.canCheck ? 'check' : 'call' }) },
  { name: 'Check / fold', decide: (s) => ({ type: s.legalActions!.canCheck ? 'check' : 'fold' }) },
  {
    name: 'Pressure baseline',
    decide: (s) => {
      const l = s.legalActions!;
      const strong =
        Math.floor(s.myCards[0]! / 4) >= 9 ||
        Math.floor(s.myCards[0]! / 4) === Math.floor(s.myCards[1]! / 4);
      return strong && l.canRaise
        ? {
            type: s.betting.currentBet ? 'raise' : 'bet',
            amount: Math.min(l.maxRaiseTo, Math.max(l.minRaiseTo, 60)),
          }
        : { type: l.canCheck ? 'check' : l.callAmount <= 60 ? 'call' : 'fold' };
    },
  },
];
export async function runBenchmark(agents: BenchmarkAgent[], hands: number, seed: string) {
  if (
    agents.length < 2 ||
    agents.length > 9 ||
    !Number.isInteger(hands) ||
    hands < 1 ||
    hands > 10000
  )
    throw new Error('Use 2–9 agents and 1–10,000 hands.');
  const standings = agents.map((agent, i) => ({
    name: agent.name,
    userId: i + 1,
    net: 0,
    hands: 0,
    wins: 0,
  }));
  const history: { handNumber: number; net: number[] }[] = [];
  const digest = createHash('sha256');
  for (let handNumber = 1; handNumber <= hands; handNumber++) {
    let round = createArenaRound(
      { playerIds: standings.map((p) => p.userId), stack: 2000, sb: 10, bb: 20, handNumber },
      arenaDeck(seed, handNumber),
    );
    for (let steps = 0; !round.result; steps++) {
      if (steps > 10000) throw new Error('Per-hand action limit reached.');
      const userId = round.playerIds[round.betting.toAct!]!;
      const decision = await agents[userId - 1]!.decide(structuredClone(arenaView(round, userId)));
      digest.update(JSON.stringify({ handNumber, actionSeq: round.actionSeq, userId, decision }));
      round = actArena(round, userId, decision);
    }
    if (round.result!.net.reduce((sum, p) => sum + p.net, 0) !== 0)
      throw new Error('Chip conservation failed.');
    const net = standings.map((p) => round.result!.net.find((r) => r.userId === p.userId)!.net);
    history.push({ handNumber, net });
    standings.forEach((p, i) => {
      p.net += net[i]!;
      p.hands++;
      if (net[i]! > 0) p.wins++;
    });
    digest.update(JSON.stringify(round.result));
  }
  return {
    format: 'local-server-dealt-benchmark',
    version: 1,
    seed,
    seedCommitment: seedCommitment(seed),
    hands,
    stackPerHand: 2000,
    smallBlind: 10,
    bigBlind: 20,
    transcriptHash: digest.digest('hex'),
    standings: standings
      .map((p) => ({ ...p, bbPer100: (p.net / 20 / hands) * 100 }))
      .sort((a, b) => b.net - a.net),
    history,
  };
}
async function main() {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!process.argv[i]?.startsWith('--') || !process.argv[i + 1])
      throw new Error('Use --hands N --seed VALUE --out FILE [--agents file1,file2].');
    args.set(process.argv[i]!, process.argv[i + 1]!);
  }
  const agents = args.has('--agents')
    ? await Promise.all(
        args
          .get('--agents')!
          .split(',')
          .map(async (file) => {
            const m = await import(pathToFileURL(resolve(file)).href);
            if (typeof m.decide !== 'function' || typeof m.name !== 'string')
              throw new Error('Local modules must export name and decide(state).');
            return { name: m.name, decide: m.decide } as BenchmarkAgent;
          }),
      )
    : baselineAgents;
  const start = Date.now();
  const result = await runBenchmark(
    agents,
    Number(args.get('--hands') ?? 1000),
    args.get('--seed') ?? '4am-arena-baseline-v1',
  );
  const output = resolve(args.get('--out') ?? 'arena-results.json');
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        output,
        hands: result.hands,
        seconds: (Date.now() - start) / 1000,
        transcriptHash: result.transcriptHash,
        standings: result.standings,
        totalNet: result.standings.reduce((sum, p) => sum + p.net, 0),
      },
      null,
      2,
    ),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((err) => {
    console.error(err instanceof Error ? err.message : 'Benchmark failed.');
    process.exitCode = 1;
  });
