// ABOUTME: The table as a three.js world - light-purple cyberpunk room, procedural
// ABOUTME: customisable characters at every seat, live cards/chips/turn state from
// ABOUTME: the same store as the 2D table, fully playable via the HUD action bar.
// ABOUTME: Requested by notpritam - see docs/FEATURES.md.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RANKS, rankOf, suitOf, type CardId } from '@4am/shared';
import { bindGameClient } from '../../shared/gameClient.ts';
import { wsClient } from '../../shared/ws.ts';
import { useStore } from '../../shared/store.ts';
import { api } from '../../shared/api.ts';
import { cn } from '../../shared/lib/cn.ts';
import { ActionBar } from '../../widgets/table/ActionBar.tsx';

/* ── the character wardrobe ─────────────────────────────────────────────── */

export interface Avatar3D {
  c: string; // body color hex
  head: 'round' | 'cube' | 'cone';
  hat: 'none' | 'cap' | 'halo' | 'crown';
}

const DEFAULT_AVATAR: Avatar3D = { c: '#a78bfa', head: 'round', hat: 'none' };
const BODY_COLORS = ['#a78bfa', '#e879f9', '#60a5fa', '#34d399', '#fbbf24', '#fb7185', '#f8fafc', '#64748b'];
const HEADS: Avatar3D['head'][] = ['round', 'cube', 'cone'];
const HATS: Avatar3D['hat'][] = ['none', 'cap', 'halo', 'crown'];

function parseAvatar(raw: string | null | undefined): Avatar3D {
  try {
    const v = JSON.parse(raw ?? '') as Partial<Avatar3D>;
    return {
      c: typeof v.c === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.c) ? v.c : DEFAULT_AVATAR.c,
      head: HEADS.includes(v.head as Avatar3D['head']) ? (v.head as Avatar3D['head']) : 'round',
      hat: HATS.includes(v.hat as Avatar3D['hat']) ? (v.hat as Avatar3D['hat']) : 'none',
    };
  } catch {
    return DEFAULT_AVATAR;
  }
}

/** A low-poly person: capsule body, chosen head, chosen hat, neon trim. */
function buildCharacter(cfg: Avatar3D, dimmed: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Color(cfg.c);
  const mat = new THREE.MeshStandardMaterial({
    color: body,
    roughness: 0.6,
    metalness: 0.15,
    transparent: dimmed,
    opacity: dimmed ? 0.35 : 1,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0x1a0b2e,
    emissive: new THREE.Color(cfg.c),
    emissiveIntensity: dimmed ? 0.15 : 0.7,
    roughness: 0.4,
  });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 6, 14), mat);
  torso.position.y = 0.62;
  g.add(torso);

  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 8, 22), trim);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.55;
  g.add(belt);

  let headGeo: THREE.BufferGeometry;
  if (cfg.head === 'cube') headGeo = new THREE.BoxGeometry(0.42, 0.4, 0.42);
  else if (cfg.head === 'cone') headGeo = new THREE.ConeGeometry(0.28, 0.5, 18);
  else headGeo = new THREE.SphereGeometry(0.26, 20, 16);
  const head = new THREE.Mesh(headGeo, mat);
  head.position.y = cfg.head === 'cone' ? 1.32 : 1.28;
  g.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.05), trim);
  visor.position.set(0, 1.29, cfg.head === 'cube' ? 0.22 : 0.24);
  g.add(visor);

  if (cfg.hat === 'cap') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 18), trim);
    brim.position.y = 1.5;
    g.add(brim);
  } else if (cfg.hat === 'halo') {
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.03, 8, 26),
      new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 1.4 }),
    );
    halo.rotation.x = Math.PI / 2.3;
    halo.position.y = 1.66;
    g.add(halo);
  } else if (cfg.hat === 'crown') {
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.16, 5),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xb45309, emissiveIntensity: 0.5, metalness: 0.7, roughness: 0.3 }),
    );
    crown.position.y = 1.56;
    g.add(crown);
  }
  return g;
}

/* ── canvas textures: cards and name tags ───────────────────────────────── */

const SUIT_GLYPHS = ['♣', '♦', '♥', '♠'];

function cardTexture(id: CardId | null): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 178;
  const x = c.getContext('2d')!;
  if (id === null) {
    x.fillStyle = '#4c1d95';
    x.fillRect(0, 0, 128, 178);
    x.strokeStyle = 'rgba(233,213,255,0.5)';
    x.lineWidth = 5;
    x.strokeRect(9, 9, 110, 160);
  } else {
    x.fillStyle = '#faf7ff';
    x.fillRect(0, 0, 128, 178);
    const suit = suitOf(id);
    x.fillStyle = suit === 1 || suit === 2 ? '#dc2626' : '#111827';
    x.font = '700 44px system-ui';
    x.fillText(RANKS[rankOf(id)]!, 12, 48);
    x.font = '84px system-ui';
    x.textAlign = 'center';
    x.fillText(SUIT_GLYPHS[suit]!, 64, 148);
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function labelTexture(name: string, sub: string, accent: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(21,11,38,0.82)';
  x.beginPath();
  x.roundRect(4, 4, 248, 88, 18);
  x.fill();
  x.strokeStyle = accent;
  x.lineWidth = 3;
  x.stroke();
  x.fillStyle = '#f5f3ff';
  x.font = '700 30px system-ui';
  x.textAlign = 'center';
  x.fillText(name.slice(0, 13), 128, 42);
  x.fillStyle = accent;
  x.font = '600 26px ui-monospace, monospace';
  x.fillText(sub, 128, 76);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function makeCard(id: CardId | null, w = 0.55): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, w * 1.39),
    new THREE.MeshBasicMaterial({ map: cardTexture(id), transparent: false }),
  );
  mesh.rotation.x = -Math.PI / 2 + 0.16;
  return mesh;
}

/* ── chips ──────────────────────────────────────────────────────────────── */

const CHIP_COLORS = [0x312e81, 0x10b981, 0xf43f5e, 0xfbbf24]; // 100bb..1bb tiers

function chipSplit(amount: number, bb: number): number[] {
  const unit = Math.max(1, bb);
  const denoms = [unit * 100, unit * 25, unit * 5, unit];
  const counts = [0, 0, 0, 0];
  let rest = amount;
  denoms.forEach((d, i) => {
    counts[i] = Math.min(Math.floor(rest / d), 6);
    rest -= counts[i]! * d;
  });
  if (!counts.some((c) => c > 0)) counts[3] = 1;
  return counts;
}

function buildChips(amount: number, bb: number): THREE.Group {
  const g = new THREE.Group();
  const counts = chipSplit(amount, bb);
  let col = 0;
  counts.forEach((count, tier) => {
    if (count === 0) return;
    for (let i = 0; i < count; i++) {
      const chip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.13, 0.045, 20),
        new THREE.MeshStandardMaterial({ color: CHIP_COLORS[tier], roughness: 0.35, metalness: 0.2 }),
      );
      chip.position.set(col * 0.3, 0.03 + i * 0.05, 0);
      g.add(chip);
    }
    col++;
  });
  g.position.x -= ((col - 1) * 0.3) / 2;
  return g;
}

/* ── the page ───────────────────────────────────────────────────────────── */

export function Table3DPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const mountRef = useRef<HTMLDivElement>(null);
  const room = useStore((s) => s.room);
  const hand = useStore((s) => s.hand);
  const auth = useStore((s) => s.auth);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draft, setDraft] = useState<Avatar3D>(DEFAULT_AVATAR);
  const [saved, setSaved] = useState(false);

  const me = room?.players.find((p) => p.userId === auth.userId);
  const mySeat = me?.seat ?? null;
  const isHost = room?.room.hostId === auth.userId;

  // clock for the urgent state on the HUD bar
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, []);
  const urgent = hand.deadline !== null && hand.deadline - now < 10_000;

  useEffect(() => {
    bindGameClient();
    wsClient.joinRoom(roomId!);
    api.getRoom(roomId!).catch(() => {});
  }, [roomId]);

  useEffect(() => {
    if (me) setDraft(parseAvatar(me.avatar3d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.avatar3d]);

  /* the whole three.js world lives in this effect */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x150b26);
    scene.fog = new THREE.Fog(0x150b26, 14, 30);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
    camera.position.set(0, 5.2, 8.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;
    controls.maxPolarAngle = 1.38;
    controls.minDistance = 4;
    controls.maxDistance = 16;

    /* the room: violet haze, neon grid floor, glowing pillars */
    scene.add(new THREE.AmbientLight(0x8b7ab8, 0.55));
    const key = new THREE.PointLight(0xa78bfa, 60, 40);
    key.position.set(0, 8, 0);
    scene.add(key);
    const magenta = new THREE.PointLight(0xe879f9, 30, 30);
    magenta.position.set(-8, 4, -6);
    scene.add(magenta);
    const blue = new THREE.PointLight(0x818cf8, 25, 30);
    blue.position.set(8, 4, 6);
    scene.add(blue);

    const grid = new THREE.GridHelper(60, 60, 0x7c3aed, 0x2c1650);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.position.y = -0.01;
    scene.add(grid);

    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 5 + (i % 3) * 2, 0.24),
        new THREE.MeshStandardMaterial({
          color: 0x1a0b2e,
          emissive: i % 2 ? 0xa78bfa : 0xe879f9,
          emissiveIntensity: 0.9,
        }),
      );
      pillar.position.set(Math.cos(a) * 16, 2.5, Math.sin(a) * 16);
      scene.add(pillar);
    }

    /* the table: oval felt with a neon rim */
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3.15, 0.35, 48),
      new THREE.MeshStandardMaterial({ color: 0x241245, roughness: 0.85 }),
    );
    felt.scale.x = 1.55;
    felt.position.y = 0.85;
    scene.add(felt);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(3.02, 0.075, 12, 64),
      new THREE.MeshStandardMaterial({ color: 0x2c1650, emissive: 0xa78bfa, emissiveIntensity: 1.1 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.scale.x = 1.55;
    rim.position.y = 1.03;
    scene.add(rim);
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.5, 0.85, 24),
      new THREE.MeshStandardMaterial({ color: 0x190d2e, roughness: 0.7 }),
    );
    leg.scale.x = 1.4;
    leg.position.y = 0.42;
    scene.add(leg);

    /* everything live rebuilds into this group */
    const dynamic = new THREE.Group();
    scene.add(dynamic);
    const turnRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.05, 10, 40),
      new THREE.MeshStandardMaterial({ color: 0xe879f9, emissive: 0xe879f9, emissiveIntensity: 1.6 }),
    );
    turnRing.rotation.x = Math.PI / 2;
    turnRing.visible = false;
    scene.add(turnRing);

    const disposeDeep = (obj: THREE.Object3D) => {
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          const anyMat = mat as THREE.MeshBasicMaterial;
          if (anyMat.map) anyMat.map.dispose();
          mat.dispose();
        }
      });
    };

    let dirty = true;
    const rebuild = () => {
      dirty = false;
      disposeDeep(dynamic);
      dynamic.clear();
      const st = useStore.getState();
      const r = st.room;
      if (!r) return;
      const h = st.hand;
      const betting = h.betting;
      const myId = st.auth.userId;

      const seated = r.players.filter((p) => p.seat !== null).sort((a, b) => a.seat! - b.seat!);
      let order = seated;
      const meIdx = seated.findIndex((p) => p.userId === myId);
      if (meIdx > 0) order = [...seated.slice(meIdx), ...seated.slice(0, meIdx)];
      const n = Math.max(order.length, 1);

      turnRing.visible = false;
      order.forEach((p, i) => {
        const a = Math.PI / 2 + (i / n) * Math.PI * 2;
        const px = Math.cos(a) * 5.6;
        const pz = Math.sin(a) * 4.1;
        const engine = betting?.seats.find((s) => s.seat === p.seat);
        const inHand = h.handId !== null && !h.abort && h.seats.some((s) => s.seat === p.seat);
        const folded = !!engine?.folded;

        const char = buildCharacter(parseAvatar(p.avatar3d), folded || !!p.sittingOut);
        char.position.set(px, 0, pz);
        char.lookAt(0, 0.6, 0);
        dynamic.add(char);

        const isToAct = betting?.toAct === p.seat && h.handId !== null && !h.result && !h.abort;
        if (isToAct) {
          turnRing.visible = true;
          turnRing.position.set(px, 0.06, pz);
        }

        const stackShown = engine && !h.result ? engine.stack : p.stack;
        const label = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: labelTexture(
              p.userId === myId ? 'You' : p.displayName,
              String(stackShown),
              isToAct ? '#e879f9' : '#a78bfa',
            ),
            transparent: true,
          }),
        );
        label.scale.set(1.7, 0.64, 1);
        label.position.set(px, 2.1, pz);
        dynamic.add(label);

        // this street's chips slide toward the middle
        const committed = engine?.committed ?? 0;
        if (committed > 0) {
          const chips = buildChips(committed, r.room.bb);
          chips.position.set(Math.cos(a) * 3.4, 1.03, Math.sin(a) * 2.35);
          dynamic.add(chips);
        }

        // opponents' face-down cards on the felt in front of them
        if (inHand && !folded && p.userId !== myId) {
          for (let ci = 0; ci < 2; ci++) {
            const back = makeCard(null, 0.42);
            back.position.set(Math.cos(a) * 4.15 + (ci - 0.5) * 0.3, 1.06, Math.sin(a) * 2.95);
            back.lookAt(0, -2.2, 0);
            dynamic.add(back);
          }
        }
      });

      /* board and my cards */
      h.board.forEach((cardId, i) => {
        const cardMesh = makeCard(cardId, 0.62);
        cardMesh.position.set((i - 2) * 0.74, 1.06, 0.1);
        dynamic.add(cardMesh);
      });
      if (mySeat !== null && h.myCards.length > 0 && h.handId) {
        h.myCards.forEach((cardId, i) => {
          const mine = makeCard(cardId, 0.66);
          mine.position.set((i - 0.5) * 0.76, 1.1, 2.05);
          mine.rotation.x = -Math.PI / 2 + 0.5;
          dynamic.add(mine);
        });
      }

      /* the pot as a pile */
      const pot = betting ? betting.seats.reduce((sum, x) => sum + x.total, 0) : 0;
      if (pot > 0) {
        const pile = buildChips(pot, r.room.bb);
        pile.position.set(0, 1.03, -1.15);
        pile.scale.setScalar(1.15);
        dynamic.add(pile);
        const potLabel = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: labelTexture('POT', String(pot), '#e879f9'), transparent: true }),
        );
        potLabel.scale.set(1.5, 0.56, 1);
        potLabel.position.set(0, 1.85, -1.15);
        dynamic.add(potLabel);
      }
    };

    const unsub = useStore.subscribe(() => {
      dirty = true;
    });

    const size = () => {
      const w = mount.clientWidth;
      const hgt = mount.clientHeight;
      renderer.setSize(w, hgt);
      camera.aspect = w / hgt;
      camera.updateProjectionMatrix();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(mount);

    let raf = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (dirty) rebuild();
      const t = clock.getElapsedTime();
      if (turnRing.visible) {
        const pulse = 1 + Math.sin(t * 5) * 0.12;
        turnRing.scale.set(pulse, pulse, 1);
        (turnRing.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + Math.sin(t * 5) * 0.7;
      }
      rim.material.emissiveIntensity = 1.0 + Math.sin(t * 1.4) * 0.25;
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      unsub();
      ro.disconnect();
      controls.dispose();
      disposeDeep(scene);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const saveAvatar = () => {
    void api
      .updateProfile({ avatar3d: JSON.stringify(draft) })
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      })
      .catch(() => {});
  };

  const swatch = useMemo(() => draft.c, [draft.c]);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#150b26] text-white">
      <div ref={mountRef} className="absolute inset-0" />

      {/* HUD: top strip */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 p-3">
        <Link
          to={`/room/${roomId}`}
          className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur hover:bg-white/20"
        >
          ← 2D
        </Link>
        <span className="font-display text-lg font-bold text-violet-200">{room?.room.name}</span>
        <span className="text-xs text-violet-300/70">drag to orbit · scroll to zoom</span>
        <button
          onClick={() => setCustomizeOpen((v) => !v)}
          className={cn(
            'ml-auto rounded-full px-4 py-2 text-sm font-semibold backdrop-blur',
            customizeOpen ? 'bg-fuchsia-500 text-white' : 'bg-white/10 hover:bg-white/20',
          )}
        >
          Your character
        </button>
      </div>

      {/* character customiser */}
      {customizeOpen && (
        <div className="absolute right-3 top-16 z-10 w-64 space-y-4 rounded-2xl bg-[#1d1033]/90 p-4 ring-1 ring-violet-400/30 backdrop-blur">
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-violet-300">Color</div>
            <div className="flex flex-wrap gap-1.5">
              {BODY_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setDraft((d) => ({ ...d, c }))}
                  aria-label={`Body color ${c}`}
                  className={cn('h-7 w-7 rounded-full ring-2', swatch === c ? 'ring-white' : 'ring-transparent')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-violet-300">Head</div>
            <div className="flex gap-1.5">
              {HEADS.map((headKind) => (
                <button
                  key={headKind}
                  onClick={() => setDraft((d) => ({ ...d, head: headKind }))}
                  className={cn(
                    'flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold capitalize',
                    draft.head === headKind ? 'bg-violet-500 text-white' : 'bg-white/10 hover:bg-white/20',
                  )}
                >
                  {headKind}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-violet-300">Hat</div>
            <div className="grid grid-cols-2 gap-1.5">
              {HATS.map((hatKind) => (
                <button
                  key={hatKind}
                  onClick={() => setDraft((d) => ({ ...d, hat: hatKind }))}
                  className={cn(
                    'rounded-lg px-2 py-1.5 text-xs font-semibold capitalize',
                    draft.hat === hatKind ? 'bg-violet-500 text-white' : 'bg-white/10 hover:bg-white/20',
                  )}
                >
                  {hatKind}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={saveAvatar}
            className="w-full rounded-lg bg-fuchsia-500 py-2 text-sm font-bold text-white hover:bg-fuchsia-400"
          >
            {saved ? 'Saved - the table sees it' : 'Save character'}
          </button>
        </div>
      )}

      {/* HUD: the same live controls as the 2D table */}
      {room && (
        <div className="absolute inset-x-0 bottom-0 z-10 mx-auto max-w-5xl p-3">
          <ActionBar mySeat={mySeat} isHost={!!isHost} urgent={urgent} hideIdleStart={false} />
        </div>
      )}
    </div>
  );
}
