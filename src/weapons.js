import * as THREE from 'three';

/**
 * Weapons, 15m Reticle, Projectile Pool, and Hit/Kill VFX Pool (Phase 1).
 * Strictly follows Neon design numbers from Spec Section 3:
 * - Rapid fire interval: 0.12s (trigger held)
 * - Single fire: 1 shot per press (A/B or X/Y, alternating allowed), same damage (1)
 * - Projectile flight time: 0.08s - 0.15s regardless of distance
 * - Hit (non-lethal):
 *     - White flash + blue sparks (30% of target width) at impact for 0.06s
 *     - Target white flash for 0.05s
 *     - Reticle hit-mark jumps +15% and returns over 0.12s
 *     - Haptic pulse: amplitude 0.50, 50ms
 *     - SFX: immediate
 * - Kill (lethal):
 *     - Explosion 1.8x - 2.2x target size (white flash sphere + blue ring + 8 debris)
 *     - Flash 0.12s + afterglow 0.45s
 *     - Reticle hit-mark jumps blue +25% and blinks for 0.20s
 *     - Haptic pulse: amplitude 0.85, 180ms
 *     - SFX: immediate
 *
 * @param {THREE.Scene} scene
 * @param {object} audio
 * @param {object} input
 */
export function createWeapons(scene, audio, input) {
  const vfxGroup = new THREE.Group();
  vfxGroup.name = 'WeaponsVFX';
  scene.add(vfxGroup);

  // --- 1. 15m Reticle (Double Ring + Hit-Mark Cross) ---
  const reticleGroup = new THREE.Group();
  reticleGroup.name = 'Reticle15m';

  const outerRingGeo = new THREE.RingGeometry(0.42, 0.48, 32);
  const outerRingMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);

  const innerRingGeo = new THREE.RingGeometry(0.20, 0.25, 24);
  const innerRingMat = new THREE.MeshBasicMaterial({
    color: 0xe0f2fe,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);

  // 4 diagonal hit-mark ticks around reticle
  const hitMarkGroup = new THREE.Group();
  const hitMarkMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.0,
    depthTest: false,
  });
  const tickGeo = new THREE.PlaneGeometry(0.055, 0.22);
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI / 4) + (i * Math.PI) / 2;
    const tick = new THREE.Mesh(tickGeo, hitMarkMat);
    const dist = 0.56;
    tick.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, 0);
    tick.rotation.z = angle - Math.PI / 2;
    hitMarkGroup.add(tick);
  }

  reticleGroup.add(outerRing, innerRing, hitMarkGroup);
  reticleGroup.renderOrder = 100;
  vfxGroup.add(reticleGroup);

  // Reticle animation states
  let lockBlend = 0;
  let hitMarkTimer = 0;
  let hitMarkDuration = 0.12;
  let hitMarkPeakScale = 1.15;
  let hitMarkIsKill = false;

  // --- 2. Projectile Pool ---
  const PROJ_POOL_SIZE = 28;
  const projGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6);
  projGeo.rotateX(Math.PI / 2); // Align along +Z/-Z for lookAt
  const projMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

  const projectiles = [];
  for (let i = 0; i < PROJ_POOL_SIZE; i++) {
    const mesh = new THREE.Mesh(projGeo, projMat);
    mesh.visible = false;
    vfxGroup.add(mesh);
    projectiles.push({
      active: false,
      mesh,
      startPos: new THREE.Vector3(),
      endPos: new THREE.Vector3(),
      elapsed: 0,
      flightTime: 0.1,
      target: null,
      damage: 1,
    });
  }

  // --- 3. Hit Flash + Blue Sparks Pool (0.06s, 30% target width) ---
  const HIT_POOL_SIZE = 16;
  const hitFlashGeo = new THREE.SphereGeometry(0.5, 10, 10);
  const sparkGeo = new THREE.BoxGeometry(0.08, 0.08, 0.32);

  const hitEffects = [];
  for (let i = 0; i < HIT_POOL_SIZE; i++) {
    const root = new THREE.Group();
    root.visible = false;

    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const flash = new THREE.Mesh(hitFlashGeo, flashMat);
    root.add(flash);

    const sparks = [];
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0x00d2ff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    for (let s = 0; s < 5; s++) {
      const sp = new THREE.Mesh(sparkGeo, sparkMat);
      root.add(sp);
      sparks.push({
        mesh: sp,
        dir: new THREE.Vector3(
          Math.cos((s / 5) * Math.PI * 2),
          Math.sin((s / 5) * Math.PI * 2),
          (s % 2 === 0 ? 0.5 : -0.5)
        ).normalize(),
      });
    }

    vfxGroup.add(root);
    hitEffects.push({
      active: false,
      root,
      flash,
      flashMat,
      sparkMat,
      sparks,
      elapsed: 0,
      duration: 0.06,
      baseSize: 1.0,
    });
  }

  // --- 4. Kill Explosion Pool (1.8x - 2.2x target size: 0.12s flash + 0.45s afterglow) ---
  const EXP_POOL_SIZE = 8;
  const expSphereGeo = new THREE.SphereGeometry(0.5, 16, 12);
  const expRingGeo = new THREE.RingGeometry(0.38, 0.5, 28);
  const expDebrisGeo = new THREE.OctahedronGeometry(0.14, 0);

  const explosions = [];
  for (let i = 0; i < EXP_POOL_SIZE; i++) {
    const root = new THREE.Group();
    root.visible = false;

    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const sphere = new THREE.Mesh(expSphereGeo, sphereMat);
    root.add(sphere);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00d2ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(expRingGeo, ringMat);
    root.add(ring);

    const debrisMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const debris = [];
    for (let d = 0; d < 8; d++) {
      const dm = new THREE.Mesh(expDebrisGeo, debrisMat);
      root.add(dm);
      const phi = (d / 8) * Math.PI * 2;
      const elev = (d % 2 === 0 ? 0.45 : -0.45);
      debris.push({
        mesh: dm,
        dir: new THREE.Vector3(Math.cos(phi), elev, Math.sin(phi)).normalize(),
        speed: 1.6 + (d % 3) * 0.45,
      });
    }

    vfxGroup.add(root);
    explosions.push({
      active: false,
      root,
      sphere,
      sphereMat,
      ring,
      ringMat,
      debris,
      debrisMat,
      elapsed: 0,
      flashDuration: 0.12,
      afterglowDuration: 0.45,
      maxScale: 4.0,
    });
  }

  // --- Firing State ---
  const RAPID_INTERVAL = 0.12; // seconds (Spec Section 2)
  let rapidCooldown = 0;
  let muzzleToggle = 0;

  // Reusable math temporaries
  const ray = new THREE.Ray();
  const hitPoint = new THREE.Vector3();
  const closestPoint = new THREE.Vector3();
  const muzzlePos = new THREE.Vector3();
  const reticlePos = new THREE.Vector3();

  function findRayTarget(origin, direction, targets) {
    ray.set(origin, direction);
    let bestTarget = null;
    let bestDist = Infinity;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t.active) continue;
      if (ray.intersectSphere(t.collider, hitPoint)) {
        const d = origin.distanceTo(hitPoint);
        if (d < bestDist) {
          bestDist = d;
          bestTarget = t;
          closestPoint.copy(hitPoint);
        }
      }
    }
    return { target: bestTarget, distance: bestDist, point: closestPoint };
  }

  function spawnHitEffect(pos, targetWidth) {
    for (let i = 0; i < hitEffects.length; i++) {
      const fx = hitEffects[i];
      if (!fx.active) {
        fx.active = true;
        fx.elapsed = 0;
        fx.duration = 0.06;
        fx.baseSize = targetWidth * 0.30; // 30% of enemy width
        fx.root.position.copy(pos);
        fx.root.visible = true;
        fx.flash.scale.setScalar(fx.baseSize);
        fx.flashMat.opacity = 1.0;
        fx.sparkMat.opacity = 1.0;
        for (let s = 0; s < fx.sparks.length; s++) {
          fx.sparks[s].mesh.position.set(0, 0, 0);
          fx.sparks[s].mesh.lookAt(
            pos.x + fx.sparks[s].dir.x,
            pos.y + fx.sparks[s].dir.y,
            pos.z + fx.sparks[s].dir.z
          );
        }
        return;
      }
    }
  }

  function spawnExplosion(pos, targetSize) {
    for (let i = 0; i < explosions.length; i++) {
      const ex = explosions[i];
      if (!ex.active) {
        ex.active = true;
        ex.elapsed = 0;
        ex.maxScale = targetSize * 2.0; // 1.8x - 2.2x enemy size
        ex.root.position.copy(pos);
        ex.root.visible = true;
        ex.sphere.scale.setScalar(0.3);
        ex.sphereMat.opacity = 1.0;
        ex.ring.scale.setScalar(0.3);
        ex.ringMat.opacity = 1.0;
        ex.debrisMat.opacity = 1.0;
        for (let d = 0; d < ex.debris.length; d++) {
          ex.debris[d].mesh.position.set(0, 0, 0);
          ex.debris[d].mesh.scale.setScalar(Math.max(0.5, targetSize * 0.35));
        }
        return;
      }
    }
  }

  function triggerHitMark(isKill) {
    hitMarkIsKill = isKill;
    if (isKill) {
      hitMarkPeakScale = 1.25; // +25%
      hitMarkDuration = 0.20;
    } else {
      hitMarkPeakScale = 1.15; // +15%
      hitMarkDuration = 0.12;
    }
    hitMarkTimer = hitMarkDuration;
  }

  function fireOneShot(origin, direction, targets, isSingle) {
    audio.playShot(isSingle);

    // Alternate left / right cockpit turret muzzles
    muzzleToggle = 1 - muzzleToggle;
    muzzlePos.set(muzzleToggle === 0 ? -0.56 : 0.56, -0.32, -1.22);

    const hitInfo = findRayTarget(origin, direction, targets);
    const dist = hitInfo.target ? hitInfo.distance : 45.0;
    const endPos = hitInfo.target
      ? hitInfo.point
      : hitPoint.copy(origin).addScaledVector(direction, dist);

    // Flight time clamped to 0.08s - 0.15s regardless of distance
    const flightTime = THREE.MathUtils.clamp(0.08 + (dist / 90.0) * 0.07, 0.08, 0.15);

    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (!p.active) {
        p.active = true;
        p.elapsed = 0;
        p.flightTime = flightTime;
        p.startPos.copy(muzzlePos);
        p.endPos.copy(endPos);
        p.target = hitInfo.target;
        p.damage = 1;
        p.mesh.position.copy(muzzlePos);
        p.mesh.lookAt(endPos);
        p.mesh.visible = true;
        return;
      }
    }
  }

  function applyImpact(proj, onKillCallback) {
    const t = proj.target;
    if (!t || !t.active) return;

    const killed = t.applyDamage(proj.damage);
    if (killed) {
      // Kill reaction
      spawnExplosion(t.mesh.position, t.width);
      triggerHitMark(true);
      input.pulseHaptics(0.85, 180);
      audio.playExplosion();
      if (onKillCallback) onKillCallback(t);
    } else {
      // Non-lethal hit reaction
      spawnHitEffect(proj.endPos, t.width);
      t.triggerFlash(0.05);
      triggerHitMark(false);
      input.pulseHaptics(0.50, 50);
      audio.playHit();
    }
  }

  function update(dt, inputState, targets, onKillCallback) {
    // --- 1. Update 15m Reticle ---
    if (inputState.hasActiveController) {
      reticleGroup.visible = true;
      reticlePos.copy(inputState.aimOrigin).addScaledVector(inputState.aimDirection, 15.0);
      reticleGroup.position.copy(reticlePos);
      reticleGroup.lookAt(inputState.aimOrigin);

      const hover = findRayTarget(inputState.aimOrigin, inputState.aimDirection, targets);
      const targetLock = hover.target ? 1.0 : 0.0;
      lockBlend += (targetLock - lockBlend) * Math.min(1, dt * 18);

      const ringScale = THREE.MathUtils.lerp(1.0, 0.72, lockBlend);
      outerRing.scale.setScalar(ringScale);
      innerRing.scale.setScalar(THREE.MathUtils.lerp(1.0, 0.65, lockBlend));

      outerRingMat.color.setHex(lockBlend > 0.5 ? 0x00ffff : 0x38bdf8);
      outerRingMat.opacity = THREE.MathUtils.lerp(0.80, 1.0, lockBlend);
      innerRingMat.opacity = THREE.MathUtils.lerp(0.75, 1.0, lockBlend);
    } else {
      reticleGroup.visible = false;
    }

    // Reticle Hit-Mark animation
    if (hitMarkTimer > 0) {
      hitMarkTimer = Math.max(0, hitMarkTimer - dt);
      const progress = 1.0 - hitMarkTimer / hitMarkDuration; // 0 -> 1
      const scale = THREE.MathUtils.lerp(hitMarkPeakScale, 1.0, progress);
      hitMarkGroup.scale.setScalar(scale);

      if (hitMarkIsKill) {
        hitMarkMat.color.setHex(0x00d2ff);
        // Blink during 0.20s
        const blink = Math.sin(progress * Math.PI * 6) >= 0 ? 1.0 : 0.2;
        hitMarkMat.opacity = blink * (1.0 - progress * 0.4);
      } else {
        hitMarkMat.color.setHex(0xffffff);
        hitMarkMat.opacity = 1.0 - progress;
      }
    } else {
      hitMarkMat.opacity = 0;
    }

    // --- 2. Handle Firing (Rapid 0.12s + Single A/B) ---
    if (rapidCooldown > 0) {
      rapidCooldown = Math.max(0, rapidCooldown - dt);
    }

    if (inputState.hasActiveController) {
      if (inputState.triggerHeld && rapidCooldown <= 0) {
        fireOneShot(inputState.aimOrigin, inputState.aimDirection, targets, false);
        rapidCooldown = RAPID_INTERVAL;
      }
      for (let s = 0; s < inputState.singleFireCount; s++) {
        fireOneShot(inputState.aimOrigin, inputState.aimDirection, targets, true);
      }
    }

    // --- 3. Update Projectiles ---
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (!p.active) continue;
      p.elapsed += dt;
      const t = Math.min(1.0, p.elapsed / p.flightTime);
      p.mesh.position.lerpVectors(p.startPos, p.endPos, t);

      if (t >= 1.0) {
        p.active = false;
        p.mesh.visible = false;
        applyImpact(p, onKillCallback);
      }
    }

    // --- 4. Update Hit Flash + Blue Sparks (0.06s) ---
    for (let i = 0; i < hitEffects.length; i++) {
      const fx = hitEffects[i];
      if (!fx.active) continue;
      fx.elapsed += dt;
      const t = fx.elapsed / fx.duration;
      if (t >= 1.0) {
        fx.active = false;
        fx.root.visible = false;
        continue;
      }
      fx.flashMat.opacity = 1.0 - t;
      fx.sparkMat.opacity = 1.0 - t;
      const spread = fx.baseSize * (0.4 + t * 1.4);
      for (let s = 0; s < fx.sparks.length; s++) {
        fx.sparks[s].mesh.position.copy(fx.sparks[s].dir).multiplyScalar(spread);
      }
    }

    // --- 5. Update Kill Explosions (0.12s flash + 0.45s afterglow) ---
    for (let i = 0; i < explosions.length; i++) {
      const ex = explosions[i];
      if (!ex.active) continue;
      ex.elapsed += dt;
      const total = ex.flashDuration + ex.afterglowDuration;
      if (ex.elapsed >= total) {
        ex.active = false;
        ex.root.visible = false;
        continue;
      }

      if (ex.elapsed <= ex.flashDuration) {
        const ft = ex.elapsed / ex.flashDuration;
        ex.sphere.scale.setScalar(THREE.MathUtils.lerp(0.3, ex.maxScale * 0.75, ft));
        ex.sphereMat.opacity = 1.0;
        ex.ring.scale.setScalar(THREE.MathUtils.lerp(0.3, ex.maxScale * 0.85, ft));
        ex.ringMat.opacity = 1.0;
      } else {
        const at = (ex.elapsed - ex.flashDuration) / ex.afterglowDuration;
        ex.sphere.scale.setScalar(THREE.MathUtils.lerp(ex.maxScale * 0.75, ex.maxScale, at));
        ex.sphereMat.opacity = Math.max(0, 1.0 - at * 1.5);
        ex.ring.scale.setScalar(THREE.MathUtils.lerp(ex.maxScale * 0.85, ex.maxScale * 1.15, at));
        ex.ringMat.opacity = 1.0 - at;
      }

      const overallT = ex.elapsed / total;
      ex.debrisMat.opacity = 1.0 - overallT;
      for (let d = 0; d < ex.debris.length; d++) {
        const deb = ex.debris[d];
        deb.mesh.position.copy(deb.dir).multiplyScalar(deb.speed * ex.maxScale * 0.45 * overallT);
        deb.mesh.rotation.x += dt * 8;
        deb.mesh.rotation.y += dt * 6;
      }
    }
  }

  function resetAll() {
    rapidCooldown = 0;
    hitMarkTimer = 0;
    for (const p of projectiles) {
      p.active = false;
      p.mesh.visible = false;
    }
    for (const fx of hitEffects) {
      fx.active = false;
      fx.root.visible = false;
    }
    for (const ex of explosions) {
      ex.active = false;
      ex.root.visible = false;
    }
  }

  return {
    update,
    resetAll,
  };
}
