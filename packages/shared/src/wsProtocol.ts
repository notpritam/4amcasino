import { z } from 'zod';
import type { BettingState, PlayerAction, Street } from './betting.js';
import type { CardId } from './cards.js';

const hex = (len?: number) => (len ? z.string().length(len).regex(/^[0-9a-f]+$/) : z.string().regex(/^[0-9a-f]+$/));

export const dleqProofSchema = z.object({ A1: hex(64), A2: hex(64), z: z.string().regex(/^[0-9a-f]+$/) });

export const playerActionSchema = z.object({
  type: z.enum(['fold', 'check', 'call', 'bet', 'raise']),
  amount: z.number().int().positive().optional(),
});

/** Client -> server messages. Signed ones carry `sig` = signContent(secret, handId, t, body). */
export const clientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('join_room'), roomId: z.string() }),
  z.object({ t: z.literal('sit'), seat: z.number().int().min(0).max(8) }),
  z.object({ t: z.literal('leave_seat') }),
  z.object({ t: z.literal('start_hand') }),
  z.object({ t: z.literal('key_commit'), handId: z.string(), commit: hex(64), sig: hex(128) }),
  z.object({ t: z.literal('shuffle_deck'), handId: z.string(), deck: z.array(hex(64)).length(52), sig: hex(128) }),
  z.object({
    t: z.literal('unmask_share'),
    handId: z.string(),
    deckIndex: z.number().int().min(0).max(51),
    out: hex(64),
    proof: dleqProofSchema,
    sig: hex(128),
  }),
  z.object({ t: z.literal('action'), handId: z.string(), action: playerActionSchema, sig: hex(128) }),
  z.object({ t: z.literal('reveal_key'), handId: z.string(), key: z.string().regex(/^[0-9a-f]+$/), sig: hex(128) }),
  z.object({
    t: z.literal('show_cards'),
    handId: z.string(),
    shares: z
      .array(z.object({ deckIndex: z.number().int().min(0).max(51), out: hex(64), proof: dleqProofSchema }))
      .min(1)
      .max(2),
    sig: hex(128),
  }),
  z.object({ t: z.literal('sit_out'), sittingOut: z.boolean() }),
  z.object({
    t: z.literal('peek_offer'),
    handId: z.string(),
    targetSeat: z.number().int().min(0).max(8),
    amount: z.number().int().positive(),
  }),
  z.object({
    t: z.literal('peek_accept'),
    handId: z.string(),
    offerId: z.string(),
    shares: z
      .array(z.object({ deckIndex: z.number().int().min(0).max(51), out: hex(64), proof: dleqProofSchema }))
      .min(1)
      .max(2),
    sig: hex(128),
  }),
  z.object({ t: z.literal('peek_decline'), handId: z.string(), offerId: z.string() }),
  z.object({
    t: z.literal('chat'),
    text: z.string().min(1).max(500),
    kind: z.enum(['text', 'sticker', 'phrase']).optional(),
  }),
  z.object({ t: z.literal('rtc'), to: z.number().int(), data: z.unknown() }),
  z.object({ t: z.literal('voice_state'), muted: z.boolean() }),
]);
export type ClientMsg = z.infer<typeof clientMsgSchema>;

/** The body that gets content-signed for each signed client message type. */
export function signedBody(msg: ClientMsg): unknown {
  switch (msg.t) {
    case 'key_commit':
      return { commit: msg.commit };
    case 'shuffle_deck':
      return { deck: msg.deck };
    case 'unmask_share':
      return { deckIndex: msg.deckIndex, out: msg.out, proof: msg.proof };
    case 'action':
      return { action: msg.action };
    case 'reveal_key':
      return { key: msg.key };
    case 'show_cards':
      return { shares: msg.shares };
    case 'peek_accept':
      return { offerId: msg.offerId, shares: msg.shares };
    default:
      return null;
  }
}

// ---- server -> client ----

export interface HandSeat {
  seat: number;
  userId: number;
  username: string;
  publicKey: string;
  stack: number;
}

export interface RoomStatePlayer {
  userId: number;
  username: string;
  displayName: string;
  avatarVersion: number;
  publicKey: string;
  seat: number | null;
  stack: number;
  sittingOut: boolean;
  connected: boolean;
  /** Net chips bought from the bank in this room (purchases minus reverts). 0 when privateStats. */
  totalBought: number;
  /** The player asked for their winnings to stay hidden. */
  privateStats: boolean;
  /** Chips requested from the bank, still waiting for banker approval. */
  pendingBuy: number;
  /** JSON blob describing the player's 3D character (color, head, hat). */
  avatar3d: string | null;
}

export type ServerMsg =
  | { t: 'hello'; serverPublicKey: string }
  | {
      t: 'room_state';
      room: { id: string; name: string; joinCode: string; hostId: number; bankerId: number; sb: number; bb: number; auditMode: string; actionTimeoutMs: number; actionSecs: number | null; coBankerId: number | null; minSettleHands: number; sevenDeuceBonus: number; voided: boolean; meetLink: string | null; autoApproveBuys: boolean };
      players: RoomStatePlayer[];
      handActive: boolean;
    }
  | { t: 'error'; message: string }
  | { t: 'chat'; from: string; userId: number; text: string; kind: 'text' | 'sticker' | 'phrase'; ts: number }
  | { t: 'rtc'; from: number; data: unknown }
  | { t: 'voice_state'; userId: number; muted: boolean }
  | { t: 'auto_deal'; inMs: number }
  | { t: 'seven_deuce'; handId: string; seat: number; amount: number }
  | { t: 'hand_start'; handId: string; seats: HandSeat[]; buttonSeat: number; sb: number; bb: number; auditMode: string }
  | { t: 'key_commit_applied'; handId: string; seat: number; commit: string }
  | { t: 'shuffle_turn'; handId: string; seat: number; deck: string[] }
  | { t: 'deck_state'; handId: string; seat: number; deck: string[] }
  | {
      t: 'need_share';
      handId: string;
      deckIndex: number;
      point: string;
      forSeat: number | null;
      purpose: 'hole' | 'board' | 'showdown';
    }
  | { t: 'share_applied'; handId: string; deckIndex: number; seat: number; out: string; forSeat: number | null }
  | { t: 'your_card'; handId: string; deckIndex: number; point: string }
  | { t: 'board_open'; handId: string; deckIndex: number; card: CardId }
  | { t: 'betting_state'; handId: string; actionSeq: number; state: BettingState; board: CardId[]; deadline: number | null }
  | { t: 'action_applied'; handId: string; seat: number; action: PlayerAction; auto?: boolean }
  | {
      t: 'showdown';
      handId: string;
      reveals: { seat: number; cards: CardId[]; score: number }[];
      awards: { seat: number; amount: number }[];
    }
  | { t: 'hand_end'; handId: string; head: string; stacks: { seat: number; stack: number }[]; deltas: { seat: number; delta: number }[] }
  | { t: 'cards_shown'; handId: string; seat: number; cards: CardId[] }
  | { t: 'peek_offer'; offerId: string; handId: string; fromUserId: number; fromName: string; targetSeat: number; amount: number }
  | {
      t: 'peek_result';
      offerId: string;
      handId: string;
      targetSeat: number;
      status: 'accepted' | 'declined';
      amount: number;
      cards?: CardId[];
    }
  | { t: 'hand_abort'; handId: string; reason: string; blamedSeat: number | null }
  | { t: 'need_keys'; handId: string }
  | { t: 'transcript_entry'; handId: string; seq: number; type: string; from: string; head: string };

export type { BettingState, PlayerAction, Street };
