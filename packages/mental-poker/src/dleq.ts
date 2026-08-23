import { RistrettoPoint } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { utf8ToBytes } from '@noble/hashes/utils';
import { GROUP_ORDER, invScalar, mulPoint, pointFromHex, pointHex, randScalar, type Point } from './group.js';
import { signBytes, verifyBytes } from './identity.js';
import { canonicalize } from './transcript.js';

/** Chaum-Pedersen proof that log_G(commit) == log_out(pIn), i.e. the share used the committed key. */
export interface DleqProof {
  A1: string; // r*G
  A2: string; // r*out
  z: string; // r + c*k mod L, hex
}

const G = RistrettoPoint.BASE;

function bytesToBigint(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

function challenge(commit: Point, out: Point, pIn: Point, A1: Point, A2: Point): bigint {
  const material = ['4amcasino/v1/dleq', pointHex(G), pointHex(commit), pointHex(out), pointHex(pIn), pointHex(A1), pointHex(A2)].join('|');
  return bytesToBigint(sha512(utf8ToBytes(material))) % GROUP_ORDER;
}

export function handKeyCommit(k: bigint): Point {
  return G.multiply(k);
}

/** out = k^-1 * pIn, with proof that pIn = k*out for the committed k. */
export function proveUnmask(k: bigint, pIn: Point): { out: Point; proof: DleqProof } {
  const out = mulPoint(pIn, invScalar(k));
  const r = randScalar();
  const A1 = G.multiply(r);
  const A2 = out.multiply(r);
  const c = challenge(handKeyCommit(k), out, pIn, A1, A2);
  const z = (r + c * k) % GROUP_ORDER;
  return { out, proof: { A1: pointHex(A1), A2: pointHex(A2), z: z.toString(16) } };
}

export function verifyUnmask(commit: Point, pIn: Point, out: Point, proof: DleqProof): boolean {
  try {
    const A1 = pointFromHex(proof.A1);
    const A2 = pointFromHex(proof.A2);
    const z = BigInt('0x' + proof.z) % GROUP_ORDER;
    if (z <= 0n) return false;
    const c = challenge(commit, out, pIn, A1, A2);
    // z*G == A1 + c*commit  and  z*out == A2 + c*pIn
    const left1 = G.multiply(z);
    const right1 = A1.add(commit.multiply(c));
    const left2 = out.multiply(z);
    const right2 = A2.add(pIn.multiply(c));
    return left1.equals(right1) && left2.equals(right2);
  } catch {
    return false;
  }
}

/** Order-independent message signature: binds handId + type + body (server assigns transcript order). */
export function signContent(secretKeyHex: string, handId: string, type: string, body: unknown): string {
  return signBytes(secretKeyHex, utf8ToBytes(canonicalize({ handId, type, body })));
}

export function verifyContent(
  publicKeyHex: string,
  handId: string,
  type: string,
  body: unknown,
  sigHex: string,
): boolean {
  return verifyBytes(publicKeyHex, utf8ToBytes(canonicalize({ handId, type, body })), sigHex);
}
