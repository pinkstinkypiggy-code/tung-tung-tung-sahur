# Tung Tung Tung Sahur 🥁

A mobile-first web toy: poke Tung Tung Tung Sahur (head, belly and legs all react
differently) and switch his weapon — bat, drum mallet or frying pan. Turn on the
mic button and he'll repeat what you say in a sped-up silly voice (opt-in, no
permission prompt until pressed). Built for sharing on TikTok — no backend,
nothing is recorded or uploaded, everything runs on-device.

Stack: Vite + vanilla JS + three.js + Web Audio API.

## Run locally

```bash
npm install
npm run dev
```

Open the printed `http://localhost:5173` URL. The mic works on `localhost` without HTTPS.
To test on a phone on the same network: `npm run dev -- --host`, but note the mic
**requires HTTPS** off-localhost — deploying (below) is the easiest way to test on-device.

## Build & deploy

```bash
npm run build   # outputs dist/
```

**Vercel:** `npx vercel` in this folder (or import the repo at vercel.com).
Framework preset: Vite. Build command `npm run build`, output directory `dist`.

**Netlify:** `npx netlify deploy --prod` (or drag the `dist/` folder onto app.netlify.com/drop).
Build command `npm run build`, publish directory `dist`.

Both serve over HTTPS, which the microphone requires.

## The 3D model

The app looks for `public/assets/tung-tung-tung-sahur.glb` at startup:

- **If present**, it's loaded, auto-centered and scaled.
- **If missing**, an original built-in character (pure three.js primitives) is used,
  so the game always works.

To use the real model: download it from
[Sketchfab](https://sketchfab.com/3d-models/tung-tung-tung-sahur-91ddd9079bd84019ba4a12e01d93a0d6)
(free account required, choose glTF/GLB) and save it as
`public/assets/tung-tung-tung-sahur.glb`.

### Attribution (required)

3D model “Tung Tung Tung Sahur” by
[Eks.Art](https://sketchfab.com/3d-models/tung-tung-tung-sahur-91ddd9079bd84019ba4a12e01d93a0d6),
licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The credit is shown in the in-app info modal and the footer link — keep it there.

## Tuning the voice

All the knobs live at the top of [src/voice.js](src/voice.js):
`PLAYBACK_RATE` (1.5 = chipmunk factor), speech start/stop thresholds,
silence duration, cooldown, etc.

## Browser notes

- iOS Safari: audio starts on the first tap (AudioContext must resume inside a gesture) — handled.
- TikTok / Instagram in-app browsers often block the mic: the app detects this and
  shows a "open in Safari/Chrome" banner with a copy-link button. Tap reactions still work.
- Out of scope for v1 (on purpose): coins, levels, feeding, outfits, mini-games, accounts.
