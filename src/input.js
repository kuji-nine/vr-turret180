import * as THREE from 'three';

/**
 * Input handler for Phase 1:
 * - VR (WebXR):
 *     - Tracks ONLY the selected dominant hand ('right' or 'left'); ignores the other controller completely.
 *     - Trigger (buttons[0]) held -> rapid fire (0.12s interval handled in weapons.js).
 *     - A/B (or X/Y on left: buttons[4], buttons[5]) rising edge -> single shot per press (alternating allowed).
 *     - Haptic pulse sent ONLY to the active hand's gamepad.
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

  // XR controllers (index 0 & 1) mapped dynamically by handedness
  const xrControllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
  const controllerHandedness = [null, null];
  xrControllers.forEach((ctrl, idx) => {
    cameraRig.add(ctrl);
    ctrl.addEventListener('connected', (event) => {
      controllerHandedness[idx] = event.data?.handedness || null;
    });
    ctrl.addEventListener('disconnected', () => {
      controllerHandedness[idx] = null;
    });
  });

  // Reusable math temporaries for XR aim extraction
  const tempMat4 = new THREE.Matrix4();
  const tempPos = new THREE.Vector3();
  const tempQuat = new THREE.Quaternion();
  const tempScale = new THREE.Vector3();
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

  function getActiveXrInputSource() {
    const session = renderer.xr.getSession();
    if (!session) return null;
    for (const source of session.inputSources) {
      if (source.handedness === activeHand) {
        return source;
      }
    }
    return null;
  }

  function pulseHaptics(amplitude, durationMs) {
    if (!renderer.xr.isPresenting) return;
    const source = getActiveXrInputSource();
    const actuators = source?.gamepad?.hapticActuators;
    if (actuators && actuators.length > 0 && typeof actuators[0].pulse === 'function') {
      actuators[0].pulse(amplitude, durationMs);
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

  function update(dt, isXrPresenting) {
    frameState.triggerHeld = false;
    frameState.singleFireCount = 0;
    frameState.hasActiveController = false;

    if (!enabled && !isXrPresenting) {
      return frameState;
    }

    if (isXrPresenting) {
      // Find the controller matching activeHand ONLY; ignore the other hand
      let activeCtrl = null;
      for (let i = 0; i < xrControllers.length; i++) {
        if (controllerHandedness[i] === activeHand) {
          activeCtrl = xrControllers[i];
          break;
        }
      }

      if (activeCtrl) {
        activeCtrl.updateMatrixWorld(true);
        tempMat4.copy(activeCtrl.matrixWorld);
        tempMat4.decompose(tempPos, tempQuat, tempScale);
        aimOrigin.copy(tempPos);
        aimDirection.copy(forwardVec).applyQuaternion(tempQuat).normalize();
        frameState.hasActiveController = true;
      }

      const source = getActiveXrInputSource();
      const gp = source?.gamepad;
      if (gp && gp.buttons) {
        const trig = gp.buttons[0];
        frameState.triggerHeld = Boolean(trig && (trig.pressed || trig.value > 0.5));

        const b4 = Boolean(gp.buttons[4]?.pressed);
        const b5 = Boolean(gp.buttons[5]?.pressed);
        if (b4 && !prevBtn4) frameState.singleFireCount += 1;
        if (b5 && !prevBtn5) frameState.singleFireCount += 1;
        prevBtn4 = b4;
        prevBtn5 = b5;
      } else {
        prevBtn4 = false;
        prevBtn5 = false;
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
        pcSingleFireQueue = 0;
        keys.clear();
      }
    },
    setActiveHand(hand) {
      activeHand = hand === 'left' ? 'left' : 'right';
      prevBtn4 = false;
      prevBtn5 = false;
    },
    getActiveHand() {
      return activeHand;
    },
    pulseHaptics,
    resetView,
    update,
  };
}
