import { verifyContent } from './dleq.js';
import { computeHead, type TranscriptEntry } from './transcript.js';

/**
 * The projection of a stored entry payload that its sender actually content-signed.
 * Most entries sign their payload verbatim; a few carry extra server-added fields.
 */
export function signedBodyOf(type: string, payload: unknown): unknown {
  const p = payload as Record<string, unknown>;
  switch (type) {
    case 'action':
      return { action: p.action };
    case 'reveal_key':
      return { key: p.key };
    default:
      return payload;
  }
}

/**
 * Full client-side audit of a stored hand transcript:
 * (1) the hash chain replays to `expectedHead`, and
 * (2) every entry's signature verifies against its `from` key for this handId.
 * Player keys come from the hand_start payload; the server key is entry 0's `from`.
 */
export function verifyHandTranscript(
  handId: string,
  entries: TranscriptEntry[],
  expectedHead: string,
): { ok: boolean; badSeq?: number; reason?: string } {
  if (entries.length === 0) return { ok: false, reason: 'empty transcript' };
  if (computeHead(entries) !== expectedHead) return { ok: false, reason: 'hash chain mismatch' };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.seq !== i) return { ok: false, badSeq: i, reason: 'sequence gap' };
    if (!verifyContent(e.from, handId, e.type, signedBodyOf(e.type, e.payload), e.sig)) {
      return { ok: false, badSeq: i, reason: `bad signature on ${e.type}` };
    }
  }
  return { ok: true };
}
