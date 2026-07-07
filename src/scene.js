import * as THREE from 'three';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();

  // Camera slightly above eye level, looking down a touch (Talking-Tom-style framing)
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(0, 2.1, 4.6);
  // aim above the character so he sits in the lower 2/3 of the screen,
  // clear of the title / mode chips / hint band at the top
  const lookTarget = new THREE.Vector3(0, 1.62, 0);
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
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Pull back on narrow screens so the character fits with breathing room for the UI
    const fovRad = (camera.fov * Math.PI) / 180;
    const fitDist = 1.95 / (2 * Math.tan(fovRad / 2) * camera.aspect);
    camera.position.z = Math.max(4.6, fitDist);
    camera.lookAt(lookTarget);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 300));

  return { scene, camera, renderer, shadow };
}
