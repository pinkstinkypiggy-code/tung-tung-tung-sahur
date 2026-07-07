import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Drop the real Sketchfab model here (see README) and it will be used automatically.
const GLB_URL = 'assets/tung-tung-tung-sahur.glb';
const TARGET_HEIGHT = 2.2;

// The Sketchfab model's bat, in raw geometry space (measured offline with a
// mesh analysis script). Triangles inside this capsule get hidden when another
// weapon is equipped; the capsule stops below the fingers so the fist survives.
const BAT_TIP = new THREE.Vector3(-1.594, -1.324, 0.644);
const BAT_DIR = new THREE.Vector3(0.393, 0.769, 0.503); // tip -> hand
const BAT_RADIUS = 0.42;
const BAT_T0 = -0.75; // just beyond the tip
const BAT_T1 = 1.7; // where the fat barrel capsule stops (leg gets close after this)
// narrow bridge segment: just the grip between barrel end and fist bottom
const BATM_T1 = 2.15;
const BATM_RADIUS = 0.24;
const BAT_GRIP_T = 2.35; // center of the fist, for anchoring replacement weapons
// second capsule: the grip end poking out ABOVE the fist. The real grip drifts
// ~0.28 off the tip-fitted axis, so this one has its own measured endpoints.
const BAT2_A = new THREE.Vector3(-0.49, 0.56, 2.21);
const BAT2_B = new THREE.Vector3(-0.473, 1.53, 2.91);
const BAT2_RADIUS = 0.31;

const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
const smooth = (q) => q * q * (3 - 2 * q);

// Instant stand-in shown while the 3 MB GLB downloads, so the stage is never
// empty on a slow phone/TikTok connection. Swapped out once the real model loads.
export function buildPlaceholder() {
  const { model } = buildProceduralCharacter();
  model.rotation.z = 0; // arms rest naturally without a weapon
  return model;
}

export async function createCharacter(scene) {
  let model = null;
  let parts = null;
  let mixer = null;
  let glbMesh = null;

  try {
    // Load the GLB directly (no HEAD pre-check — iOS Safari can hang on HEAD
    // requests, which left mobile stuck on the placeholder). If the URL 404s or
    // returns HTML, loadAsync throws and we fall back to the built-in character.
    const gltf = await new GLTFLoader().loadAsync(GLB_URL);
    const candidate = gltf.scene;
    // Sanity check: make sure it actually contains a renderable mesh.
    let hasMesh = false;
    candidate.traverse((o) => {
      if (o.isMesh) { hasMesh = true; glbMesh = o; }
    });
    if (!hasMesh) throw new Error('GLB has no mesh');
    model = candidate;
    // Normalize: stand on y=0, TARGET_HEIGHT tall, centered
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const s = TARGET_HEIGHT / size.y;
    model.scale.setScalar(s);
    box.setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
    if (gltf.animations && gltf.animations.length) {
      mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(gltf.animations[0]).play();
    }
    console.log('[character] loaded GLB model');
  } catch (e) {
    console.warn('[character] GLB load failed, using built-in character:', e?.message || e);
    model = null;
    glbMesh = null;
  }

  if (!model) {
    ({ model, parts } = buildProceduralCharacter());
  }

  const root = new THREE.Group(); // pointer-tracking rotation
  const body = new THREE.Group(); // bob / squash / reactions
  body.add(model);
  root.add(body);
  scene.add(root);
  root.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(model);
  const charH = bounds.max.y - bounds.min.y;

  // ---- baked-in bat show/hide (GLB only): swap between two index buffers ----
  let setBatVisible = () => {};
  if (glbMesh && glbMesh.geometry.index) {
    const geo = glbMesh.geometry;
    const posA = geo.attributes.position;
    const fullIdx = geo.index.array;
    const kept = [];
    const v = new THREE.Vector3();
    const rel = new THREE.Vector3();
    const seg = new THREE.Vector3();
    const distToSeg = (p, A, B) => {
      seg.subVectors(B, A);
      const t = THREE.MathUtils.clamp(rel.subVectors(p, A).dot(seg) / seg.lengthSq(), 0, 1);
      return rel.subVectors(p, A).addScaledVector(seg, -t).length();
    };
    const A1 = BAT_TIP.clone().addScaledVector(BAT_DIR, BAT_T0);
    const B1 = BAT_TIP.clone().addScaledVector(BAT_DIR, BAT_T1);
    const BM = BAT_TIP.clone().addScaledVector(BAT_DIR, BATM_T1);
    const insideBat = (vi) => {
      v.fromBufferAttribute(posA, vi);
      return (
        distToSeg(v, A1, B1) < BAT_RADIUS ||
        distToSeg(v, B1, BM) < BATM_RADIUS ||
        distToSeg(v, BAT2_A, BAT2_B) < BAT2_RADIUS
      );
    };
    for (let t = 0; t < fullIdx.length; t += 3) {
      if (!(insideBat(fullIdx[t]) && insideBat(fullIdx[t + 1]) && insideBat(fullIdx[t + 2]))) {
        kept.push(fullIdx[t], fullIdx[t + 1], fullIdx[t + 2]);
      }
    }
    const IndexArray = fullIdx.constructor;
    const fullAttr = geo.index;
    const noBatAttr = new THREE.BufferAttribute(new IndexArray(kept), 1);
    setBatVisible = (show) => geo.setIndex(show ? fullAttr : noBatAttr);
  }

  // ---- weapons: grip at origin, extending +y ----
  const glbMode = !parts;
  const weapons = buildWeapons();
  const anchor = new THREE.Group();
  if (glbMode && glbMesh) {
    // anchor inside the sculpted fist, aligned with the old bat's axis
    const gripWorld = glbMesh.localToWorld(BAT_TIP.clone().addScaledVector(BAT_DIR, BAT_GRIP_T));
    const tipWorld = glbMesh.localToWorld(BAT_TIP.clone());
    const towardTip = tipWorld.clone().sub(gripWorld).normalize();
    anchor.position.copy(body.worldToLocal(gripWorld.clone()));
    anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), towardTip);
    body.add(anchor);
  } else if (parts) {
    // inside the raised right arm, pointing past the hand
    anchor.position.set(0, -0.56, 0);
    anchor.rotation.z = Math.PI - 0.15;
    parts.armR.add(anchor);
  }
  weapons.forEach((w) => anchor.add(w.group));

  const setWeaponVisible = (idx) => {
    // in GLB mode slot 0 is his own sculpted bat
    weapons.forEach((w, i) => (w.group.visible = i === idx && !(glbMode && i === 0)));
    setBatVisible(idx === 0);
  };
  setWeaponVisible(0);

  // ---- dizzy stars (head-punch effect) ----
  const stars = buildStars();
  stars.group.position.y = charH * 0.93;
  stars.group.visible = false;
  body.add(stars.group);

  // ---- dirt splats + wash bubbles ----
  const dirtGroup = new THREE.Group();
  body.add(dirtGroup);
  const splatGeo = new THREE.SphereGeometry(1, 10, 8);
  const splatMats = [0x4a3417, 0x3e2c12, 0x5a4520].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 })
  );
  // one particle pool drives bubbles, bursts, dust and shockwave rings
  const partGeo = new THREE.SphereGeometry(1, 8, 6);
  const ringGeo = new THREE.RingGeometry(0.09, 0.13, 26);
  const particles = [];
  const spawnP = (geo, color, pos, vel, opts = {}) => {
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: opts.opacity ?? 0.9, side: THREE.DoubleSide,
      })
    );
    m.scale.setScalar(opts.size ?? 0.045);
    m.position.copy(pos);
    scene.add(m);
    particles.push({
      m, vel, life: opts.life ?? 0.6, maxLife: opts.life ?? 0.6,
      gravity: opts.gravity ?? 0, grow: opts.grow ?? 0,
    });
  };
  const dirtRay = new THREE.Raycaster();

  const char = {
    root,
    state: 'idle', // idle | listening | talking
    reaction: null, // { zone, t, dur }
    pointer: { x: 0, y: 0 },
    amp: 0, // playback amplitude 0..1
    dirtCount: 0,
    onEvent: null, // ('thud') etc — wired up by main.js for sounds
    _cur: { posY: 0, rotX: 0, rotY: 0, rotZ: 0, sy: 1, sxz: 1, eyeS: 1 },

    setState(s) { this.state = s; },

    setPointer(x, y) { this.pointer.x = x; this.pointer.y = y; },

    setTalkAmplitude(a) { this.amp = damp(this.amp, a, 18, 1 / 60); },

    react(zone) {
      // don't interrupt him mid-fall
      if (this.reaction?.zone === 'legs' && this.reaction.t / this.reaction.dur < 0.85) return;
      const durs = { head: 1.3, belly: 0.75, legs: 1.9, switch: 0.7, dirty: 0.8, jam: 0.22 };
      this.reaction = { zone, t: 0, dur: durs[zone] ?? 0.7 };
    },

    zoneAt(worldY) {
      const n = (worldY - bounds.min.y) / charH;
      return n > 0.62 ? 'head' : n > 0.26 ? 'belly' : 'legs';
    },

    hasWeapons: true,
    _weaponIdx: 0,
    weaponList: weapons.map((w) => ({ id: w.id, emoji: w.emoji })),

    // equip by id; returns the weapon's emoji (with a show-off spin unless silent)
    setWeapon(id, { silent = false } = {}) {
      const idx = weapons.findIndex((w) => w.id === id);
      if (idx < 0) return null;
      this._weaponIdx = idx;
      setWeaponVisible(idx);
      if (!silent) this.react('switch');
      return weapons[idx].emoji;
    },

    // stick one mud splat at a specific surface point ({point, normal} in world space)
    addSplatAt(sp) {
      const worldPos = sp.point.clone().addScaledVector(sp.normal, 0.015);
      const splat = new THREE.Mesh(splatGeo, splatMats[(Math.random() * splatMats.length) | 0]);
      const s = 0.07 + Math.random() * 0.09;
      splat.scale.set(s * (0.8 + Math.random() * 0.6), s * (0.8 + Math.random() * 0.6), s * 0.3);
      dirtGroup.add(splat);
      splat.position.copy(dirtGroup.worldToLocal(worldPos.clone()));
      splat.lookAt(worldPos.clone().add(sp.normal));
      this.spawnBurst(worldPos, { color: 0x4a3417, n: 4, speed: 0.9, gravity: -2.5, size: 0.035 });
      this.dirtCount = dirtGroup.children.length;
    },

    // fling some mud at him
    addDirt(n = 7) {
      let placed = 0;
      for (let i = 0; i < n; i++) {
        const sp = this.randomSurfacePoint(0.1, 0.92);
        if (!sp) continue;
        this.addSplatAt(sp);
        placed++;
      }
      return placed;
    },

    // scrub around a world-space point; returns how many splats came off
    washAt(worldPoint, radius = 0.3) {
      dirtGroup.updateMatrixWorld(true);
      const local = dirtGroup.worldToLocal(worldPoint.clone());
      let removed = 0;
      for (const splat of [...dirtGroup.children]) {
        if (splat.position.distanceTo(local) < radius) {
          dirtGroup.remove(splat);
          removed++;
        }
      }
      this.dirtCount = dirtGroup.children.length;
      return removed;
    },

    spawnBubbles(worldPoint, n = 3) {
      for (let i = 0; i < n; i++) {
        const pos = worldPoint.clone().add(
          new THREE.Vector3((Math.random() - 0.5) * 0.18, (Math.random() - 0.5) * 0.18, 0.05)
        );
        spawnP(partGeo, 0xf3fbff, pos,
          new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.45 + Math.random() * 0.35, 0.05),
          { size: 0.025 + Math.random() * 0.04, life: 0.7 + Math.random() * 0.4, opacity: 0.75 });
      }
    },

    // exploding spark/dust burst at a world point
    spawnBurst(worldPoint, { color = 0xffd94d, n = 12, speed = 1.6, size = 0.045, gravity = -3.2, life = 0.55 } = {}) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const up = Math.random() * 0.9 + 0.25;
        const vel = new THREE.Vector3(Math.cos(a), up, Math.sin(a) * 0.4 + 0.3)
          .normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.8));
        spawnP(partGeo, color, worldPoint.clone(), vel,
          { size: size * (0.6 + Math.random() * 0.9), gravity, life: life * (0.7 + Math.random() * 0.6) });
      }
    },

    // expanding shockwave ring facing the camera
    spawnRing(worldPoint, color = 0xfff3c4) {
      spawnP(ringGeo, color, worldPoint.clone().add(new THREE.Vector3(0, 0, 0.1)),
        new THREE.Vector3(0, 0, 0), { size: 1, grow: 9, life: 0.45, opacity: 0.85 });
    },

    // random point on the model's front surface (used by dirt + the Bonk game)
    randomSurfacePoint(minN = 0.1, maxN = 0.92) {
      root.updateMatrixWorld(true);
      for (let tries = 0; tries < 12; tries++) {
        const x = (Math.random() - 0.5) * 1.0;
        const y = bounds.min.y + charH * (minN + Math.random() * (maxN - minN));
        dirtRay.set(new THREE.Vector3(x, y, 3), new THREE.Vector3(0, 0, -1));
        const hits = dirtRay.intersectObject(model, true);
        if (hits.length) {
          const h = hits[0];
          const normal = h.face.normal.clone().transformDirection(h.object.matrixWorld);
          return { point: h.point.clone(), normal };
        }
      }
      return null;
    },

    update(dt, t) {
      if (mixer) mixer.update(dt);

      // ---- compute targets ----
      let posY = Math.sin(t * 2.1) * 0.03; // idle bob
      let sy = 1 + Math.sin(t * 2.6) * 0.015; // breathing
      let sxz = 1 - Math.sin(t * 2.6) * 0.008;
      let rotY = this.pointer.x * 0.28 + Math.sin(t * 0.9) * 0.04; // face the finger + sway
      let rotX = -this.pointer.y * 0.10;
      let rotZ = Math.sin(t * 1.3) * 0.02;
      let eyeS = 1;
      let mouthOpen = 0.06;

      if (this.state === 'listening') {
        rotZ += 0.13;
        rotX += 0.07;
        eyeS = 1.25;
        posY += 0.02;
      } else if (this.state === 'talking') {
        const a = this.amp;
        posY += a * 0.10;
        sy += a * 0.06;
        sxz -= a * 0.03;
        rotZ += Math.sin(t * 11) * 0.05 * a;
        mouthOpen = 0.1 + a * 1.6;
        eyeS = 1 + a * 0.15;
      }

      // ---- reactions override on top ----
      let spinY = 0; // applied directly (damping a full spin would unwind backwards)
      let fallX = 0; // ditto for falling over
      let starsOn = false;
      if (this.reaction) {
        this.reaction.t += dt;
        const r = this.reaction;
        const p = Math.min(r.t / r.dur, 1);
        const pulse = Math.sin(p * Math.PI);
        if (r.zone === 'head') {
          // dizzy: big bounce + shake while stars circle the head
          posY += Math.sin(Math.min(p * 4, 1) * Math.PI) * 0.3;
          rotZ += Math.sin(t * 22) * 0.13 * (1 - p);
          sy += Math.sin(Math.min(p * 4, 1) * Math.PI) * 0.12;
          eyeS = 1.4;
          starsOn = true;
          stars.group.rotation.y = t * 6;
          stars.mat.opacity = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
          mouthOpen = Math.max(mouthOpen, 0.5 * (1 - p));
        } else if (r.zone === 'belly') {
          sy -= pulse * 0.45; // MEGA squash
          sxz += pulse * 0.38;
          eyeS = 1.45;
          mouthOpen = Math.max(mouthOpen, pulse * 1.6);
        } else if (r.zone === 'jam') {
          sy -= pulse * 0.16; // punchy drum-hit pulse
          sxz += pulse * 0.1;
          posY += pulse * 0.05;
        } else if (r.zone === 'legs') {
          // knocked over: tip backwards, lie there a beat, climb back up
          const P1 = 0.18, P2 = 0.45, P3 = 0.82;
          if (p < P1) {
            fallX = -Math.pow(p / P1, 2) * 1.5;
          } else if (p < P2) {
            // impact + a comedic little rebound
            fallX = -1.5 + Math.sin(Math.min((p - P1) * 16, Math.PI)) * 0.28;
            if (!r.thudFired) {
              r.thudFired = true;
              this.onEvent?.('thud');
            }
            const q = (p - P1) / 0.1;
            if (q < 1) { sy -= (1 - q) * 0.24; sxz += (1 - q) * 0.2; } // impact squash
          } else if (p < P3) {
            fallX = -1.5 * (1 - smooth((p - P2) / (P3 - P2)));
          } else {
            const q = (p - P3) / (1 - P3);
            rotZ += Math.sin(q * Math.PI * 3) * 0.08 * (1 - q); // recovery wobble
          }
          posY += 0.34 * (Math.abs(fallX) / 1.5); // keep him on top of the floor while flat
          eyeS = 1.3;
        } else if (r.zone === 'switch') {
          spinY = (1 - Math.pow(1 - p, 3)) * Math.PI * 2; // full show-off spin
          posY += pulse * 0.38; // big jump with it
          sy += pulse * 0.15;
          sxz -= pulse * 0.08;
          eyeS = 1.3;
          mouthOpen = Math.max(mouthOpen, pulse * 1.1);
        } else if (r.zone === 'dirty') {
          rotZ += Math.sin(t * 30) * 0.05 * (1 - p); // grossed-out shiver
          sy -= pulse * 0.08;
          eyeS = 0.85;
        }
        if (p >= 1) this.reaction = null;
      }
      stars.group.visible = starsOn;

      // ---- smooth toward targets ----
      const c = this._cur;
      c.posY = damp(c.posY, posY, 14, dt);
      c.rotX = damp(c.rotX, rotX, 10, dt);
      c.rotY = damp(c.rotY, rotY, 10, dt);
      c.rotZ = damp(c.rotZ, rotZ, 14, dt);
      c.sy = damp(c.sy, sy, 16, dt);
      c.sxz = damp(c.sxz, sxz, 16, dt);
      c.eyeS = damp(c.eyeS, eyeS, 12, dt);

      body.position.y = c.posY;
      body.scale.set(c.sxz, c.sy, c.sxz);
      body.rotation.z = c.rotZ;
      body.rotation.y = spinY;
      body.rotation.x = fallX;
      root.rotation.y = c.rotY;
      root.rotation.x = c.rotX;

      // ---- fancy-weapon idle effects ----
      const w = weapons[this._weaponIdx];
      if (w.spin) w.spin.rotation.y = t * 2.2;
      if (w.pulse) {
        w.pulse.userData.base ??= w.pulse.material.opacity;
        w.pulse.material.opacity = w.pulse.userData.base * (0.8 + Math.sin(t * 7) * 0.25);
      }

      // ---- particles (bubbles, bursts, dust, rings) ----
      for (let i = particles.length - 1; i >= 0; i--) {
        const b = particles[i];
        b.life -= dt;
        b.vel.y += b.gravity * dt;
        b.m.position.addScaledVector(b.vel, dt);
        if (b.grow) b.m.scale.multiplyScalar(1 + b.grow * dt);
        b.m.material.opacity = Math.max(0, 0.9 * (b.life / b.maxLife));
        if (b.life <= 0) {
          scene.remove(b.m);
          b.m.material.dispose();
          particles.splice(i, 1);
        }
      }

      // ---- procedural face & limbs (only when using the built-in model) ----
      if (parts) {
        parts.mouth.scale.set(1, THREE.MathUtils.clamp(mouthOpen, 0.05, 1.8), 0.6);
        parts.eyeL.scale.setScalar(c.eyeS);
        parts.eyeR.scale.setScalar(c.eyeS);
        const px = this.pointer.x * 0.045;
        const py = this.pointer.y * 0.03;
        parts.pupilL.position.x = parts.pupilL.userData.bx + px;
        parts.pupilR.position.x = parts.pupilR.userData.bx + px;
        parts.pupilL.position.y = parts.pupilL.userData.by - py;
        parts.pupilR.position.y = parts.pupilR.userData.by - py;
        const talkSwing = this.state === 'talking' ? Math.sin(t * 13) * 0.5 * this.amp : 0;
        parts.armL.rotation.z = -0.32 + Math.sin(t * 1.8) * 0.05 + talkSwing;
        parts.armR.rotation.z = 2.95 + Math.sin(t * 1.8 + 1) * 0.05 - talkSwing * 0.7;
      }
    },
  };

  return char;
}

// ---------------------------------------------------------------------------
// Original built-in character: a cheerful wooden log. Zero copied assets.
// ---------------------------------------------------------------------------
function buildProceduralCharacter() {
  const model = new THREE.Group();
  const parts = {};

  const wood = new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 0.75 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x6e4426, roughness: 0.85 });
  const lightWood = new THREE.MeshStandardMaterial({ color: 0xc89a63, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.35 });
  const black = new THREE.MeshStandardMaterial({ color: 0x241408, roughness: 0.4 });
  const blush = new THREE.MeshStandardMaterial({ color: 0xe8795a, roughness: 0.8 });

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.6, 1.72, 28), wood);
  trunk.position.y = 1.16;
  model.add(trunk);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    darkWood
  );
  cap.scale.y = 0.35;
  cap.position.y = 2.02;
  model.add(cap);

  for (const [y, r] of [[0.62, 0.595], [1.42, 0.55]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 8, 36), darkWood);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    model.add(ring);
  }

  const face = new THREE.Group();
  face.position.set(0, 1.55, 0);
  model.add(face);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 16), white);
    eye.scale.z = 0.55;
    eye.position.set(side * 0.21, 0.08, 0.47);
    face.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 12), black);
    pupil.position.set(side * 0.21, 0.08, 0.56);
    pupil.userData.bx = pupil.position.x;
    pupil.userData.by = pupil.position.y;
    face.add(pupil);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.04), black);
    brow.position.set(side * 0.21, 0.27, 0.5);
    brow.rotation.z = side * -0.18;
    face.add(brow);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), blush);
    cheek.scale.z = 0.3;
    cheek.position.set(side * 0.33, -0.12, 0.46);
    face.add(cheek);
    parts[side === -1 ? 'eyeL' : 'eyeR'] = eye;
    parts[side === -1 ? 'pupilL' : 'pupilR'] = pupil;
  }

  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 14), black);
  mouth.scale.set(1, 0.06, 0.6);
  mouth.position.set(0, -0.24, 0.46);
  face.add(mouth);
  parts.mouth = mouth;

  const mkArm = (side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.5, 1.42, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.55, 12), darkWood);
    arm.position.y = -0.27;
    g.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), lightWood);
    hand.position.y = -0.56;
    g.add(hand);
    model.add(g);
    return g;
  };
  parts.armL = mkArm(-1);
  parts.armL.rotation.z = -0.32;
  parts.armR = mkArm(1);
  parts.armR.rotation.z = 2.95; // raised close to the body, holding the weapon

  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.34, 12), darkWood);
    leg.position.set(side * 0.24, 0.2, 0);
    model.add(leg);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), lightWood);
    foot.scale.set(1, 0.55, 1.35);
    foot.position.set(side * 0.24, 0.07, 0.08);
    model.add(foot);
  }

  return { model, parts };
}

// Weapon meshes with the grip at the origin, extending along +y.
// Works parented to any hand anchor (procedural arm or GLB fist).
// Each entry: { id, emoji, group, spin?, pulse? } — spin/pulse animate per frame.
function buildWeapons() {
  const lightWood = new THREE.MeshStandardMaterial({ color: 0xc89a63, roughness: 0.7 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x6e4426, roughness: 0.85 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x4d4d58, roughness: 0.45, metalness: 0.4 });
  const metalLight = new THREE.MeshStandardMaterial({ color: 0x71717e, roughness: 0.5, metalness: 0.3 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc94d, roughness: 0.25, metalness: 0.85 });

  // butt end: pokes out of the top of the fist where the bat's grip used to be
  const mkButt = (mat) => {
    const g = new THREE.Group();
    const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.34, 12), mat);
    butt.position.y = -0.14;
    g.add(butt);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), mat);
    cap.position.y = -0.31;
    g.add(cap);
    // grip collar: fat sleeve under the fist that masks the cut edge of the old grip
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.085, 0.4, 14), mat);
    collar.position.y = 0.18;
    g.add(collar);
    return g;
  };

  const mkBatMesh = (parent) => {
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.055, 1.15, 14), lightWood);
    bat.position.y = 0.45;
    parent.add(bat);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), darkWood);
    knob.position.y = 1.03;
    parent.add(knob);
  };

  // 1. his trusty bat
  const batG = new THREE.Group();
  mkBatMesh(batG);

  // 2. spiked bat — same bat, extra menace
  const spikeG = new THREE.Group();
  mkBatMesh(spikeG);
  spikeG.add(mkButt(lightWood));
  const spikeGeo = new THREE.ConeGeometry(0.035, 0.14, 8);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 * 2.5; // spiral up the barrel
    const y = 0.55 + (i / 9) * 0.45;
    const r = 0.06 + (y - 0.45) * 0.05; // follow the taper
    const spike = new THREE.Mesh(spikeGeo, metalLight);
    spike.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    // cone +y axis pointed radially outward
    spike.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    );
    spikeG.add(spike);
  }

  // 3. breakfast pan — frying pan with a fried egg, sunny side up
  const panG = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.65, 12), metal);
  handle.position.y = 0.26;
  panG.add(handle);
  panG.add(mkButt(metal));
  const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.08, 24), metal);
  pan.position.y = 0.82;
  pan.rotation.x = Math.PI / 2;
  panG.add(pan);
  const panInner = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 24), metalLight);
  panInner.position.set(0, 0.82, 0.05);
  panInner.rotation.x = Math.PI / 2;
  panG.add(panInner);
  const eggWhite = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xfffdf2, roughness: 0.35 })
  );
  eggWhite.scale.set(1.15, 0.9, 0.22);
  eggWhite.position.set(-0.015, 0.8, 0.075);
  panG.add(eggWhite);
  const yolk = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xffb52e, roughness: 0.3 })
  );
  yolk.scale.z = 0.55;
  yolk.position.set(0.02, 0.82, 0.1);
  panG.add(yolk);

  // 4. laser sword — humming blade with a pulsing glow
  const saberG = new THREE.Group();
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.32, 12), metal);
  hilt.position.y = 0.16;
  saberG.add(hilt);
  const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.05, 0.05, 12), metalLight);
  emitter.position.y = 0.33;
  saberG.add(emitter);
  saberG.add(mkButt(metal));
  const bladeMat = new THREE.MeshBasicMaterial({ color: 0xf4fff6 });
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.05, 10), bladeMat);
  blade.position.y = 0.88;
  saberG.add(blade);
  const bladeTip = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), bladeMat);
  bladeTip.position.y = 1.4;
  saberG.add(bladeTip);
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 1.1, 10),
    new THREE.MeshBasicMaterial({
      color: 0x4dff6a, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  glow.position.y = 0.88;
  saberG.add(glow);

  // 5. THE GOLDEN KENTONGAN — the legendary dawn-waker, ultimate drip
  const kentG = new THREE.Group();
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 1.0, 12), darkWood);
  staff.position.y = 0.4;
  kentG.add(staff);
  kentG.add(mkButt(darkWood));
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.52, 18), gold);
  drum.position.y = 1.0;
  kentG.add(drum);
  const slit = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.36, 0.03),
    new THREE.MeshBasicMaterial({ color: 0x241408 })
  );
  slit.position.set(0, 1.0, 0.155);
  kentG.add(slit);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), gold);
  crown.position.y = 1.31;
  kentG.add(crown);
  const kentGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xffd97a, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  kentGlow.position.y = 1.0;
  kentG.add(kentGlow);
  const halo = new THREE.Group(); // orbiting sparkles
  const gemGeo = new THREE.OctahedronGeometry(0.045);
  const gemMat = new THREE.MeshBasicMaterial({ color: 0xffe9a3 });
  for (let i = 0; i < 6; i++) {
    const gem = new THREE.Mesh(gemGeo, gemMat);
    const a = (i / 6) * Math.PI * 2;
    gem.position.set(Math.cos(a) * 0.32, Math.sin(i * 2.1) * 0.12, Math.sin(a) * 0.32);
    halo.add(gem);
  }
  halo.position.y = 1.0;
  kentG.add(halo);

  return [
    { id: 'bat', emoji: '🏏', group: batG },
    { id: 'spikebat', emoji: '🌵', group: spikeG },
    { id: 'eggpan', emoji: '🍳', group: panG },
    { id: 'saber', emoji: '⚡', group: saberG, pulse: glow },
    { id: 'kentongan', emoji: '🌟', group: kentG, spin: halo, pulse: kentGlow },
  ];
}

// Ring of little 3D stars for the dizzy head-punch effect
function buildStars() {
  const shape = new THREE.Shape();
  const R = 0.09, r = 0.038;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false });
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd94d, transparent: true, side: THREE.DoubleSide });
  const group = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(geo, mat);
    const a = (i / 7) * Math.PI * 2;
    const s = 0.9 + (i % 3) * 0.35;
    m.scale.setScalar(s);
    m.position.set(Math.cos(a) * 0.6, Math.sin(i * 1.7) * 0.09, Math.sin(a) * 0.6);
    m.rotation.y = -a;
    group.add(m);
  }
  return { group, mat };
}
