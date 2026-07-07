const $ = (id) => document.getElementById(id);

export function isInAppBrowser() {
  return /TikTok|musical_ly|Instagram|FBAN|FBAV|FB_IAB|Line\/|MicroMessenger|Snapchat/i.test(
    navigator.userAgent
  );
}

const CONFETTI_COLORS = ['#ffc94d', '#ff5e5b', '#3ec9b8', '#ff9cb8', '#fff4dd', '#a13d8d'];

export function setupUI({ onShopOpen, onWeaponPick, onMicPress, onDirty, onSpongeToggle, onModeSelect }) {
  const hint = $('hint');
  const banner = $('banner');
  const bannerText = $('banner-text');
  const bannerAction = $('banner-action');
  const btnWeapon = $('btn-weapon');
  const btnMic = $('btn-mic');
  const micIcon = $('mic-icon');
  const modal = $('modal');
  const result = $('result');
  const fx = $('fx');
  const hud = $('hud');
  const hudMain = $('hud-main');
  const hudSub = $('hud-sub');

  const pop = (btn) => {
    btn.classList.remove('pop');
    void btn.offsetWidth; // restart the animation
    btn.classList.add('pop');
  };

  btnWeapon.addEventListener('click', () => { pop(btnWeapon); onShopOpen?.(); $('shop').hidden = false; });
  btnMic.addEventListener('click', () => { pop(btnMic); onMicPress?.(); });
  $('btn-dirty').addEventListener('click', (e) => { pop(e.currentTarget); onDirty?.(); });
  $('btn-sponge').addEventListener('click', (e) => { pop(e.currentTarget); onSpongeToggle?.(); });
  $('btn-combos').addEventListener('click', (e) => { pop(e.currentTarget); $('combos').hidden = false; });
  $('combos-close').addEventListener('click', () => { $('combos').hidden = true; });
  $('combos').addEventListener('click', (e) => { if (e.target === $('combos')) $('combos').hidden = true; });
  $('shop-close').addEventListener('click', () => { $('shop').hidden = true; });
  $('shop').addEventListener('click', (e) => { if (e.target === $('shop')) $('shop').hidden = true; });

  const modeButtons = [...document.querySelectorAll('.corner-mode')];
  modeButtons.forEach((btn) =>
    btn.addEventListener('click', () => onModeSelect?.(btn.dataset.mode))
  );

  $('btn-info').addEventListener('click', () => { modal.hidden = false; });
  $('modal-close').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  $('banner-close').addEventListener('click', () => { banner.hidden = true; });

  let resultCbs = {};
  $('result-again').addEventListener('click', () => { result.hidden = true; resultCbs.again?.(); });
  $('result-close').addEventListener('click', () => { result.hidden = true; resultCbs.close?.(); });

  let lastHudMain = '';
  const ui = {
    setHint(text) {
      if (!text) { hint.classList.add('hidden'); return; }
      hint.textContent = text;
      hint.classList.remove('hidden');
    },

    setMode(mode) {
      modeButtons.forEach((c) => c.classList.toggle('active', c.dataset.mode === mode));
      $('actionbar').classList.toggle('hide', mode !== 'play');
    },

    setSpongeOn(on) {
      $('btn-sponge').classList.toggle('active', on);
    },

    setHud(main, sub) {
      if (main == null) { hud.hidden = true; return; }
      hud.hidden = false;
      if (main !== lastHudMain) {
        lastHudMain = main;
        hudMain.classList.remove('bump');
        void hudMain.offsetWidth;
        hudMain.classList.add('bump');
      }
      hudMain.textContent = main;
      hudSub.textContent = sub ?? '';
      hudSub.style.display = sub ? '' : 'none';
    },

    // render the weapon shop; owned = Set of ids, equipped = id
    renderShop(weapons, owned, equipped, balance) {
      const list = $('shop-list');
      list.innerHTML = '';
      for (const w of weapons) {
        const li = document.createElement('li');
        const isOwned = owned.has(w.id);
        const isEquipped = w.id === equipped;
        const canAfford = balance >= w.cost;
        if (isEquipped) li.classList.add('equipped');
        if (!isOwned && !canAfford) li.classList.add('locked');
        if (w.legendary) li.classList.add('legendary');
        const badge = isEquipped
          ? '<span class="combo-pts owned">✓ EQUIPPED</span>'
          : isOwned
            ? '<span class="combo-pts owned">EQUIP</span>'
            : `<span class="combo-pts ${canAfford ? '' : 'cant'}">${canAfford ? '' : '🔒 '}⭐ ${w.cost.toLocaleString()}</span>`;
        li.innerHTML =
          `<span class="combo-icon">${w.emoji}</span>` +
          `<span class="combo-info">` +
          `<span class="combo-name">${w.name}</span>` +
          `<span class="combo-seq">${w.desc}</span>` +
          `</span>` + badge;
        li.addEventListener('click', () => onWeaponPick?.(w.id));
        list.appendChild(li);
      }
      $('shop-balance').textContent = balance.toLocaleString();
    },

    closeShop() { $('shop').hidden = true; },

    // render the combo guide; `done` is a Set of discovered combo ids
    renderCombos(combos, done, bestScore) {
      const list = $('combo-list');
      list.innerHTML = '';
      for (const c of combos) {
        const li = document.createElement('li');
        if (done.has(c.id)) li.classList.add('done');
        li.innerHTML =
          `<span class="combo-icon">${c.emoji}</span>` +
          `<span class="combo-info">` +
          `<span class="combo-name">${c.name}${done.has(c.id) ? ' <span class="done-tick">✓ done</span>' : ''}</span>` +
          `<span class="combo-seq">${c.seq.map((z) => z[0].toUpperCase() + z.slice(1)).join(' → ')}${c.note ? ' · ' + c.note : ''}</span>` +
          `</span>` +
          `<span class="combo-pts">+${c.points}</span>`;
        list.appendChild(li);
      }
      $('combos-best').textContent = bestScore.toLocaleString();
    },

    showResult({ emoji, title, score, best, onAgain, onClose }) {
      $('result-emoji').textContent = emoji;
      $('result-title').textContent = title;
      $('result-score').textContent = score;
      $('result-best').textContent = best ?? '';
      resultCbs = { again: onAgain, close: onClose };
      result.hidden = false;
    },

    // emoji/text that floats up from a screen point
    float(x, y, text, big = false) {
      const el = document.createElement('div');
      el.className = 'floater' + (big ? ' big' : '');
      el.textContent = text;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      fx.appendChild(el);
      setTimeout(() => el.remove(), 1050);
    },

    confetti(x = window.innerWidth / 2, y = window.innerHeight * 0.4, n = 26) {
      for (let i = 0; i < n; i++) {
        const el = document.createElement('div');
        el.className = 'confetto';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        el.style.setProperty('--cx', (Math.random() - 0.5) * 320 + 'px');
        el.style.setProperty('--cy', 180 + Math.random() * 380 + 'px');
        el.style.setProperty('--cr', (Math.random() - 0.5) * 900 + 'deg');
        fx.appendChild(el);
        setTimeout(() => el.remove(), 1350);
      }
    },

    shake() {
      const s = $('shaker');
      s.classList.remove('shake');
      void s.offsetWidth;
      s.classList.add('shake');
    },

    setWeaponIcon(emoji) { $('weapon-icon').textContent = emoji; },

    setWashMode(on) { document.body.classList.toggle('washing', on); },

    moveSponge(x, y) {
      const s = $('sponge');
      s.style.left = x + 'px';
      s.style.top = y + 'px';
    },

    setMicOn(on) {
      btnMic.classList.toggle('muted', !on);
      micIcon.textContent = '🎤'; // always a microphone; dimmed when off
      btnMic.setAttribute('aria-label', on ? 'Mute microphone' : 'Enable microphone');
    },

    setMicPrompt(show) {
      $('mic-prompt').hidden = !show;
    },

    showMicDenied() {
      if (isInAppBrowser()) {
        bannerText.textContent =
          'This browser blocks the microphone 😢 For the full experience, open this page in Safari or Chrome:';
        bannerAction.textContent = '📋 Copy link';
        bannerAction.onclick = async () => {
          try {
            await navigator.clipboard.writeText(location.href);
            bannerAction.textContent = '✅ Copied!';
          } catch {
            bannerText.textContent = location.href;
          }
        };
      } else {
        bannerText.textContent =
          'He needs the microphone to copy your voice! Everything else still works. Allow the mic and try again:';
        bannerAction.textContent = '🎤 Retry';
        bannerAction.onclick = () => {
          banner.hidden = true;
          onMicPress?.();
        };
      }
      banner.hidden = false;
    },

    hideBanner() { banner.hidden = true; },
  };

  ui.setMicOn(false); // mic starts off — it's opt-in

  return ui;
}
