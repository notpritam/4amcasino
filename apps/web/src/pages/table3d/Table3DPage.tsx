// ABOUTME: The table as a three.js world - light-purple cyberpunk room, procedural
// ABOUTME: customisable characters at every seat, live cards/chips/turn state from
// ABOUTME: the same store as the 2D table, fully playable via the HUD action bar.
// ABOUTME: Requested by notpritam - see docs/FEATURES.md.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RANKS, rankOf, suitOf, type CardId } from '@4am/shared';
import { wsClient } from '../../shared/ws.ts';
import { useStore } from '../../shared/store.ts';
import { play } from '../../shared/sounds.ts';
import { cn } from '../../shared/lib/cn.ts';
import { ActionBar } from '../../widgets/table/ActionBar.tsx';
import { ATTACKS, EMOTES, type EmoteKind } from './emotes.ts';

import {
  ArrowLeft,
  Camera,
  Check,
  ChatCircleDots,
  ChatCircle,
  DotsThree,
  SignOut,
  Question,
  HandWaving,
  SlidersHorizontal,
  SpeakerHigh,
  SpeakerSlash,
  Users,
  X,
} from '@phosphor-icons/react';
import { BankControls } from '../../widgets/table/BankControls.tsx';
import { LastHandStrip } from '../../widgets/table/LastHandStrip.tsx';
import { Dialog } from '../../shared/ui/index.tsx';
import { TablePage, type TablePresentation } from '../table/TablePage.tsx';
import { TableCards } from './TableCards.tsx';
import { publicCardsBySeat } from './publicTableCards.ts';
import { soundsEnabled, setSoundsEnabled } from '../../shared/sounds.ts';
import { parseAvatar } from './avatar.ts';
import { buildCharacter, disposeObject, idleCharacter } from './character.ts';
import { Wardrobe } from './Wardrobe.tsx';
import './table3d.css';

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
    new THREE.MeshBasicMaterial({
      map: cardTexture(id),
      transparent: true,
      side: THREE.DoubleSide,
    }),
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
        new THREE.MeshStandardMaterial({
          color: CHIP_COLORS[tier],
          roughness: 0.35,
          metalness: 0.2,
        }),
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
  return <TablePage renderTable={(table) => <Table3DView table={table} />} />;
}

function Table3DView({ table }: { table: TablePresentation }) {
  // lightning flash on every showdown reveal (requested by notpritam)
  const [thunderKey, setThunderKey] = useState(0);
  useEffect(() => {
    const boom = () => {
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setThunderKey((k) => k + 1);
    };
    window.addEventListener('4am-thunder', boom);
    return () => window.removeEventListener('4am-thunder', boom);
  }, []);
  const { id: roomId } = useParams<{ id: string }>();
  const mountRef = useRef<HTMLDivElement>(null);
  const room = useStore((s) => s.room);
  const hand = useStore((s) => s.hand);
  const auth = useStore((s) => s.auth);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const flyRef = useRef<
    ((pos: [number, number, number], look: [number, number, number]) => void) | null
  >(null);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [targetMenu, setTargetMenu] = useState<{
    seat: number;
    name: string;
    x: number;
    y: number;
  } | null>(null);
  const targetMenuRef = useRef(setTargetMenu);
  targetMenuRef.current = setTargetMenu;
  const [panel, setPanel] = useState<'players' | 'help' | null>(null);
  const [cameraView, setCameraView] = useState('Table');
  const [soundOn, setSoundOn] = useState(soundsEnabled);
  const [sceneError, setSceneError] = useState('');
  const [kickArmed, setKickArmed] = useState<number | null>(null);
  const [reaction, setReaction] = useState('');
  const reactionTimer = useRef<ReturnType<typeof setTimeout>>();
  const connected = useStore((s) => s.wsConnected);
  const characterButton = useRef<HTMLButtonElement>(null);
  const activeRoom = room?.room.id === roomId ? room : null;

  const me = activeRoom?.players.find((p) => p.userId === auth.userId);
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
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      setCustomizeOpen(false);
      setEmoteOpen(false);
      setPanel(null);
      setTargetMenu(null);
      characterButton.current?.focus();
    };
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
      clearTimeout(reactionTimer.current);
    };
  }, []);

  /* the whole three.js world lives in this effect */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    setSceneError('');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x150b26);
    scene.fog = new THREE.Fog(0x150b26, 16, 44);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
    camera.position.set(0, 5.2, 8.6);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setSceneError(
        'Your device could not start the 3D view. You can keep playing at the 2D table.',
      );
      return;
    }
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let alive = true;
    const auxiliaryFrames = new Set<number>();
    const timeouts = new Set<ReturnType<typeof setTimeout>>();
    const nextFrame = (fn: FrameRequestCallback) => {
      const id = requestAnimationFrame((time) => {
        auxiliaryFrames.delete(id);
        if (alive) fn(time);
      });
      auxiliaryFrames.add(id);
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setSceneError('The 3D view paused. Reload to restore it, or continue at the 2D table.');
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 700 ? 1.5 : 1.75));
    // the Blender-style setup: an environment map for image-based lighting,
    // filmic tone mapping, and a shadow-casting sun
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentScene = new RoomEnvironment();
    const environmentTarget = pmrem.fromScene(environmentScene, 0.04);
    environmentScene.dispose();
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.4;
    mount.appendChild(renderer.domElement);

    const sun = new THREE.DirectionalLight(0xd8c7ff, 2.2);
    sun.position.set(7, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
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
    controls.maxDistance = 36;
    controls.enablePan = true;
    controls.keyPanSpeed = 14;
    // Camera keys never intercept sliders or text controls. Drag/touch uses OrbitControls.

    // smooth fly-to for the camera preset buttons
    let cameraPreset: { pos: [number, number, number]; look: [number, number, number] } = {
      pos: [0, 6.5, 10.8],
      look: [0, 0.7, 0],
    };
    let flyPos: THREE.Vector3 | null = null;
    let flyLook: THREE.Vector3 | null = null;
    const fly = (pos: [number, number, number], look: [number, number, number]) => {
      cameraPreset = { pos, look };
      flyPos = new THREE.Vector3(...pos);
      flyLook = new THREE.Vector3(...look);
      const fit = Math.max(1, 1.5 / camera.aspect);
      flyPos.sub(flyLook).multiplyScalar(Math.min(fit, 2.3)).add(flyLook);
      if (motion.matches) {
        camera.position.copy(flyPos);
        controls.target.copy(flyLook);
        flyPos = null;
        flyLook = null;
      }
    };
    flyRef.current = fly;
    const stopFly = () => {
      flyPos = null;
      flyLook = null;
    };
    controls.addEventListener('start', stopFly);

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
      for (let iy = 0; iy < 4; iy++)
        (cc.beginPath(), cc.arc(ix * 64 + 32, iy * 64 + 32, 5, 0, 7), cc.fill());
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
        new THREE.MeshStandardMaterial({
          color: 0xe879f9,
          emissive: 0xe879f9,
          emissiveIntensity: 0.8,
        }),
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
      new THREE.MeshStandardMaterial({
        color: 0x1a0b2e,
        emissive: 0xa78bfa,
        emissiveIntensity: 1.5,
      }),
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

    // a roulette wheel spinning in the corner
    const rouletteCanvas = document.createElement('canvas');
    rouletteCanvas.width = 256;
    rouletteCanvas.height = 256;
    const rc = rouletteCanvas.getContext('2d')!;
    for (let i = 0; i < 18; i++) {
      rc.fillStyle = i % 2 ? '#7c3aed' : i % 3 ? '#1c1132' : '#e879f9';
      rc.beginPath();
      rc.moveTo(128, 128);
      rc.arc(128, 128, 126, (i / 18) * Math.PI * 2, ((i + 1) / 18) * Math.PI * 2);
      rc.fill();
    }
    rc.fillStyle = '#f5d0fe';
    rc.beginPath();
    rc.arc(128, 128, 26, 0, Math.PI * 2);
    rc.fill();
    const rouletteTex = new THREE.CanvasTexture(rouletteCanvas);
    rouletteTex.colorSpace = THREE.SRGBColorSpace;
    const roulette = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.28, 36), [
      new THREE.MeshStandardMaterial({ color: 0x2b1650, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ map: rouletteTex, roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: 0x2b1650 }),
    ]);
    roulette.position.set(-R + 5, 1.05, -R + 7.5);
    roulette.castShadow = true;
    scene.add(roulette);
    const rouletteStand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.9, 0.95, 16),
      new THREE.MeshStandardMaterial({ color: 0x190d2e }),
    );
    rouletteStand.position.set(-R + 5, 0.45, -R + 7.5);
    scene.add(rouletteStand);

    // holo cards orbiting above the bar
    const holoGroup = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const holo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 1.25),
        new THREE.MeshBasicMaterial({
          map: cardTexture(((i * 17 + 12) % 52) as CardId),
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        }),
      );
      holo.userData.phase = (i / 3) * Math.PI * 2;
      holoGroup.add(holo);
    }
    holoGroup.position.set(0, 3.4, R - 3.4);
    scene.add(holoGroup);

    // JACKPOT sign that blinks
    const jkCanvas = document.createElement('canvas');
    jkCanvas.width = 512;
    jkCanvas.height = 128;
    const jk = jkCanvas.getContext('2d')!;
    jk.shadowColor = '#fbbf24';
    jk.shadowBlur = 26;
    jk.fillStyle = '#fde68a';
    jk.font = '700 84px system-ui';
    jk.textAlign = 'center';
    jk.fillText('JACKPOT', 256, 94);
    const jkTex = new THREE.CanvasTexture(jkCanvas);
    jkTex.colorSpace = THREE.SRGBColorSpace;
    const jackpot = new THREE.Sprite(new THREE.SpriteMaterial({ map: jkTex, transparent: true }));
    jackpot.scale.set(4.4, 1.1, 1);
    jackpot.position.set(-(R - 1.4) * 0.7, 6.2, -(R - 1.4) * 0.7);
    scene.add(jackpot);

    // two spotlights slowly sweeping the room
    const sweepers: { light: THREE.SpotLight; phase: number }[] = [];
    for (let i = 0; i < 2; i++) {
      const spot = new THREE.SpotLight(i ? 0xe879f9 : 0xa78bfa, 120, 30, 0.35, 0.5);
      spot.position.set(0, 8.6, 0);
      const target = new THREE.Object3D();
      scene.add(target);
      spot.target = target;
      scene.add(spot);
      sweepers.push({ light: spot, phase: i * Math.PI });
    }

    // drifting dust motes
    const moteCount = 220;
    const motePos = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++)
      motePos.set(
        [(Math.random() - 0.5) * 30, Math.random() * 7 + 0.5, (Math.random() - 0.5) * 30],
        i * 3,
      );
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
    const motes = new THREE.Points(
      moteGeo,
      new THREE.PointsMaterial({ color: 0xc4b5fd, size: 0.045, transparent: true, opacity: 0.5 }),
    );
    scene.add(motes);

    // framed wall art
    for (const [glyph, ang] of [
      ['♛', 0.95],
      ['♚', 2.2],
      ['★', 4.1],
    ] as const) {
      const artCanvas = document.createElement('canvas');
      artCanvas.width = 128;
      artCanvas.height = 160;
      const ac = artCanvas.getContext('2d')!;
      ac.fillStyle = '#241245';
      ac.fillRect(0, 0, 128, 160);
      ac.fillStyle = '#c4b5fd';
      ac.font = '84px system-ui';
      ac.textAlign = 'center';
      ac.fillText(glyph, 64, 110);
      const artTex = new THREE.CanvasTexture(artCanvas);
      artTex.colorSpace = THREE.SRGBColorSpace;
      const art = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 2),
        new THREE.MeshStandardMaterial({
          map: artTex,
          emissive: 0x4c1d95,
          emissiveIntensity: 0.35,
        }),
      );
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(1.85, 2.25, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x3b2168, metalness: 0.5, roughness: 0.4 }),
      );
      const artAngle = ang;
      frame.position.set(Math.cos(artAngle) * (R - 0.35), 4.4, Math.sin(artAngle) * (R - 0.35));
      frame.lookAt(0, 4.4, 0);
      art.position
        .copy(frame.position)
        .addScaledVector(frame.position.clone().setY(0).normalize(), -0.06);
      art.position.y = 4.4;
      art.lookAt(0, 4.4, 0);
      scene.add(frame);
      scene.add(art);
    }

    // the bar cat, obviously
    const cat = new THREE.Group();
    const catMat = new THREE.MeshStandardMaterial({ color: 0x312244, roughness: 0.9 });
    const catBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.3, 4, 10), catMat);
    catBody.rotation.z = Math.PI / 2;
    catBody.position.y = 0.13;
    cat.add(catBody);
    const catHead = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), catMat);
    catHead.position.set(0.28, 0.22, 0);
    cat.add(catHead);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.09, 6), catMat);
      ear.position.set(0.28, 0.34, side * 0.06);
      cat.add(ear);
    }
    const catEyes = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 0.14),
      new THREE.MeshStandardMaterial({
        color: 0xe879f9,
        emissive: 0xe879f9,
        emissiveIntensity: 1.6,
      }),
    );
    catEyes.position.set(0.38, 0.24, 0);
    cat.add(catEyes);
    const catTail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.4, 8), catMat);
    catTail.position.set(-0.3, 0.28, 0);
    catTail.rotation.z = -0.7;
    cat.add(catTail);
    cat.position.set(1.9, 1.16, R - 3.4);
    cat.rotation.y = Math.PI * 0.8;
    scene.add(cat);

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
      new THREE.TorusGeometry(3.04, 0.14, 12, 80),
      new THREE.MeshStandardMaterial({ color: 0x1d132c, roughness: 0.45, metalness: 0.2 }),
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

    // A tailored felt surface: double inlay, a quiet brand mark, and a padded rail.
    const feltCanvas = document.createElement('canvas');
    feltCanvas.width = feltCanvas.height = 1024;
    const feltInk = feltCanvas.getContext('2d')!;
    feltInk.fillStyle = '#23183b';
    feltInk.fillRect(0, 0, 1024, 1024);
    for (const radius of [466, 453]) {
      feltInk.beginPath();
      feltInk.arc(512, 512, radius, 0, Math.PI * 2);
      feltInk.strokeStyle = radius === 466 ? '#817052' : '#4f3a65';
      feltInk.lineWidth = 2;
      feltInk.stroke();
    }
    feltInk.textAlign = 'center';
    feltInk.fillStyle = '#71607e';
    feltInk.font = '600 48px sans-serif';
    feltInk.fillText('4 A M', 512, 700);
    feltInk.font = '500 17px sans-serif';
    feltInk.fillStyle = '#9885a5';
    feltInk.fillText('A SEAT AT YOUR TABLE', 512, 734);
    const feltMap = new THREE.CanvasTexture(feltCanvas);
    feltMap.colorSpace = THREE.SRGBColorSpace;
    feltMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const feltSurface = new THREE.Mesh(
      new THREE.CircleGeometry(2.97, 80),
      new THREE.MeshStandardMaterial({ map: feltMap, roughness: 0.95 }),
    );
    feltSurface.rotation.x = -Math.PI / 2;
    feltSurface.scale.x = 1.55;
    feltSurface.position.y = FELT_TOP + 0.003;
    feltSurface.receiveShadow = true;
    scene.add(feltSurface);
    const underglow = new THREE.Mesh(
      new THREE.TorusGeometry(3.025, 0.022, 8, 80),
      new THREE.MeshStandardMaterial({
        color: 0xa78bfa,
        emissive: 0xa78bfa,
        emissiveIntensity: 0.6,
      }),
    );
    underglow.rotation.x = Math.PI / 2;
    underglow.scale.x = 1.55;
    underglow.position.y = 0.78;
    scene.add(underglow);

    /* everything live rebuilds into this group */
    const dynamic = new THREE.Group();
    scene.add(dynamic);
    const turnRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.05, 10, 40),
      new THREE.MeshStandardMaterial({
        color: 0xe879f9,
        emissive: 0xe879f9,
        emissiveIntensity: 1.6,
      }),
    );
    turnRing.rotation.x = Math.PI / 2;
    turnRing.visible = false;
    scene.add(turnRing);
    // a bobbing arrow over the head of whoever is up
    const turnArrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.42, 4),
      new THREE.MeshStandardMaterial({
        color: 0xe879f9,
        emissive: 0xe879f9,
        emissiveIntensity: 1.8,
      }),
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
    // newly dealt cards drop onto the felt and flip from back to face; a
    // rebuild mid-flip just snaps the fresh mesh to its landed pose
    const cardAnims: {
      mesh: THREE.Mesh;
      t0: number;
      dur: number;
      baseY: number;
      baseRX: number;
    }[] = [];
    const spawnCard = (mesh: THREE.Mesh, key: string, delayMs: number) => {
      if (motion.matches || !key || seen.has(key)) return;
      seen.add(key);
      mesh.visible = false;
      cardAnims.push({
        mesh,
        t0: performance.now() + delayMs,
        dur: 520,
        baseY: mesh.position.y,
        baseRX: mesh.rotation.x,
      });
    };
    const particles: { pts: THREE.Points; vel: Float32Array; t0: number; dur: number }[] = [];

    const burst = (at: THREE.Vector3, color: number, count: number, spread: number, up: number) => {
      if (motion.matches) return;
      const pos = new Float32Array(count * 3);
      const vel = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos.set([at.x, at.y, at.z], i * 3);
        vel.set(
          [
            (Math.random() - 0.5) * spread,
            Math.random() * up + 0.5,
            (Math.random() - 0.5) * spread,
          ],
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
      const timeout = setTimeout(() => {
        timeouts.delete(timeout);
        scene.remove(sp);
        sp.material.map?.dispose();
        sp.material.dispose();
      }, 900);
      timeouts.add(timeout);
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
        if (!motion.matches) {
          sp.position.y = at.y + 2.3 + lifeP * 0.6;
          sp.material.opacity = 1 - lifeP;
        }
        nextFrame(rise);
      };
      rise();
    };

    const onEmote = (e: Event) => {
      const d = (e as CustomEvent<{ fromSeat: number | null; kind: string; targetSeat?: number }>)
        .detail;
      if (d.kind in ATTACKS && d.targetSeat !== undefined) {
        // wind-up on the attacker, impact on the target
        if (d.fromSeat !== null)
          anims.push({ kind: 'emote', emote: 'wave', seat: d.fromSeat, t0: performance.now() });
        anims.push({ kind: d.kind as 'slap' | 'chip', seat: d.targetSeat, t0: performance.now() });
        play(ATTACKS[d.kind]!.sound);
        const home = homeBySeat.get(d.targetSeat);
        if (home) powSprite(home);
        if (d.kind === 'chip' && d.fromSeat !== null && !motion.matches) {
          const from = homeBySeat.get(d.fromSeat);
          if (from && home) {
            const chip = new THREE.Mesh(
              new THREE.CylinderGeometry(0.13, 0.13, 0.05, 16),
              new THREE.MeshStandardMaterial({
                color: 0xfbbf24,
                emissive: 0xb45309,
                emissiveIntensity: 0.4,
              }),
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
              nextFrame(flyChip);
            };
            flyChip();
          }
        }
        return;
      }
      const def = EMOTES[d.kind as EmoteKind];
      if (def && d.fromSeat !== null) {
        anims.push({ kind: 'emote', emote: d.kind, seat: d.fromSeat, t0: performance.now() });
        if (def.sound) play(def.sound);
        const home = homeBySeat.get(d.fromSeat);
        if (home) emoteSprite(home, def.sprite ?? def.emoji);
      }
    };
    window.addEventListener('4am-emote', onEmote);
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

    const disposeDeep = disposeObject;

    let dirty = true;
    const rebuild = () => {
      dirty = false;
      renderer.shadowMap.needsUpdate = true;
      cardAnims.length = 0;
      // Keep rigs alive across betting/connection updates. Dispose only replaced looks.
      charBySeat.forEach((character) => dynamic.remove(character));
      disposeDeep(dynamic);
      dynamic.clear();
      homeBySeat.clear();
      const st = useStore.getState();
      const r = st.room;
      if (!r || r.room.id !== roomId) {
        charBySeat.forEach(disposeDeep);
        charBySeat.clear();
        return;
      }
      const h = st.hand;
      const betting = h.betting;
      const myId = st.auth.userId;

      const seated = r.players.filter((p) => p.seat !== null).sort((a, b) => a.seat! - b.seat!);
      let order = seated;
      const meIdx = seated.findIndex((p) => p.userId === myId);
      if (meIdx > 0) order = [...seated.slice(meIdx), ...seated.slice(0, meIdx)];
      const n = Math.max(order.length, 1);
      const currentSeats = new Set(order.map((player) => player.seat!));
      for (const [seat, character] of charBySeat)
        if (!currentSeats.has(seat)) {
          disposeDeep(character);
          charBySeat.delete(seat);
        }

      turnRing.visible = false;
      turnArrow.visible = false;
      if (seen.size > 600) seen.clear();
      order.forEach((p, i) => {
        const a = Math.PI / 2 + (i / n) * Math.PI * 2;
        const px = Math.cos(a) * 5.6;
        const pz = Math.sin(a) * 4.1;
        const engine = betting?.seats.find((s) => s.seat === p.seat);
        const inHand = h.handId !== null && !h.abort && h.seats.some((s) => s.seat === p.seat);
        const folded = !!engine?.folded;

        const cfg = parseAvatar(p.avatar3d);
        const signature = JSON.stringify([cfg, folded, p.sittingOut]);
        let char = charBySeat.get(p.seat!);
        if (!char || char.userData.signature !== signature) {
          if (char) disposeDeep(char);
          char = buildCharacter(cfg, folded || !!p.sittingOut);
          char.userData.signature = signature;
        }
        const previousCards = char.getObjectByName('held-cards');
        if (previousCards) {
          char.remove(previousCards);
          disposeDeep(previousCards);
        }
        char.position.set(px, 0, pz);
        char.rotation.y = Math.atan2(px, pz) + Math.PI;
        delete char.userData.pokeSeat;
        delete char.userData.pokeName;
        if (p.userId !== myId) {
          char.userData.pokeSeat = p.seat;
          char.userData.pokeName = p.displayName;
        }
        charBySeat.set(p.seat!, char);
        homeBySeat.set(p.seat!, new THREE.Vector3(px, 0, pz));
        dynamic.add(char);
        const chair = new THREE.Group();
        const upholstery = new THREE.MeshStandardMaterial({
          color: 0x21172f,
          metalness: 0.15,
          roughness: 0.75,
        });
        const chairSeat = new THREE.Mesh(
          new THREE.CylinderGeometry(0.44, 0.4, 0.12, 24),
          upholstery,
        );
        chairSeat.position.set(0, 0.38, -0.12);
        const chairBack = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.27, 4, 16), upholstery);
        chairBack.scale.z = 0.32;
        chairBack.position.set(0, 0.76, -0.36);
        const chairStem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.08, 0.33, 12),
          new THREE.MeshStandardMaterial({ color: 0x554664, metalness: 0.8, roughness: 0.3 }),
        );
        chairStem.position.set(0, 0.18, -0.12);
        chair.add(chairSeat, chairBack, chairStem);
        chair.position.set(px, 0, pz);
        chair.rotation.y = char.rotation.y;
        dynamic.add(chair);

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
          turnArrow.visible = p.userId !== myId;
          turnArrow.position.set(px, 3.25, pz);
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
          label.position.set(px, 2.65, pz);
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
        const publicCards = publicCardsBySeat(h)[p.seat!];
        if ((inHand && !folded) || publicCards) {
          const held = new THREE.Group();
          held.name = 'held-cards';
          for (let ci = 0; ci < 2; ci++) {
            const hc = makeCard(publicCards?.[ci] ?? null, publicCards ? 0.32 : 0.22, 0);
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
        // the flop cascades left to right; turn and river flip on arrival
        spawnCard(
          cardMesh,
          h.handId ? `${h.handId}:b:${i}` : '',
          h.board.length === 3 ? i * 150 : 0,
        );
      });
      // run it twice: the second board sits one row behind the first
      h.board2.forEach((cardId, i) => {
        const cardMesh = makeCard(cardId, 0.5, 0.14);
        cardMesh.position.x = (i - 2) * 0.6;
        cardMesh.position.z = -0.62;
        dynamic.add(cardMesh);
        spawnCard(cardMesh, h.handId ? `${h.handId}:b2:${i}` : '', 0);
      });
      const mySeatNow = r.players.find((p) => p.userId === myId)?.seat ?? null;
      if (mySeatNow !== null && h.myCards.length > 0 && h.handId) {
        h.myCards.forEach((cardId, i) => {
          const mine = makeCard(cardId, 0.72, 0.55);
          mine.position.x = (i - 0.5) * 0.8;
          mine.position.z = 2.0;
          dynamic.add(mine);
          spawnCard(mine, `${h.handId}:mine:${i}`, i * 140);
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
          new THREE.SpriteMaterial({
            map: labelTexture('POT', String(pot), '#e879f9'),
            transparent: true,
          }),
        );
        potLabel.scale.set(1.5, 0.56, 1);
        potLabel.position.set(0, 1.85, -1.15);
        dynamic.add(potLabel);
      }
      dynamic.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
    };

    const unsub = useStore.subscribe((state, previous) => {
      if (
        state.room !== previous.room ||
        state.hand !== previous.hand ||
        state.auth.userId !== previous.auth.userId
      )
        dirty = true;
    });

    const size = () => {
      const w = mount.clientWidth;
      const hgt = mount.clientHeight;
      if (!w || !hgt) return;
      renderer.setSize(w, hgt);
      camera.aspect = w / hgt;
      camera.updateProjectionMatrix();
      fly(cameraPreset.pos, cameraPreset.look);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(mount);

    let raf = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (dirty) rebuild();
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = motion.matches ? 0 : clock.elapsedTime;
      if (turnRing.visible) {
        const pulse = 1 + Math.sin(t * 5) * 0.12;
        turnRing.scale.set(pulse, pulse, 1);
        (turnRing.material as THREE.MeshStandardMaterial).emissiveIntensity =
          1.2 + Math.sin(t * 5) * 0.7;
        turnArrow.position.y = 3.25 + Math.sin(t * 4) * 0.14;
        turnArrow.rotation.y = t * 2;
      }

      const nowMs = performance.now();
      // every character starts each frame at its base pose, breathes a little,
      // then active animations write absolute offsets on top - nothing drifts
      for (const [seat, char] of charBySeat) {
        const home = homeBySeat.get(seat);
        if (!home) continue;
        char.position.copy(home);
        char.rotation.set(0, Math.atan2(home.x, home.z) + Math.PI, 0); // face center, stand upright
        char.scale.setScalar(1);
        idleCharacter(char, t, seat, motion.matches);
      }
      // dealt cards: drop from above while flipping face-down → face-up
      for (let i = cardAnims.length - 1; i >= 0; i--) {
        const ca = cardAnims[i]!;
        const cp = (nowMs - ca.t0) / ca.dur;
        if (cp < 0) {
          ca.mesh.visible = false;
          continue;
        }
        if (cp >= 1 || !ca.mesh.parent) {
          ca.mesh.visible = true;
          ca.mesh.position.y = ca.baseY;
          ca.mesh.rotation.x = ca.baseRX;
          cardAnims.splice(i, 1);
          continue;
        }
        ca.mesh.visible = true;
        const ease = 1 - Math.pow(1 - cp, 3);
        ca.mesh.position.y = ca.baseY + (1 - ease) * 0.8;
        ca.mesh.rotation.x = ca.baseRX + (1 - ease) * Math.PI;
      }
      for (let i = anims.length - 1; i >= 0; i--) {
        const anim = anims[i]!;
        const char = charBySeat.get(anim.seat);
        const home = homeBySeat.get(anim.seat);
        const dur =
          anim.kind === 'emote'
            ? (EMOTES[(anim.emote ?? '') as EmoteKind]?.dur ?? 1600)
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
        if (motion.matches || !char || !home || prog >= 1) {
          anims.splice(i, 1);
          continue;
        }
        const wave = Math.sin(Math.PI * prog);
        const away = home.clone().normalize();
        if (anim.kind === 'emote') {
          const def = EMOTES[(anim.emote ?? '') as EmoteKind];
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
            positions.getX(j) + pt.vel[j * 3]! * dt,
            positions.getY(j) + (pt.vel[j * 3 + 1]! - life * 2.2) * dt,
            positions.getZ(j) + pt.vel[j * 3 + 2]! * dt,
          );
        }
        positions.needsUpdate = true;
        (pt.pts.material as THREE.PointsMaterial).opacity = 1 - life;
      }

      roulette.rotation.y = t * 0.7;
      holoGroup.children.forEach((holo, hi) => {
        const ph = (holo.userData.phase as number) + t * 0.6;
        holo.position.set(Math.cos(ph) * 1.5, Math.sin(t * 1.2 + hi) * 0.25, Math.sin(ph) * 1.5);
        holo.rotation.y = ph + Math.PI / 2;
      });
      jackpot.material.opacity = 0.86;
      for (const sw of sweepers) {
        sw.light.target.position.set(
          Math.cos(t * 0.5 + sw.phase) * 9,
          0,
          Math.sin(t * 0.5 + sw.phase) * 9,
        );
        sw.light.target.updateMatrixWorld();
      }
      motes.rotation.y = t * 0.02;
      catTail.rotation.x = Math.sin(t * 2.2) * 0.5;
      if (flyPos && flyLook) {
        camera.position.lerp(flyPos, 1 - Math.exp(-7 * dt));
        controls.target.lerp(flyLook, 1 - Math.exp(-7 * dt));
        if (camera.position.distanceTo(flyPos) < 0.05) {
          flyPos = null;
          flyLook = null;
        }
      }
      if (anims.length > 0 && !motion.matches) renderer.shadowMap.needsUpdate = true;
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      auxiliaryFrames.forEach(cancelAnimationFrame);
      timeouts.forEach(clearTimeout);
      window.removeEventListener('4am-emote', onEmote);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      flyRef.current = null;
      window.removeEventListener('4am-poke', onPoke);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      unsub();
      ro.disconnect();
      controls.dispose();
      disposeDeep(scene);
      environmentTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const pot = hand.betting?.seats.reduce((total, seat) => total + seat.total, 0) ?? 0;
  const handActive = !!hand.handId && !hand.result && !hand.abort;
  const myTurn = mySeat !== null && handActive && hand.betting?.toAct === mySeat;
  const actingName = activeRoom?.players.find(
    (player) => player.seat === hand.betting?.toAct,
  )?.displayName;
  const status = !connected
    ? 'Reconnecting…'
    : hand.abort
      ? 'Hand ended'
      : hand.result
        ? 'Hand complete'
        : myTurn
          ? 'Your turn'
          : handActive
            ? (table.status ?? `${actingName ?? 'Table'} is thinking`)
            : 'Waiting for the next hand';
  const seconds = hand.deadline ? Math.max(0, Math.ceil((hand.deadline - now) / 1000)) : null;
  const closeStudio = () => {
    setCustomizeOpen(false);
    characterButton.current?.focus();
  };
  const sendReaction = (kind: EmoteKind) => {
    if (!connected || mySeat === null) return;
    wsClient.send({ t: 'emote', kind });
    setEmoteOpen(false);
    setReaction(`${EMOTES[kind]?.label ?? 'Reaction'} sent`);
    clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => setReaction(''), 2200);
  };

  return (
    <div
      className={cn(
        'table3d-lounge dark',
        myTurn && 'is-my-turn',
        hand.myCards.length > 0 && mySeat !== null && 'has-private-hand',
      )}
    >
      <header className="lounge-header">
        <Link
          to={`/room/${roomId}`}
          className="lounge-button back-to-table"
          aria-label="2D table"
          title="Switch to 2D table"
        >
          <ArrowLeft size={17} />
          <span>2D table</span>
        </Link>
        <div className="lounge-title">
          <h1>{activeRoom?.room.name ?? 'Your table'}</h1>
          <span>
            <i className={connected ? 'connection-dot connected' : 'connection-dot'} />
            {connected ? 'Connected' : 'Reconnecting'}
            <b>·</b>
            {activeRoom ? `${activeRoom.room.sb} / ${activeRoom.room.bb} blinds` : 'Joining table'}
          </span>
        </div>
        <div className="lounge-room-tools">
          {!table.amSpectator && <BankControls roomId={roomId!} mode="hub" />}
          {table.voiceControl}
          <button
            className="lounge-icon chat-trigger"
            aria-label={
              table.unreadChat ? `Open chat, ${table.unreadChat} unread messages` : 'Open chat'
            }
            aria-expanded={table.chatOpen}
            onClick={() => table.setChatOpen(true)}
          >
            <ChatCircle size={20} />
            {table.unreadChat > 0 && (
              <span className="lounge-unread">
                {table.unreadChat > 9 ? '9+' : table.unreadChat}
              </span>
            )}
          </button>
          <button
            className="lounge-button table-controls-trigger"
            aria-label="More table controls"
            aria-expanded={table.menuOpen}
            onClick={() => {
              table.setMenuOpen(true);
              setCustomizeOpen(false);
              setPanel(null);
              setEmoteOpen(false);
            }}
          >
            <DotsThree size={22} />
            <span>Table</span>
          </button>
        </div>
        <button
          className="lounge-icon sound-toggle"
          aria-label={soundOn ? 'Mute sound' : 'Enable sound'}
          aria-pressed={soundOn}
          onClick={() => {
            setSoundsEnabled(!soundOn);
            setSoundOn(!soundOn);
          }}
        >
          {soundOn ? <SpeakerHigh size={19} /> : <SpeakerSlash size={19} />}
        </button>
        <button
          ref={characterButton}
          className="lounge-button character-trigger"
          aria-expanded={customizeOpen}
          onClick={() => {
            setCustomizeOpen(!customizeOpen);
            setPanel(null);
            setEmoteOpen(false);
            setTargetMenu(null);
          }}
        >
          <SlidersHorizontal size={18} />
          <span>Your character</span>
        </button>
      </header>

      <main className="lounge-stage" aria-label="3D poker table">
        <div
          ref={mountRef}
          className="lounge-canvas"
          aria-label="3D casino. Drag to orbit. Use the camera buttons to change view."
        />
        {thunderKey > 0 && <div key={thunderKey} className="thunder-flash" aria-hidden="true" />}
        <div className="table-readout">
          <span>{handActive ? (hand.betting?.street ?? 'Dealing') : 'Texas Hold’em'}</span>
          <strong>
            {pot.toLocaleString()} <small>in the pot</small>
          </strong>
        </div>
        {sceneError && (
          <div className="scene-message" role="status">
            <h2>The 3D scene is unavailable</h2>
            <p>{sceneError}</p>
            <Link className="lounge-button primary" to={`/room/${roomId}`}>
              Open 2D table
            </Link>
          </div>
        )}
        {(table.runTwice || table.seatPicker) && (
          <div className="lounge-game-prompt">
            <fieldset disabled={!connected}>
              {table.runTwice}
              {table.seatPicker}
            </fieldset>
          </div>
        )}
        {!customizeOpen && (
          <div className="camera-controls" aria-label="Camera view">
            <Camera size={16} />
            {(
              [
                ['Table', [0, 6.5, 10.8], [0, 0.7, 0]],
                ['Overhead', [0, 15, 0.01], [0, 1, 0]],
                ['Side', [12, 5, 3], [0, 1, 0]],
                ['Close', [0, 3.6, 7.4], [0, 1, 0]],
              ] as [string, [number, number, number], [number, number, number]][]
            ).map(([label, position, look]) => (
              <button
                key={label}
                aria-pressed={cameraView === label}
                onClick={() => {
                  setCameraView(label);
                  flyRef.current?.(position, look);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <span className="orbit-hint">Drag to orbit · Scroll to zoom</span>
        {customizeOpen && <Wardrobe initial={parseAvatar(me?.avatar3d)} onClose={closeStudio} />}
        {panel === 'players' && (
          <section className="lounge-panel players-panel" aria-label="Players at the table">
            <div className="panel-heading">
              <h2>At the table</h2>
              <button
                className="lounge-icon"
                aria-label="Close player list"
                onClick={() => setPanel(null)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="field-hint">Profiles, seats, and table reactions.</p>
            {table.players.map((player) => (
              <div className="lounge-player-entry" key={player.userId}>
                <div className="player-row">
                  <span
                    className="player-color"
                    style={{
                      background: parseAvatar(
                        activeRoom?.players.find((p) => p.userId === player.userId)?.avatar3d,
                      ).c,
                    }}
                  />
                  <span>
                    <Link to={`/players/${player.userId}`}>
                      {player.displayName}
                      {player.userId === auth.userId ? ' · You' : ''}
                    </Link>
                    <small>
                      Seat {player.seat + 1} ·{' '}
                      {player.sittingOut
                        ? 'Sitting out'
                        : !player.connected
                          ? 'Reconnecting'
                          : player.allIn
                            ? 'All-in'
                            : player.folded
                              ? 'Folded'
                              : player.isToAct
                                ? 'Their turn'
                                : 'At the table'}
                    </small>
                  </span>
                  <strong>{player.stack.toLocaleString()}</strong>
                </div>
                <div className="player-detail-row">
                  <span>
                    {[
                      player.isButton && 'Dealer',
                      player.isSB && 'Small blind',
                      player.isBB && 'Big blind',
                      player.speaking && 'Speaking',
                      player.voiceMuted && 'Muted',
                      player.pendingBuy > 0 && `${player.pendingBuy} pending`,
                      hand.readyCheck?.ready.includes(player.userId) && 'Ready',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {player.userId !== auth.userId && (
                    <>
                      <button
                        className="lounge-button"
                        disabled={mySeat === null || !connected}
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          setTargetMenu({
                            seat: player.seat,
                            name: player.displayName,
                            x: rect.right + 8,
                            y: rect.top,
                          });
                        }}
                      >
                        React
                      </button>
                      {table.canManagePlayers && (
                        <button
                          className="lounge-button"
                          disabled={!connected}
                          aria-label={
                            kickArmed === player.userId
                              ? `Confirm stand up ${player.displayName}`
                              : `Stand up ${player.displayName}`
                          }
                          onClick={() => {
                            if (kickArmed === player.userId) {
                              table.standUp(player.userId);
                              setKickArmed(null);
                            } else setKickArmed(player.userId);
                          }}
                        >
                          {kickArmed === player.userId ? 'Confirm stand up' : 'Stand up'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}
        {panel === 'help' && (
          <section className="lounge-panel help-panel" aria-label="3D table help">
            <div className="panel-heading">
              <h2>Make yourself at home</h2>
              <button
                className="lounge-icon"
                aria-label="Close help"
                onClick={() => setPanel(null)}
              >
                <X size={18} />
              </button>
            </div>
            <button
              className="lounge-button"
              onClick={() => {
                setSoundsEnabled(!soundOn);
                setSoundOn(!soundOn);
              }}
            >
              {soundOn ? <SpeakerSlash size={18} /> : <SpeakerHigh size={18} />}
              {soundOn ? 'Mute sound' : 'Enable sound'}
            </button>
            <p>
              Drag to look around. Pinch or scroll to zoom. Camera presets bring you back to the
              action.
            </p>
            <p>
              Tap a character or open Players to send a playful nudge. Reactions are shared with the
              table.
            </p>
            <p>
              Community cards, both runouts, and public reveals stay readable below. Tap your cards
              to enlarge them. Open Table for invites, records, seats, and preferences.
            </p>
            <Link to={`/room/${roomId}`} className="lounge-button">
              Switch to 2D table
            </Link>
          </section>
        )}
        {emoteOpen && (
          <section className="lounge-panel reactions-panel" aria-label="Table reactions">
            <div className="panel-heading">
              <div>
                <h2>Say it with a move</h2>
                <p>Everyone at the table sees it.</p>
              </div>
              <button
                className="lounge-icon"
                aria-label="Close reactions"
                onClick={() => setEmoteOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="reaction-grid">
              {(Object.entries(EMOTES) as [EmoteKind, NonNullable<(typeof EMOTES)[EmoteKind]>][])
                .filter(([kind]) => kind !== 'celebrate')
                .map(([kind, def]) => (
                  <button
                    key={kind}
                    aria-label={def.label}
                    disabled={!connected || mySeat === null}
                    onClick={() => sendReaction(kind)}
                  >
                    <span aria-hidden="true">{def.emoji}</span>
                    {def.label}
                  </button>
                ))}
            </div>
          </section>
        )}
      </main>

      <Dialog open={table.menuOpen} onClose={() => table.setMenuOpen(false)} title="Table controls">
        <div className="lounge-shared-controls">{table.utilities}</div>
        <div className="lounge-extra-controls">
          {table.fullscreenControl}
          <button
            className="lounge-button"
            onClick={() => {
              setSoundsEnabled(!soundOn);
              setSoundOn(!soundOn);
            }}
          >
            {soundOn ? <SpeakerSlash size={17} /> : <SpeakerHigh size={17} />}
            {soundOn ? 'Mute sound' : 'Enable sound'}
          </button>
          <Link to="/lobby" className="lounge-button">
            <SignOut size={17} />
            Leave table
          </Link>
        </div>
      </Dialog>

      {targetMenu && (
        <>
          <button
            className="target-dismiss"
            aria-label="Dismiss player interaction"
            onClick={() => setTargetMenu(null)}
          />
          <section
            className="lounge-panel target-panel"
            aria-label={`Interact with ${targetMenu.name}`}
            style={{
              left: Math.max(12, Math.min(targetMenu.x, window.innerWidth - 232)),
              top: Math.max(80, Math.min(targetMenu.y, window.innerHeight - 245)),
            }}
          >
            <div className="panel-heading">
              <h2>{targetMenu.name}</h2>
              <button
                className="lounge-icon"
                aria-label="Close player interaction"
                onClick={() => setTargetMenu(null)}
              >
                <X size={16} />
              </button>
            </div>
            {(
              [
                ['Shove', 'shove'],
                ['High-energy slap', 'slap'],
                ['Toss a chip', 'chip'],
              ] as const
            ).map(([label, kind]) => (
              <button
                className="target-action"
                disabled={!connected || mySeat === null}
                key={kind}
                onClick={() => {
                  if (kind === 'shove') wsClient.send({ t: 'poke', targetSeat: targetMenu.seat });
                  else wsClient.send({ t: 'emote', kind, targetSeat: targetMenu.seat });
                  setTargetMenu(null);
                }}
              >
                <HandWaving size={17} />
                {label}
              </button>
            ))}
          </section>
        </>
      )}

      <footer className="lounge-footer">
        <div className="lounge-toolbar">
          <div
            className={cn('turn-status', myTurn && 'your-turn', urgent && myTurn && 'urgent')}
            role="status"
          >
            <i className="status-indicator" />
            <span>{status}</span>
            {handActive && seconds !== null && <strong>{seconds}s</strong>}
          </div>
          <div className="lounge-tools">
            <button
              className="lounge-button"
              aria-expanded={panel === 'players'}
              onClick={() => {
                setPanel(panel === 'players' ? null : 'players');
                setCustomizeOpen(false);
                setEmoteOpen(false);
              }}
            >
              <Users size={17} />
              <span>Players</span>
              <small>{activeRoom?.players.filter((p) => p.seat !== null).length ?? 0}</small>
            </button>
            <button
              className="lounge-button"
              aria-expanded={emoteOpen}
              disabled={mySeat === null || !connected}
              onClick={() => {
                setEmoteOpen(!emoteOpen);
                setCustomizeOpen(false);
                setPanel(null);
              }}
            >
              <ChatCircleDots size={18} />
              <span>React</span>
            </button>
            <button
              className="lounge-icon"
              aria-label="How to use the 3D table"
              aria-expanded={panel === 'help'}
              onClick={() => {
                setPanel(panel === 'help' ? null : 'help');
                setCustomizeOpen(false);
                setEmoteOpen(false);
              }}
            >
              <Question size={19} />
            </button>
          </div>
        </div>
        {reaction && (
          <div className="reaction-feedback" role="status">
            <Check size={15} />
            {reaction}
          </div>
        )}
        <TableCards onEnlarge={table.showLargeCards} onResult={table.showResult} />
        {table.peekPanel && (
          <details className="lounge-peek" open={hand.peekOffers.length > 0 ? true : undefined}>
            <summary>
              {hand.peekOffers.length > 0 ? 'Private card offer — respond' : 'Private card peeks'}
            </summary>
            <fieldset disabled={!connected}>{table.peekPanel}</fieldset>
          </details>
        )}
        <div className="play-controls">
          <fieldset className="poker-actions" disabled={!connected}>
            {activeRoom && (
              <ActionBar mySeat={mySeat} isHost={!!isHost} urgent={urgent} hideIdleStart={false} />
            )}
          </fieldset>
        </div>
        <div className="lounge-last-hand">
          <LastHandStrip roomId={roomId!} light />
        </div>
      </footer>
    </div>
  );
}
