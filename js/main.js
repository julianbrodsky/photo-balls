// Entry point. Wires the setup screen to a round, and a round to the screen:
// the game rules, the physics, the drawing, and the noises all stay strangers
// to each other and meet here.
import { TIERS, TOP_TIER } from './config.js';
import { initSetup } from './ui.js';
import { createGame } from './board.js';
import { createRenderer } from './render.js';
import { createEffects } from './effects.js';
import { attachInput } from './input.js';
import { createAudio } from './audio.js';
import { loadBest, saveBest } from './storage.js';

const el = id => document.getElementById(id);

const dom = {
  game:      el('game'),
  canvas:    el('board'),
  rail:      el('rail'),
  score:     el('score'),
  best:      el('best'),
  sound:     el('sound-btn'),
  restart:   el('restart-btn'),
  over:      el('gameover'),
  overScore: el('final-score'),
  overNote:  el('final-note'),
  again:     el('again-btn'),
  newPhotos: el('newphotos-btn'),
};

const audio = createAudio();
let best = loadBest();
dom.best.textContent = String(best);

// A browser will not let a page make noise until someone has touched it, so the
// audio context is built on the first press anywhere and not a moment sooner.
// Capture phase, because the canvas calls preventDefault on its own pointers.
window.addEventListener('pointerdown', () => audio.unlock(), { once: true, capture: true });

dom.sound.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  dom.sound.textContent = audio.muted ? '🔇' : '🔊';
  dom.sound.setAttribute('aria-label', audio.muted ? 'Sound off' : 'Sound on');
});

initSetup({ onStart: play });

function play({ textures, thumbs }) {
  dom.game.hidden = false;
  buildRail(thumbs);

  const effects = createEffects();
  const renderer = createRenderer(dom.canvas, textures);
  const game = createGame({ onDrop, onMerge, onGameOver });

  function onDrop() {
    audio.drop();
  }

  function onMerge({ x, y, tier, value, popped }) {
    effects.burst(x, y, tier, { big: popped });
    effects.label(x, y, `+${value}`, popped ? '#fff3e2' : TIERS[tier].color);
    if (popped) audio.pop(); else audio.merge(tier);
    unlockRail(game.biggest);
    showScore(game.score);
  }

  function onGameOver(score) {
    audio.gameOver();
    if (score > best) {
      best = score;
      saveBest(best);
      dom.best.textContent = String(best);
    }
    dom.overScore.textContent = String(score);
    dom.overNote.textContent = signOff(score, game.biggest, score === best && score > 0);
    dom.over.hidden = false;
    dom.again.focus();
  }

  attachInput(dom.canvas, {
    onAim: clientX => game.aim(renderer.toBoardX(clientX)),
    onNudge: game.nudge,
    onDrop: () => game.drop(),
  });

  function newRound() {
    game.restart();
    effects.clear();
    unlockRail(0);
    showScore(0);
    dom.over.hidden = true;
  }

  dom.again.addEventListener('click', newRound);
  dom.restart.addEventListener('click', newRound);
  // Nothing about a photo is stored, so the shortest honest way back to the
  // picker is to start the page over.
  dom.newPhotos.addEventListener('click', () => location.reload());

  // The canvas is a flex item, so its size follows the viewport, the address
  // bar sliding away, and the phone being turned sideways. Watching the
  // element itself catches all three without listening for any of them.
  new ResizeObserver(renderer.resize).observe(dom.canvas);
  renderer.resize();

  let previous = performance.now();
  requestAnimationFrame(function frame(now) {
    requestAnimationFrame(frame);
    // Capped, so a tab that was in the background for a minute resumes instead
    // of advancing the world by a minute in a single step.
    const dt = Math.min((now - previous) / 1000, 1 / 30);
    previous = now;
    game.update(dt);
    effects.update(dt);
    renderer.draw(game, effects, now / 1000);
  });
}

// ── Heads up display ───────────────────────────────────────────────────────

function showScore(score) {
  if (dom.score.textContent === String(score)) return;
  dom.score.textContent = String(score);
  // Restarting a CSS animation takes a reflow between removing and adding the
  // class, otherwise the browser sees no change at all and skips it.
  dom.score.classList.remove('bumped');
  void dom.score.offsetWidth;
  dom.score.classList.add('bumped');
}

function buildRail(thumbs) {
  dom.rail.replaceChildren(...TIERS.map((tier, i) => {
    const li = document.createElement('li');
    li.className = 'rail-item';
    li.style.setProperty('--tier', tier.color);
    li.title = `${tier.name}, worth ${tier.value}`;

    const photo = document.createElement('span');
    photo.className = 'rail-photo';
    photo.append(thumbs[i]);

    const value = document.createElement('span');
    value.className = 'rail-value';
    value.textContent = String(tier.value);

    li.append(photo, value);
    return li;
  }));
  unlockRail(0);
}

// Everything you have made so far is lit; everything ahead of you is a rumour.
function unlockRail(biggest) {
  [...dom.rail.children].forEach((item, i) => {
    item.classList.toggle('locked', i > biggest);
  });
}

const SIGN_OFFS = [
  [60,   'A short lap, but a lap.'],
  [200,  'You were just getting into the swing of it.'],
  [500,  'Nicely rounded.'],
  [1200, 'You were properly on a roll there.'],
  [3000, 'Round and round and round you went.'],
];

function signOff(score, biggest, isBest) {
  if (isBest) return 'A new best round. Everything else can go in circles.';
  if (biggest >= TOP_TIER) return 'You built a Disco Ball. Take the lap.';
  for (const [limit, line] of SIGN_OFFS) {
    if (score < limit) return line;
  }
  return 'At this point you are just showing off.';
}
