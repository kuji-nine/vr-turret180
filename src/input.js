import * as THREE from 'three';

/**
 * Input handler for Phase 1 (Hardened for Quest Browser WebXR):
 * - VR (WebXR):
 *     - Tracks ONLY the selected dominant hand ('right' or 'left').
 *     - Unselected controller's connected, disconnected, selectstart/end, and gamepad
 *       events/data are completely ignored.
 *     - Uses the exact same XRInputSource (event.data) bound to the tracked controller
 *       for both aim ray and button/haptic input.
 *     - Trigger: selectstart/end OR gamepad.buttons[0] -> rapid fire (0.12s interval).
 *     - A/B (or X/Y on left): gamepad.buttons[4], buttons[5] rising edge -> single shot.
 *     - Per-frame XR reading is guarded with try/catch and finite-number checks so a
 *       transient input anomaly can never freeze the render loop.
 * - PC Preview:
 *     - Mouse cursor position aims the turret ray across the screen.
 *     - Left mouse button held -> rapid fire.
 *     - Z / X / J / K keys (non-repeat press) -> single shot (alternating allowed).
 *     - Right mouse drag -> look around (Yaw 360 deg, Pitch clamped).
 *     - WASD / Arrow / Q,E -> head lean (+-0.25m) for parallax check.
 *     - R -> reset view.
 *
 * @param {THREE.Group} cameraRig
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.WebGLRenderer} renderer
 */
export function createInput(cameraRig, camera, renderer) {
  const domElement = renderer.domElement;
  camera.rotation.order = 'YXZ';

  let enabled = false;
  let activeHand = 'right';

  // PC Preview camera state
  let yaw = 0;
  let pitch = 0;
  let isRightDragging = false;
  let lastDragX = 0;
  let lastDragY = 0;
  let leftMouseHeld = false;

  // Normalized device coordinates for PC mouse aim
  const mouseNdc = new THREE.Vector2(0, 0);
  const raycaster = new THREE.Raycaster();

  const keys = new Set();
  const headOffset = new THREE.Vector3(0, 0, 0);
  const MAX_OFFSET_XZ = 0.25;
  const MAX_OFFSET_Y = 0.20;
  const MOVE_SPEED = 0.65;

  // Output aim ray (reused every frame, zero GC)
  const aimOrigin = new THREE.Vector3();
  const aimDirection = new THREE.Vector3(0, 0, -1);

  // XR controllers (index 0 & 1). We bind ONLY the one matching activeHand.
  const xrControllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
  const boundSources = [null, null]; // XRInputSource per controller slot

  let activeSlot = -1;
  let activeInputSource = null;
  let xrSelectHeld = false;

  function refreshActiveBinding() {
    activeSlot = -1;
    activeInputSource = null;
    xrSelectHeld = false;
    prevBtn4 = false;
    prevBtn5 = false;

    for (let i = 0; i < boundSources.length; i++) {
      const src = boundSources[i];
      if (src && src.handedness === activeHand) {
        activeSlot = i;
        activeInputSource = src;
        break;
      }
    }
  }

  xrControllers.forEach((ctrl, idx) => {
    cameraRig.add(ctrl);

    ctrl.addEventListener('connected', (event) => {
      try {
        const src = event?.data || null;
        boundSources[idx] = src;
        // Ignore unselected hand completely; only bind if it matches activeHand
        if (src && src.handedness === activeHand) {
          activeSlot = idx;
          activeInputSource = src;
          xrSelectHeld = false;
          prevBtn4 = false;
          prevBtn5 = false;
        }
      } catch (err) {
        console.warn('[input] XR connected handler error:', err);
      }
    });

    ctrl.addEventListener('disconnected', () => {
      try {
        boundSources[idx] = null;
        if (idx === activeSlot) {
          refreshActiveBinding();
        }
      } catch (err) {
        console.warn('[input] XR disconnected handler error:', err);
      }
    });

    ctrl.addEventListener('selectstart', () => {
      if (idx !== activeSlot) return; // Completely ignore unselected controller
      xrSelectHeld = true;
    });

    ctrl.addEventListener('selectend', () => {
      if (idx !== activeSlot) return; // Completely ignore unselected controller
      xrSelectHeld = false;
    });
  });

  // Reusable math temporaries for XR aim extraction
  const tempMat4 = new THREE.Matrix4();
  const tempPos = new THREE.Vector3();
  const tempQuat = new THREE.Quaternion();
  const tempScale = new THREE.Vector3();
  const tempDir = new THREE.Vector3();
  const forwardVec = new THREE.Vector3(0, 0, -1);

  // Previous button states for rising-edge detection (buttons[4], buttons[5])
  let prevBtn4 = false;
  let prevBtn5 = false;
  let pcSingleFireQueue = 0;

  // --- PC Event Listeners ---
  const onContextMenu = (e) => {
    if (enabled) e.preventDefault();
  };

  const onPointerDown = (e) => {
    if (!enabled) return;
    if (e.button === 0) {
      leftMouseHeld = true;
      updateMouseNdc(e);
    } else if (e.button === 2) {
      isRightDragging = true;
      lastDragX = e.clientX;
      lastDragY = e.clientY;
    }
  };

  const onPointerMove = (e) => {
    if (!enabled) return;
    updateMouseNdc(e);
    if (isRightDragging) {
      const dx = e.clientX - lastDragX;
      const dy = e.clientY - lastDragY;
      lastDragX = e.clientX;
      lastDragY = e.clientY;
      const sensitivity = 0.0032;
      yaw -= dx * sensitivity;
      pitch -= dy * sensitivity;
      pitch = THREE.MathUtils.clamp(
        pitch,
        THREE.MathUtils.degToRad(-75),
        THREE.MathUtils.degToRad(75)
      );
    }
  };

  const onPointerUp = (e) => {
    if (e.button === 0) {
      leftMouseHeld = false;
    } else if (e.button === 2) {
      isRightDragging = false;
    }
  };

  const onKeyDown = (e) => {
    if (!enabled) return;
    keys.add(e.code);
    if (e.code === 'KeyR') {
      resetView();
    } else if (
      !e.repeat &&
      (e.code === 'KeyZ' || e.code === 'KeyX' || e.code === 'KeyJ' || e.code === 'KeyK')
    ) {
      pcSingleFireQueue += 1;
    }
  };

  const onKeyUp = (e) => {
    keys.delete(e.code);
  };

  function updateMouseNdc(e) {
    const rect = domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  domElement.addEventListener('contextmenu', onContextMenu);
  domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function resetView() {
    yaw = 0;
    pitch = 0;
    mouseNdc.set(0, 0);
    headOffset.set(0, 0, 0);
    cameraRig.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
  }

  function isFiniteVec3(v) {
    return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  }

  function pulseHaptics(amplitude, durationMs) {
    if (!renderer.xr.isPresenting) return;
    try {
      const actuators = activeInputSource?.gamepad?.hapticActuators;
      if (actuators && actuators.length > 0 && typeof actuators[0]?.pulse === 'function') {
        actuators[0].pulse(amplitude, durationMs);
      }
    } catch (err) {
      // Never let haptics failure interrupt gameplay
    }
  }

  // Reusable state returned each frame
  const frameState = {
    aimOrigin,
    aimDirection,
    triggerHeld: false,
    singleFireCount: 0,
    hasActiveController: false,
  };

  function isButtonDown(btn) {
    return Boolean(btn && (btn.pressed || btn.value > 0.5));
  }

  function update(dt, isXrPresenting) {
    frameState.triggerHeld = false;
    frameState.singleFireCount = 0;
    frameState.hasActiveController = false;

    if (!enabled && !isXrPresenting) {
      return frameState;
    }

    if (isXrPresenting) {
      try {
        // Ensure activeSlot matches activeHand if connected before setActiveHand
        if (activeSlot < 0 || !activeInputSource || activeInputSource.handedness !== activeHand) {
          refreshActiveBinding();
        }

        const activeCtrl = activeSlot >= 0 ? xrControllers[activeSlot] : null;
        if (activeCtrl) {
          activeCtrl.updateMatrixWorld(true);
          tempMat4.copy(activeCtrl.matrixWorld);
          tempMat4.decompose(tempPos, tempQuat, tempScale);
          tempDir.copy(forwardVec).applyQuaternion(tempQuat);

          if (isFiniteVec3(tempPos) && isFiniteVec3(tempDir) && tempDir.lengthSq() > 1e-6) {
            aimOrigin.copy(tempPos);
            aimDirection.copy(tempDir).normalize();
            frameState.hasActiveController = true;
          }
        }

        // Read gamepad from the EXACT SAME XRInputSource bound to activeCtrl
        const gp = activeInputSource?.gamepad;
        const buttons = gp?.buttons;
        if (buttons && buttons.length > 0) {
          const trigDown = isButtonDown(buttons[0]);
          frameState.triggerHeld = xrSelectHeld || trigDown;

          const b4 = buttons.length > 4 ? isButtonDown(buttons[4]) : false;
          const b5 = buttons.length > 5 ? isButtonDown(buttons[5]) : false;
          if (b4 && !prevBtn4) frameState.singleFireCount += 1;
          if (b5 && !prevBtn5) frameState.singleFireCount += 1;
          prevBtn4 = b4;
          prevBtn5 = b5;
        } else {
          frameState.triggerHeld = xrSelectHeld;
          prevBtn4 = false;
          prevBtn5 = false;
        }
      } catch (err) {
        console.warn('[input] XR update error:', err);
      }
      return frameState;
    }

    // --- PC Preview Mode ---
    let moveX = 0;
    let moveY = 0;
    let moveZ = 0;

    if (keys.has('KeyA') || keys.has('ArrowLeft')) moveX -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) moveX += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) moveZ -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) moveZ += 1;
    if (keys.has('KeyE')) moveY += 1;
    if (keys.has('KeyQ')) moveY -= 1;

    if (moveX !== 0 || moveY !== 0 || moveZ !== 0) {
      headOffset.x = THREE.MathUtils.clamp(
        headOffset.x + moveX * MOVE_SPEED * dt,
        -MAX_OFFSET_XZ,
        MAX_OFFSET_XZ
      );
      headOffset.y = THREE.MathUtils.clamp(
        headOffset.y + moveY * MOVE_SPEED * dt,
        -MAX_OFFSET_Y,
        MAX_OFFSET_Y
      );
      headOffset.z = THREE.MathUtils.clamp(
        headOffset.z + moveZ * MOVE_SPEED * dt,
        -MAX_OFFSET_XZ,
        MAX_OFFSET_XZ
      );
      cameraRig.position.copy(headOffset);
    }

    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    camera.rotation.z = 0;
    camera.updateMatrixWorld(true);

    raycaster.setFromCamera(mouseNdc, camera);
    aimOrigin.copy(raycaster.ray.origin);
    aimDirection.copy(raycaster.ray.direction).normalize();

    frameState.hasActiveController = true;
    frameState.triggerHeld = leftMouseHeld;
    frameState.singleFireCount = pcSingleFireQueue;
    pcSingleFireQueue = 0;

    return frameState;
  }

  return {
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) {
        isRightDragging = false;
        leftMouseHeld = false;
        xrSelectHeld = false;
        pcSingleFireQueue = 0;
        keys.clear();
      }
    },
    setActiveHand(hand) {
      activeHand = hand === 'left' ? 'left' : 'right';
      refreshActiveBinding();
    },
    getActiveHand() {
      return activeHand;
    },
    pulseHaptics,
    resetView,
    update,
  };
}
