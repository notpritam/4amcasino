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
  if (!res.ok) throw new Error(json.error ?? `request failed (${res.status})`);
  return json;
}

export const api = {
  register: (username: string, authKey: string, publicKey: string) =>
    req('/api/register', { username, authKey, publicKey }),
  login: (username: string, authKey: string) => req('/api/login', { username, authKey }),
  me: () => req('/api/me'),
  myRooms: () => req('/api/my-rooms'),
  createRoom: (name: string, sb: number, bb: number, auditMode?: string) =>
    req('/api/rooms', { name, sb, bb, ...(auditMode ? { auditMode } : {}) }),
  joinRoom: (joinCode: string) => req('/api/rooms/join', { joinCode }),
  getRoom: (id: string) => req(`/api/rooms/${id}`),
  buy: (roomId: string, amount: number, note?: string) =>
    req(`/api/rooms/${roomId}/buy`, { amount, ...(note ? { note } : {}) }),
  requests: (roomId: string) => req(`/api/rooms/${roomId}/requests`),
  approve: (roomId: string, requestId: number, approve: boolean) =>
    req(`/api/rooms/${roomId}/approve`, { requestId, approve }),
  ledger: (roomId: string) => req(`/api/rooms/${roomId}/ledger`),
  hands: (roomId: string) => req(`/api/rooms/${roomId}/hands`),
  hand: (roomId: string, handId: string) => req(`/api/rooms/${roomId}/hands/${handId}`),
};
