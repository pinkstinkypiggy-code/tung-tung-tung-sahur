// Silly synthesized reaction sounds — zero audio files, zero copyright worries.
export class SFX {
  constructor() {
    this.ctx = null;
  }

  setContext(ctx) {
    this.ctx = ctx;
  }

  _blip({ type = 'sine', from = 440, to = 880, dur = 0.15, vol = 0.25, delay = 0, filterHz = 0 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let out = gain;
    if (filterHz) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterHz;
      gain.connect(filter);
      out = filter;
    }
    osc.connect(gain);
    out.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise({ dur = 0.15, vol = 0.25, filterHz = 800, filterType = 'lowpass', delay = 0 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterHz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t0);
  }

  // head tap: happy double squeak
  squeak() {
    this._blip({ type: 'triangle', from: 620, to: 1250, dur: 0.12, vol: 0.22 });
    this._blip({ type: 'triangle', from: 820, to: 1500, dur: 0.13, vol: 0.2, delay: 0.1 });
  }

  // belly tap: low "oof"
  oof() {
    this._blip({ type: 'sawtooth', from: 190, to: 62, dur: 0.28, vol: 0.35, filterHz: 420 });
  }

  // leg tap: springy wobble
  boing() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const dur = 0.5;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, t0);
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(9, t0);
    lfoGain.gain.setValueAtTime(70, t0);
    lfoGain.gain.exponentialRampToValueAtTime(4, t0 + dur);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + dur + 0.02);
    lfo.stop(t0 + dur + 0.02);
  }

  // weapon switch: cheerful ascending arpeggio
  switchy() {
    this._blip({ type: 'square', from: 520, to: 660, dur: 0.08, vol: 0.1 });
    this._blip({ type: 'square', from: 700, to: 900, dur: 0.08, vol: 0.11, delay: 0.07 });
    this._blip({ type: 'triangle', from: 950, to: 1400, dur: 0.14, vol: 0.16, delay: 0.14 });
  }

  // falling flat on his back
  thud() {
    this._blip({ type: 'sine', from: 130, to: 42, dur: 0.3, vol: 0.5 });
    this._noise({ dur: 0.12, vol: 0.35, filterHz: 220 });
  }

  // mud hitting him
  splat() {
    this._noise({ dur: 0.2, vol: 0.32, filterHz: 420 });
    this._blip({ type: 'sawtooth', from: 160, to: 55, dur: 0.16, vol: 0.18, filterHz: 500 });
  }

  // sponge scrubbing (called rapidly, so keep it tiny)
  scrub() {
    this._noise({ dur: 0.07, vol: 0.1, filterHz: 900 + Math.random() * 700, filterType: 'bandpass' });
  }

  // small trash blob landing on him
  plop() {
    this._blip({ type: 'sine', from: 300, to: 90, dur: 0.12, vol: 0.16 });
    this._noise({ dur: 0.06, vol: 0.1, filterHz: 600 });
  }

  // all clean!
  clean() {
    this._blip({ type: 'triangle', from: 900, to: 1000, dur: 0.09, vol: 0.14 });
    this._blip({ type: 'triangle', from: 1250, to: 1350, dur: 0.09, vol: 0.14, delay: 0.09 });
    this._blip({ type: 'triangle', from: 1700, to: 2100, dur: 0.16, vol: 0.16, delay: 0.18 });
  }

  // ---- Sahur Jam drums: he IS the drum ----
  drum(zone) {
    if (zone === 'head') {
      // "tak" — sharp rim hit
      this._blip({ type: 'triangle', from: 760, to: 380, dur: 0.09, vol: 0.4 });
      this._noise({ dur: 0.04, vol: 0.22, filterHz: 3200, filterType: 'bandpass' });
    } else if (zone === 'belly') {
      // "DUNG" — the big sahur drum boom
      this._blip({ type: 'sine', from: 170, to: 48, dur: 0.5, vol: 0.6 });
      this._noise({ dur: 0.05, vol: 0.18, filterHz: 500 });
    } else {
      // "tek" — mid knock
      this._blip({ type: 'square', from: 420, to: 230, dur: 0.13, vol: 0.28, filterHz: 1100 });
    }
  }

  // ---- Bonk! minigame ----
  hit(streak = 0) {
    const s = Math.min(streak, 10);
    this._blip({ type: 'triangle', from: 520 + s * 55, to: 880 + s * 70, dur: 0.11, vol: 0.3 });
    this._blip({ type: 'sine', from: 880 + s * 70, to: 1200 + s * 80, dur: 0.09, vol: 0.18, delay: 0.07 });
  }

  miss() {
    this._blip({ type: 'sawtooth', from: 300, to: 95, dur: 0.3, vol: 0.26, filterHz: 700 });
  }

  countTick() {
    this._blip({ type: 'square', from: 700, to: 700, dur: 0.06, vol: 0.16 });
  }

  fanfare() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) =>
      this._blip({ type: 'triangle', from: f, to: f * 1.02, dur: 0.16, vol: 0.22, delay: i * 0.11 })
    );
    this._noise({ dur: 0.5, vol: 0.06, filterHz: 6000, filterType: 'highpass', delay: 0.3 });
  }

  play(zone) {
    if (zone === 'head') this.squeak();
    else if (zone === 'belly') this.oof();
    else if (zone === 'switch') this.switchy();
    else this.boing();
  }
}
