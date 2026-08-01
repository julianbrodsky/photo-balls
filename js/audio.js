// Small synthesised noises. No files to load, no licences to worry about, and
// the whole thing is a handful of oscillators that clean up after themselves.
//
// Getting sound out of a phone takes more than making the right oscillator.
// There are three separate gates, and the first build only handled one of them:
//
//   1. A browser will not start an audio context outside a user gesture, so the
//      context is built on the first touch rather than at load.
//   2. Safari wants that context woken with real output before it will play
//      anything later, so unlock() pushes one silent sample through it.
//   3. On an iPhone, Web Audio defaults to an audio session that the hardware
//      ring/silent switch mutes. A phone on silent plays nothing at all, with
//      no error and no warning. Asking for the 'playback' session opts out of
//      that, which is the whole reason this game was silent on a phone.
const BASE_HZ = 220;          // A3, the bottom of the merge ladder
const MASTER_GAIN = 0.5;

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let broken = false;

  // Safe to call as often as you like. Only the first call inside a real user
  // gesture does anything, and every later one is a cheap state check.
  function unlock() {
    if (broken || ctx) return wake();
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error('no web audio');

      // Ask for a session the silent switch does not govern. Supported from
      // Safari 16.4 onward, absent everywhere else, and harmless either way.
      try { navigator.audioSession.type = 'playback'; } catch { /* not supported */ }

      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_GAIN;
      master.connect(ctx.destination);

      // One silent sample. Safari treats a context that has never produced
      // output as still asleep, however many times you resume it.
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      source.connect(master);
      source.start(0);
    } catch {
      broken = true;
      ctx = null;
    }
    return wake();
  }

  // Coming back from a locked screen or another tab leaves the context
  // suspended, and nothing says so.
  function wake() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // One note: a shaped blip that can slide in pitch as it fades. Gain is ramped
  // rather than switched, because a square edge on an envelope is an audible
  // click on every single sound.
  function note(freq, { at = 0, dur = 0.16, type = 'triangle', gain = 0.3, bend = 1 } = {}) {
    if (muted) return;
    const audio = wake() || unlock();
    if (!audio) return;

    const t = audio.currentTime + at;
    const osc = audio.createOscillator();
    const amp = audio.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.014);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock,
    get muted() { return muted; },

    setMuted(value) {
      muted = value;
      // Ramped, so hitting the button mid-chime does not click.
      if (master) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, ctx.currentTime, 0.02);
      }
    },

    drop() {
      note(150, { dur: 0.1, type: 'sine', gain: 0.22, bend: 0.65 });
    },

    // The sound of two photos becoming one. A major chord that arrives all at
    // once, with the octave a hair late so it sparkles, and the whole thing
    // pitched up a step per tier: a good chain reaction plays itself a rising
    // scale you were never told to listen for. A few cents of random detune
    // stops the hundredth Pebble merge sounding like a machine.
    merge(tier) {
      const root = BASE_HZ * Math.pow(2, tier / 4) * (0.99 + Math.random() * 0.02);
      note(root, { dur: 0.2, gain: 0.26, bend: 1.06 });
      note(root * 1.25, { at: 0.012, dur: 0.22, gain: 0.2, bend: 1.05 });   // major third
      note(root * 1.5, { at: 0.024, dur: 0.24, gain: 0.22, bend: 1.05 });   // fifth
      note(root * 2, { at: 0.06, dur: 0.3, type: 'sine', gain: 0.16, bend: 1.03 });
    },

    // Two Disco Balls deserve more than a chord.
    pop() {
      [0, 0.075, 0.15, 0.225, 0.33].forEach((at, i) => {
        note(BASE_HZ * Math.pow(2, (4 + i * 2) / 4), { at, dur: 0.36, gain: 0.26, bend: 1.02 });
        note(BASE_HZ * Math.pow(2, (4 + i * 2) / 4) * 1.5, { at: at + 0.02, dur: 0.3, type: 'sine', gain: 0.14 });
      });
    },

    gameOver() {
      [0, 0.15, 0.3].forEach((at, i) => {
        note(BASE_HZ * Math.pow(2, (3 - i * 2) / 4), { at, dur: 0.4, type: 'sine', gain: 0.24, bend: 0.94 });
      });
    },
  };
}
