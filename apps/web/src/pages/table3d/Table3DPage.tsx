// ABOUTME: The table as a three.js world - open-roof midnight card lounge, procedural
// ABOUTME: customisable characters at every seat, live cards/chips/turn state from
// ABOUTME: the same store as the 2D table, fully playable via the HUD action bar.
// ABOUTME: Requested by notpritam - see docs/FEATURES.md.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  RANKS,
  rankOf,
  suitOf,
  LOUNGE_DESTINATIONS,
  isLoungeWalkable,
  seatExit,
  type LoungePoint,
  type CardId,
} from '@4am/shared';
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
  PersonSimpleWalk,
  Television,
  Armchair,
  CardsThree,
  CaretDown,
  Eye,
  EyeSlash,
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
import {
  buildChair,
  boardPlacement,
  opponentCardPlacement,
  committedChipPlacement,
  privateCardPlacement,
  seatPlacement,
  dealPose,
  orientChair,
} from './layout.ts';
import { buildLounge, createLoungeCutaway } from './scenery.ts';
import { capturePose, blendPose } from './pose.ts';
import {
  CharacterMotions,
  CONTACT_MS,
  chipPosition,
  motionDuration,
  type CharacterMotion,
} from './motion.ts';
import { Wardrobe } from './Wardrobe.tsx';
import { LoungeTV } from './LoungeTV.tsx';
import { LoungeLocomotion, type TravelPose } from './locomotion.ts';
import { posture, walkPose } from './rigPose.ts';
import { isWalkKey, walkDirection, LoungeMoveQueue } from './navigation.ts';
import { CAMERA_VIEWS, cameraPresetFor, isSeatCamera, type CameraView } from './camera.ts';
import './table3d.css';
import './glass-widgets.css';

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
  x.fillStyle = 'rgba(13,31,34,0.92)';
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
      side: THREE.FrontSide,
    }),
  );
  if (id !== null) {
    const back = new THREE.Mesh(
      mesh.geometry,
      new THREE.MeshBasicMaterial({ map: cardTexture(null), transparent: true }),
    );
    back.rotation.y = Math.PI;
    back.position.z = -0.002;
    mesh.add(back);
  }
  mesh.userData.cardWidth = w;
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

function buildChips(amount: number, bb: number, compact = false): THREE.Group {
  const g = new THREE.Group();
  const counts = chipSplit(amount, bb);
  let col = 0;
  let level = 0;
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
      chip.position.set(compact ? 0 : col * 0.3, 0.03 + (compact ? level++ : i) * 0.05, 0);
      g.add(chip);
    }
    col++;
  });
  if (!compact)
    g.children.forEach((chip) => {
      chip.position.x -= ((col - 1) * 0.3) / 2;
    });
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
  const dockRef = useRef<HTMLElement>(null);
  const peekRef = useRef<HTMLDetailsElement>(null);
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
  const [cameraView, setCameraView] = useState<CameraView>('Table');
  const cameraViewRef = useRef(cameraView);
  cameraViewRef.current = cameraView;
  const [soundOn, setSoundOn] = useState(soundsEnabled);
  const [sceneError, setSceneError] = useState('');
  const [kickArmed, setKickArmed] = useState<number | null>(null);
  const [reaction, setReaction] = useState('');
  const reactionTimer = useRef<ReturnType<typeof setTimeout>>();
  const connected = useStore((s) => s.wsConnected);
  const characterButton = useRef<HTMLButtonElement>(null);
  const activeRoom = room?.room.id === roomId ? room : null;
  const loungePresence = useStore((s) => s.lounge);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [tvOpen, setTVOpen] = useState(false);
  const [tvChannel, setTVChannel] = useState<'film' | 'table'>('film');
  const tvChannelRef = useRef(tvChannel);
  tvChannelRef.current = tvChannel;
  const videoRef = useRef<HTMLVideoElement>(null);
  const myPositionRef = useRef<TravelPose>();
  const navigationRef = useRef({ walk: (_point: LoungePoint) => {}, clear: () => {} });
  const keyboardAccessRef = useRef({ enabled: false, blocked: false, maySend: false });
  const focusWorld = () =>
    mountRef.current?.querySelector('canvas')?.focus({ preventScroll: true });
  const worldPositionsRef = useRef(new Map<number, LoungePoint>());
  const [travelStatus, setTravelStatus] = useState<TravelPose['status']>('seated');
  const [breakDestination, setBreakDestination] = useState<LoungePoint | null>(null);
  const [chooseSeat, setChooseSeat] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraButton = useRef<HTMLButtonElement>(null);
  const [cardsOpen, setCardsOpen] = useState(true);
  const [controlsHidden, setControlsHidden] = useState(false);
  const restoreControlsButton = useRef<HTMLButtonElement>(null);
  const hideControlsButton = useRef<HTMLButtonElement>(null);

  const me = activeRoom?.players.find((p) => p.userId === auth.userId);
  const mySeat = me?.seat ?? null;
  const selectCameraView = (view: CameraView) => {
    setCameraView(view);
    const preset = cameraPresetFor(view, mySeat);
    flyRef.current?.(preset.pos, preset.look);
  };
  useEffect(() => {
    if (!isSeatCamera(cameraViewRef.current)) return;
    const preset = cameraPresetFor(cameraViewRef.current, mySeat);
    flyRef.current?.(preset.pos, preset.look);
  }, [mySeat]);

  // Result panels share the viewport with the HUD. Measure only when it resizes,
  // so long recaps cannot cover Deal, Ready, or the betting controls.
  useEffect(() => {
    const dock = dockRef.current;
    const root = dock?.closest<HTMLElement>('.table3d-experience');
    if (!dock || !root) return;
    const measure = () => {
      const bounds = dock.getBoundingClientRect();
      // During rotation, innerHeight can change before the old dock rect moves.
      // Its height plus the anchored bottom gap stays valid in either orientation.
      const gap = Number.parseFloat(getComputedStyle(dock).bottom) || 0;
      const clearance = bounds.height ? bounds.height + gap : 0;
      root.style.setProperty('--lounge-dock-clearance', `${Math.ceil(clearance)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--lounge-dock-clearance');
    };
  }, []);
  const isHost = room?.room.hostId === auth.userId;
  const handActive = !!hand.handId && !hand.result && !hand.abort;
  const myTurn = mySeat !== null && handActive && hand.betting?.toAct === mySeat;
  const readyResponse =
    !handActive &&
    !!hand.readyCheck?.eligible.includes(auth.userId ?? -1) &&
    !hand.readyCheck.ready.includes(auth.userId ?? -1);
  const needsResponse = myTurn || readyResponse || !!table.runTwice || hand.peekOffers.length > 0;
  const hudHidden = controlsHidden && !needsResponse && !sceneError;
  const hasCards =
    hand.myCards.length > 0 ||
    hand.board.length > 0 ||
    hand.board2.length > 0 ||
    Object.keys(publicCardsBySeat(hand)).length > 0 ||
    !!hand.result ||
    !!hand.abort;
  useEffect(() => {
    if (myTurn) dockRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [myTurn]);
  useEffect(() => {
    if (!needsResponse && !hand.result && !hand.abort) return;
    setControlsHidden(false);
    // A decision or new result brings attention back to the poker controls,
    // while leaving the renderer, camera, and any current walk untouched.
    setTVOpen(false);
    setCustomizeOpen(false);
    setPanel(null);
    setEmoteOpen(false);
    setExploreOpen(false);
    setCameraOpen(false);
    setTargetMenu(null);
    if (myTurn) setCardsOpen(true);
    else if (hand.peekOffers.length > 0)
      peekRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [needsResponse, myTurn, hand.peekOffers.length, hand.result, hand.abort]);
  const restoreControls = () => {
    setControlsHidden(false);
    requestAnimationFrame(() => hideControlsButton.current?.focus());
  };
  const hideControls = () => {
    if (needsResponse) return;
    setCustomizeOpen(false);
    setPanel(null);
    setEmoteOpen(false);
    setTargetMenu(null);
    setExploreOpen(false);
    setTVOpen(false);
    setCameraOpen(false);
    setControlsHidden(true);
    requestAnimationFrame(() => restoreControlsButton.current?.focus());
  };
  const contesting =
    mySeat !== null &&
    (hand.handId
      ? handActive &&
        hand.seats.some((s) => s.userId === auth.userId) &&
        !hand.betting?.seats.find((s) => s.seat === mySeat)?.folded
      : !!activeRoom?.handActive);
  const away = !!loungePresence[auth.userId ?? 0] || mySeat === null;
  keyboardAccessRef.current = {
    enabled: connected && !!me && away && !contesting,
    maySend: connected && !!me && (me.sittingOut || mySeat === null) && !contesting,
    blocked:
      needsResponse ||
      tvOpen ||
      customizeOpen ||
      !!panel ||
      emoteOpen ||
      !!targetMenu ||
      !!sceneError,
  };
  const requestWalk = (point: LoungePoint) => {
    if (!connected || !me) return;
    if (!isLoungeWalkable(point)) {
      setReaction('Choose a clear spot inside the lounge.');
      clearTimeout(reactionTimer.current);
      reactionTimer.current = setTimeout(() => setReaction(''), 2200);
      return;
    }
    if (!away) {
      wsClient.send({ t: 'sit_out', sittingOut: true });
      setBreakDestination(point);
    } else navigationRef.current.walk(point);
    setChooseSeat(false);
    requestAnimationFrame(focusWorld);
  };
  const returnToSeat = () => {
    navigationRef.current.clear();
    setBreakDestination(null);
    if (mySeat === null) {
      setChooseSeat(true);
      setExploreOpen(false);
    } else wsClient.send({ t: 'lounge_return' });
    selectCameraView('Table');
  };
  const worldActionsRef = useRef({
    walk: requestWalk,
    tv: () => setTVOpen(true),
    seat: (_seat: number) => {},
  });
  worldActionsRef.current = {
    walk: (point) => {
      if (away) requestWalk(point);
    },
    tv: () => setTVOpen(true),
    seat: (seat) => {
      if (!connected || !me) return;
      if (mySeat === null && !activeRoom?.handActive) wsClient.send({ t: 'sit', seat });
      else if (seat === mySeat) returnToSeat();
      else setChooseSeat(true);
    },
  };
  useEffect(() => {
    if (!breakDestination || !connected || !me?.sittingOut || contesting) return;
    navigationRef.current.walk(breakDestination);
    setExploreOpen(false);
    requestAnimationFrame(focusWorld);
    setCameraView('Lounge');
    flyRef.current?.([11, 10, 17], [0, 1, 0]);
    setBreakDestination(null);
  }, [breakDestination, connected, me?.sittingOut, contesting]);
  useEffect(() => {
    if (mySeat !== null) setChooseSeat(false);
  }, [mySeat]);

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
      setExploreOpen(false);
      setTVOpen(false);
      setCameraOpen(false);
      setControlsHidden(false);
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
    scene.background = new THREE.Color(0x101e2c);
    scene.fog = new THREE.Fog(0x101e2c, 32, 58);

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
    let renderRequested = true;
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
    scene.environmentIntensity = 0.55;
    mount.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      'aria-label',
      'Lounge world. After taking a break, use W A S D or arrow keys to walk. Drag to look around.',
    );
    renderer.domElement.setAttribute(
      'aria-keyshortcuts',
      'W A S D ArrowUp ArrowDown ArrowLeft ArrowRight',
    );
    const walkKeys = new Set<string>();
    let keyboardOwnsWalk = false;
    let lastOffered: LoungePoint | undefined;
    const sentTargets: LoungePoint[] = [];
    const moveQueue = new LoungeMoveQueue((point) => {
      if (!keyboardAccessRef.current.maySend) return;
      sentTargets.push(point);
      if (sentTargets.length > 24) sentTargets.shift();
      wsClient.send({ t: 'lounge_move', x: point.x, z: point.z });
    });
    const clearNavigation = () => {
      walkKeys.clear();
      keyboardOwnsWalk = false;
      lastOffered = undefined;
      moveQueue.clear();
    };
    navigationRef.current = {
      walk: (point) => {
        clearNavigation();
        moveQueue.offer(point);
      },
      clear: clearNavigation,
    };
    const stopKeys = () => {
      walkKeys.clear();
    };
    const keyboardBlocked = () =>
      keyboardAccessRef.current.blocked ||
      document.activeElement !== renderer.domElement ||
      !!document.querySelector(
        '[role="dialog"]:not([hidden]), [role="menu"]:not([hidden]), .lounge-panel:not([hidden])',
      );
    const onWalkDown = (event: KeyboardEvent) => {
      if (
        !isWalkKey(event.code) ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing
      )
        return;
      if (!keyboardAccessRef.current.enabled || keyboardBlocked()) return;
      event.preventDefault();
      if (event.repeat) return;
      walkKeys.add(event.code);
      keyboardOwnsWalk = true;
    };
    const onWalkUp = (event: KeyboardEvent) => {
      walkKeys.delete(event.code);
    };
    const onWorldVisibility = () => {
      if (document.hidden) stopKeys();
    };
    window.addEventListener('keydown', onWalkDown);
    window.addEventListener('keyup', onWalkUp);
    window.addEventListener('blur', stopKeys);
    document.addEventListener('visibilitychange', onWorldVisibility);
    renderer.domElement.addEventListener('blur', stopKeys);

    const sun = new THREE.DirectionalLight(0xffe0b3, 2.1);
    sun.position.set(7, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 2;
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
    let cameraPreset = cameraPresetFor(cameraViewRef.current, mySeat);
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

    const lounge = buildLounge();
    scene.add(lounge);
    const updateCutaway = createLoungeCutaway(lounge);
    const destinationRing = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.37, 40),
      new THREE.MeshBasicMaterial({ color: 0xe8d5a9, transparent: true, opacity: 0.9 }),
    );
    destinationRing.name = 'walking-destination';
    destinationRing.rotation.x = -Math.PI / 2;
    destinationRing.visible = false;
    scene.add(destinationRing);
    const tvScreen = lounge.getObjectByName('lounge-tv-screen') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.MeshBasicMaterial
    >;
    const video = videoRef.current;
    let videoTexture: THREE.VideoTexture | undefined;
    const liveCanvas = document.createElement('canvas');
    liveCanvas.width = 960;
    liveCanvas.height = 540;
    const liveTexture = new THREE.CanvasTexture(liveCanvas);
    liveTexture.colorSpace = THREE.SRGBColorSpace;
    const resetVideoTexture = () => {
      videoTexture?.dispose();
      if (video) {
        videoTexture = new THREE.VideoTexture(video);
        videoTexture.colorSpace = THREE.SRGBColorSpace;
      }
      renderRequested = true;
    };
    video?.addEventListener('loadeddata', resetVideoTexture);
    if (video && video.readyState >= 2) resetVideoTexture();
    const drawLiveTV = () => {
      const ink = liveCanvas.getContext('2d')!;
      const { hand: current, room: currentRoom } = useStore.getState();
      ink.fillStyle = '#112a2e';
      ink.fillRect(0, 0, 960, 540);
      ink.fillStyle = '#bfa376';
      ink.font = '500 28px Onest, sans-serif';
      ink.fillText('4AM  /  TABLE LIVE', 48, 60);
      const pot = current.betting?.seats.reduce((sum, seat) => sum + seat.total, 0) ?? 0;
      ink.fillStyle = '#f4f0e6';
      ink.font = '600 78px Bricolage Grotesque, sans-serif';
      ink.fillText(`${pot.toLocaleString()} in the pot`, 48, 167);
      const name = currentRoom?.players.find((p) => p.seat === current.betting?.toAct)?.displayName;
      ink.fillStyle = '#bad4ca';
      ink.font = '400 28px Onest, sans-serif';
      ink.fillText(
        current.result
          ? 'Hand complete'
          : name
            ? `${name.slice(0, 28)} is playing`
            : 'The next hand is coming',
        48,
        218,
      );
      current.board.forEach((card, index) => {
        const x = 48 + index * 133;
        ink.fillStyle = '#f4f0e6';
        ink.beginPath();
        ink.roundRect(x, 277, 108, 154, 10);
        ink.fill();
        const suit = suitOf(card);
        ink.fillStyle = suit === 1 || suit === 2 ? '#ae3237' : '#163138';
        ink.font = '600 46px Onest, sans-serif';
        ink.fillText(RANKS[rankOf(card)]!, x + 16, 331);
        ink.font = '54px serif';
        ink.fillText(SUIT_GLYPHS[suit]!, x + 31, 401);
      });
      ink.fillStyle = '#bad4ca';
      ink.font = '400 22px Onest, sans-serif';
      ink.fillText('Good company. One more hand.', 48, 491);
      liveTexture.needsUpdate = true;
    };
    drawLiveTV();
    let lastTVFrame = 0;

    /* the table: teal wool felt, walnut base, leather rail */
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3.15, 0.35, 48),
      new THREE.MeshStandardMaterial({ color: 0x163e3b, roughness: 0.85 }),
    );
    felt.scale.x = 1.55;
    felt.position.y = 0.85;
    felt.receiveShadow = true;
    felt.castShadow = true;
    scene.add(felt);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(3.04, 0.14, 12, 80),
      new THREE.MeshStandardMaterial({ color: 0x382e28, roughness: 0.45, metalness: 0.2 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.scale.x = 1.55;
    rim.position.y = 1.03;
    scene.add(rim);
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.5, 0.85, 24),
      new THREE.MeshStandardMaterial({ color: 0x30251f, roughness: 0.7 }),
    );
    leg.scale.x = 1.4;
    leg.position.y = 0.42;
    leg.castShadow = true;
    scene.add(leg);

    // A tailored felt surface: double inlay, a quiet brand mark, and a padded rail.
    const feltCanvas = document.createElement('canvas');
    feltCanvas.width = feltCanvas.height = 1024;
    const feltInk = feltCanvas.getContext('2d')!;
    feltInk.fillStyle = '#16413d';
    feltInk.fillRect(0, 0, 1024, 1024);
    for (const radius of [466, 453]) {
      feltInk.beginPath();
      feltInk.arc(512, 512, radius, 0, Math.PI * 2);
      feltInk.strokeStyle = radius === 466 ? '#817052' : '#497069';
      feltInk.lineWidth = 2;
      feltInk.stroke();
    }
    feltInk.textAlign = 'center';
    feltInk.fillStyle = '#73928a';
    feltInk.font = '600 48px sans-serif';
    feltInk.fillText('4 A M', 512, 700);
    feltInk.font = '500 17px sans-serif';
    feltInk.fillStyle = '#8ca79b';
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
        color: 0xb99d65,
        emissive: 0xb99d65,
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
    const motions = new CharacterMotions();
    const travel = new LoungeLocomotion();
    let lastTravelStatus = '';
    const startMotion = (anim: CharacterMotion) => motions.start(anim, charBySeat.get(anim.seat));
    const charBySeat = new Map<number, THREE.Group>();
    const homeBySeat = new Map<number, THREE.Vector3>();
    const seen = new Set<string>();
    // Keep deal start times across room/bet updates, so an in-flight card never snaps.
    const dealStarts = new Map<string, number>();
    const cardAnims: {
      mesh: THREE.Mesh;
      t0: number;
      dur: number;
      baseY: number;
      baseRX: number;
    }[] = [];
    const spawnCard = (mesh: THREE.Mesh, key: string, delayMs: number) => {
      if (!key || seen.has(key)) return;
      if (motion.matches) {
        seen.add(key);
        return;
      }
      const t0 = dealStarts.get(key) ?? performance.now() + delayMs;
      dealStarts.set(key, t0);
      if (performance.now() - t0 >= 520) {
        seen.add(key);
        dealStarts.delete(key);
        return;
      }
      mesh.visible = false;
      cardAnims.push({ mesh, t0, dur: 520, baseY: mesh.position.y, baseRX: mesh.rotation.x });
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
      renderRequested = true;
      const timeout = setTimeout(() => {
        timeouts.delete(timeout);
        scene.remove(sp);
        renderRequested = true;
        sp.material.map?.dispose();
        sp.material.dispose();
      }, 900);
      timeouts.add(timeout);
    };

    const onPoke = (e: Event) => {
      const detail = (e as CustomEvent<{ targetSeat: number; fromUserId: number }>).detail;
      const fromSeat =
        useStore.getState().room?.players.find((p) => p.userId === detail.fromUserId)?.seat ?? null;
      if (fromSeat === null || !homeBySeat.has(fromSeat) || !homeBySeat.has(detail.targetSeat))
        return;
      e.preventDefault();
      onEmote(
        new CustomEvent('4am-emote', {
          detail: { fromSeat, targetSeat: detail.targetSeat, kind: 'shove' },
        }),
      );
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
      renderRequested = true;
      const born = performance.now();
      const rise = () => {
        const lifeP = (performance.now() - born) / 1400;
        if (lifeP >= 1) {
          scene.remove(sp);
          renderRequested = true;
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
      const detail = (
        e as CustomEvent<{
          fromSeat: number | null;
          fromUserId?: number;
          kind: string;
          targetSeat?: number;
        }>
      ).detail;
      const d = {
        ...detail,
        fromSeat: detail.fromSeat ?? (detail.fromUserId ? -detail.fromUserId : null),
      };
      if (
        detail.fromUserId &&
        d.fromSeat !== null &&
        charBySeat.get(d.fromSeat)?.userData.userId !== detail.fromUserId
      )
        return;
      if (ATTACKS[d.kind] && d.targetSeat !== undefined) {
        const home = homeBySeat.get(d.targetSeat);
        const from = d.fromSeat === null ? undefined : homeBySeat.get(d.fromSeat);
        if (!home || !from || d.fromSeat === d.targetSeat) return;
        if (motion.matches) {
          powSprite(home);
          play(ATTACKS[d.kind]!.sound);
          return;
        }
        const attackerId = charBySeat.get(d.fromSeat!)!.userData.userId;
        const targetId = charBySeat.get(d.targetSeat)!.userData.userId;
        const born = performance.now();
        startMotion({
          kind: 'throw',
          seat: d.fromSeat!,
          t0: born,
          direction: home.clone().sub(from).normalize(),
        });
        startMotion({
          kind: d.kind as 'shove' | 'slap' | 'chip',
          seat: d.targetSeat,
          t0: born,
          direction: home.clone().sub(from).normalize(),
        });
        if (!motion.matches) {
          const icon = document.createElement('canvas');
          icon.width = icon.height = 128;
          const ink = icon.getContext('2d')!;
          ink.font = '92px system-ui';
          ink.textAlign = 'center';
          ink.fillText(d.kind === 'slap' ? '✋' : '💨', 64, 98);
          const chip =
            d.kind === 'chip'
              ? new THREE.Mesh(
                  new THREE.CylinderGeometry(0.13, 0.13, 0.05, 16),
                  new THREE.MeshStandardMaterial({
                    color: 0xfbbf24,
                    metalness: 0.45,
                    roughness: 0.3,
                  }),
                )
              : new THREE.Sprite(
                  new THREE.SpriteMaterial({
                    map: new THREE.CanvasTexture(icon),
                    transparent: true,
                  }),
                );
          chip.name = 'targeted-projectile';
          if (chip instanceof THREE.Sprite) chip.scale.setScalar(0.65);
          let launch: THREE.Vector3 | null = null;
          const land = new THREE.Vector3();
          scene.add(chip);
          const flyChip = () => {
            const fp = (performance.now() - born - 160) / (CONTACT_MS - 160);
            chip.visible = fp >= 0;
            if (
              fp >= 1 ||
              motion.matches ||
              charBySeat.get(d.fromSeat!)?.userData.userId !== attackerId ||
              charBySeat.get(d.targetSeat!)?.userData.userId !== targetId
            ) {
              scene.remove(chip);
              renderRequested = true;
              disposeObject(chip);
              return;
            }
            if (fp >= 0 && !launch)
              launch =
                (
                  charBySeat.get(d.fromSeat!)?.userData.handR as THREE.Mesh | undefined
                )?.getWorldPosition(new THREE.Vector3()) ?? from.clone().setY(1.5);
            (charBySeat.get(d.targetSeat!)!.userData.head as THREE.Group).getWorldPosition(land);
            chip.position.copy(chipPosition(launch ?? from, land, Math.max(0, fp)));
            if (chip instanceof THREE.Mesh) chip.rotation.x = fp * Math.PI * 4;
            nextFrame(flyChip);
          };
          flyChip();
        }
        return;
      }
      const def = EMOTES[d.kind as EmoteKind];
      if (def && d.fromSeat !== null && charBySeat.has(d.fromSeat)) {
        startMotion({ kind: 'emote', emote: d.kind, seat: d.fromSeat, t0: performance.now() });
        if (def.sound) play(def.sound);
        const home = homeBySeat.get(d.fromSeat);
        if (home) emoteSprite(home, def.sprite ?? def.emoji);
      }
    };
    window.addEventListener('4am-emote', onEmote);
    /* tap a player to shove them (a click, not an orbit-drag) */
    const ray = new THREE.Raycaster();
    let downAt: { x: number; y: number; pointerId: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary) {
        downAt = null;
        return;
      }
      if (e.button !== 0) return;
      renderer.domElement.focus({ preventScroll: true });
      stopKeys();
      downAt = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    };
    const onUp = (e: PointerEvent) => {
      if (!downAt || downAt.pointerId !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects([dynamic, felt, rim, feltSurface, lounge], true);
      for (const hit of hits) {
        let visible = true;
        for (let ancestor: THREE.Object3D | null = hit.object; ancestor; ancestor = ancestor.parent)
          if (!ancestor.visible) visible = false;
        if (!visible) continue;
        let o: THREE.Object3D | null = hit.object;
        while (o) {
          if (o.userData.chooseSeat !== undefined) {
            worldActionsRef.current.seat(o.userData.chooseSeat);
            return;
          }
          if (o.userData.loungePoint) {
            worldActionsRef.current.walk(o.userData.loungePoint);
            return;
          }
          if (o.userData.loungeSpot) {
            const spot = o.userData.loungeSpot as keyof typeof LOUNGE_DESTINATIONS;
            if (spot === 'tv') worldActionsRef.current.tv();
            if (LOUNGE_DESTINATIONS[spot]) worldActionsRef.current.walk(LOUNGE_DESTINATIONS[spot]);
            return;
          }
          if (o.userData.walkFloor) {
            worldActionsRef.current.walk({ x: hit.point.x, z: hit.point.z });
            return;
          }
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
        // Cards and the table surface block picking a player behind them.
        if (hit.object instanceof THREE.Mesh) break;
      }
      targetMenuRef.current(null as never);
    };
    const onCancel = () => {
      downAt = null;
    };
    renderer.domElement.addEventListener('pointercancel', onCancel);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    const disposeDeep = disposeObject;

    let dirty = true;
    const viewAnchor = 0; // Everyone shares one physical room; only the camera changes.
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
        motions.active.clear();
        return;
      }
      const h = st.hand;
      const betting = h.betting;
      const myId = st.auth.userId;

      const order = r.players.filter((p) => p.seat !== null || p.connected);
      const oldOwners = new Map([...charBySeat].map(([key, char]) => [key, char.userData.userId]));
      const oldCharacters = new Map(
        [...charBySeat.values()].map((char) => [char.userData.userId as number, char]),
      );
      charBySeat.clear();
      const currentKeys = new Set(order.map((p) => p.seat ?? -p.userId));
      for (const key of motions.active.keys())
        if (
          !currentKeys.has(key) ||
          oldOwners.get(key) !== order.find((p) => (p.seat ?? -p.userId) === key)?.userId
        )
          motions.remove(key);
      for (const [id, character] of oldCharacters)
        if (!order.some((p) => p.userId === id)) {
          disposeDeep(character);
          travel.remove(id);
          oldCharacters.delete(id);
        }

      turnRing.visible = false;
      turnArrow.visible = false;
      turnArrow.userData.active = false;
      if (seen.size > 600) seen.clear();
      for (const [key, t0] of dealStarts)
        if (performance.now() - t0 > 2000) {
          dealStarts.delete(key);
          seen.add(key);
        }
      order.forEach((p) => {
        const key = p.seat ?? -p.userId;
        const { position, yaw } =
          p.seat !== null
            ? seatPlacement(p.seat, viewAnchor)
            : { position: new THREE.Vector3(((p.userId % 5) - 2) * 0.65, 0, 6.4), yaw: Math.PI };
        const px = position.x,
          pz = position.z;
        const engine = betting?.seats.find((s) => s.seat === p.seat);
        const inHand = h.handId !== null && !h.abort && h.seats.some((s) => s.seat === p.seat);
        const folded = !!engine?.folded;

        const cfg = parseAvatar(p.avatar3d);
        const signature = JSON.stringify([p.userId, cfg, folded, p.sittingOut]);
        let char = oldCharacters.get(p.userId);
        if (!char || char.userData.signature !== signature) {
          const previousPose = char?.userData.userId === p.userId ? capturePose(char) : undefined;
          if (char) {
            if (char.userData.userId !== p.userId) motions.remove(p.seat!);
            disposeDeep(char);
          }
          char = buildCharacter(cfg, folded && !p.sittingOut);
          char.userData.signature = signature;
          char.userData.userId = p.userId;
          char.position.copy(position);
          char.rotation.set(0, yaw, 0);
          idleCharacter(char, performance.now() / 1000, p.seat!, motion.matches, true);
          if (previousPose) blendPose(char, previousPose, 0);
        }
        char.userData.physicalSeat = p.seat;
        delete char.userData.pokeSeat;
        delete char.userData.pokeName;
        if (p.userId !== myId) {
          char.userData.pokeSeat = key;
          char.userData.pokeName = p.displayName;
        }
        charBySeat.set(key, char);
        homeBySeat.set(key, char.position.clone());
        dynamic.add(char);
        if (p.seat !== null) {
          const chair = buildChair();
          char.userData.chair = chair;
          chair.position.copy(position);
          orientChair(chair, yaw);
          chair.userData.chooseSeat = p.seat;
          dynamic.add(chair);
        }
        if (p.seat === null) {
          const label = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: labelTexture(p.displayName, 'In the lounge', '#bed6d0'),
              transparent: true,
            }),
          );
          label.userData.screenLabel = true;
          label.userData.hideOverhead = true;
          label.userData.followActor = key;
          label.userData.pokeSeat = key;
          label.userData.pokeName = p.displayName;
          label.scale.set(1.35, 0.51, 1);
          dynamic.add(label);
          return;
        }

        // a fresh fold gets its little slump (timeout folds included)
        const foldKey = `${h.handId}:fold:${p.seat}`;
        if (folded && h.handId && !seen.has(foldKey)) {
          seen.add(foldKey);
          startMotion({ kind: 'fold', seat: p.seat!, t0: performance.now() });
        }
        // the winner celebrates for everyone
        if (h.result && h.handId) {
          const winDelta = h.result.deltas.find((x) => x.seat === p.seat)?.delta ?? 0;
          const winKey = `${h.handId}:win:${p.seat}`;
          if (winDelta > 0 && !seen.has(winKey)) {
            seen.add(winKey);
            startMotion({
              kind: 'emote',
              emote: 'celebrate',
              seat: p.seat!,
              t0: performance.now(),
            });
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
            startMotion({ kind: cfg.fx, seat: p.seat!, t0: performance.now() });
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
          turnArrow.userData.active = p.userId !== myId;
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
                isToAct ? '#eccf88' : '#bed6d0',
              ),
              transparent: true,
            }),
          );
          label.userData.hideOverhead = true;
          label.userData.screenLabel = true;
          label.userData.pokeSeat = key;
          label.userData.followActor = key;
          label.userData.pokeName = p.displayName;
          label.scale.set(1.35, 0.51, 1);
          label.position.set(px, 2.65, pz);
          dynamic.add(label);
        }

        // this street's chips slide toward the middle
        const committed = engine?.committed ?? 0;
        if (committed > 0) {
          const chips = buildChips(committed, r.room.bb, p.userId === myId);
          const placement = committedChipPlacement(p.seat!);
          chips.position.set(placement.x, 1.03, placement.z);
          chips.rotation.y = placement.yaw;
          if (p.userId === myId) {
            // A compact personal stack fits between the larger private cards and
            // the board without spreading into the next player's card place.
            chips.scale.set(0.75, 0.5, 0.75);
            chips.position.x *= 0.84;
            chips.position.z *= 0.84;
          }
          dynamic.add(chips);
        }

        // Opponents' cards rest at their place on the felt. Only publicly revealed
        // values may be face up; the private-card rail remains local to this player.
        const publicCards = publicCardsBySeat(h)[p.seat!];
        if (p.userId !== myId && ((inHand && !folded) || publicCards)) {
          const pair = new THREE.Group();
          for (let ci = 0; ci < 2; ci++) {
            const card = makeCard(publicCards?.[ci] ?? null, 0.36, 0);
            card.name = `player-card-${p.seat}-${ci}`;
            card.position.x = (ci - 0.5) * 0.41;
            pair.add(card);
          }
          const cards = opponentCardPlacement(p.seat!);
          pair.position.set(cards.x, 0, cards.z);
          pair.rotation.y = cards.yaw;
          dynamic.add(pair);
        }
      });

      for (let seat = 0; seat < 9; seat++)
        if (!order.some((p) => p.seat === seat)) {
          const chair = buildChair(),
            placement = seatPlacement(seat);
          chair.position.copy(placement.position);
          orientChair(chair, placement.yaw);
          chair.userData.chooseSeat = seat;
          dynamic.add(chair);
        }
      drawLiveTV();

      /* board and my cards */
      h.board.forEach((cardId, i) => {
        const cardMesh = makeCard(cardId, 0.62, 0);
        cardMesh.name = `community-card-1-${i}`;
        const placement = boardPlacement(i, false, h.board2.length > 0);
        cardMesh.position.x = placement.x;
        cardMesh.position.z = placement.z;
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
        const cardMesh = makeCard(cardId, 0.62, 0);
        cardMesh.name = `community-card-2-${i}`;
        const placement = boardPlacement(i, true, true);
        cardMesh.position.x = placement.x;
        cardMesh.position.z = placement.z;
        dynamic.add(cardMesh);
        spawnCard(cardMesh, h.handId ? `${h.handId}:b2:${i}` : '', 0);
      });
      const mySeatNow = r.players.find((p) => p.userId === myId)?.seat ?? null;
      if (mySeatNow !== null && h.myCards.length > 0 && h.handId) {
        const place = privateCardPlacement(mySeatNow);
        const pair = new THREE.Group();
        pair.position.set(place.x, 0, place.z);
        pair.rotation.y = place.yaw;
        h.myCards.forEach((cardId, i) => {
          const mine = makeCard(cardId, 0.62, 0);
          mine.name = `private-card-${i}`;
          mine.position.x = (i - 0.5) * 0.69;
          pair.add(mine);
          spawnCard(mine, `${h.handId}:mine:${i}`, i * 140);
        });
        dynamic.add(pair);
      }

      /* the pot as a pile */
      const pot = betting ? betting.seats.reduce((sum, x) => sum + x.total, 0) : 0;
      if (pot > 0) {
        const pile = buildChips(pot, r.room.bb);
        pile.position.set(2.26, 1.03, 0);
        pile.scale.setScalar(0.6);
        dynamic.add(pile);
        const potLabel = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: labelTexture('POT', String(pot), '#e879f9'),
            transparent: true,
          }),
        );
        potLabel.userData.hideOverhead = true;
        potLabel.scale.set(1.5, 0.56, 1);
        potLabel.position.set(2.26, 1.85, 0);
        dynamic.add(potLabel);
      }
      dynamic.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
    };

    const unsub = useStore.subscribe((state, previous) => {
      if (state.lounge !== previous.lounge) {
        const id = state.auth.userId;
        const target = id === null ? undefined : state.lounge[id!];
        const previousTarget = id === null ? undefined : previous.lounge[id!];
        if (keyboardOwnsWalk && target !== previousTarget) {
          // Self echoes must not pull the local rig backwards. A server-selected
          // free spot or another session's move hands control back to the path planner.
          const echo =
            target && sentTargets.some((p) => Math.hypot(p.x - target.x, p.z - target.z) < 0.001);
          if (!echo) clearNavigation();
        }
        renderRequested = true;
        renderer.shadowMap.needsUpdate = true;
      }
      if (
        state.room?.room !== previous.room?.room ||
        state.room?.players !== previous.room?.players ||
        state.room?.handActive !== previous.room?.handActive ||
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
      renderRequested = true;
      camera.aspect = w / hgt;
      camera.updateProjectionMatrix();
      fly(cameraPreset.pos, cameraPreset.look);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(mount);

    let raf = 0;
    const clock = new THREE.Clock();
    let previousReducedMotion = motion.matches;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const wasDirty = dirty;
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
      if (!keyboardAccessRef.current.maySend) clearNavigation();
      else if (walkKeys.size && (!keyboardAccessRef.current.enabled || keyboardBlocked()))
        stopKeys();
      const direction = walkDirection(walkKeys, {
        x: controls.target.x - camera.position.x,
        z: controls.target.z - camera.position.z,
      });
      const state = useStore.getState();
      const occupied: LoungePoint[] = [];
      for (const other of charBySeat.values()) {
        const id = other.userData.userId as number;
        if (id === state.auth.userId) continue;
        occupied.push({ x: other.position.x, z: other.position.z });
        if (state.lounge[id]) occupied.push(state.lounge[id]!);
      }
      const motionWasActive = motions.active.size > 0;
      // every character starts each frame at its base pose, breathes a little,
      // then active animations write absolute offsets on top - nothing drifts
      let travelling = false;
      worldPositionsRef.current.clear();
      for (const [key, char] of charBySeat) {
        const id = char.userData.userId as number;
        const pose = travel.update(
          id,
          char.userData.physicalSeat as number | null,
          useStore.getState().lounge[id],
          nowMs,
          motion.matches,
          id === state.auth.userId && keyboardOwnsWalk ? { direction, dt, occupied } : undefined,
        );
        if (
          id === state.auth.userId &&
          keyboardOwnsWalk &&
          pose.sitting === 0 &&
          isLoungeWalkable(pose)
        ) {
          if (!lastOffered || Math.hypot(pose.x - lastOffered.x, pose.z - lastOffered.z) > 0.001) {
            lastOffered = { x: pose.x, z: pose.z };
            moveQueue.offer(pose);
          }
        }
        char.position.set(pose.x, 0, pose.z);
        char.rotation.set(0, pose.yaw, 0);
        idleCharacter(char, nowMs / 1000, id, motion.matches, false);
        posture(char, pose.sitting);
        if (pose.status === 'walking') walkPose(char, pose.distance, motion.matches);
        const moving = !['seated', 'standing'].includes(pose.status);
        travelling ||= moving;
        motions.layer(char, key, nowMs, motion.matches, moving);
        homeBySeat.set(key, new THREE.Vector3(pose.x, 0, pose.z));
        worldPositionsRef.current.set(key, { x: pose.x, z: pose.z });
        if (id === useStore.getState().auth.userId) {
          myPositionRef.current = pose;
          const target = useStore.getState().lounge[id];
          destinationRing.visible =
            !keyboardOwnsWalk && !!target && Math.hypot(pose.x - target.x, pose.z - target.z) > 0.3;
          if (target) destinationRing.position.set(target.x, 0.025, target.z);
          if (lastTravelStatus !== pose.status) {
            lastTravelStatus = pose.status;
            setTravelStatus(pose.status);
          }
        }
      }
      if (travelling) renderer.shadowMap.needsUpdate = true;
      const nextTVTexture =
        tvChannelRef.current === 'film' && videoTexture ? videoTexture : liveTexture;
      if (tvScreen.material.map !== nextTVTexture) {
        tvScreen.material.map = nextTVTexture;
        tvScreen.material.needsUpdate = true;
        renderRequested = true;
      }
      if (
        tvChannelRef.current === 'film' &&
        video &&
        !video.paused &&
        video.readyState >= 2 &&
        nowMs - lastTVFrame > 66
      ) {
        lastTVFrame = nowMs;
        renderRequested = true;
      }

      // dealt cards: drop from above while flipping face-down → face-up
      for (let i = cardAnims.length - 1; i >= 0; i--) {
        const ca = cardAnims[i]!;
        const cp = (nowMs - ca.t0) / ca.dur;
        if (cp < 0 && !motion.matches) {
          ca.mesh.visible = false;
          continue;
        }
        if (cp >= 1 || motion.matches || !ca.mesh.parent) {
          ca.mesh.visible = true;
          ca.mesh.position.y = ca.baseY;
          ca.mesh.rotation.x = ca.baseRX;
          cardAnims.splice(i, 1);
          continue;
        }
        ca.mesh.visible = true;
        const pose = dealPose(ca.mesh.userData.cardWidth as number, cp);
        ca.mesh.position.y = ca.baseY + pose.lift;
        ca.mesh.rotation.x = ca.baseRX + pose.angle;
      }
      for (const anim of motions.active.values()) {
        const home = homeBySeat.get(anim.seat);
        if (!home || anim.fired || motion.matches) continue;
        const prog = (nowMs - anim.t0) / motionDuration(anim);
        const def = anim.kind === 'emote' ? EMOTES[anim.emote as EmoteKind] : undefined;
        if (def?.burst && prog > 0.4) {
          anim.fired = true;
          burst(home.clone().setY(1.6), def.burst, 40, 2.2, 3);
        } else if (
          ['poke', 'shove', 'slap', 'chip'].includes(anim.kind) &&
          nowMs - anim.t0 >= CONTACT_MS
        ) {
          anim.fired = true;
          powSprite(home);
          play(ATTACKS[anim.kind]?.sound ?? 'thwack');
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i]!;
        const life = motion.matches ? 1 : (nowMs - pt.t0) / pt.dur;
        if (life >= 1) {
          scene.remove(pt.pts);
          renderRequested = true;
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

      if (flyPos && flyLook) {
        camera.position.lerp(flyPos, 1 - Math.exp(-7 * dt));
        controls.target.lerp(flyLook, 1 - Math.exp(-7 * dt));
        if (camera.position.distanceTo(flyPos) < 0.05) {
          flyPos = null;
          flyLook = null;
        }
      }
      if (motionWasActive || previousReducedMotion !== motion.matches)
        renderer.shadowMap.needsUpdate = true;
      const cameraChanged = controls.update();
      if ((cameraChanged || renderRequested) && updateCutaway(camera.position, controls.target))
        renderer.shadowMap.needsUpdate = true;
      const overhead = camera.position.clone().sub(controls.target).normalize().y > 0.9;
      dynamic.traverse((object) => {
        if (object.userData.followActor !== undefined) {
          const actor = charBySeat.get(object.userData.followActor);
          if (actor) object.position.copy(actor.position).add(new THREE.Vector3(0, 2.65, 0));
        }
        if (object.userData.hideOverhead) object.visible = !overhead;
        if (object.userData.screenLabel) {
          const worldPerPixel =
            (2 *
              object.position.distanceTo(camera.position) *
              Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
            mount.clientHeight;
          const width = Math.min(1.35, worldPerPixel * 72);
          object.scale.set(width, width * 0.38, 1);
        }
      });
      turnArrow.visible = !!turnArrow.userData.active && !overhead;
      if (
        !motion.matches ||
        wasDirty ||
        cameraChanged ||
        travelling ||
        renderRequested ||
        previousReducedMotion !== motion.matches
      ) {
        renderer.render(scene, camera);
        renderRequested = false;
      }
      previousReducedMotion = motion.matches;
    };
    loop();

    return () => {
      alive = false;
      clearNavigation();
      navigationRef.current = { walk: () => {}, clear: () => {} };
      window.removeEventListener('keydown', onWalkDown);
      window.removeEventListener('keyup', onWalkUp);
      window.removeEventListener('blur', stopKeys);
      document.removeEventListener('visibilitychange', onWorldVisibility);
      renderer.domElement.removeEventListener('blur', stopKeys);
      cancelAnimationFrame(raf);
      auxiliaryFrames.forEach(cancelAnimationFrame);
      timeouts.forEach(clearTimeout);
      window.removeEventListener('4am-emote', onEmote);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      flyRef.current = null;
      window.removeEventListener('4am-poke', onPoke);
      renderer.domElement.removeEventListener('pointercancel', onCancel);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      unsub();
      ro.disconnect();
      controls.dispose();
      video?.removeEventListener('loadeddata', resetVideoTexture);
      tvScreen.material.map = null;
      videoTexture?.dispose();
      liveTexture.dispose();
      disposeDeep(scene);
      environmentTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const pot = hand.betting?.seats.reduce((total, seat) => total + seat.total, 0) ?? 0;
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
    if (!connected || !me) return;
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
        hudHidden && 'hud-hidden',
        hasCards && cardsOpen && 'cards-open',
      )}
    >
      <header className="lounge-header">
        <div className="lounge-identity lounge-glass">
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
              {activeRoom
                ? `${activeRoom.room.sb} / ${activeRoom.room.bb} blinds`
                : 'Joining table'}
            </span>
          </div>
        </div>
        <div className="lounge-room-tools lounge-glass">
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
            aria-label="Your character"
            title="Your character"
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
          <button
            ref={hideControlsButton}
            className="lounge-icon hide-controls-trigger"
            aria-label="Hide controls"
            title={
              needsResponse ? 'Respond before hiding controls' : 'Hide controls for a clear view'
            }
            disabled={needsResponse}
            onClick={hideControls}
          >
            <EyeSlash size={19} />
          </button>
        </div>
      </header>

      {hudHidden && (
        <button
          ref={restoreControlsButton}
          className="lounge-button lounge-glass restore-controls"
          onClick={restoreControls}
        >
          <Eye size={18} /> Show controls
        </button>
      )}

      <main className="lounge-stage" aria-label="3D poker table">
        <div
          ref={mountRef}
          className="lounge-canvas"
          aria-label="3D casino. Drag to orbit. Use the camera buttons to change view."
        />
        {thunderKey > 0 && <div key={thunderKey} className="thunder-flash" aria-hidden="true" />}
        <div className="table-readout lounge-glass">
          <span>{handActive ? (hand.betting?.street ?? 'Dealing') : 'Texas Hold’em'}</span>
          <strong>
            {pot.toLocaleString()} <small>in the pot</small>
          </strong>
        </div>
        <div className="lounge-world-tools lounge-glass">
          <button
            className="lounge-button"
            aria-expanded={exploreOpen}
            onClick={() => {
              setExploreOpen(!exploreOpen);
              setTVOpen(false);
              setCustomizeOpen(false);
            }}
          >
            <PersonSimpleWalk size={18} />
            Lounge
          </button>
          <button
            className="lounge-button"
            aria-expanded={tvOpen}
            onClick={() => {
              setTVOpen(!tvOpen);
              setExploreOpen(false);
              setCustomizeOpen(false);
            }}
          >
            <Television size={18} />
            TV
          </button>
          <button
            ref={cameraButton}
            className="lounge-button camera-trigger"
            aria-label="Camera views"
            aria-expanded={cameraOpen}
            aria-controls="lounge-camera-views"
            onClick={() => setCameraOpen(!cameraOpen)}
          >
            <Camera size={18} />
            <span>{cameraView} view</span>
            <CaretDown size={12} />
          </button>
          {(away || breakDestination) && me && (
            <button className="lounge-button" disabled={!connected} onClick={returnToSeat}>
              <Armchair size={18} />
              {mySeat === null
                ? 'Choose seat'
                : breakDestination
                  ? 'Stay seated'
                  : 'Return to seat'}
            </button>
          )}
        </div>
        {exploreOpen && (
          <section className="lounge-panel lounge-explore-panel" aria-label="Explore the lounge">
            <div className="panel-heading">
              <div>
                <h2>Make yourself at home</h2>
                <p>
                  {breakDestination
                    ? 'Your break starts after this hand.'
                    : away
                      ? 'Use WASD or arrow keys to walk. Drag to look around.'
                      : 'Take a break. Your seat and chips stay yours.'}
                </p>
              </div>
              <button
                className="lounge-icon"
                aria-label="Close lounge controls"
                onClick={() => setExploreOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="lounge-destinations">
              {Object.entries(LOUNGE_DESTINATIONS)
                .filter(([key]) => key !== 'entry')
                .map(([key, destination]) => (
                  <button
                    className="lounge-button"
                    key={key}
                    disabled={!connected || !me}
                    onClick={() => {
                      requestWalk(destination);
                      setExploreOpen(false);
                      if (key === 'tv') setTVOpen(true);
                      if (key === 'dance') setEmoteOpen(true);
                    }}
                  >
                    {key === 'tv' ? <Television size={17} /> : <PersonSimpleWalk size={17} />}
                    {destination.label}
                  </button>
                ))}
            </div>
            {away && (
              <button
                className="lounge-button keyboard-walk-trigger"
                disabled={!connected}
                onClick={() => {
                  setExploreOpen(false);
                  requestAnimationFrame(focusWorld);
                }}
              >
                <span className="walk-keys" aria-hidden="true">
                  <kbd>W</kbd>
                  <kbd>A</kbd>
                  <kbd>S</kbd>
                  <kbd>D</kbd>
                </span>
                Walk with keyboard
              </button>
            )}
            <div className="lounge-break-actions">
              {!away && !breakDestination && (
                <button
                  className="lounge-button primary"
                  disabled={!connected || !me}
                  onClick={() => requestWalk(LOUNGE_DESTINATIONS.entry)}
                >
                  {contesting ? 'Leave after this hand' : 'Get up and explore'}
                </button>
              )}
              {(away || breakDestination) && me && (
                <button
                  className="lounge-button primary"
                  disabled={!connected}
                  onClick={returnToSeat}
                >
                  <Armchair size={17} />
                  {mySeat === null
                    ? 'Choose a seat'
                    : breakDestination
                      ? 'Cancel break'
                      : 'Return to seat'}
                </button>
              )}
              {away && travelStatus === 'walking' && (
                <button
                  className="lounge-button"
                  disabled={!connected}
                  onClick={() => {
                    const point = myPositionRef.current;
                    if (point && isLoungeWalkable(point)) navigationRef.current.walk(point);
                  }}
                >
                  Stop walking
                </button>
              )}
              {away && mySeat !== null && !activeRoom?.handActive && (
                <button
                  className="lounge-button"
                  disabled={!connected}
                  onClick={() => wsClient.send({ t: 'leave_seat' })}
                >
                  Free my seat
                </button>
              )}
            </div>
            <p className="lounge-travel-status" role="status">
              {breakDestination
                ? 'You remain in this hand. You can still use all poker actions.'
                : travelStatus === 'getting-up'
                  ? 'Getting up from your chair…'
                  : travelStatus === 'walking'
                    ? 'Walking through the lounge…'
                    : travelStatus === 'sitting-down'
                      ? 'Taking your seat…'
                      : away
                        ? 'Reactions and chat work throughout the room.'
                        : 'Standing dances are available when you leave the chair.'}
            </p>
          </section>
        )}
        <LoungeTV
          open={tvOpen}
          onClose={() => setTVOpen(false)}
          videoRef={videoRef}
          channel={tvChannel}
          onChannel={setTVChannel}
        />
        {sceneError && (
          <div className="scene-message" role="status">
            <h2>The 3D scene is unavailable</h2>
            <p>{sceneError}</p>
            <Link className="lounge-button primary" to={`/room/${roomId}`}>
              Open 2D table
            </Link>
          </div>
        )}
        {(table.runTwice || (table.seatPicker && (!away || chooseSeat))) && (
          <div className="lounge-game-prompt">
            <fieldset disabled={!connected}>
              {table.runTwice}
              {(!away || chooseSeat) && table.seatPicker}
            </fieldset>
          </div>
        )}
        {cameraOpen && !customizeOpen && (
          <div
            id="lounge-camera-views"
            className="camera-controls lounge-glass"
            aria-label="Camera view"
          >
            <Camera size={16} />
            {CAMERA_VIEWS.map((label) => (
              <button
                key={label}
                aria-pressed={cameraView === label}
                onClick={() => {
                  selectCameraView(label);
                  setCameraOpen(false);
                  requestAnimationFrame(() => cameraButton.current?.focus());
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <span className="orbit-hint">
          {away
            ? 'WASD / arrows to walk · Tap floor to go · Drag to orbit'
            : 'Lounge to get up · Drag to orbit · Scroll to zoom'}
        </span>
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
                        disabled={!me || !connected}
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
              Take a break in Lounge, then click the world or choose Walk with keyboard. Use WASD or
              arrow keys to steer relative to the camera. Release to stop. Chat, menus, and poker
              decisions pause keyboard movement. Quick destinations work on every device.
            </p>
            <p>
              Tap a character or open Players to send a playful nudge. Reactions are shared with the
              table.
            </p>
            <p>
              Open Cards for community cards, both runouts, and public reveals. Tap your cards to
              enlarge them. Open Table for invites, records, seats, and preferences.
            </p>
            <p>
              Hide controls for a clear view. They return when you need to respond. Press Escape to
              bring them back.
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
                <p>
                  {away
                    ? 'Standing moves. Everyone sees them.'
                    : 'Seated reactions. Explore for standing moves.'}
                </p>
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
                    disabled={!connected || !me}
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
            <button
              className="target-action"
              disabled={!connected || !me}
              onClick={() => {
                sendReaction('wave');
                setTargetMenu(null);
              }}
            >
              <HandWaving size={17} />
              Wave hello
            </button>
            <button
              className="target-action"
              disabled={!connected || !me}
              onClick={() => {
                let point =
                  targetMenu.seat >= 0
                    ? seatExit(targetMenu.seat).at(-1)!
                    : worldPositionsRef.current.get(targetMenu.seat);
                if (point && isLoungeWalkable(point)) {
                  const center = point;
                  for (let step = 0; step < 8; step++) {
                    const angle = (step * Math.PI) / 4;
                    const beside = {
                      x: center.x + Math.cos(angle) * 0.85,
                      z: center.z + Math.sin(angle) * 0.85,
                    };
                    if (isLoungeWalkable(beside)) {
                      point = beside;
                      break;
                    }
                  }
                  requestWalk(point);
                }
                setTargetMenu(null);
              }}
            >
              <PersonSimpleWalk size={17} />
              Walk over
            </button>
            {(
              [
                ['Shove', 'shove'],
                ['High-energy slap', 'slap'],
                ['Toss a chip', 'chip'],
              ] as const
            )
              .filter(() => targetMenu.seat >= 0)
              .map(([label, kind]) => (
                <button
                  className="target-action"
                  disabled={!connected || !me}
                  key={kind}
                  onClick={() => {
                    wsClient.send({ t: 'emote', kind, targetSeat: targetMenu.seat });
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

      <footer className="lounge-footer" ref={dockRef} aria-label="Poker widgets">
        <div className="lounge-toolbar">
          <div
            className={cn(
              'turn-status lounge-glass',
              myTurn && 'your-turn',
              urgent && myTurn && 'urgent',
            )}
            role="status"
          >
            <i className="status-indicator" />
            <span>{status}</span>
            {handActive && seconds !== null && <strong>{seconds}s</strong>}
          </div>
          <div className="lounge-tools lounge-glass">
            <button
              className="lounge-button cards-trigger"
              aria-label={cardsOpen && hasCards ? 'Hide card widget' : 'Show card widget'}
              aria-expanded={cardsOpen && hasCards}
              aria-controls="lounge-card-widget"
              disabled={!hasCards}
              onClick={() => setCardsOpen(!cardsOpen)}
              title={hasCards ? 'Cards on the table' : 'Cards appear when a hand is dealt'}
            >
              <CardsThree size={18} />
              <span>Cards</span>
            </button>
            <button
              className="lounge-button"
              aria-label="Players"
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
              aria-label="React"
              aria-expanded={emoteOpen}
              disabled={!me || !connected}
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
        <div className="play-controls">
          <fieldset className="poker-actions" disabled={!connected}>
            {activeRoom && (
              <ActionBar
                mySeat={mySeat}
                isHost={!!isHost}
                urgent={urgent}
                hideIdleStart={false}
                presentation="overlay"
              />
            )}
          </fieldset>
        </div>
        {cardsOpen && hasCards && (
          <TableCards onEnlarge={table.showLargeCards} onResult={table.showResult} />
        )}
        {table.peekPanel && (
          <details
            ref={peekRef}
            className="lounge-peek"
            open={hand.peekOffers.length > 0 ? true : undefined}
          >
            <summary>
              {hand.peekOffers.length > 0 ? 'Private card offer — respond' : 'Private card peeks'}
            </summary>
            <fieldset disabled={!connected}>{table.peekPanel}</fieldset>
          </details>
        )}
        {cardsOpen && hasCards && (
          <div className="lounge-last-hand">
            <LastHandStrip roomId={roomId!} light />
          </div>
        )}
      </footer>
    </div>
  );
}
