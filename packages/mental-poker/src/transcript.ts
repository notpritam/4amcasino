import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { verifyBytes } from './identity.js';

export interface TranscriptEntry {
  seq: number;
  type: string;
  from: string;
  payload: unknown;
  sig: string;
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value as object).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

const GENESIS = bytesToHex(sha256(utf8ToBytes('4amcasino/v1/transcript')));

export function signableBytes(
  seq: number,
  prevHead: string,
  type: string,
  from: string,
  payload: unknown,
): Uint8Array {
  return utf8ToBytes(canonicalize({ seq, prevHead, type, from, payload }));
}

function entryHead(prevHead: string, e: TranscriptEntry): string {
  return bytesToHex(sha256(utf8ToBytes(prevHead + canonicalize(e))));
}

export class Transcript {
  readonly entries: TranscriptEntry[] = [];
  #head = GENESIS;
  get head(): string {
    return this.#head;
  }
  append(e: Omit<TranscriptEntry, 'seq'>): TranscriptEntry {
    const entry: TranscriptEntry = { seq: this.entries.length, ...e };
    this.#head = entryHead(this.#head, entry);
    this.entries.push(entry);
    return entry;
  }
}

export function verifyTranscript(
  entries: TranscriptEntry[],
  pubkeys: Map<string, string>,
): { ok: boolean; head: string; badSeq?: number } {
  let head = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const pub = pubkeys.get(e.from);
    if (
      e.seq !== i ||
      !pub ||
      !verifyBytes(pub, signableBytes(e.seq, head, e.type, e.from, e.payload), e.sig)
    ) {
      return { ok: false, head, badSeq: i };
    }
    head = entryHead(head, e);
  }
  return { ok: true, head };
}
