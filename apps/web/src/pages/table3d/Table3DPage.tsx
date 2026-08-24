// ABOUTME: The table as a three.js world - light-purple cyberpunk room, procedural
// ABOUTME: customisable characters at every seat, live cards/chips/turn state from
// ABOUTME: the same store as the 2D table, fully playable via the HUD action bar.
// ABOUTME: Requested by notpritam - see docs/FEATURES.md.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RANKS, rankOf, suitOf, type CardId } from '@4am/shared';
import { bindGameClient } from '../../shared/gameClient.ts';
import { wsClient } from '../../shared/ws.ts';
import { useStore } from '../../shared/store.ts';
import { api } from '../../shared/api.ts';
import { play } from '../../shared/sounds.ts';
import { cn } from '../../shared/lib/cn.ts';
import { ActionBar } from '../../widgets/table/ActionBar.tsx';
import { ATTACKS, EMOTES } from './emotes.ts';

/* ── the character wardrobe ─────────────────────────────────────────────── */

export interface Avatar3D {
  c: string; // body color hex
  t: string; // trim/glow color hex
  head: 'round' | 'cube' | 'cone';
  hat: 'none' | 'cap' | 'halo' | 'crown';
  /** the bust-out blast you leave the table with */
  fx: 'boom' | 'rocket' | 'sparks';
}

const DEFAULT_AVATAR: Avatar3D = { c: '#a78bfa', t: '#e879f9', head: 'round', hat: 'none', fx: 'boom' };
const FX: Avatar3D['fx'][] = ['boom', 'rocket', 'sparks'];
const BODY_COLORS = ['#a78bfa', '#e879f9', '#60a5fa', '#34d399', '#fbbf24', '#fb7185', '#f8fafc', '#64748b'];
const HEADS: Avatar3D['head'][] = ['round', 'cube', 'cone'];
const HATS: Avatar3D['hat'][] = ['none', 'cap', 'halo', 'crown'];

function parseAvatar(raw: string | null | undefined): Avatar3D {
  try {
    const v = JSON.parse(raw ?? '') as Partial<Avatar3D>;
    const hex = (x: unknown, fb: string) =>
      typeof x === 'string' && /^#[0-9a-fA-F]{6}$/.test(x) ? x : fb;
    return {
      c: hex(v.c, DEFAULT_AVATAR.c),
      t: hex(v.t, DEFAULT_AVATAR.t),
      head: HEADS.includes(v.head as Avatar3D['head']) ? (v.head as Avatar3D['head']) : 'round',
      hat: HATS.includes(v.hat as Avatar3D['hat']) ? (v.hat as Avatar3D['hat']) : 'none',
      fx: FX.includes(v.fx as Avatar3D['fx']) ? (v.fx as Avatar3D['fx']) : 'boom',
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
    emissive: new THREE.Color(cfg.t),
    emissiveIntensity: dimmed ? 0.15 : 0.9,
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

  // articulated arms: shoulder pivots so emotes can wave, clap, flex, slap
  for (const side of [-1, 1] as const) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.36, 1.0, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.34, 4, 10), mat);
    arm.position.y = -0.24;
    shoulder.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), trim);
    hand.position.y = -0.5;
    shoulder.add(hand);
    shoulder.rotation.z = side * 0.16; // resting pose, slightly out
    g.add(shoulder);
    if (side === -1) g.userData.armL = shoulder;
    else g.userData.armR = shoulder;
  }
  g.userData.head = head;

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

const FELT_TOP = 1.025;

function cardTexture(id: CardId | null): THREE.CanvasTexture {
  const W = 256;
  const H = 356;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  // rounded card silhouette; outside stays transparent
  x.beginPath();
  x.roundRect(2, 2, W - 4, H - 4, 26);
  x.clip();
  if (id === null) {
    x.fillStyle = '#5b21b6';
    x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(233,213,255,0.55)';
    x.lineWidth = 8;
    x.strokeRect(20, 20, W - 40, H - 40);
    x.strokeRect(38, 38, W - 76, H - 76);
  } else {
    x.fillStyle = '#fbfaff';
    x.fillRect(0, 0, W, H);
    const suit = suitOf(id);
    const ink = suit === 1 || suit === 2 ? '#dc2626' : '#0f172a';
    x.fillStyle = ink;
    x.textAlign = 'left';
    x.font = '700 84px system-ui';
    x.fillText(RANKS[rankOf(id)]!, 20, 92);
    x.font = '58px system-ui';
    x.fillText(SUIT_GLYPHS[suit]!, 22, 152);
    x.font = '150px system-ui';
    x.textAlign = 'center';
    x.fillText(SUIT_GLYPHS[suit]!, W / 2 + 20, H - 62);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
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

/** A card resting on the felt: the tilt raises the pivot just enough that
 *  the near edge never clips through the table surface. */
function makeCard(id: CardId | null, w = 0.55, tilt = 0.14): THREE.Mesh {
  const h = w * 1.39;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: cardTexture(id), transparent: true, side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2 + tilt;
  mesh.position.y = FELT_TOP + 0.02 + Math.sin(tilt) * (h / 2);
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

/** A turntable preview of the draft character, so you see every change live. */
function CharacterPreview({ cfg }: { cfg: Avatar3D }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mount = ref.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1d1033);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
    camera.position.set(0, 1.35, 3.1);
    camera.lookAt(0, 0.85, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(224, 190);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0x9d8bd8, 0.7));
    const key = new THREE.PointLight(0xffffff, 14, 20);
    key.position.set(2, 3, 3);
    scene.add(key);
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.85, 0.1, 32),
      new THREE.MeshStandardMaterial({ color: 0x2c1650, emissive: 0x7c3aed, emissiveIntensity: 0.4 }),
    );
    scene.add(disc);
    const char = buildCharacter(cfg, false);
    scene.add(char);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      char.rotation.y += 0.02;
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [cfg]);
  return <div ref={ref} className="overflow-hidden rounded-xl" />;
}

/* ── the page ───────────────────────────────────────────────────────────── */

export function Table3DPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const mountRef = useRef<HTMLDivElement>(null);
  const room = useStore((s) => s.room);
  const hand = useStore((s) => s.hand);
  const auth = useStore((s) => s.auth);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const flyRef = useRef<((pos: [number, number, number], look: [number, number, number]) => void) | null>(null);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [targetMenu, setTargetMenu] = useState<{ seat: number; name: string; x: number; y: number } | null>(null);
  const targetMenuRef = useRef(setTargetMenu);
  targetMenuRef.current = setTargetMenu;
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
    scene.fog = new THREE.Fog(0x150b26, 16, 44);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
    camera.position.set(0, 5.2, 8.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // the Blender-style setup: an environment map for image-based lighting,
    // filmic tone mapping, and a shadow-casting sun
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.4;
    mount.appendChild(renderer.domElement);

    const sun = new THREE.DirectionalLight(0xd8c7ff, 2.2);
    sun.position.set(7, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    const shadowCatcher = new THREE.Mesh(
      new THREE.CircleGeometry(20, 48),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = 0.001;
    shadowCatcher.receiveShadow = true;
    scene.add(shadowCatcher);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;
    controls.maxPolarAngle = 1.42;
    controls.minDistance = 2.2;
    controls.maxDistance = 18;
    controls.enablePan = true;
    controls.keyPanSpeed = 14;
    controls.listenToKeyEvents(window); // arrow keys walk the room

    // smooth fly-to for the camera preset buttons
    let flyPos: THREE.Vector3 | null = null;
    let flyLook: THREE.Vector3 | null = null;
    const fly = (pos: [number, number, number], look: [number, number, number]) => {
      flyPos = new THREE.Vector3(...pos);
      flyLook = new THREE.Vector3(...look);
    };
    flyRef.current = fly;

    /* the room: violet haze, neon grid floor, glowing pillars */
    scene.add(new THREE.AmbientLight(0x8b7ab8, 0.35));
    const key = new THREE.PointLight(0xa78bfa, 40, 40);
    key.position.set(0, 8, 0);
    scene.add(key);
    const magenta = new THREE.PointLight(0xe879f9, 30, 30);
    magenta.position.set(-8, 4, -6);
    scene.add(magenta);
    const blue = new THREE.PointLight(0x818cf8, 25, 30);
    blue.position.set(8, 4, 6);
    scene.add(blue);


    /* ── the casino room ── */
    const R = 19; // room radius

    // patterned carpet
    const carpetCanvas = document.createElement('canvas');
    carpetCanvas.width = 256;
    carpetCanvas.height = 256;
    const cc = carpetCanvas.getContext('2d')!;
    cc.fillStyle = '#1c1132';
    cc.fillRect(0, 0, 256, 256);
    cc.strokeStyle = 'rgba(167,139,250,0.16)';
    cc.lineWidth = 3;
    for (let i = -4; i < 8; i++) {
      cc.beginPath();
      cc.moveTo(i * 64, 0);
      cc.lineTo(i * 64 + 256, 256);
      cc.stroke();
      cc.beginPath();
      cc.moveTo(i * 64 + 256, 0);
      cc.lineTo(i * 64, 256);
      cc.stroke();
    }
    cc.fillStyle = 'rgba(232,121,249,0.14)';
    for (let ix = 0; ix < 4; ix++)
      for (let iy = 0; iy < 4; iy++) cc.beginPath(), cc.arc(ix * 64 + 32, iy * 64 + 32, 5, 0, 7), cc.fill();
    const carpetTex = new THREE.CanvasTexture(carpetCanvas);
    carpetTex.colorSpace = THREE.SRGBColorSpace;
    carpetTex.wrapS = carpetTex.wrapT = THREE.RepeatWrapping;
    carpetTex.repeat.set(12, 12);
    const carpet = new THREE.Mesh(
      new THREE.CircleGeometry(R, 48),
      new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.95 }),
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.y = 0.002;
    carpet.receiveShadow = true;
    scene.add(carpet);

    // enclosing wall with neon trim bands
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 9, 32, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x160c28, roughness: 0.9, side: THREE.BackSide }),
    );
    wall.position.y = 4.5;
    scene.add(wall);
    for (const [y, col] of [
      [0.5, 0xa78bfa],
      [7.6, 0xe879f9],
    ] as const) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(R - 0.05, 0.06, 8, 64),
        new THREE.MeshStandardMaterial({ color: 0x1a0b2e, emissive: col, emissiveIntensity: 1.6 }),
      );
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      scene.add(band);
    }
    // ceiling + chandelier over the table
    const ceiling = new THREE.Mesh(
      new THREE.CircleGeometry(R, 32),
      new THREE.MeshStandardMaterial({ color: 0x120a20, roughness: 1 }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 9;
    scene.add(ceiling);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.1 + i * 0.7, 0.045, 8, 48),
        new THREE.MeshStandardMaterial({
          color: 0x1a0b2e,
          emissive: i % 2 ? 0xe879f9 : 0xa78bfa,
          emissiveIntensity: 1.8,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 6.6 - i * 0.25;
      scene.add(ring);
    }

    // glowing suit signs at the compass points
    const suitSign = (glyph: string, color: string, angle: number) => {
      const sc = document.createElement('canvas');
      sc.width = 128;
      sc.height = 128;
      const sx = sc.getContext('2d')!;
      sx.shadowColor = color;
      sx.shadowBlur = 26;
      sx.fillStyle = color;
      sx.font = '96px system-ui';
      sx.textAlign = 'center';
      sx.fillText(glyph, 64, 100);
      const tex = new THREE.CanvasTexture(sc);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sp.scale.set(2.6, 2.6, 1);
      sp.position.set(Math.cos(angle) * (R - 1), 5.4, Math.sin(angle) * (R - 1));
      scene.add(sp);
    };
    suitSign('♠', '#a78bfa', Math.PI / 4);
    suitSign('♥', '#e879f9', (Math.PI * 3) / 4);
    suitSign('♦', '#f0abfc', (Math.PI * 5) / 4);
    suitSign('♣', '#c4b5fd', (Math.PI * 7) / 4);

    // the house sign
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 1024;
    signCanvas.height = 192;
    const sg = signCanvas.getContext('2d')!;
    sg.shadowColor = '#e879f9';
    sg.shadowBlur = 34;
    sg.fillStyle = '#f5d0fe';
    sg.font = '700 120px system-ui';
    sg.textAlign = 'center';
    sg.fillText('4AM CASINO', 512, 132);
    const signTex = new THREE.CanvasTexture(signCanvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex, transparent: true }));
    sign.scale.set(9, 1.7, 1);
    sign.position.set(0, 6.4, -(R - 1.2));
    scene.add(sign);

    // a row of slot machines along the back wall
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.32 + i * 0.09);
      const slot = new THREE.Group();
      const bodyBox = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 2.1, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x241245, roughness: 0.5, metalness: 0.3 }),
      );
      bodyBox.position.y = 1.05;
      slot.add(bodyBox);
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.6),
        new THREE.MeshStandardMaterial({
          color: 0x0b0518,
          emissive: i % 2 ? 0xe879f9 : 0x8b5cf6,
          emissiveIntensity: 1.3,
        }),
      );
      screen.position.set(0, 1.45, 0.41);
      slot.add(screen);
      const lever = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xe879f9, emissive: 0xe879f9, emissiveIntensity: 0.8 }),
      );
      lever.position.set(0.62, 1.8, 0);
      slot.add(lever);
      slot.position.set(Math.cos(a) * (R - 2.2), 0, -Math.abs(Math.sin(a)) * (R - 2.2));
      slot.lookAt(0, 0, 0);
      slot.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
      scene.add(slot);
    }

    // a bar on the opposite side, stools included
    const bar = new THREE.Group();
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(7, 1.15, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x2b1650, roughness: 0.35, metalness: 0.4 }),
    );
    counter.position.y = 0.58;
    bar.add(counter);
    const counterGlow = new THREE.Mesh(
      new THREE.BoxGeometry(7.05, 0.06, 1.15),
      new THREE.MeshStandardMaterial({ color: 0x1a0b2e, emissive: 0xa78bfa, emissiveIntensity: 1.5 }),
    );
    counterGlow.position.y = 1.18;
    bar.add(counterGlow);
    for (let i = 0; i < 4; i++) {
      const stool = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.28, 0.85, 14),
        new THREE.MeshStandardMaterial({ color: 0x3b2168, roughness: 0.6 }),
      );
      stool.position.set(-2.6 + i * 1.7, 0.42, 1.35);
      stool.castShadow = true;
      bar.add(stool);
    }
    bar.position.set(0, 0, R - 3.4);
    bar.rotation.y = Math.PI;
    bar.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    scene.add(bar);

    /* the table: oval felt with a neon rim */
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3.15, 0.35, 48),
      new THREE.MeshStandardMaterial({ color: 0x241245, roughness: 0.85 }),
    );
    felt.scale.x = 1.55;
    felt.position.y = 0.85;
    felt.receiveShadow = true;
    felt.castShadow = true;
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
    leg.castShadow = true;
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
    // a bobbing arrow over the head of whoever is up
    const turnArrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.42, 4),
      new THREE.MeshStandardMaterial({ color: 0xe879f9, emissive: 0xe879f9, emissiveIntensity: 1.8 }),
    );
    turnArrow.rotation.x = Math.PI;
    turnArrow.visible = false;
    scene.add(turnArrow);

    /* fun: pokes, fold slumps, bust-out blasts */
    interface Anim {
      kind: 'poke' | 'slap' | 'chip' | 'fold' | 'boom' | 'rocket' | 'sparks' | 'emote';
      emote?: string;
      seat: number;
      t0: number;
      fired?: boolean;
    }
    const anims: Anim[] = [];
    const charBySeat = new Map<number, THREE.Group>();
    const homeBySeat = new Map<number, THREE.Vector3>();
    const seen = new Set<string>();
    const particles: { pts: THREE.Points; vel: Float32Array; t0: number; dur: number }[] = [];

    const burst = (at: THREE.Vector3, color: number, count: number, spread: number, up: number) => {
      const pos = new Float32Array(count * 3);
      const vel = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos.set([at.x, at.y, at.z], i * 3);
        vel.set(
          [(Math.random() - 0.5) * spread, Math.random() * up + 0.5, (Math.random() - 0.5) * spread],
          i * 3,
        );
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color, size: 0.12, transparent: true, opacity: 1 }),
      );
      scene.add(pts);
      particles.push({ pts, vel, t0: performance.now(), dur: 1500 });
    };

    const powSprite = (at: THREE.Vector3) => {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: labelTexture('POW!', '', '#fbbf24'), transparent: true }),
      );
      sp.scale.set(1.3, 0.5, 1);
      sp.position.copy(at).add(new THREE.Vector3(0, 1.9, 0));
      scene.add(sp);
      setTimeout(() => {
        scene.remove(sp);
        sp.material.map?.dispose();
        sp.material.dispose();
      }, 900);
    };

    const onPoke = (e: Event) => {
      const detail = (e as CustomEvent<{ targetSeat: number }>).detail;
      anims.push({ kind: 'poke', seat: detail.targetSeat, t0: performance.now() });
      const home = homeBySeat.get(detail.targetSeat);
      if (home) powSprite(home);
    };
    window.addEventListener('4am-poke', onPoke);

    const emoteSprite = (at: THREE.Vector3, text: string) => {
      const sc = document.createElement('canvas');
      sc.width = 128;
      sc.height = 128;
      const sx = sc.getContext('2d')!;
      sx.font = '92px system-ui';
      sx.textAlign = 'center';
      sx.fillText(text, 64, 96);
      const tex = new THREE.CanvasTexture(sc);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sp.scale.set(0.9, 0.9, 1);
      sp.position.copy(at).add(new THREE.Vector3(0, 2.3, 0));
      scene.add(sp);
      const born = performance.now();
      const rise = () => {
        const lifeP = (performance.now() - born) / 1400;
        if (lifeP >= 1) {
          scene.remove(sp);
          tex.dispose();
          sp.material.dispose();
          return;
        }
        sp.position.y += 0.012;
        sp.material.opacity = 1 - lifeP;
        requestAnimationFrame(rise);
      };
      rise();
    };

    const onEmote = (e: Event) => {
      const d = (e as CustomEvent<{ fromSeat: number | null; kind: string; targetSeat?: number }>).detail;
      if (d.kind in ATTACKS && d.targetSeat !== undefined) {
        // wind-up on the attacker, impact on the target
        if (d.fromSeat !== null)
          anims.push({ kind: 'emote', emote: 'wave', seat: d.fromSeat, t0: performance.now() });
        anims.push({ kind: d.kind as 'slap' | 'chip', seat: d.targetSeat, t0: performance.now() });
        play(ATTACKS[d.kind]!.sound);
        const home = homeBySeat.get(d.targetSeat);
        if (home) powSprite(home);
        if (d.kind === 'chip' && d.fromSeat !== null) {
          const from = homeBySeat.get(d.fromSeat);
          if (from && home) {
            const chip = new THREE.Mesh(
              new THREE.CylinderGeometry(0.13, 0.13, 0.05, 16),
              new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xb45309, emissiveIntensity: 0.4 }),
            );
            scene.add(chip);
            const born = performance.now();
            const flyChip = () => {
              const fp = (performance.now() - born) / 500;
              if (fp >= 1) {
                scene.remove(chip);
                chip.geometry.dispose();
                (chip.material as THREE.Material).dispose();
                return;
              }
              chip.position.lerpVectors(from, home, fp);
              chip.position.y = 1.4 + Math.sin(Math.PI * fp) * 1.6;
              chip.rotation.x += 0.4;
              requestAnimationFrame(flyChip);
            };
            flyChip();
          }
        }
        return;
      }
      const def = EMOTES[d.kind];
      if (def && d.fromSeat !== null) {
        anims.push({ kind: 'emote', emote: d.kind, seat: d.fromSeat, t0: performance.now() });
        if (def.sound) play(def.sound);
        const home = homeBySeat.get(d.fromSeat);
        if (home) emoteSprite(home, def.sprite ?? def.emoji);
      }
    };
    window.addEventListener('4am-emote', onEmote);
    (window as unknown as Record<string, unknown>).__dbg = { anims, charBySeat, homeBySeat };

    /* tap a player to shove them (a click, not an orbit-drag) */
    const ray = new THREE.Raycaster();
    let downAt: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
    };
    const onUp = (e: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
      downAt = null;
      if (moved > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(dynamic.children, true);
      for (const hit of hits) {
        let o: THREE.Object3D | null = hit.object;
        while (o) {
          if (o.userData.pokeSeat !== undefined) {
            targetMenuRef.current({
              seat: o.userData.pokeSeat as number,
              name: (o.userData.pokeName as string) ?? 'player',
              x: e.clientX,
              y: e.clientY,
            });
            return;
          }
          o = o.parent;
        }
      }
      targetMenuRef.current(null as never);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

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
      charBySeat.clear();
      homeBySeat.clear();
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

        const cfg = parseAvatar(p.avatar3d);
        const char = buildCharacter(cfg, folded || !!p.sittingOut);
        char.position.set(px, 0, pz);
        char.lookAt(0, 0.6, 0);
        if (p.userId !== myId) {
          char.userData.pokeSeat = p.seat;
          char.userData.pokeName = p.displayName;
        }
        charBySeat.set(p.seat!, char);
        homeBySeat.set(p.seat!, new THREE.Vector3(px, 0, pz));
        dynamic.add(char);

        // a fresh fold gets its little slump (timeout folds included)
        const foldKey = `${h.handId}:fold:${p.seat}`;
        if (folded && h.handId && !seen.has(foldKey)) {
          seen.add(foldKey);
          anims.push({ kind: 'fold', seat: p.seat!, t0: performance.now() });
        }
        // the winner celebrates for everyone
        if (h.result && h.handId) {
          const winDelta = h.result.deltas.find((x) => x.seat === p.seat)?.delta ?? 0;
          const winKey = `${h.handId}:win:${p.seat}`;
          if (winDelta > 0 && !seen.has(winKey)) {
            seen.add(winKey);
            anims.push({ kind: 'emote', emote: 'celebrate', seat: p.seat!, t0: performance.now() });
            play('fanfare');
            burst(new THREE.Vector3(px, 1.6, pz), 0xfbbf24, 80, 3, 4);
          }
        }
        // busting out fires the player's chosen blast
        if (h.result && h.handId) {
          const endStack = h.result.stacks.find((x) => x.seat === p.seat)?.stack;
          const blastKey = `${h.handId}:blast:${p.seat}`;
          if (endStack === 0 && !seen.has(blastKey)) {
            seen.add(blastKey);
            anims.push({ kind: cfg.fx, seat: p.seat!, t0: performance.now() });
            play('boom');
            const at = new THREE.Vector3(px, 1, pz);
            if (cfg.fx === 'boom') burst(at, 0xfb923c, 90, 5, 3);
            else if (cfg.fx === 'sparks') burst(at, 0xe879f9, 120, 2.4, 5);
            else burst(at, 0xa78bfa, 60, 1.6, 6);
          }
        }

        const isToAct = betting?.toAct === p.seat && h.handId !== null && !h.result && !h.abort;
        if (isToAct) {
          turnRing.visible = true;
          turnRing.position.set(px, 0.06, pz);
          turnArrow.visible = true;
          turnArrow.position.set(px, 2.55, pz);
        }
        if (!betting || betting.toAct === null || h.result || h.abort) turnArrow.visible = false;

        const stackShown = engine && !h.result ? engine.stack : p.stack;
        if (p.userId !== myId) {
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
        }

        // this street's chips slide toward the middle
        const committed = engine?.committed ?? 0;
        if (committed > 0) {
          const chips = buildChips(committed, r.room.bb);
          chips.position.set(Math.cos(a) * 3.4, 1.03, Math.sin(a) * 2.35);
          dynamic.add(chips);
        }

        // players in the hand hold their two cards up like humans do
        if (inHand && !folded) {
          const held = new THREE.Group();
          for (let ci = 0; ci < 2; ci++) {
            const hc = makeCard(null, 0.22, 0);
            hc.rotation.set(-0.5, 0, (ci - 0.5) * 0.35);
            hc.position.set((ci - 0.5) * 0.14, 0, 0.02 * ci);
            held.add(hc);
          }
          held.position.set(0, 0.95, 0.4);
          char.add(held);
        }

      });

      /* board and my cards */
      h.board.forEach((cardId, i) => {
        const cardMesh = makeCard(cardId, 0.62, 0.14);
        cardMesh.position.x = (i - 2) * 0.72;
        cardMesh.position.z = 0.1;
        dynamic.add(cardMesh);
      });
      const mySeatNow = r.players.find((p) => p.userId === myId)?.seat ?? null;
      if (mySeatNow !== null && h.myCards.length > 0 && h.handId) {
        h.myCards.forEach((cardId, i) => {
          const mine = makeCard(cardId, 0.72, 0.55);
          mine.position.x = (i - 0.5) * 0.8;
          mine.position.z = 2.0;
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
      dynamic.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
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
        turnArrow.position.y = 2.55 + Math.sin(t * 4) * 0.14;
        turnArrow.rotation.y = t * 2;
      }

      const nowMs = performance.now();
      // every character starts each frame at its base pose, breathes a little,
      // then active animations write absolute offsets on top - nothing drifts
      for (const [seat, char] of charBySeat) {
        const home = homeBySeat.get(seat);
        if (!home) continue;
        char.position.copy(home);
        char.rotation.set(0, 0, 0);
        char.scale.setScalar(1);
        char.lookAt(0, 0.6, 0);
        const armL = char.userData.armL as THREE.Group | undefined;
        const armR = char.userData.armR as THREE.Group | undefined;
        const headObj = char.userData.head as THREE.Object3D | undefined;
        if (armL) armL.rotation.set(0, 0, -0.16 + Math.sin(t * 1.1 + seat) * 0.05);
        if (armR) armR.rotation.set(0, 0, 0.16 - Math.sin(t * 1.1 + seat) * 0.05);
        if (headObj) headObj.rotation.set(0, Math.sin(t * 0.4 + seat * 2) * 0.22, 0);
        char.scale.setScalar(1 + Math.sin(t * 1.3 + seat) * 0.012);
      }
      for (let i = anims.length - 1; i >= 0; i--) {
        const anim = anims[i]!;
        const char = charBySeat.get(anim.seat);
        const home = homeBySeat.get(anim.seat);
        const dur =
          anim.kind === 'emote'
            ? (EMOTES[anim.emote ?? '']?.dur ?? 1600)
            : anim.kind === 'poke'
              ? 1100
              : anim.kind === 'slap'
                ? 1300
                : anim.kind === 'chip'
                  ? 1500
                  : anim.kind === 'fold'
                    ? 900
                    : 1700;
        const prog = (nowMs - anim.t0) / dur;
        if (!char || !home || prog >= 1) {
          anims.splice(i, 1);
          continue;
        }
        const wave = Math.sin(Math.PI * prog);
        const away = home.clone().normalize();
        if (anim.kind === 'emote') {
          const def = EMOTES[anim.emote ?? ''];
          if (def) {
            def.apply(char, prog, t);
            if (def.burst && !anim.fired && prog > 0.4) {
              anim.fired = true;
              burst(home.clone().setY(1.4), def.burst, 40, 2.2, 3);
            }
          }
        } else if (anim.kind === 'poke') {
          char.position.copy(home).addScaledVector(away, wave * 2.1);
          char.position.y = wave * 1.4;
          char.rotation.y = prog * Math.PI * 4;
          char.rotation.z = wave * 0.9;
        } else if (anim.kind === 'slap') {
          // a harder hit: long arc sideways with a full flat spin
          char.position.copy(home).addScaledVector(away, wave * 3.1);
          char.position.y = wave * 2.2;
          char.rotation.z = prog * Math.PI * 6;
        } else if (anim.kind === 'chip') {
          if (prog > 0.35) {
            const kp = (prog - 0.35) / 0.65;
            const kw = Math.sin(Math.PI * kp);
            char.position.copy(home).addScaledVector(away, kw * 0.9);
            char.rotation.x = -kw * 0.5;
          }
        } else if (anim.kind === 'fold') {
          char.rotation.x = wave * 0.65;
          char.position.y = home.y - wave * 0.18;
        } else if (anim.kind === 'rocket') {
          char.position.y = home.y + prog * 9;
          char.rotation.y = prog * Math.PI * 8;
          if (Math.random() < 0.5) burst(char.position.clone(), 0xa78bfa, 3, 0.4, -1);
        } else {
          char.scale.setScalar(Math.max(0.05, 1 - prog * 1.1));
          char.rotation.y = prog * Math.PI * (anim.kind === 'sparks' ? 3 : 7);
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i]!;
        const life = (nowMs - pt.t0) / pt.dur;
        if (life >= 1) {
          scene.remove(pt.pts);
          pt.pts.geometry.dispose();
          (pt.pts.material as THREE.Material).dispose();
          particles.splice(i, 1);
          continue;
        }
        const positions = pt.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let j = 0; j < positions.count; j++) {
          positions.setXYZ(
            j,
            positions.getX(j) + pt.vel[j * 3]! * 0.016,
            positions.getY(j) + (pt.vel[j * 3 + 1]! - life * 2.2) * 0.016,
            positions.getZ(j) + pt.vel[j * 3 + 2]! * 0.016,
          );
        }
        positions.needsUpdate = true;
        (pt.pts.material as THREE.PointsMaterial).opacity = 1 - life;
      }
      rim.material.emissiveIntensity = 1.0 + Math.sin(t * 1.4) * 0.25;
      if (flyPos && flyLook) {
        camera.position.lerp(flyPos, 0.08);
        controls.target.lerp(flyLook, 0.08);
        if (camera.position.distanceTo(flyPos) < 0.05) {
          flyPos = null;
          flyLook = null;
        }
      }
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('4am-poke', onPoke);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      unsub();
      ro.disconnect();
      controls.dispose();
      disposeDeep(scene);
      pmrem.dispose();
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
        <span className="text-xs text-violet-300/70">drag to orbit · scroll to zoom · arrows to move</span>
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
        <div className="absolute right-3 top-16 z-10 max-h-[calc(100dvh-9rem)] w-64 space-y-4 overflow-y-auto rounded-2xl bg-[#1d1033]/90 p-4 ring-1 ring-violet-400/30 backdrop-blur">
          <CharacterPreview cfg={draft} />
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
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-violet-300">Glow trim</div>
            <div className="flex flex-wrap gap-1.5">
              {BODY_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setDraft((d) => ({ ...d, t: c }))}
                  aria-label={`Trim color ${c}`}
                  className={cn('h-7 w-7 rounded-full ring-2', draft.t === c ? 'ring-white' : 'ring-transparent')}
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
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-violet-300">
              Bust-out blast
            </div>
            <div className="flex gap-1.5">
              {FX.map((fxKind) => (
                <button
                  key={fxKind}
                  onClick={() => setDraft((d) => ({ ...d, fx: fxKind }))}
                  className={cn(
                    'flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold capitalize',
                    draft.fx === fxKind ? 'bg-violet-500 text-white' : 'bg-white/10 hover:bg-white/20',
                  )}
                >
                  {fxKind}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[0.66rem] leading-snug text-violet-300/60">
              Plays for the whole table when you run out of chips.
            </p>
          </div>
          <button
            onClick={saveAvatar}
            className="w-full rounded-lg bg-fuchsia-500 py-2 text-sm font-bold text-white hover:bg-fuchsia-400"
          >
            {saved ? 'Saved - the table sees it' : 'Save character'}
          </button>
        </div>
      )}

      {/* emotes: everyone at the table sees yours */}
      <div className="absolute bottom-28 right-3 z-10 flex flex-col items-end gap-2">
        {emoteOpen && (
          <div className="grid max-h-72 w-64 grid-cols-4 gap-1 overflow-y-auto rounded-2xl bg-[#1d1033]/95 p-2 ring-1 ring-violet-400/30 backdrop-blur">
            {Object.entries(EMOTES)
              .filter(([k]) => k !== 'celebrate')
              .map(([kind, def]) => (
                <button
                  key={kind}
                  title={def.label}
                  onClick={() => {
                    wsClient.send({ t: 'emote', kind });
                    setEmoteOpen(false);
                  }}
                  className="flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-lg hover:bg-white/10"
                >
                  {def.emoji}
                  <span className="text-[0.55rem] leading-none text-violet-300/80">{def.label}</span>
                </button>
              ))}
          </div>
        )}
        <button
          onClick={() => setEmoteOpen((v) => !v)}
          className={cn(
            'rounded-full px-4 py-2 text-sm font-semibold backdrop-blur',
            emoteOpen ? 'bg-fuchsia-500 text-white' : 'bg-white/10 hover:bg-white/20',
          )}
        >
          🎭 Emotes
        </button>
      </div>

      {/* tap a player: pick your mischief */}
      {targetMenu && (
        <div
          className="fixed z-20 w-40 overflow-hidden rounded-xl bg-[#1d1033]/95 ring-1 ring-violet-400/40 backdrop-blur"
          style={{ left: Math.min(targetMenu.x, window.innerWidth - 170), top: Math.min(targetMenu.y, window.innerHeight - 160) }}
        >
          <div className="border-b border-violet-400/20 px-3 py-1.5 text-xs font-bold text-violet-200">
            {targetMenu.name}
          </div>
          {(
            [
              ['👉 Shove', 'shove'],
              ['🖐️ Slap', 'slap'],
              ['🪙 Throw a chip', 'chip'],
            ] as const
          ).map(([label, kind]) => (
            <button
              key={kind}
              onClick={() => {
                if (kind === 'shove') wsClient.send({ t: 'poke', targetSeat: targetMenu.seat });
                else wsClient.send({ t: 'emote', kind, targetSeat: targetMenu.seat });
                setTargetMenu(null);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10"
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => setTargetMenu(null)}
            className="block w-full px-3 py-1.5 text-left text-xs text-violet-300/60 hover:bg-white/10"
          >
            Never mind
          </button>
        </div>
      )}

      {/* camera presets */}
      <div className="absolute bottom-28 left-3 z-10 flex flex-col gap-1.5">
        {(
          [
            ['Seat', [0, 5.2, 8.6], [0, 0.5, 0]],
            ['Top', [0, 14, 0.01], [0, 1, 0]],
            ['Side', [11.5, 3.2, 0], [0, 1, 0]],
            ['Close', [0, 2.4, 5.2], [0, 1, 0.4]],
          ] as [string, [number, number, number], [number, number, number]][]
        ).map(([label, pos, look]) => (
          <button
            key={label}
            onClick={() => flyRef.current?.(pos, look)}
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold backdrop-blur hover:bg-white/20"
          >
            {label}
          </button>
        ))}
      </div>

      {/* HUD: the same live controls as the 2D table */}
      {room && (
        <div className="absolute inset-x-0 bottom-0 z-10 mx-auto max-w-5xl p-3">
          <ActionBar mySeat={mySeat} isHost={!!isHost} urgent={urgent} hideIdleStart={false} />
        </div>
      )}
    </div>
  );
}
