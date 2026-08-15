// Everything the player sees inside the canvas: the box, the line, the balls,
// and the ball waiting to go in. Drawing happens in board units, so this file
// and the physics agree on what a coordinate means and neither has to think
// about pixels.
import { BOARD, TIERS, TOP_TIER, FUNNEL, floorYAt } from './config.js';
import { POP_TIME } from './board.js';

const TAU = Math.PI * 2;

// Where the box's walls stop. Everything above this belongs to the funnel, and
// pinning it here is what keeps extending the stage upward from stretching the
// box along with it.
const RIM_Y = -18;

// The chute's four rail ends, worked out once from the funnel's centre line.
// Doing it here rather than per frame is partly for speed and mostly so the
// stage can be sized off the real shape: the top edge comes from the highest
// rail there actually is, which means retuning the funnel in config can never
// leave it clipped by the canvas.
const CHUTE = (() => {
  const { entryX, entryY, exitX, exitY, entryHalf, exitHalf, overhang } = FUNNEL;
  const dx = exitX - entryX;
  const dy = exitY - entryY;
  const len = Math.hypot(dx, dy);
  const ax = dx / len, ay = dy / len;      // along the chute
  const nx = -ay, ny = ax;                 // across it

  // The rails run on behind the waiting ball, so the chute reads as something
  // the ball came out of rather than something it is perched on the end of.
  const backX = entryX - ax * overhang;
  const backY = entryY - ay * overhang;
  const at = (x, y, half, side) => ({ x: x + nx * half * side, y: y + ny * half * side });

  return {
    upper: [at(backX, backY, entryHalf, 1), at(exitX, exitY, exitHalf, 1)],
    lower: [at(backX, backY, entryHalf, -1), at(exitX, exitY, exitHalf, -1)],
  };
})();

const CHUTE_TOP = Math.min(...[...CHUTE.upper, ...CHUTE.lower].map(p => p.y));

// The drawn stage is the box, its shell, and the airspace above it that the
// funnel hangs in.
const SHELL = BOARD.wallThickness;

export const STAGE = {
  left: -(BOARD.halfWidth + SHELL),
  right: BOARD.halfWidth + SHELL,
  top: Math.min(RIM_Y, CHUTE_TOP - FUNNEL.railThickness),
  bottom: BOARD.floorY + SHELL + BOARD.rimThickness,
};
STAGE.width = STAGE.right - STAGE.left;
STAGE.height = STAGE.bottom - STAGE.top;

// The floor is a parabola, and a quadratic Bezier with this control point is
// that same parabola exactly, so the drawn floor and the solved floor are the
// same curve rather than two things that look alike.
const FLOOR_CONTROL_Y = BOARD.floorY + BOARD.sag;
const FLOOR_EDGE_Y = floorYAt(BOARD.halfWidth);

export function createRenderer(canvas, textures) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, originX: 0, originY: 0, dpr: 1 };
  const shades = TIERS.map(tier => makeShade(ctx, tier.radius));

  function resize() {
    // Capped at 2, because an iPhone reports 3 and a third of a million extra
    // pixels a frame buys nothing you can see on a photo of your dog.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    view.dpr = dpr;
    view.scale = Math.min(rect.width / STAGE.width, rect.height / STAGE.height);
    view.originX = rect.width / 2;
    view.originY = (rect.height - STAGE.height * view.scale) / 2 - STAGE.top * view.scale;
  }

  // Screen pixels to board units. The rect is read fresh because the page can
  // scroll or the address bar can slide away between one tap and the next.
  function toBoardX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left - view.originX) / view.scale;
  }

  function draw(game, effects, time) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = view.scale * view.dpr;
    ctx.setTransform(s, 0, 0, s, view.originX * view.dpr, view.originY * view.dpr);

    drawBox();
    if (game.state === 'playing') drawFunnel(game, time);
    drawLine(game.danger, time);
    if (game.state === 'playing') drawGuide(game);
    for (const body of game.world.bodies) {
      drawBall(body.x, body.y, body.tier, body.angle, popScale(body), 1);
    }
    if (game.state === 'playing') drawReady(game, time);
    effects.draw(ctx);
  }

  // ── The funnel ───────────────────────────────────────────────────────────

  // Two converging rails with a dark throat between them. The ball waiting its
  // turn is drawn inside, before the rails go down, so the rails read as the
  // near wall of a tube it is sitting in rather than a shape behind it.
  function drawFunnel(game, time) {
    const [upA, upB] = CHUTE.upper;
    const [downA, downB] = CHUTE.lower;

    ctx.beginPath();
    ctx.moveTo(upA.x, upA.y);
    ctx.lineTo(upB.x, upB.y);
    ctx.lineTo(downB.x, downB.y);
    ctx.lineTo(downA.x, downA.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(18, 4, 44, 0.55)';
    ctx.fill();

    // The ball on deck. It swells into view over the delivery, so the moment
    // one ball rolls out the next is visibly fed in behind it.
    const arriving = 1 - Math.pow(game.delivery, 2);
    if (arriving > 0.02) {
      drawBall(FUNNEL.entryX, FUNNEL.entryY, game.next.tier, time * 0.4, arriving, 1);
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [a, b] of [[upA, upB], [downA, downB]]) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(24, 6, 48, 0.55)';
      ctx.lineWidth = FUNNEL.railThickness + 8;
      ctx.stroke();
      ctx.strokeStyle = '#fff3e2';
      ctx.lineWidth = FUNNEL.railThickness;
      ctx.stroke();
    }
  }

  // ── The box ──────────────────────────────────────────────────────────────

  function drawBox() {
    const hw = BOARD.halfWidth;

    // The wash starts level with the top of the walls, not above them, so the
    // box has a lip rather than fading out into the backdrop.
    ctx.beginPath();
    ctx.moveTo(-hw, RIM_Y);
    ctx.lineTo(-hw, FLOOR_EDGE_Y);
    ctx.quadraticCurveTo(0, FLOOR_CONTROL_Y, hw, FLOOR_EDGE_Y);
    ctx.lineTo(hw, RIM_Y);
    ctx.closePath();

    const wash = ctx.createLinearGradient(0, RIM_Y, 0, BOARD.floorY);
    wash.addColorStop(0, 'rgba(30, 8, 60, 0.16)');
    wash.addColorStop(1, 'rgba(18, 4, 44, 0.52)');
    ctx.fillStyle = wash;
    ctx.fill();

    // The shell is stroked half a thickness outside the interior, so the cream
    // band you see stops exactly where the solver stops the balls.
    const off = SHELL / 2;
    ctx.beginPath();
    ctx.moveTo(-hw - off, RIM_Y);
    ctx.lineTo(-hw - off, FLOOR_EDGE_Y + off);
    ctx.quadraticCurveTo(0, FLOOR_CONTROL_Y + off, hw + off, FLOOR_EDGE_Y + off);
    ctx.lineTo(hw + off, RIM_Y);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(24, 6, 48, 0.55)';
    ctx.lineWidth = SHELL + 10;
    ctx.stroke();
    ctx.strokeStyle = '#fff3e2';
    ctx.lineWidth = SHELL;
    ctx.stroke();

    // A slim highlight along the top inside face of each wall, so the shell
    // reads as a rounded rail rather than a flat band.
    ctx.strokeStyle = 'rgba(255, 170, 210, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-hw - off + 4, RIM_Y + 10);
    ctx.lineTo(-hw - off + 4, FLOOR_EDGE_Y - 20);
    ctx.moveTo(hw + off - 4, RIM_Y + 10);
    ctx.lineTo(hw + off - 4, FLOOR_EDGE_Y - 20);
    ctx.stroke();
  }

  // ── The line ─────────────────────────────────────────────────────────────

  function drawLine(danger, time) {
    const hw = BOARD.halfWidth;
    const pulse = danger > 0 ? 0.55 + 0.45 * Math.sin(time * 14) : 0;
    const alpha = 0.3 + danger * 0.7 * pulse;

    ctx.save();
    ctx.setLineDash([16, 13]);
    ctx.lineDashOffset = -time * 26;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = danger > 0
      ? `rgba(255, 82, 122, ${alpha})`
      : 'rgba(255, 243, 226, 0.3)';
    ctx.beginPath();
    ctx.moveTo(-hw + 3, BOARD.lineY);
    ctx.lineTo(hw - 3, BOARD.lineY);
    ctx.stroke();
    ctx.restore();

    if (danger > 0) {
      const glow = ctx.createLinearGradient(0, BOARD.lineY, 0, BOARD.lineY - 130);
      glow.addColorStop(0, `rgba(255, 60, 110, ${0.3 * danger * pulse})`);
      glow.addColorStop(1, 'rgba(255, 60, 110, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-hw, BOARD.lineY - 130, hw * 2, 130);
    }
  }

  // A faint drop line, so you can see where the ball is going to land before
  // you commit to it.
  function drawGuide(game) {
    ctx.save();
    ctx.setLineDash([7, 11]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 243, 226, 0.18)';
    ctx.beginPath();
    ctx.moveTo(game.ready.x, BOARD.spawnY + TIERS[game.ready.tier].radius + 8);
    ctx.lineTo(game.ready.x, floorYAt(game.ready.x));
    ctx.stroke();
    ctx.restore();
  }

  // Once settled, the ball waiting to be dropped just bobs. While it is being
  // delivered it walks a curve from the funnel's hopper, bending around the
  // chute's mouth, to wherever you are currently aiming. The destination is
  // read fresh every frame, so dragging mid delivery steers the ball in.
  function drawReady(game, time) {
    if (game.delivery <= 0) {
      const bob = Math.sin(time * 3.4) * 2.5;
      drawBall(game.ready.x, BOARD.spawnY + bob, game.ready.tier, time * 0.6, 1, 1);
      return;
    }

    const p = easeInOut(1 - game.delivery);
    const q = 1 - p;
    // A quadratic Bezier with the chute's mouth as its control point: the ball
    // leaves along the chute and swings out of it, rather than cutting the
    // corner through the rail.
    const x = q * q * FUNNEL.entryX + 2 * q * p * FUNNEL.exitX + p * p * game.ready.x;
    const y = q * q * FUNNEL.entryY + 2 * q * p * FUNNEL.exitY + p * p * BOARD.spawnY;

    // Turning through five radians on the way down sells it as rolling rather
    // than sliding.
    drawBall(x, y, game.ready.tier, time * 0.6 + p * 5, 1, 1);
  }

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ── Balls ────────────────────────────────────────────────────────────────

  function popScale(body) {
    if (!body.popTime) return 1;
    const progress = 1 - body.popTime / POP_TIME;
    return 1 + 0.22 * Math.sin(progress * Math.PI);
  }

  function drawBall(x, y, tier, angle, scale, alpha) {
    const spec = TIERS[tier];
    const r = spec.radius;
    const ring = Math.max(2.6, r * 0.12);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    ctx.save();
    ctx.rotate(angle);
    ctx.drawImage(textures[tier], -r, -r, r * 2, r * 2);
    ctx.restore();

    // Sphere shading and its highlight are one gradient, and it does not turn
    // with the photo: the light in the room stays where it is.
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = shades[tier];
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, r - ring / 2, 0, TAU);
    ctx.lineWidth = ring;
    ctx.strokeStyle = tier === TOP_TIER ? discoRing(angle) : spec.color;
    ctx.stroke();

    ctx.restore();
  }

  // The last ball has earned a ring that cannot pick a colour, spinning with
  // the ball itself.
  function discoRing(angle) {
    if (!ctx.createConicGradient) return TIERS[TOP_TIER].color;
    const g = ctx.createConicGradient(angle, 0, 0);
    for (const tier of TIERS) g.addColorStop(tier.index / TIERS.length, tier.color);
    g.addColorStop(1, TIERS[0].color);
    return g;
  }

  return { resize, draw, toBoardX, view };
}

// Built once per tier and reused every frame. Because it is centred on the
// origin, the same object works for a ball anywhere on the board: the canvas
// transform carries it there, and scaling the context scales it too.
function makeShade(ctx, r) {
  const g = ctx.createRadialGradient(-r * 0.32, -r * 0.36, r * 0.05, 0, 0, r * 1.16);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
  g.addColorStop(0.34, 'rgba(255, 255, 255, 0.05)');
  g.addColorStop(0.62, 'rgba(20, 0, 40, 0.04)');
  g.addColorStop(1, 'rgba(16, 0, 36, 0.42)');
  return g;
}
