/** Tournament amounts are whole competition chips, never currency. */
export interface TournamentPolicy {
  /**
   * `freezeout` is the current competition format, requested by notpritam: the entry fee is the
   * stack, a zero stack is final, and play runs to one survivor. `knockout` is retained so
   * tournaments whose terms locked under the older rules keep the behaviour they published.
   */
  format: 'fixed-hand-league' | 'knockout' | 'freezeout';
  startsAt: number | null;
  entryFee: number;
  joiningReward: number;
  guaranteedPool: number;
  houseBps: number;
  prizeBps: number;
  payoutBps: number[];
  blindEveryHands: number;
  /** Total hands one entrant may sit out across the whole tournament. */
  sitOutBudget: number;
  /** Longest single sit-out an entrant may declare. */
  maxSitOutPerRequest: number;
  publicWatch: boolean;
  revealAllAfterHand: boolean;
  streamUrl: string;
  meetUrl: string;
}
export const DEFAULT_TOURNAMENT_POLICY: TournamentPolicy = {
  format: 'fixed-hand-league',
  startsAt: null,
  entryFee: 0,
  joiningReward: 0,
  guaranteedPool: 0,
  houseBps: 50,
  prizeBps: 50,
  payoutBps: [5000, 3000, 2000],
  blindEveryHands: 20,
  sitOutBudget: 10,
  maxSitOutPerRequest: 5,
  publicWatch: true,
  revealAllAfterHand: true,
  streamUrl: '',
  meetUrl: '',
};
/** Freezeout and knockout carry a stack between hands; a fixed-hand league resets it. */
export function carriesStacks(format: TournamentPolicy['format']): boolean {
  return format === 'knockout' || format === 'freezeout';
}
export function tournamentFormatLabel(format: TournamentPolicy['format']): string {
  if (format === 'freezeout') return 'Freezeout';
  return format === 'knockout' ? 'Knockout' : 'Fixed-hand league';
}
export interface TournamentFinance {
  unit: 'chips';
  pool: number;
  house: number;
  guaranteed: number;
  entryFees: number;
  joiningRewards: number;
  prizes: number;
  sponsorContributions: number;
}
export interface TournamentEarning {
  tournamentId: string;
  tournamentName: string;
  status: string;
  userId: number;
  playerName: string;
  entryFee: number;
  joiningReward: number;
  prize: number;
  playNet: number;
  settlementNet: number;
  recordedPaid: number;
  outstanding: number;
}
export interface SponsorPlacement {
  id: string;
  tournamentId: string | null;
  name: string;
  headline: string;
  description: string;
  destinationUrl: string;
  placement: 'directory' | 'tournament' | 'watch';
  startsAt: number;
  endsAt: number;
  active: boolean;
}
export interface SponsorCampaign extends SponsorPlacement {
  bookedAmount: number;
  receivedAmount: number;
  prizeContribution: number;
  note: string;
  revision: number;
}
