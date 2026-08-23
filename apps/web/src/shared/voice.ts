import type { RoomStatePlayer } from '@4am/shared';
import { useStore } from './store.ts';
import { wsClient } from './ws.ts';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

interface RtcPayload {
  sdp?: RTCSessionDescriptionInit;
  ice?: RTCIceCandidateInit;
}

/**
 * Always-on room voice chat: a WebRTC mesh between connected players.
 * Signaling rides our WS ('rtc' messages); audio flows peer-to-peer and
 * never touches the server. Mute disables the local track (and is
 * broadcast so others can show it). Initiator = lower userId (no glare).
 */
class VoiceManager {
  private pcs = new Map<number, RTCPeerConnection>();
  private audios = new Map<number, HTMLAudioElement>();
  private analysers = new Map<number, AnalyserNode>();
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private levelTimer: number | null = null;
  private myId = 0;

  get joined(): boolean {
    return this.stream !== null;
  }

  async join(): Promise<boolean> {
    if (this.stream) return true;
    this.myId = useStore.getState().auth.userId!;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      useStore.getState().pushError('Microphone blocked. Voice chat stays off.');
      return false;
    }
    useStore.getState().patchVoice({ joined: true, muted: false });
    wsClient.send({ t: 'voice_state', muted: false });
    this.watchLevel(this.myId, this.stream);
    this.startLevelLoop();
    return true;
  }

  leave(): void {
    for (const pc of this.pcs.values()) pc.close();
    this.pcs.clear();
    for (const a of this.audios.values()) a.remove();
    this.audios.clear();
    this.analysers.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    useStore.getState().patchVoice({ joined: false, speakingByUser: {} });
  }

  toggleMute(): void {
    if (!this.stream) return;
    const track = this.stream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    useStore.getState().patchVoice({ muted: !track.enabled });
    wsClient.send({ t: 'voice_state', muted: !track.enabled });
  }

  /** Called on every room_state: connect to newly present players, drop gone ones. */
  syncPeers(players: RoomStatePlayer[]): void {
    if (!this.stream) return;
    const present = new Set(
      players.filter((p) => p.connected && p.userId !== this.myId).map((p) => p.userId),
    );
    for (const [id, pc] of this.pcs) {
      if (!present.has(id)) {
        pc.close();
        this.pcs.delete(id);
        this.audios.get(id)?.remove();
        this.audios.delete(id);
        this.analysers.delete(id);
      }
    }
    for (const id of present) {
      if (!this.pcs.has(id) && this.myId < id) void this.offerTo(id);
    }
  }

  private newPc(peerId: number): RTCPeerConnection {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pcs.set(peerId, pc);
    for (const track of this.stream!.getTracks()) pc.addTrack(track, this.stream!);
    pc.onicecandidate = (e) => {
      if (e.candidate) wsClient.send({ t: 'rtc', to: peerId, data: { ice: e.candidate.toJSON() } });
    };
    pc.ontrack = (e) => {
      const remote = e.streams[0];
      if (!remote) return;
      let audio = this.audios.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        this.audios.set(peerId, audio);
      }
      audio.srcObject = remote;
      this.watchLevel(peerId, remote);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        pc.close();
        this.pcs.delete(peerId);
      }
    };
    return pc;
  }

  private async offerTo(peerId: number): Promise<void> {
    const pc = this.newPc(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsClient.send({ t: 'rtc', to: peerId, data: { sdp: offer } });
  }

  async handleRtc(from: number, data: unknown): Promise<void> {
    if (!this.stream) return;
    const payload = data as RtcPayload;
    try {
      if (payload.sdp?.type === 'offer') {
        const pc = this.pcs.get(from) ?? this.newPc(from);
        await pc.setRemoteDescription(payload.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsClient.send({ t: 'rtc', to: from, data: { sdp: answer } });
      } else if (payload.sdp?.type === 'answer') {
        await this.pcs.get(from)?.setRemoteDescription(payload.sdp);
      } else if (payload.ice) {
        await this.pcs.get(from)?.addIceCandidate(payload.ice);
      }
    } catch {
      /* transient glare/teardown races are non-fatal */
    }
  }

  private watchLevel(userId: number, stream: MediaStream): void {
    try {
      this.ctx ??= new AudioContext();
      const src = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      this.analysers.set(userId, analyser);
    } catch {
      /* level meter is best-effort */
    }
  }

  private startLevelLoop(): void {
    if (this.levelTimer) return;
    const buf = new Uint8Array(128);
    this.levelTimer = window.setInterval(() => {
      const speaking: Record<number, boolean> = {};
      for (const [userId, analyser] of this.analysers) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += Math.abs(v - 128);
        speaking[userId] = sum / buf.length > 6;
      }
      useStore.getState().patchVoice({ speakingByUser: speaking });
    }, 250);
  }
}

export const voice = new VoiceManager();
