/**
 * WebAudio synthesized placeholder SFX (NO external audio files).
 * Temporary procedural sounds for Phase 1:
 *  - playShot(isSingle): laser/pulse turret shot
 *  - playHit(): metallic armor hit
 *  - playExplosion(): enemy destruction burst
 */
export function createAudio() {
  let ctx = null;
  let noiseBuffer = null;

  function ensureContext() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!noiseBuffer && ctx) {
      const len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    return ctx;
  }

  function playShot(isSingle = false) {
    const c = ensureContext();
    if (!c) return;
    const now = c.currentTime;

    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = isSingle ? 'triangle' : 'sawtooth';
    const startFreq = isSingle ? 980 : 840;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.085);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  function playHit() {
    const c = ensureContext();
    if (!c) return;
    const now = c.currentTime;

    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.055);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.065);
  }

  function playExplosion() {
    const c = ensureContext();
    if (!c) return;
    const now = c.currentTime;

    // Noise burst
    if (noiseBuffer) {
      const src = c.createBufferSource();
      src.buffer = noiseBuffer;

      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.frequency.exponentialRampToValueAtTime(120, now + 0.42);

      const gain = c.createGain();
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(c.destination);
      src.start(now);
      src.stop(now + 0.46);
    }

    // Low sub punch
    const sub = c.createOscillator();
    const subGain = c.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(150, now);
    sub.frequency.exponentialRampToValueAtTime(38, now + 0.25);
    subGain.gain.setValueAtTime(0.28, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    sub.connect(subGain);
    subGain.connect(c.destination);
    sub.start(now);
    sub.stop(now + 0.27);
  }

  return {
    unlock: ensureContext,
    playShot,
    playHit,
    playExplosion,
  };
}
