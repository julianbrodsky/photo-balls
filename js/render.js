// Everything the player sees inside the canvas: the box, the line, the balls,
// and the ball waiting to go in. Drawing happens in board units, so this file
// and the physics agree on what a coordinate means and neither has to think
// about pixels.
import { BOARD, TIERS, TOP_TIER, floorYAt } from './config.js';
import { POP_TIME } from './board.js';

const TAU = Math.PI * 2;

// The drawn stage is the interior plus the shell around it, with a little air
// above the open top so the ready ball is never clipped by the canvas edge.
const SHELL = BOARD.wallThickness;
export const STAGE = {
  left: -(BOARD.halfWidth + SHELL),
  right: BOARD.halfWidth + SHELL,
  top: -18,
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
    drawLine(game.danger, time);
    if (game.state === 'playing') drawGuide(game);
    for (const body of game.world.bodies) {
      drawBall(body.x, body.y, body.tier, body.angle, popScale(body), 1);
    }
    if (game.state === 'playing') drawReady(game, time);
    effects.draw(ctx);
  }

  // ── The box ──────────────────────────────────────────────────────────────

  function drawBox() {
    const hw = BOARD.halfWidth;

    // The wash starts level with the top of the walls, not above them, so the
    // box has a lip rather than fading out into the backdrop.
    ctx.beginPath();
    ctx.moveTo(-hw, STAGE.top);
    ctx.lineTo(-hw, FLOOR_EDGE_Y);
    ctx.quadraticCurveTo(0, FLOOR_CONTROL_Y, hw, FLOOR_EDGE_Y);
    ctx.lineTo(hw, STAGE.top);
    ctx.closePath();

    const wash = ctx.createLinearGradient(0, STAGE.top, 0, BOARD.floorY);
    wash.addColorStop(0, 'rgba(30, 8, 60, 0.16)');
    wash.addColorStop(1, 'rgba(18, 4, 44, 0.52)');
    ctx.fillStyle = wash;
    ctx.fill();

    // The shell is stroked half a thickness outside the interior, so the cream
    // band you see stops exactly where the solver stops the balls.
    const off = SHELL / 2;
    ctx.beginPath();
    ctx.moveTo(-hw - off, STAGE.top);
    ctx.lineTo(-hw - off, FLOOR_EDGE_Y + off);
    ctx.quadraticCurveTo(0, FLOOR_CONTROL_Y + off, hw + off, FLOOR_EDGE_Y + off);
    ctx.lineTo(hw + off, STAGE.top);

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
    ctx.moveTo(-hw - off + 4, STAGE.top + 10);
    ctx.lineTo(-hw - off + 4, FLOOR_EDGE_Y - 20);
    ctx.moveTo(hw + off - 4, STAGE.top + 10);
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

  function drawReady(game, time) {
    const bob = Math.sin(time * 3.4) * 2.5;
    // The ball fades while the drop is on cooldown, which is the only cue that
    // the next tap is not going to do anything yet.
    const alpha = game.canDrop ? 1 : 0.45;
    drawBall(game.ready.x, BOARD.spawnY + bob, game.ready.tier, time * 0.6, 1, alpha);
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
