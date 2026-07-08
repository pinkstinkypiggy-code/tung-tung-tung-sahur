import * as THREE from 'three';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();

  // Camera slightly above eye level, looking down a touch (Talking-Tom-style framing)
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(0, 2.1, 4.6);
  // Aim lower so the character floats up in the frame: his head clears the top
  // UI band and his FEET sit above the bottom button row — whole body pokeable.
  const lookTarget = new THREE.Vector3(0, 1.2, 0);
  camera.lookAt(lookTarget);

  // Lighting: warm hemisphere ambient + one key directional
  const hemi = new THREE.HemisphereLight(0xfff1d6, 0xff9a5c, 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(2.5, 4.5, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffb347, 0.6);
  rim.position.set(-2, 2, -3);
  scene.add(rim);

  // Warm floor + rug (the sky is a CSS gradient behind the transparent canvas)
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 40),
    new THREE.MeshStandardMaterial({ color: 0xf49a63, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(1.7, 40),
    new THREE.MeshStandardMaterial({ color: 0xffcd6b, roughness: 1 })
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.005;
  scene.add(rug);

  const rugTrim = new THREE.Mesh(
    new THREE.RingGeometry(1.7, 1.86, 40),
    new THREE.MeshStandardMaterial({ color: 0xe0584f, roughness: 1, side: THREE.DoubleSide })
  );
  rugTrim.rotation.x = -Math.PI / 2;
  rugTrim.position.y = 0.005;
  scene.add(rugTrim);

  // Soft blob shadow under the character
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.8, 32),
    new THREE.MeshBasicMaterial({ color: 0x5a2410, transparent: true, opacity: 0.22 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  scene.add(shadow);

  function resize() {
    // Use the canvas's ACTUAL displayed box so the render-buffer aspect always
    // matches the display — otherwise Safari stretches the buffer and the
    // character looks squished/thin. Skip until the element is laid out.
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Frame by the VERTICAL field of view (constant across aspect ratios), so
    // the ~2.2-tall character always occupies the middle ~53% of the screen
    // (feet ~79%, head ~26%) — stably above the bottom buttons and below the
    // top UI on every phone. Also pull back on ultra-narrow screens so his arms
    // never clip horizontally.
    const t = Math.tan((camera.fov * Math.PI) / 180 / 2);
    const distV = 2.08 / t;
    const distH = 0.66 / (t * camera.aspect);
    camera.position.z = Math.max(distV, distH);
    camera.lookAt(lookTarget);
    camera.updateProjectionMatrix();
  }
  resize();
  // ResizeObserver is the reliable signal on mobile (fires on URL-bar show/hide,
  // rotation, and every layout change) with the true box size.
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 300));

  return { scene, camera, renderer, shadow };
}
