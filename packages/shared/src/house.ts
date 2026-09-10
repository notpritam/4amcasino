export interface HouseBalance {
  accrued: number;
  /** Payments recorded by users; these are not bank-confirmed receipts. */
  paid: number;
  outstanding: number;
  credit: number;
}

export interface HouseRoom {
  roomId: string;
  roomName: string;
  commissionBps: number;
  accrued: number;
}

export interface HouseDues extends HouseBalance {
  rooms: HouseRoom[];
}

export interface PlatformDuesUser extends HouseDues {
  userId: number;
  username: string;
  displayName: string;
  avatarVersion: number;
}

export interface PlatformDuesReport {
  people: PlatformDuesUser[];
  totals: HouseBalance & { usersOwing: number; unallocated: number };
}
