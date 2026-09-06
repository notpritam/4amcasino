import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ArrowsClockwise, HandWaving, PersonSimpleRun } from '@phosphor-icons/react';
import { buildCharacter, disposeObject, idleCharacter } from './character.ts';
import { EMOTES, type EmoteKind } from './emotes.ts';
import type { Avatar3D } from './avatar.ts';

export function CharacterPreview({ cfg }: { cfg: Avatar3D }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const [failed, setFailed] = useState(false);
  const [rotate, setRotate] = useState(false);
  const rotateRef = useRef(false);
  rotateRef.current = rotate;
  const poseRef = useRef<{ kind: EmoteKind; start: number } | null>(null);
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
    camera.position.set(0, 2.1, 5.6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.3, 0);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.minPolarAngle = 0.8;
    controls.maxPolarAngle = 1.8;
    scene.add(new THREE.HemisphereLight(0xe5e4ff, 0x261533, 2));
    for (const [color, intensity, position] of [
      [0xffffff, 4, [2, 4, 3]],
      [0xa78bfa, 5, [-3, 2, -2]],
      [0x60a5fa, 2, [3, 1, -1]],
    ] as const) {
      const light = new THREE.DirectionalLight(color, intensity);
      light.position.set(position[0], position[1], position[2]);
      scene.add(light);
    }
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.88, 0.12, 48),
      new THREE.MeshStandardMaterial({ color: 0x29213e, metalness: 0.65, roughness: 0.3 }),
    );
    pedestal.position.y = -0.045;
    scene.add(pedestal);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.82, 0.015, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xa78bfa }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.025;
    scene.add(ring);
    let character: THREE.Group | null = null;
    let previous: Avatar3D | null = null;
    let raf = 0;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const size = () => {
      const w = mount.clientWidth,
        h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(size);
    observer.observe(mount);
    size();
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (document.hidden) return;
      if (previous !== cfgRef.current) {
        if (character) {
          scene.remove(character);
          disposeObject(character);
        }
        previous = cfgRef.current;
        character = buildCharacter(previous);
        scene.add(character);
      }
      if (character) {
        character.position.y = 0;
        character.rotation.set(0, 0, 0);
        idleCharacter(character, now / 1000, 0, motion.matches);
        const pose = poseRef.current;
        if (pose) {
          const def = EMOTES[pose.kind];
          const progress = (now - pose.start) / (def?.dur ?? 1800);
          if (progress >= 1) poseRef.current = null;
          else if (def && !motion.matches) def.apply(character, progress, now / 1000);
        }
      }
      controls.autoRotate = rotateRef.current && !motion.matches;
      controls.autoRotateSpeed = 1.7;
      controls.update(dt);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div className="character-preview">
      <div
        ref={mountRef}
        className="character-preview-canvas"
        role="img"
        aria-label={`Live ${cfg.head} character preview with ${cfg.hat === 'none' ? 'no hat' : cfg.hat}. Drag to rotate.`}
      />
      {failed && (
        <p className="preview-fallback">
          3D preview is unavailable on this device. You can still customize and save.
        </p>
      )}
      <div className="preview-controls">
        <button
          type="button"
          aria-label="Rotate preview"
          aria-pressed={rotate}
          onClick={() => setRotate(!rotate)}
        >
          <ArrowsClockwise size={17} />
        </button>
        <span>Drag to explore</span>
        <button
          type="button"
          title="Preview wave"
          aria-label="Preview wave"
          onClick={() => {
            poseRef.current = { kind: 'wave', start: performance.now() };
          }}
        >
          <HandWaving size={18} />
        </button>
        <button
          type="button"
          title="Preview dance"
          aria-label="Preview dance"
          onClick={() => {
            poseRef.current = { kind: 'dance', start: performance.now() };
          }}
        >
          <PersonSimpleRun size={18} />
        </button>
      </div>
    </div>
  );
}
