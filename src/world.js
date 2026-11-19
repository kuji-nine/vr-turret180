import * as THREE from 'three';

/**
 * Create the 4-layer background world (Layers 1 & 2):
 * - Layer 1 (Far): 400m sphere with Earth + starfield (infinite-like, zero parallax)
 * - Layer 2 (Mid-Far): 120m arc with distant station modules
 * - Layer 2 (Mid-Near): 60m arc with station outer hull & trusses
 *
 * Texture paths follow Section 5 of the spec so Forge assets can replace placeholders
 * without any code changes.
 *
 * @param {THREE.Scene} scene
 */
export function createWorld(scene) {
  const worldGroup = new THREE.Group();
  worldGroup.name = 'WorldLayers';

  const loader = new THREE.TextureLoader();

  const loadTex = (path) => {
    const tex = loader.load(
      path,
      undefined,
      undefined,
      (err) => console.warn(`[world] Failed to load texture: ${path}`, err)
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  // --- Layer 1: Far background (400m sphere) ---
  const farTex = loadTex('./assets/textures/bg/bg_far.png');
  const farGeo = new THREE.SphereGeometry(400, 64, 32);
  const farMat = new THREE.MeshBasicMaterial({
    map: farTex,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const farSphere = new THREE.Mesh(farGeo, farMat);
  // Align texture center (u = 0.5) to face -Z (front)
  farSphere.rotation.y = Math.PI / 2;
  farSphere.renderOrder = -30;
  worldGroup.add(farSphere);

  // --- Layer 2 (Far): Mid-Far station modules (120m) ---
  // Cover front 180 deg (-95 to +95 deg) centered on -Z (theta = PI)
  const midArcLength = Math.PI * 1.06;
  const midArcStart = Math.PI - midArcLength / 2;

  const midFarTex = loadTex('./assets/textures/bg/bg_mid_far.png');
  const midFarGeo = new THREE.CylinderGeometry(
    120,
    120,
    130,
    48,
    1,
    true,
    midArcStart,
    midArcLength
  );
  const midFarMat = new THREE.MeshBasicMaterial({
    map: midFarTex,
    side: THREE.BackSide,
    transparent: true,
    alphaTest: 0.05,
    depthWrite: false,
  });
  const midFarMesh = new THREE.Mesh(midFarGeo, midFarMat);
  midFarMesh.renderOrder = -20;
  worldGroup.add(midFarMesh);

  // --- Layer 2 (Near): Mid-Near station outer hull & trusses (60m) ---
  const midNearTex = loadTex('./assets/textures/bg/bg_mid_near.png');
  const midNearGeo = new THREE.CylinderGeometry(
    60,
    60,
    68,
    48,
    1,
    true,
    midArcStart,
    midArcLength
  );
  const midNearMat = new THREE.MeshBasicMaterial({
    map: midNearTex,
    side: THREE.BackSide,
    transparent: true,
    alphaTest: 0.05,
    depthWrite: false,
  });
  const midNearMesh = new THREE.Mesh(midNearGeo, midNearMat);
  midNearMesh.renderOrder = -10;
  worldGroup.add(midNearMesh);

  // --- Lighting (no shadows for Quest 3 72fps target) ---
  const hemiLight = new THREE.HemisphereLight(0xeef6ff, 0x1e293b, 1.35);
  worldGroup.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
  dirLight.position.set(2.5, 4.0, 2.0);
  worldGroup.add(dirLight);

  scene.add(worldGroup);

  return {
    group: worldGroup,
    farSphere,
    midFarMesh,
    midNearMesh,
  };
}
