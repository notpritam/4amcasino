/** Tournament amounts are whole competition chips, never currency. */
export interface TournamentPolicy {
  format: 'fixed-hand-league' | 'knockout';
  startsAt: number | null;
  entryFee: number;
  joiningReward: number;
  guaranteedPool: number;
  houseBps: number;
  prizeBps: number;
  payoutBps: number[];
  blindEveryHands: number;
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
  payoutBps: [6000, 3000, 1000],
  blindEveryHands: 20,
  publicWatch: true,
  revealAllAfterHand: true,
  streamUrl: '',
  meetUrl: '',
};
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
