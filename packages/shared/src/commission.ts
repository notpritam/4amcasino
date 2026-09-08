/** One basis point = 0.01%. Rates are fixed when a room is created. */
export const NEW_ROOM_COMMISSION_BPS = 10;
export const LEGACY_ROOM_COMMISSION_BPS = 100;

/** Whole chips only: floor each pot before awarding it or splitting its boards. */
export function commissionForPot(amount: number, commissionBps: number): number {
  return Math.floor((amount * commissionBps) / 10_000);
}

/** Older servers omit the rate from room_state; those rooms charged 1%. */
export function commissionRateLabel(commissionBps = LEGACY_ROOM_COMMISSION_BPS): string {
  return `${commissionBps / 100}%`;
}
