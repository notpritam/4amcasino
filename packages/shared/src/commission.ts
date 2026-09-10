/** One basis point = 0.01%. Initial default; the platform can change it at runtime. */
export const NEW_ROOM_COMMISSION_BPS = 50;
export const LEGACY_ROOM_COMMISSION_BPS = 100;

/** Whole chips only: floor each pot before awarding it or splitting its boards. */
export function commissionForPot(amount: number, commissionBps: number): number {
  return Math.floor((amount * commissionBps) / 10_000);
}

/** Older servers omit the rate from room_state; those rooms charged 1%. */
export function commissionRateLabel(commissionBps = LEGACY_ROOM_COMMISSION_BPS): string {
  return `${commissionBps / 100}%`;
}
