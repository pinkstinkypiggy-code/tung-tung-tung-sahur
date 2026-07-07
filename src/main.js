import './style.css';
import * as THREE from 'three';
import { createScene } from './scene.js';
import { createCharacter } from './character.js';
import { VoiceLoop } from './voice.js';
import { SFX } from './sfx.js';
import { setupUI } from './ui.js';

const canvas = document.getElementById('game');
const { scene, camera, renderer } = createScene(canvas);

const sfx = new SFX();
let character = null;
let audioCtx = null;
let firstRepeatDone = false;

// ---------------------------------------------------------------------------
// audio bootstrap
// ---------------------------------------------------------------------------
function ensureCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    sfx.setContext(audioCtx);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}

const voice = new VoiceLoop({
  onSpeechStart: () => character?.setState('listening'),
  onSpeechEnd: () => character?.setState('idle'),
  onPlaybackStart: () => {
    character?.setState('talking');
    if (!firstRepeatDone) {
      firstRepeatDone = true;
      ui.setHint(null);
    }
  },
  onPlaybackEnd: () => character?.setState('idle'),
});

let micMuted = true;
async function handleMicPress() {
  ensureCtx();
  if (!voice.active) {
    if (!navigator.mediaDevices?.getUserMedia) { ui.showMicDenied(); return; }
    try {
      await voice.init(audioCtx);
      micMuted = false;
      voice.setMuted(false);
      ui.setMicOn(true);
      ui.hideBanner();
      ui.setHint('🎤 Say something!');
    } catch (err) {
      console.warn('mic unavailable:', err);
      ui.showMicDenied();
    }
  } else {
    micMuted = !micMuted;
    voice.setMuted(micMuted);
    ui.setMicOn(!micMuted);
  }
}

// ---------------------------------------------------------------------------
// modes
// ---------------------------------------------------------------------------
const HINTS = {
  play: '👆 Poke him!',
  jam: '🥁 Drum on him!',
  wash: null, // the HUD owns that spot; startWash announces via floater
};
let mode = 'play';
const best = {
  bonk: +localStorage.getItem('tts_best_bonk') || 0,
  wash: +localStorage.getItem('tts_best_wash') || 0,
};

// Bonk! state
const BONK_TIME = 30;
const TARGET_LIFE = 2.0;
let bonk = null; // { score, streak, timeLeft, target: {point, mesh, age} }
let targetMesh = null;

function buildTargetMesh() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.13, 0.19, 28),
    new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
  );
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.06, 20),
    new THREE.MeshBasicMaterial({ color: 0xff5e5b, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
  );
  dot.position.z = 0.005;
  g.add(ring, dot);
  return g;
}

function spawnTarget() {
  const sp = character.randomSurfacePoint(0.15, 0.9);
  if (!sp) return;
  if (!targetMesh) {
    targetMesh = buildTargetMesh();
    scene.add(targetMesh);
  }
  targetMesh.visible = true;
  // float in front of the surface toward the camera — a flat ring hugging a
  // curved body clips through it (half-buried targets on the head/sides)
  const toCam = camera.position.clone().sub(sp.point).normalize();
  targetMesh.position.copy(sp.point).addScaledVector(toCam, 0.18);
  bonk.target = { point: sp.point.clone(), age: 0 };
}

function hideTarget() {
  if (targetMesh) targetMesh.visible = false;
  if (bonk) bonk.target = null;
}

function startBonk() {
  bonk = { score: 0, streak: 0, timeLeft: BONK_TIME };
  spawnTarget();
  sfx.countTick();
}

function endBonk() {
  const hits = bonk.score;
  hideTarget();
  bonk = null;
  const isBest = hits > best.bonk;
  if (isBest) {
    best.bonk = hits;
    localStorage.setItem('tts_best_bonk', hits);
    ui.confetti();
  }
  const earned = hits * 25;
  addPoints(earned);
  sfx.fanfare();
  ui.showResult({
    emoji: isBest ? '🏆' : '🎯',
    title: isBest ? 'NEW BEST!' : "Time's up!",
    score: `${hits}`,
    best: `+⭐ ${earned.toLocaleString()} earned · Best: ${best.bonk} bonks`,
    onAgain: () => startBonk(),
    onClose: () => setMode('play'),
  });
}

// Wash challenge state
const WASH_SPLATS = 16;
const TRASH_GRACE = 2.5; // seconds before the sky starts dumping trash
const MAX_DIRT = 26; // stop spawning if he's already a disaster
let washTimer = 0;
let washActive = false;
let nextTrashAt = 0;
const fallingTrash = []; // { mesh, sp, vy }
const trashGeo = new THREE.SphereGeometry(0.075, 8, 6);
const trashMat = new THREE.MeshStandardMaterial({ color: 0x6b5230, roughness: 1 });

function spawnTrash() {
  const sp = character.randomSurfacePoint(0.15, 0.9);
  if (!sp) return;
  const mesh = new THREE.Mesh(trashGeo, trashMat);
  mesh.scale.set(1, 0.7, 1);
  mesh.position.set(sp.point.x, 3.6, sp.point.z + 0.02);
  scene.add(mesh);
  fallingTrash.push({ mesh, sp, vy: 2.4 });
}

function clearTrash() {
  for (const t of fallingTrash) scene.remove(t.mesh);
  fallingTrash.length = 0;
}

function updateTrash(dt) {
  for (let i = fallingTrash.length - 1; i >= 0; i--) {
    const tr = fallingTrash[i];
    tr.vy += 14 * dt;
    tr.mesh.position.y -= tr.vy * dt;
    tr.mesh.rotation.x += dt * 9;
    tr.mesh.rotation.z += dt * 7;
    if (tr.mesh.position.y <= tr.sp.point.y) {
      scene.remove(tr.mesh);
      fallingTrash.splice(i, 1);
      character.addSplatAt(tr.sp); // splat! he's dirty again
      sfx.plop();
    }
  }
}

function startWash() {
  if (character.dirtCount === 0) character.addDirt(WASH_SPLATS);
  sfx.splat();
  character.react('dirty');
  washTimer = 0;
  nextTrashAt = TRASH_GRACE;
  washActive = true;
  ui.setWashMode(true);
  ui.float(window.innerWidth / 2, window.innerHeight * 0.42, '🫧 Scrub fast — incoming trash!', true);
}

function endWash() {
  washActive = false;
  clearTrash();
  ui.setWashMode(false); // he's clean — put the sponge away
  const time = washTimer;
  const isBest = best.wash === 0 || time < best.wash;
  if (isBest) {
    best.wash = time;
    localStorage.setItem('tts_best_wash', time.toFixed(1));
    ui.confetti();
  }
  sfx.clean();
  sfx.fanfare();
  character.react('switch');
  const earned = Math.max(100, Math.round(900 - time * 30));
  addPoints(earned);
  ui.showResult({
    emoji: isBest ? '🏆' : '✨',
    title: isBest ? 'NEW BEST!' : 'Squeaky clean!',
    score: `${time.toFixed(1)}s`,
    best: `+⭐ ${earned.toLocaleString()} earned · Best: ${best.wash.toFixed(1)}s`,
    onAgain: () => startWash(),
    onClose: () => setMode('play'),
  });
}

// freeplay sponge: scrub him anytime in Play mode, no timer
let freeScrub = false;
function setFreeScrub(on) {
  freeScrub = on;
  ui.setWashMode(on);
  ui.setSpongeOn(on);
}

function setMode(m) {
  ensureCtx();
  if (m === mode) return;
  // leave the old mode
  if (mode === 'play') setFreeScrub(false);
  if (mode === 'bonk') { hideTarget(); bonk = null; }
  if (mode === 'wash') { washActive = false; clearTrash(); ui.setWashMode(false); }
  mode = m;
  ui.setMode(m);
  ui.setHint(HINTS[m] ?? null);
  ui.setHud(null);
  if (m === 'play' && score > 0) {
    ui.setHint(null);
    updateScoreHud();
  }
  if (m === 'bonk') { ui.setHint(null); startBonk(); }
  if (m === 'wash') { ui.setWashMode(true); startWash(); }
  if (m === 'jam') sfx.drum('belly');
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const ui = setupUI({
  onShopOpen: () => { ensureCtx(); refreshShop(); },
  onWeaponPick: (id) => pickWeapon(id),
  onMicPress: handleMicPress,
  onDirty: () => {
    ensureCtx();
    if (!character) return;
    character.addDirt(7);
    sfx.splat();
    character.react('dirty');
  },
  onSpongeToggle: () => {
    ensureCtx();
    if (mode === 'play') setFreeScrub(!freeScrub);
  },
  onModeSelect: (m) => setMode(m),
});

// ---------------------------------------------------------------------------
// pointer input
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function toNDC(e) {
  ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  return ndc;
}

function raycastCharacter(e) {
  if (!character) return null;
  toNDC(e);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(character.root, true);
  return hits.length ? hits[0] : null;
}

// ---------------------------------------------------------------------------
// Play-mode scoring: chains + secret combos
// ---------------------------------------------------------------------------
const CHAIN_WINDOW = 1200; // ms between pokes to keep the chain alive
const BASE_POINTS = 10;
const COMBOS = [
  { id: 'tung3', name: 'TUNG TUNG TUNG!', emoji: '🥁', seq: ['head', 'head', 'head'], points: 300, fx: 'drums' },
  { id: 'wakeup', name: 'Wake-Up Call', emoji: '⏰', seq: ['legs', 'legs', 'head'], points: 400, fx: 'jump' },
  { id: 'slam', name: 'Body Slam', emoji: '💥', seq: ['belly', 'belly', 'legs'], points: 500, fx: 'fall', note: 'floors him!' },
  { id: 'fullsahur', name: 'THE FULL SAHUR', emoji: '🌙', seq: ['belly', 'head', 'legs'], points: 1000, fx: 'mega', note: 'floors him!' },
];

let score = +localStorage.getItem('tts_score') || 0; // ⭐ balance — also the shop currency
let chain = 0;
let lastTapAt = 0;
let hitSeq = [];
let bestScore = +localStorage.getItem('tts_best_score') || 0;
const combosDone = new Set(JSON.parse(localStorage.getItem('tts_combos_done') || '[]'));

// ---------------------------------------------------------------------------
// weapon shop
// ---------------------------------------------------------------------------
const WEAPONS = [
  { id: 'bat', name: 'Trusty Bat', emoji: '🏏', cost: 0, desc: 'His day-one bestie. Free forever.' },
  { id: 'spikebat', name: 'Spiky Boi', emoji: '🌵', cost: 500, desc: 'The bat, but with opinions.' },
  { id: 'eggpan', name: 'Breakfast Pan', emoji: '🍳', cost: 1500, desc: 'Egg included. Sunny side up.' },
  { id: 'saber', name: 'Laser Sword', emoji: '⚡', cost: 7500, desc: 'Vwoom. Bzzz. Respect.' },
  { id: 'kentongan', name: 'THE GOLDEN KENTONGAN', emoji: '🌟', cost: 25000, desc: 'Legendary dawn-waker. Wakes entire villages.', legendary: true },
];
const ownedWeapons = new Set(JSON.parse(localStorage.getItem('tts_weapons') || '["bat"]'));
let equippedWeapon = localStorage.getItem('tts_equipped') || 'bat';
if (!ownedWeapons.has(equippedWeapon)) equippedWeapon = 'bat';

function saveWallet() {
  localStorage.setItem('tts_score', score);
  localStorage.setItem('tts_weapons', JSON.stringify([...ownedWeapons]));
  localStorage.setItem('tts_equipped', equippedWeapon);
}

function refreshShop() {
  ui.renderShop(WEAPONS, ownedWeapons, equippedWeapon, score);
}

function pickWeapon(id) {
  const w = WEAPONS.find((x) => x.id === id);
  if (!w || !character) return;
  ensureCtx();
  if (ownedWeapons.has(id)) {
    if (id !== equippedWeapon) {
      equippedWeapon = id;
      ui.setWeaponIcon(character.setWeapon(id));
      sfx.play('switch');
      ui.closeShop();
      ui.confetti(window.innerWidth / 2, window.innerHeight * 0.45, 14);
      saveWallet();
    }
    refreshShop();
    return;
  }
  if (score >= w.cost) {
    score -= w.cost;
    ownedWeapons.add(id);
    equippedWeapon = id;
    saveWallet();
    updateScoreHud();
    refreshShop();
    ui.closeShop();
    ui.setWeaponIcon(character.setWeapon(id));
    sfx.fanfare();
    ui.confetti();
    ui.float(window.innerWidth / 2, window.innerHeight * 0.3, `${w.emoji} ${w.name}!`, true);
    if (w.legendary) {
      setTimeout(() => ui.confetti(window.innerWidth / 2, window.innerHeight * 0.35, 24), 400);
      setTimeout(() => sfx.fanfare(), 350);
    }
  } else {
    sfx.miss();
    ui.float(window.innerWidth / 2, window.innerHeight * 0.55, `Need ⭐ ${(w.cost - score).toLocaleString()} more!`);
  }
}

function refreshCombosPanel() {
  ui.renderCombos(COMBOS, combosDone, bestScore);
}

function updateScoreHud() {
  if (mode !== 'play' || score === 0) return;
  ui.setHud(`⭐ ${score.toLocaleString()}`, chain >= 2 ? `🔥 x${chain}` : null);
}

function addPoints(n) {
  score += n;
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('tts_best_score', bestScore);
  }
  localStorage.setItem('tts_score', score);
  updateScoreHud();
}

function comboFx(recipe, e) {
  ui.float(window.innerWidth / 2, window.innerHeight * 0.32, `${recipe.emoji} ${recipe.name}`, true);
  ui.float(e.clientX, e.clientY - 30, `+${recipe.points}`, true);
  if (recipe.fx === 'drums') {
    ['head', 'legs', 'belly'].forEach((z, i) => setTimeout(() => sfx.drum(z), i * 130));
    character.react('head');
  } else if (recipe.fx === 'jump') {
    sfx.fanfare();
    character.react('switch');
  } else if (recipe.fx === 'fall') {
    sfx.hit(8);
    character.react('legs'); // down he goes
    ui.confetti(e.clientX, e.clientY, 16);
  } else {
    // mega: the full show
    sfx.fanfare();
    character.react('legs');
    ui.confetti();
    setTimeout(() => ui.confetti(window.innerWidth / 2, window.innerHeight * 0.3, 20), 400);
  }
  if (!combosDone.has(recipe.id)) {
    combosDone.add(recipe.id);
    localStorage.setItem('tts_combos_done', JSON.stringify([...combosDone]));
    refreshCombosPanel();
  }
}

function scorePoke(zone, e) {
  const now = performance.now();
  chain = now - lastTapAt < CHAIN_WINDOW ? chain + 1 : 1;
  lastTapAt = now;
  if (chain === 1) hitSeq = [];
  hitSeq.push(zone);
  if (hitSeq.length > 6) hitSeq.shift();

  const pts = BASE_POINTS * Math.min(chain, 10);
  addPoints(pts);
  ui.float(e.clientX, e.clientY - 36, chain >= 2 ? `+${pts} 🔥x${chain}` : `+${pts}`, chain >= 4);

  // does the tail of the sequence land a secret combo?
  for (const recipe of COMBOS) {
    const tail = hitSeq.slice(-recipe.seq.length);
    if (tail.length === recipe.seq.length && tail.every((z, i) => z === recipe.seq[i])) {
      addPoints(recipe.points);
      comboFx(recipe, e);
      hitSeq = [];
      break;
    }
  }
}

// wash scrub throttle
let lastScrub = 0;

function washSwipe(e) {
  const hit = raycastCharacter(e);
  if (!hit) return;
  const removed = character.washAt(hit.point);
  const now = performance.now();
  if (now - lastScrub > 110) {
    lastScrub = now;
    sfx.scrub();
    character.spawnBubbles(hit.point, removed ? 5 : 2);
  }
  if (removed && character.dirtCount === 0) {
    if (washActive) {
      endWash();
    } else if (freeScrub) {
      // freeplay scrub finished — celebrate and put the sponge away
      sfx.clean();
      character.react('switch');
      ui.float(window.innerWidth / 2, window.innerHeight * 0.4, '✨ So fresh!', true);
      setFreeScrub(false);
    }
  }
}

const scrubbing = () => (mode === 'wash' && washActive) || (mode === 'play' && freeScrub);

window.addEventListener('pointermove', (e) => {
  toNDC(e);
  character?.setPointer(ndc.x, ndc.y);
  if (scrubbing()) {
    ui.moveSponge(e.clientX, e.clientY);
    washSwipe(e);
  }
});

canvas.addEventListener('pointerdown', (e) => {
  ensureCtx();
  if (!character) return;

  if (scrubbing()) {
    ui.moveSponge(e.clientX, e.clientY);
    washSwipe(e);
    return;
  }

  const hit = raycastCharacter(e);
  character.setPointer(ndc.x, ndc.y);

  if (mode === 'bonk') {
    if (!bonk) return;
    // ray test the floating ring too — near his silhouette the ring sticks out
    // past the body, and a tap on the ring must still count
    let hitPoint = hit?.point ?? null;
    if (targetMesh?.visible) {
      const ringHits = raycaster.intersectObject(targetMesh, true);
      if (ringHits.length) hitPoint = bonk.target.point;
    }
    if (hitPoint && bonk.target && hitPoint.distanceTo(bonk.target.point) < 0.42) {
      bonk.score++;
      bonk.streak++;
      sfx.hit(bonk.streak);
      character.spawnBurst(bonk.target.point, { color: 0xffc94d, n: 10 });
      character.spawnRing(bonk.target.point);
      character.react('jam');
      ui.float(e.clientX, e.clientY, bonk.streak >= 5 ? `+1 🔥x${bonk.streak}` : '+1');
      spawnTarget();
    } else {
      bonk.streak = 0;
      sfx.miss();
      ui.float(e.clientX, e.clientY, '💨');
    }
    return;
  }

  if (!hit) return;

  if (mode === 'jam') {
    const zone = character.zoneAt(hit.point.y);
    sfx.drum(zone);
    character.react('jam');
    character.spawnRing(hit.point, zone === 'belly' ? 0xff8a5c : 0xfff3c4);
    ui.float(e.clientX, e.clientY, ['🎵', '🥁', '💥', '🎶'][(Math.random() * 4) | 0]);
    return;
  }

  // play mode: zone reactions + scoring
  const zone = character.zoneAt(hit.point.y);
  character.react(zone);
  sfx.play(zone);
  character.spawnBurst(hit.point, {
    color: zone === 'head' ? 0xffd94d : zone === 'belly' ? 0xff8a5c : 0x3ec9b8,
    n: 7, speed: 1.2, size: 0.035,
  });
  ui.setHint(null); // hint's job is done — the HUD takes over
  scorePoke(zone, e);
});

// iOS: block double-tap zoom / pinch on the canvas
canvas.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
// A clean loading spinner (only appears if the model takes more than a blink
// to load) instead of an ugly stand-in character, then Tung pops in smoothly.
const loaderEl = document.getElementById('loading');
const loaderTimer = setTimeout(() => loaderEl?.classList.add('show'), 150);
let intro = -1; // <0 = not started; 0..1 = pop-in animation progress

createCharacter(scene).then((c) => {
  clearTimeout(loaderTimer);
  loaderEl?.classList.add('gone');
  setTimeout(() => loaderEl?.remove(), 450);
  character = c;
  c.root.scale.setScalar(0.001); // start tiny, grow in
  intro = 0;
  c.onEvent = (ev) => {
    if (ev === 'thud') {
      sfx.thud();
      ui.shake();
      c.spawnBurst(new THREE.Vector3(0, 0.15, 0.4), {
        color: 0xc9a06b, n: 14, speed: 1.5, size: 0.05, gravity: -1.6, life: 0.7,
      });
    }
  };
  ui.setWeaponIcon(c.setWeapon(equippedWeapon, { silent: true }) ?? '🏏');
  if (score > 0) {
    ui.setHint(null);
    updateScoreHud();
  }
  c.react('switch'); // grand entrance
  ui.confetti();
  window.__debug = {
    character: c, camera,
    getBonk: () => bonk,
    getTargetMesh: () => targetMesh,
    wash: { spawnTrash, updateTrash, trash: fallingTrash },
  };
});

refreshCombosPanel();

const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (character) {
    if (intro >= 0 && intro < 1) {
      // elastic pop-in reveal (easeOutBack)
      intro = Math.min(1, intro + dt * 2.6);
      const x = intro, c1 = 1.70158, c3 = c1 + 1;
      const s = 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
      character.root.scale.setScalar(Math.max(0.001, s));
    }
    character.setTalkAmplitude(voice.getPlaybackLevel());
    character.update(dt, t);
  }

  // mode upkeep
  if (mode === 'bonk' && bonk) {
    bonk.timeLeft -= dt;
    if (bonk.target) {
      bonk.target.age += dt;
      if (targetMesh) {
        const pulse = 1 + Math.sin(t * 9) * 0.16;
        targetMesh.scale.setScalar(pulse);
        targetMesh.lookAt(camera.position); // always face the player
        targetMesh.rotateZ(t * 2.4);
      }
      if (bonk.target.age > TARGET_LIFE) {
        bonk.streak = 0;
        spawnTarget(); // it escaped — relocate
      }
    }
    ui.setHud(`🎯 ${bonk.score}`, `⏱ ${Math.max(0, Math.ceil(bonk.timeLeft))}s`);
    if (bonk.timeLeft <= 0) endBonk();
  } else if (mode === 'wash' && washActive) {
    washTimer += dt;
    if (washTimer >= nextTrashAt && character && character.dirtCount < MAX_DIRT) {
      spawnTrash();
      nextTrashAt = washTimer + 1.3 + Math.random() * 1.2;
    }
    updateTrash(dt);
    ui.setHud(`🫧 ${character?.dirtCount ?? 0} left`, `⏱ ${washTimer.toFixed(1)}s`);
  } else if (mode === 'play' && chain > 0 && performance.now() - lastTapAt > CHAIN_WINDOW) {
    chain = 0; // chain went cold
    updateScoreHud();
  }

  renderer.render(scene, camera);
}
tick();
