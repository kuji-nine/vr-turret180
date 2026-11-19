import * as THREE from 'three';
import { createWorld } from './world.js';
import { createCockpit } from './cockpit.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createWeapons } from './weapons.js';

// --- DOM Elements ---
const titleOverlay = document.getElementById('title-overlay');
const previewHud = document.getElementById('preview-hud');
const btnStartVr = document.getElementById('btn-start-vr');
const btnStartPc = document.getElementById('btn-start-pc');
const btnBackTitle = document.getElementById('btn-back-title');
const xrStatusEl = document.getElementById('xr-status');
const handRadios = document.querySelectorAll('input[name="hand"]');

// --- Renderer & Scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
renderer.domElement.id = 'app-canvas';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040812);

const cameraRig = new THREE.Group();
cameraRig.name = 'CameraRig';
scene.add(cameraRig);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.05,
  500
);
cameraRig.add(camera);

// --- Build World, Cockpit, Input, Audio, Weapons ---
createWorld(scene);
const cockpit = createCockpit(scene);
const input = createInput(cameraRig, camera, renderer);
const audio = createAudio();
const weapons = createWeapons(scene, audio, input);

// --- Phase 1 Dummy Targets (for testing hit/kill VFX, haptics, rapid & single fire) ---
const dummyGroup = new THREE.Group();
dummyGroup.name = 'Phase1DummyTargets';
scene.add(dummyGroup);

function createDummyTarget({ x, y, z, maxHp, width, scoreValue }) {
  const root = new THREE.Group();
  root.position.set(x, y, z);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xe6edf5,
    roughness: 0.38,
    metalness: 0.2,
    emissive: 0x000000,
  });
  const coreMat = new THREE.MeshBasicMaterial({
    color: maxHp >= 10 ? 0x00d2ff : 0x38bdf8,
  });

  const bodyGeo = new THREE.OctahedronGeometry(width * 0.5, 0);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  root.add(body);

  const ringGeo = new THREE.TorusGeometry(width * 0.62, width * 0.06, 6, 20);
  const ring = new THREE.Mesh(ringGeo, coreMat);
  root.add(ring);

  dummyGroup.add(root);

  const collider = new THREE.Sphere(new THREE.Vector3(x, y, z), width * 0.68);
  let hp = maxHp;
  let active = true;
  let flashTimer = 0;
  let respawnTimer = 0;

  return {
    get active() {
      return active;
    },
    mesh: root,
    collider,
    width,
    scoreValue,
    applyDamage(dmg) {
      if (!active) return false;
      hp -= dmg;
      if (hp <= 0) {
        active = false;
        root.visible = false;
        respawnTimer = 2.0; // Respawn after 2s for repeated Phase 1 testing
        return true;
      }
      return false;
    },
    triggerFlash(duration) {
      flashTimer = duration;
      bodyMat.emissive.setHex(0xffffff);
      bodyMat.emissiveIntensity = 1.0;
    },
    reset() {
      hp = maxHp;
      active = true;
      flashTimer = 0;
      respawnTimer = 0;
      bodyMat.emissive.setHex(0x000000);
      root.visible = true;
    },
    update(dt) {
      if (active) {
        ring.rotation.z += dt * 1.4;
        body.rotation.y += dt * 0.8;
        if (flashTimer > 0) {
          flashTimer = Math.max(0, flashTimer - dt);
          if (flashTimer === 0) {
            bodyMat.emissive.setHex(0x000000);
          }
        }
      } else if (respawnTimer > 0) {
        respawnTimer = Math.max(0, respawnTimer - dt);
        if (respawnTimer === 0) {
          hp = maxHp;
          active = true;
          bodyMat.emissive.setHex(0x000000);
          root.visible = true;
        }
      }
    },
  };
}

const dummyTargets = [
  createDummyTarget({ x: -7.5, y: 1.5, z: -22, maxHp: 1, width: 1.6, scoreValue: 100 }),
  createDummyTarget({ x: 7.5, y: 1.2, z: -22, maxHp: 2, width: 2.0, scoreValue: 200 }),
  createDummyTarget({ x: 0.0, y: 0.5, z: -30, maxHp: 10, width: 3.4, scoreValue: 500 }),
];

// --- Game State ---
let mode = 'TITLE'; // 'TITLE' | 'PC_PREVIEW' | 'VR'
let elapsedSeconds = 0;
let score = 0;
let lastTimeMs = performance.now();

function getSelectedHand() {
  for (const radio of handRadios) {
    if (radio.checked) return radio.value;
  }
  return 'right';
}

function enterPlayState(nextMode) {
  mode = nextMode;
  elapsedSeconds = 0;
  score = 0;
  audio.unlock();
  input.setActiveHand(getSelectedHand());
  input.resetView();
  input.setEnabled(nextMode === 'PC_PREVIEW');
  weapons.resetAll();
  for (const t of dummyTargets) t.reset();

  titleOverlay.classList.add('hidden');
  if (nextMode === 'PC_PREVIEW') {
    previewHud.classList.remove('hidden');
  } else {
    previewHud.classList.add('hidden');
  }

  cockpit.updateConsole(score, elapsedSeconds);
}

function returnToTitle() {
  mode = 'TITLE';
  input.setEnabled(false);
  input.resetView();
  weapons.resetAll();
  previewHud.classList.add('hidden');
  titleOverlay.classList.remove('hidden');
}

// --- WebXR Availability Check ---
async function checkXrSupport() {
  if (!('xr' in navigator)) {
    xrStatusEl.textContent = 'このブラウザは WebXR に非対応です（PCプレビューをご利用ください）';
    btnStartVr.disabled = true;
    return;
  }
  try {
    const supported = await navigator.xr.isSessionSupported('immersive-vr');
    if (supported) {
      xrStatusEl.textContent = 'WebXR (immersive-vr) 利用可能';
      btnStartVr.disabled = false;
    } else {
      xrStatusEl.textContent = 'VRヘッドセット未検出（PCプレビューをご利用ください）';
      btnStartVr.disabled = true;
    }
  } catch (err) {
    xrStatusEl.textContent = `WebXR 確認エラー: ${err.message}`;
    btnStartVr.disabled = true;
  }
}

checkXrSupport();

// --- UI Event Listeners ---
btnStartPc.addEventListener('click', () => {
  enterPlayState('PC_PREVIEW');
});

btnBackTitle.addEventListener('click', () => {
  returnToTitle();
});

btnStartVr.addEventListener('click', async () => {
  if (!navigator.xr) return;
  try {
    audio.unlock(); // Unlock WebAudio synchronously inside user gesture before await
    btnStartVr.disabled = true;
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local'],
    });
    session.addEventListener('end', () => {
      btnStartVr.disabled = false;
      returnToTitle();
    });
    await renderer.xr.setSession(session);
    enterPlayState('VR');
  } catch (err) {
    xrStatusEl.textContent = `VR起動に失敗しました: ${err.message}`;
    btnStartVr.disabled = false;
  }
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && mode === 'PC_PREVIEW') {
    returnToTitle();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Main Loop ---
renderer.setAnimationLoop((nowMs) => {
  const dt = Math.min(0.1, Math.max(0, (nowMs - lastTimeMs) * 0.001));
  lastTimeMs = nowMs;

  const isXr = renderer.xr.isPresenting;

  if (mode !== 'TITLE') {
    elapsedSeconds = Math.min(90.0, elapsedSeconds + dt);
    try {
      const inputState = input.update(dt, isXr);
      for (let i = 0; i < dummyTargets.length; i++) {
        dummyTargets[i].update(dt);
      }
      weapons.update(dt, inputState, dummyTargets, (killedTarget) => {
        score += killedTarget.scoreValue;
      });
      cockpit.updateConsole(score, elapsedSeconds);
    } catch (err) {
      console.warn('[main] Frame update error:', err);
    }
  }

  renderer.render(scene, camera);
});
