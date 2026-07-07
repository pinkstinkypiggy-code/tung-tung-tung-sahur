// Voice repeat loop: listen -> detect speech -> record -> play back sped-up.
// Tuning knobs:
export const PLAYBACK_RATE = 1.5; // speed-up = pitch-up chipmunk voice
const START_RMS = 0.045; // mic level that counts as "speech started"
const STOP_RMS = 0.022; // below this counts as silence
const SILENCE_MS = 800; // this much silence ends the utterance
const MIN_SPEECH_MS = 220; // shorter blips are ignored
const MAX_UTTERANCE_MS = 10000;
const COOLDOWN_MS = 500; // pause after playback before listening again (feedback guard)
const PREBUFFER_CHUNKS = 8; // ~0.35s kept from before the trigger so words aren't clipped

export class VoiceLoop {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.state = 'off'; // off | listening | recording | playing | cooldown
    this.muted = false;
    this.ctx = null;
    this._pre = [];
    this._chunks = [];
    this._silenceMs = 0;
    this._elapsedMs = 0;
    this._levelData = null;
  }

  // Must be called from a user-gesture handler (iOS). Throws if mic is denied.
  async init(ctx) {
    this.ctx = ctx;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.stream = stream;

    const src = ctx.createMediaStreamSource(stream);
    // ScriptProcessor: deprecated but the one capture path that works everywhere,
    // including older iOS Safari. 2048 frames ≈ 43ms at 48kHz.
    this.proc = ctx.createScriptProcessor(2048, 1, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0; // processor must reach destination to run, but stays silent
    src.connect(this.proc);
    this.proc.connect(sink);
    sink.connect(ctx.destination);

    this.playGain = ctx.createGain();
    this.playAnalyser = ctx.createAnalyser();
    this.playAnalyser.fftSize = 512;
    this._levelData = new Uint8Array(this.playAnalyser.fftSize);
    this.playGain.connect(this.playAnalyser);
    this.playAnalyser.connect(ctx.destination);

    this.proc.onaudioprocess = (e) => this._process(e);
    this.state = 'listening';
  }

  _process(e) {
    const input = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    const chunkMs = (input.length / this.ctx.sampleRate) * 1000;

    if (this.state === 'listening' && !this.muted) {
      this._pre.push(new Float32Array(input));
      if (this._pre.length > PREBUFFER_CHUNKS) this._pre.shift();
      if (rms > START_RMS) {
        this.state = 'recording';
        this._chunks = this._pre.slice();
        this._pre = [];
        this._silenceMs = 0;
        this._elapsedMs = this._chunks.length * chunkMs;
        this.cb.onSpeechStart?.();
      }
    } else if (this.state === 'recording') {
      this._chunks.push(new Float32Array(input));
      this._elapsedMs += chunkMs;
      this._silenceMs = rms < STOP_RMS ? this._silenceMs + chunkMs : 0;
      if (this.muted) {
        this._chunks = [];
        this.state = 'listening';
        this.cb.onSpeechEnd?.(false);
      } else if (this._silenceMs >= SILENCE_MS || this._elapsedMs >= MAX_UTTERANCE_MS) {
        this._finishRecording();
      }
    }
  }

  _finishRecording() {
    const chunks = this._chunks;
    this._chunks = [];
    const speechMs = this._elapsedMs - this._silenceMs;
    if (speechMs < MIN_SPEECH_MS) {
      this.state = 'listening';
      this.cb.onSpeechEnd?.(false);
      return;
    }
    this.state = 'playing';
    this.cb.onSpeechEnd?.(true);

    // Assemble one buffer, trimming most of the trailing silence
    const sr = this.ctx.sampleRate;
    const full = chunks.reduce((n, c) => n + c.length, 0);
    const trim = Math.max(0, Math.floor((sr * (Math.min(this._silenceMs, SILENCE_MS) - 200)) / 1000));
    const total = Math.max(sr * 0.15, full - trim);
    const buffer = this.ctx.createBuffer(1, Math.floor(total), sr);
    const data = buffer.getChannelData(0);
    let offset = 0;
    for (const c of chunks) {
      if (offset >= data.length) break;
      data.set(c.subarray(0, Math.min(c.length, data.length - offset)), offset);
      offset += c.length;
    }

    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = PLAYBACK_RATE;
    node.connect(this.playGain);
    node.onended = () => {
      this.cb.onPlaybackEnd?.();
      this.state = 'cooldown';
      setTimeout(() => {
        if (this.state === 'cooldown') this.state = 'listening';
      }, COOLDOWN_MS);
    };
    this.cb.onPlaybackStart?.();
    node.start();
  }

  // 0..1-ish RMS of what the character is currently saying (drives the mouth)
  getPlaybackLevel() {
    if (this.state !== 'playing' || !this.playAnalyser) return 0;
    this.playAnalyser.getByteTimeDomainData(this._levelData);
    let sum = 0;
    for (let i = 0; i < this._levelData.length; i++) {
      const v = (this._levelData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this._levelData.length) * 4);
  }

  setMuted(m) {
    this.muted = m;
  }

  get active() {
    return this.state !== 'off';
  }
}
