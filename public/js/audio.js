// Sons sintetizados em tempo real, sem arquivos externos
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('cc-mudo') === '1';
  }
  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(ctx.destination);

    // Motor
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 500;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(g2).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // Ruído reutilizável
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Pneu cantando
    const skid = ctx.createBufferSource();
    skid.buffer = this.noiseBuf;
    skid.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1500;
    band.Q.value = 2.4;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    skid.connect(band).connect(this.skidGain).connect(this.master);
    skid.start();
  }
  setMuted(m) {
    this.muted = m;
    localStorage.setItem('cc-mudo', m ? '1' : '0');
    if (this.ctx) this.master.gain.value = m ? 0 : 0.7;
  }
  engine(speedRatio, throttle, nitro, skidding) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // simula troca de marchas com um dente de serra sobre a velocidade
    const gears = 4;
    const g = Math.min(gears - 0.001, Math.max(0, speedRatio) * gears);
    const inGear = g - Math.floor(g);
    const f = 55 + inGear * 75 + Math.floor(g) * 16 + (nitro ? 28 : 0);
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(380 + 900 * Math.abs(throttle) + speedRatio * 900, t, 0.08);
    this.engGain.gain.setTargetAtTime(0.045 + Math.abs(throttle) * 0.05 + speedRatio * 0.04, t, 0.06);
    this.skidGain.gain.setTargetAtTime(skidding ? 0.11 : 0, t, 0.05);
  }
  stopEngine() {
    if (!this.ctx) return;
    this.engGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    this.skidGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }
  tone(freq, dur, type = 'sine', vol = 0.2, delay = 0, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  noise(dur, vol, freq, type = 'lowpass') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }
  coin() {
    this.tone(988, 0.08, 'square', 0.06);
    this.tone(1319, 0.2, 'square', 0.06, 0.07);
  }
  nitroGet() {
    this.tone(340, 0.32, 'sawtooth', 0.09, 0, 800);
  }
  checkpoint() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.24, 'triangle', 0.17, i * 0.085));
  }
  crash(power = 1) {
    this.noise(0.32, 0.5 * Math.min(1, power), 900);
    this.tone(110, 0.22, 'square', 0.14 * Math.min(1, power), 0, -60);
  }
  land() {
    this.noise(0.16, 0.26, 340);
  }
  cone() {
    this.tone(420, 0.1, 'triangle', 0.08, 0, -180);
  }
  horn(vol = 0.16) {
    if (vol < 0.004) return;
    this.tone(415, 0.4, 'sawtooth', vol);
    this.tone(523, 0.4, 'sawtooth', vol);
  }
  whoosh() {
    this.noise(0.5, 0.2, 1700, 'bandpass');
  }
  fanfare() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.15, i * 0.14));
  }
}
