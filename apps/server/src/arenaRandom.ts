import { createHash, createHmac } from 'node:crypto';

export function seedCommitment(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}
/** Reproducible unbiased Fisher-Yates. The seed stays server-private until completion. */
export function arenaDeck(seed: string, handNumber: number): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  let counter = 0;
  const randomBelow = (max: number) => {
    const limit = Math.floor(0x100000000 / max) * max;
    let n: number;
    do {
      n = createHmac('sha256', seed)
        .update(`4am/arena/v1/${handNumber}/${counter++}`)
        .digest()
        .readUInt32BE(0);
    } while (n >= limit);
    return n % max;
  };
  for (let i = 51; i > 0; i--) {
    const j = randomBelow(i + 1);
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}
