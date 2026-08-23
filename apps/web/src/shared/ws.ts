import type { ClientMsg, ServerMsg } from '@4am/shared';
import { api } from './api.ts';
import { useStore } from './store.ts';

type Listener = (msg: ServerMsg) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private roomId: string | null = null;
  private retry = 0;
  private closedByUs = false;
  private needResync = false;

  /** True once after a dropped connection; the game client uses it to reconcile state. */
  consumeResync(): boolean {
    const v = this.needResync;
    this.needResync = false;
    return v;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  joinRoom(roomId: string): void {
    this.roomId = roomId;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ t: 'join_room', roomId });
    } else {
      this.connect();
    }
  }

  leaveRoom(): void {
    this.roomId = null;
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
  }

  send(msg: ClientMsg): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private connect(): void {
    const token = useStore.getState().auth.token;
    if (!token || this.ws) return;
    this.closedByUs = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      useStore.getState().setWsConnected(true);
      if (this.roomId) this.send({ t: 'join_room', roomId: this.roomId });
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string) as ServerMsg;
      } catch {
        return;
      }
      for (const fn of this.listeners) fn(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      this.needResync = true;
      useStore.getState().setWsConnected(false);
      if (!this.closedByUs && this.roomId) {
        // if reconnects keep failing, the server may have restarted with fresh
        // data and our token is dead; api's 401 handler sends us to login
        if (this.retry >= 4) void api.profile().catch(() => {});
        const delay = Math.min(500 * 2 ** this.retry++, 8000);
        setTimeout(() => this.connect(), delay);
      }
    };
  }
}

export const wsClient = new WsClient();
