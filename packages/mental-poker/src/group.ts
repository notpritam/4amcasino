import { RistrettoPoint } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes, randomBytes } from '@noble/hashes/utils';
import { type CardId, cardName } from '@4am/shared';

export type Point = InstanceType<typeof RistrettoPoint>;
export const GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;

function bytesToBigint(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

export function randScalar(): bigint {
  // 64 uniform bytes mod L => negligible bias
  const k = bytesToBigint(randomBytes(64)) % GROUP_ORDER;
  return k === 0n ? randScalar() : k;
}

export function invScalar(k: bigint): bigint {
  // Fermat: k^(L-2) mod L
  let base = ((k % GROUP_ORDER) + GROUP_ORDER) % GROUP_ORDER;
  let e = GROUP_ORDER - 2n;
  let r = 1n;
  while (e > 0n) {
    if (e & 1n) r = (r * base) % GROUP_ORDER;
    base = (base * base) % GROUP_ORDER;
    e >>= 1n;
  }
  return r;
}

export function mulPoint(P: Point, k: bigint): Point {
  return P.multiply(k);
}

export function cardPoint(id: CardId): Point {
  const seed = sha512(utf8ToBytes(`4amcasino/v1/card/${cardName(id)}`));
  return RistrettoPoint.hashToCurve(seed);
}

export function pointHex(P: Point): string {
  return bytesToHex(P.toRawBytes());
}
export function pointFromHex(hex: string): Point {
  return RistrettoPoint.fromHex(hexToBytes(hex));
}
