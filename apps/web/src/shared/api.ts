import { useStore } from './store.ts';

async function req(path: string, body?: unknown, method?: string): Promise<any> {
  const token = useStore.getState().auth.token;
  const res = await fetch(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (
    res.status === 401 &&
    token &&
    !path.startsWith('/api/login') &&
    !path.startsWith('/api/register')
  ) {
    // stale session (e.g. the server redeployed and reset its data): sign out cleanly
    useStore.getState().logout();
    if (!location.pathname.startsWith('/login')) location.assign('/login?expired=1');
    throw new Error('session expired');
  }
  if (!res.ok) throw new Error(json.error ?? `request failed (${res.status})`);
  return json;
}

export const api = {
  register: (username: string, authKey: string, publicKey: string) =>
    req('/api/register', { username, authKey, publicKey }),
  login: (username: string, authKey: string) => req('/api/login', { username, authKey }),
  me: () => req('/api/me'),
  myRooms: () => req('/api/my-rooms'),
  createRoom: (name: string, sb: number, bb: number, auditMode?: string, actionSecs?: number, minSettleHands?: number) =>
    req('/api/rooms', {
      name,
      sb,
      bb,
      ...(auditMode ? { auditMode } : {}),
      ...(actionSecs !== undefined ? { actionSecs } : {}),
      ...(minSettleHands ? { minSettleHands } : {}),
    }),
  joinRoom: (joinCode: string) => req('/api/rooms/join', { joinCode }),
  getRoom: (id: string) => req(`/api/rooms/${id}`),
  buy: (roomId: string, amount: number, note?: string) =>
    req(`/api/rooms/${roomId}/buy`, { amount, ...(note ? { note } : {}) }),
  requests: (roomId: string) => req(`/api/rooms/${roomId}/requests`),
  approve: (roomId: string, requestId: number, approve: boolean) =>
    req(`/api/rooms/${roomId}/approve`, { requestId, approve }),
  room: (id: string) => req(`/api/rooms/${id}`),
  revertPurchase: (roomId: string, entryId: number) => req(`/api/rooms/${roomId}/revert`, { entryId }),
  setCoBanker: (roomId: string, userId: number | null) =>
    req(`/api/rooms/${roomId}/co-banker`, { userId }, 'PUT'),
  session: (roomId: string) => req(`/api/rooms/${roomId}/session`),
  ledger: (roomId: string) => req(`/api/rooms/${roomId}/ledger`),
  hands: (roomId: string) => req(`/api/rooms/${roomId}/hands`),
  hand: (roomId: string, handId: string) => req(`/api/rooms/${roomId}/hands/${handId}`),
  profile: () => req('/api/profile'),
  updateProfile: (p: Record<string, unknown>) => req('/api/profile', p, 'PUT'),
  uploadAvatar: (image: string) => req('/api/profile/avatar', { image }, 'PUT'),
  deleteAvatar: () => req('/api/profile/avatar', undefined, 'DELETE'),
  leaderboard: () => req('/api/leaderboard'),
  roomLeaderboard: (roomId: string) => req(`/api/rooms/${roomId}/leaderboard`),
  userProfile: (userId: number) => req(`/api/users/${userId}/profile`),
  setMinSettleHands: (roomId: string, minSettleHands: number) =>
    req(`/api/rooms/${roomId}/settings`, { minSettleHands }, 'PUT'),
  setSevenDeuceBonus: (roomId: string, sevenDeuceBonus: number) =>
    req(`/api/rooms/${roomId}/settings`, { sevenDeuceBonus }, 'PUT'),
  roomSettings: (roomId: string, actionSecs: number) =>
    req(`/api/rooms/${roomId}/settings`, { actionSecs }, 'PUT'),
};
