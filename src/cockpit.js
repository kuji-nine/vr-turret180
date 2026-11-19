import * as THREE from 'three';

/**
 * Create Layer 4: Cockpit (0.5m - 1.2m around player head at origin).
 * - White panels + blue emissive lines
 * - Rear (>= +-90 deg) completely closed by cockpit inner wall, floor, and ceiling
 * - Canopy frame + left/right gun turret bases
 * - Fixed center-lower console (-15..+15 deg az, -20..-35 deg el) showing SCORE & TIME only
 *   (NO durability / shield display per spec)
 *
 * @param {THREE.Scene} scene
 */
export function createCockpit(scene) {
  const group = new THREE.Group();
  group.name = 'Cockpit';

  // Shared materials (no per-frame allocations)
  const whitePanelMat = new THREE.MeshStandardMaterial({
    color: 0xe6edf5,
    roughness: 0.42,
    metalness: 0.18,
  });
  const innerWallMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.55,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  const darkFrameMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.6,
    metalness: 0.35,
  });
  const blueGlowMat = new THREE.MeshBasicMaterial({
    color: 0x00d2ff,
  });

  // Left & Right canopy edge alert materials (for Phase 2 edge-cue blinking)
  const leftAlertMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff });
  const rightAlertMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff });

  // --- 1. Rear Inner Wall (completely closes +-90 to 180 deg) ---
  // CylinderGeometry theta=0 is +Z (rear). Cover -94 deg to +94 deg around +Z.
  const rearWallGeo = new THREE.CylinderGeometry(
    1.05,
    1.05,
    1.65,
    36,
    1,
    true,
    -Math.PI * 0.52,
    Math.PI * 1.04
  );
  const rearWall = new THREE.Mesh(rearWallGeo, innerWallMat);
  rearWall.position.y = 0.05;
  group.add(rearWall);

  // Rear structural ribs & blue indirect light strips
  const ribAnglesDeg = [105, 135, 165, -165, -135, -105];
  const ribGeo = new THREE.BoxGeometry(0.06, 1.6, 0.06);
  const ribGlowGeo = new THREE.BoxGeometry(0.015, 1.45, 0.015);
  for (const deg of ribAnglesDeg) {
    const rad = THREE.MathUtils.degToRad(deg);
    const x = Math.sin(rad) * 1.01;
    const z = -Math.cos(rad) * 1.01;
    const rib = new THREE.Mesh(ribGeo, whitePanelMat);
    rib.position.set(x, 0.05, z);
    rib.lookAt(0, 0.05, 0);
    group.add(rib);

    const glow = new THREE.Mesh(ribGlowGeo, blueGlowMat);
    glow.position.set(Math.sin(rad) * 0.975, 0.05, -Math.cos(rad) * 0.975);
    glow.lookAt(0, 0.05, 0);
    group.add(glow);
  }

  // Horizontal rear console/backrest trim ring
  const rearRingGeo = new THREE.TorusGeometry(0.99, 0.015, 8, 32, Math.PI * 1.04);
  const rearRing = new THREE.Mesh(rearRingGeo, blueGlowMat);
  rearRing.rotation.x = Math.PI / 2;
  rearRing.rotation.z = -Math.PI * 0.02; // Align arc to +Z rear
  rearRing.position.y = 0.15;
  group.add(rearRing);

  // --- 2. Floor & Ceiling ---
  const floorGeo = new THREE.CircleGeometry(1.12, 36);
  const floor = new THREE.Mesh(floorGeo, darkFrameMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.75;
  group.add(floor);

  // Rear ceiling (covers overhead & behind so looking up/back shows no gap)
  const ceilingGeo = new THREE.CircleGeometry(1.12, 36, 0, Math.PI * 1.15);
  const ceiling = new THREE.Mesh(ceilingGeo, innerWallMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.rotation.z = -Math.PI * 0.075;
  ceiling.position.y = 0.82;
  group.add(ceiling);

  // Overhead canopy header bar connecting rear ceiling to front canopy frame
  const headerArchGeo = new THREE.TorusGeometry(0.92, 0.035, 8, 28, Math.PI);
  const headerArch = new THREE.Mesh(headerArchGeo, whitePanelMat);
  headerArch.position.set(0, 0.45, -0.35);
  headerArch.rotation.x = -0.45;
  group.add(headerArch);

  const headerGlowGeo = new THREE.TorusGeometry(0.895, 0.008, 6, 28, Math.PI);
  const headerGlow = new THREE.Mesh(headerGlowGeo, blueGlowMat);
  headerGlow.position.copy(headerArch.position);
  headerGlow.rotation.copy(headerArch.rotation);
  group.add(headerGlow);

  // --- 3. Front Lower Skirt & Side Canopy Pillars (+-90 deg boundaries & +-25 deg thin struts) ---
  // Front lower cowling (closes below -20 deg elevation across front 180 deg)
  const frontSkirtGeo = new THREE.CylinderGeometry(
    0.96,
    1.05,
    0.55,
    32,
    1,
    true,
    Math.PI * 0.48,
    Math.PI * 1.04
  );
  const frontSkirt = new THREE.Mesh(frontSkirtGeo, innerWallMat);
  frontSkirt.position.y = -0.52;
  group.add(frontSkirt);

  // Left & Right +-90 deg boundary pillars with cue light strips
  const sidePillarGeo = new THREE.BoxGeometry(0.06, 1.35, 0.08);
  const sideCueGeo = new THREE.BoxGeometry(0.018, 1.15, 0.018);

  const leftPillar = new THREE.Mesh(sidePillarGeo, whitePanelMat);
  leftPillar.position.set(-0.98, 0.08, 0.0);
  group.add(leftPillar);

  const leftCue = new THREE.Mesh(sideCueGeo, leftAlertMat);
  leftCue.position.set(-0.94, 0.08, -0.03);
  group.add(leftCue);

  const rightPillar = new THREE.Mesh(sidePillarGeo, whitePanelMat);
  rightPillar.position.set(0.98, 0.08, 0.0);
  group.add(rightPillar);

  const rightCue = new THREE.Mesh(sideCueGeo, rightAlertMat);
  rightCue.position.set(0.94, 0.08, -0.03);
  group.add(rightCue);

  // Thin +-35 deg upper-diagonal canopy struts (non-obstructive framing)
  for (const side of [-1, 1]) {
    const strutGeo = new THREE.BoxGeometry(0.025, 0.85, 0.025);
    const strut = new THREE.Mesh(strutGeo, darkFrameMat);
    strut.position.set(side * 0.56, 0.42, -0.68);
    strut.rotation.z = side * 0.35;
    strut.rotation.x = 0.55;
    group.add(strut);
  }

  // --- 4. Left & Right Turret Barrel Bases ---
  const turretBaseGeo = new THREE.BoxGeometry(0.16, 0.14, 0.36);
  const barrelGeo = new THREE.CylinderGeometry(0.032, 0.042, 0.48, 12);
  const muzzleRingGeo = new THREE.TorusGeometry(0.036, 0.006, 6, 16);

  for (const side of [-1, 1]) {
    const turret = new THREE.Group();
    turret.position.set(side * 0.56, -0.34, -0.74);

    const base = new THREE.Mesh(turretBaseGeo, whitePanelMat);
    turret.add(base);

    const barrel = new THREE.Mesh(barrelGeo, darkFrameMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.34);
    turret.add(barrel);

    const ring = new THREE.Mesh(muzzleRingGeo, blueGlowMat);
    ring.position.set(0, 0.02, -0.57);
    turret.add(ring);

    group.add(turret);
  }

  // --- 5. Fixed Lower-Center Console (az -15..+15 deg, el -20..-35 deg) ---
  const consoleBackingGeo = new THREE.BoxGeometry(0.40, 0.18, 0.03);
  const consoleBacking = new THREE.Mesh(consoleBackingGeo, whitePanelMat);
  consoleBacking.position.set(0, -0.36, -0.69);
  consoleBacking.lookAt(0, 0, 0);
  group.add(consoleBacking);

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 224;
  const ctx = canvas.getContext('2d');

  const consoleTex = new THREE.CanvasTexture(canvas);
  consoleTex.colorSpace = THREE.SRGBColorSpace;

  const consoleScreenGeo = new THREE.PlaneGeometry(0.36, 0.155);
  const consoleScreenMat = new THREE.MeshBasicMaterial({ map: consoleTex });
  const consoleScreen = new THREE.Mesh(consoleScreenGeo, consoleScreenMat);
  consoleScreen.position.set(0, -0.352, -0.672);
  consoleScreen.lookAt(0, 0, 0);
  group.add(consoleScreen);

  let lastRenderedScore = -1;
  let lastRenderedTenth = -1;

  function drawConsole(score, elapsedSeconds) {
    const clampedTime = Math.min(90.0, Math.max(0.0, elapsedSeconds));
    const tenth = Math.floor(clampedTime * 10);
    if (score === lastRenderedScore && tenth === lastRenderedTenth) {
      return;
    }
    lastRenderedScore = score;
    lastRenderedTenth = tenth;

    // Background
    ctx.fillStyle = '#091526';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Outer blue glowing border
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

    // Subtle divider
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(256, 26);
    ctx.lineTo(256, 152);
    ctx.stroke();

    // SCORE (Left)
    ctx.fillStyle = '#7dd3fc';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SCORE', 132, 54);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px "Consolas", "Courier New", monospace';
    ctx.fillText(String(score).padStart(4, '0'), 132, 118);

    // TIME (Right)
    ctx.fillStyle = '#7dd3fc';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillText('TIME', 380, 54);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px "Consolas", "Courier New", monospace';
    ctx.fillText(`${clampedTime.toFixed(1)}s`, 380, 116);

    // Footer status (NO durability / shield display)
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 17px "Segoe UI", sans-serif';
    ctx.fillText('STAGE 1 // PHASE 1: WEAPONS TEST', 256, 188);

    consoleTex.needsUpdate = true;
  }

  // Initial draw
  drawConsole(0, 0);

  scene.add(group);

  return {
    group,
    updateConsole: drawConsole,
    setEdgeAlert(side, active) {
      const targetMat = side === 'left' ? leftAlertMat : rightAlertMat;
      targetMat.color.setHex(active ? 0xff4d6d : 0x00d2ff);
    },
  };
}
