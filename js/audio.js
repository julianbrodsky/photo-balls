// Small synthesised noises. No files to load, no licences to worry about, and
// the whole thing is a handful of oscillators that clean up after themselves.
//
// Every method is safe to call before the browser has allowed audio: the
// context is created on the first sound and resumed on demand, so the first
// drop is what unlocks it.
const BASE_HZ = 196;          // G3, the bottom of the merge ladder

export function createAudio() {
  let audio = null;
  let muted = false;
  let broken = false;

  function context() {
    if (broken) return null;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error('no web audio');
      audio ??= new Ctor();
      if (audio.state === 'suspended') audio.resume();
      return audio;
    } catch {
      broken = true;
      return null;
    }
  }

  // One note: a shaped blip that slides in pitch and fades out. Gain is ramped
  // rather than switched, because a square edge on an envelope is an audible
  // click on every single sound.
  function note(freq, { at = 0, dur = 0.14, type = 'triangle', gain = 0.13, bend = 1 } = {}) {
    const ctx = context();
    if (!ctx || muted) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    get muted() { return muted; },
    setMuted(value) { muted = value; },

    drop() {
      note(150, { dur: 0.09, type: 'sine', gain: 0.09, bend: 0.7 });
    },

    // Pitch climbs with the tier, so the sound of a good chain reaction is a
    // rising scale you did not have to be told to listen for.
    merge(tier) {
      const freq = BASE_HZ * Math.pow(2, tier / 5);
      note(freq, { dur: 0.16, gain: 0.11, bend: 1.14 });
      note(freq * 1.5, { at: 0.045, dur: 0.13, gain: 0.06, bend: 1.12 });
    },

    // Two Disco Balls deserve more than a blip.
    pop() {
      [0, 0.07, 0.14, 0.22].forEach((at, i) => {
        note(BASE_HZ * Math.pow(2, (6 + i * 2) / 5), { at, dur: 0.3, gain: 0.1, bend: 1.02 });
      });
    },

    gameOver() {
      [0, 0.13, 0.27].forEach((at, i) => {
        note(BASE_HZ * Math.pow(2, (4 - i * 2) / 5), { at, dur: 0.34, type: 'sine', gain: 0.1, bend: 0.94 });
      });
    },
  };
}
