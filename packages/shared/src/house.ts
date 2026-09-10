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

export type CommissionScope = 'new_rooms' | 'all_rooms';

export interface CommissionSettings {
  commissionBps: number;
  revision: number;
  updatedAt: number;
  updatedBy: number | null;
  history: {
    id: number;
    previousBps: number | null;
    commissionBps: number;
    scope: CommissionScope;
    affectedRooms: number;
    changedBy: number | null;
    changedByName: string;
    createdAt: number;
  }[];
}

export interface AdminOverview {
  users: number;
  rooms: number;
  activeRooms: number;
  hands: number;
  pendingRequests: number;
  commissionBps: number;
  dues: PlatformDuesReport['totals'];
  revenue: { date: string; commission: number }[];
}
