// The rules of a round. Everything here is about what a collision means, not
// how one is found: the world reports which balls are touching, and this layer
// decides which of those touches turn two photos into one bigger photo.
import { createWorld } from './physics.js';
import { TIERS, TOP_TIER, POP_VALUE, BOARD, RULES, floorYAt } from './config.js';

// How long a freshly merged ball keeps its little swell of pride.
export const POP_TIME = 0.3;

// How far from the centre line a ball of this tier can sit and still be inside
// the box. It depends on the ball, which is why the ready ball's reach changes
// with whatever size you have been handed.
function aimLimit(tier) {
  return BOARD.halfWidth - TIERS[tier].radius;
}

function rollTier() {
  return Math.floor(Math.random() * RULES.dropTiers);
}

const clamp = (x, limit) => Math.max(-limit, Math.min(limit, x));

export function createGame({ onMerge, onDrop, onGameOver }) {
  const world = createWorld();

  const game = {
    world,
    state: 'playing',      // or 'over'
    score: 0,
    biggest: 0,            // highest tier index reached this round
    danger: 0,             // 0 to 1, how close the top line is to ending it
    ready: { x: 0, y: BOARD.spawnY, tier: rollTier() },
    canDrop: true,
    aim, nudge, drop, update, restart,
  };

  let aimX = 0;
  let cooldown = 0;
  let dangerTime = 0;

  // Where you asked for the ball to be, kept apart from where the ball is
  // allowed to be. The two differ whenever the next ball is wider than the last
  // one, and storing the raw wish means aiming at the wall then being handed a
  // Gumball puts it against the wall rather than somewhere you did not point.
  function aim(x) {
    aimX = clamp(x, aimLimit(0));
  }

  // Arrow keys move the aim from where it already is, not from where the ready
  // ball has eased to, so holding a key travels at a steady rate.
  function nudge(dx) {
    aim(aimX + dx);
  }

  function drop() {
    if (game.state !== 'playing' || cooldown > 0) return false;
    const tier = game.ready.tier;
    const jitter = (Math.random() * 2 - 1) * RULES.spawnJitter;
    world.add({
      x: clamp(game.ready.x + jitter, aimLimit(tier)),
      y: BOARD.spawnY,
      radius: TIERS[tier].radius,
      tier,
    });
    cooldown = RULES.dropCooldown;
    game.canDrop = false;
    // The next size is decided the moment this one leaves your hand, so it is
    // on screen for the whole cooldown rather than appearing at the end of it.
    game.ready.tier = rollTier();
    onDrop?.();
    return true;
  }

  function update(dt) {
    if (game.state === 'playing') {
      cooldown = Math.max(0, cooldown - dt);
      game.canDrop = cooldown === 0;
      // Clamped here rather than in aim(), because the ball you are holding can
      // change size between one frame and the next and a wider one has to come
      // away from the wall to fit.
      const target = clamp(aimX, aimLimit(game.ready.tier));
      game.ready.x += (target - game.ready.x) * Math.min(1, RULES.aimEase * dt);
    }

    world.step(dt);
    for (const body of world.bodies) {
      if (body.popTime > 0) body.popTime = Math.max(0, body.popTime - dt);
    }

    if (game.state !== 'playing') return;
    resolveMerges();
    watchTheLine(dt);
  }

  // ── Merging ──────────────────────────────────────────────────────────────

  function resolveMerges() {
    // A ball can only be spent once per frame. Without this, a ball wedged
    // between two identical twins would merge with both and quietly print an
    // extra photo out of nothing.
    const spent = new Set();
    for (const { a, b } of world.contacts) {
      if (a.tier !== b.tier || spent.has(a) || spent.has(b)) continue;
      spent.add(a);
      spent.add(b);
      combine(a, b);
    }
  }

  function combine(a, b) {
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    world.remove(a);
    world.remove(b);

    if (a.tier === TOP_TIER) {
      // Nothing bigger to become. Both Disco Balls burst, the score jumps, and
      // the box gets a hole in the middle of the pile as a reward.
      game.score += POP_VALUE;
      onMerge?.({ x: midX, y: midY, tier: TOP_TIER, value: POP_VALUE, popped: true });
      return;
    }

    const tier = a.tier + 1;
    const radius = TIERS[tier].radius;

    // The ball being born is wider than either half that made it, so the point
    // between them can easily be inside a wall or under the floor. Placing it
    // legally costs one clamp. Leaving it to the solver means one substep of
    // correction becomes several thousand units a second of launch, and a
    // merge in the corner fires the new ball out of the open top of the box.
    const limit = BOARD.halfWidth - radius;
    const x = Math.max(-limit, Math.min(limit, midX));
    const y = Math.min(midY, floorYAt(x) - radius);

    const born = world.add({
      x, y, radius, tier,
      // Averaging momentum keeps a merge from launching the new ball: two
      // halves falling at the same speed produce one ball falling at that
      // speed, which is what your eye expects to see.
      vx: (a.vx + b.vx) / 2,
      vy: (a.vy + b.vy) / 2,
    });
    born.popTime = POP_TIME;

    game.score += TIERS[tier].value;
    game.biggest = Math.max(game.biggest, tier);
    onMerge?.({ x, y, tier, value: TIERS[tier].value, popped: false });
  }

  // ── The line ─────────────────────────────────────────────────────────────

  // A ball on its way down is allowed to pass the line. It has to be up there
  // and out of options for a good moment before the round is called, so a
  // lucky drop into a tight gap is never punished for the trip.
  function watchTheLine(dt) {
    let breached = false;
    for (const body of world.bodies) {
      if (body.age > RULES.dangerGrace && body.y - body.radius < BOARD.lineY) {
        breached = true;
        break;
      }
    }
    dangerTime = breached ? dangerTime + dt : 0;
    game.danger = Math.min(1, dangerTime / RULES.dangerLimit);
    if (dangerTime >= RULES.dangerLimit) {
      game.state = 'over';
      onGameOver?.(game.score);
    }
  }

  function restart() {
    world.bodies.length = 0;
    world.contacts.length = 0;
    game.state = 'playing';
    game.score = 0;
    game.biggest = 0;
    game.danger = 0;
    game.ready.x = 0;
    game.ready.tier = rollTier();
    game.canDrop = true;
    aimX = 0;
    cooldown = 0;
    dangerTime = 0;
  }

  return game;
}
