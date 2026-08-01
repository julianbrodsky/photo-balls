// Confetti and floating score labels. Purely decorative, kept apart from the
// simulation on purpose: nothing in here can ever move a ball, so it can be as
// loose with its maths as it likes.
import { TIERS, FONT } from './config.js';

const SPARK_GRAVITY = 1400;
const SPARK_DRAG = 0.86;      // velocity kept per second
const LABEL_RISE = 90;        // board units a score label floats upward
const LABEL_LIFE = 1.1;

export function createEffects() {
  const sparks = [];
  const labels = [];

  // A ring of shards thrown outward from a merge. Speed scales with the ball
  // that was born, so a Gumball gives a polite puff and a Disco Ball throws
  // paper across half the box.
  function burst(x, y, tier, { big = false } = {}) {
    const count = big ? 64 : 14 + tier * 3;
    const power = (big ? 620 : 190 + tier * 34);
    const palette = big ? TIERS.map(t => t.color) : [TIERS[tier].color, '#ffffff'];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = power * (0.45 + Math.random() * 0.75);
      sparks.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        size: (big ? 5 : 3) + Math.random() * 4,
        spin: (Math.random() * 2 - 1) * 14,
        angle: Math.random() * Math.PI,
        color: palette[(Math.random() * palette.length) | 0],
        life: big ? 1.4 : 0.7 + Math.random() * 0.4,
        age: 0,
      });
    }
  }

  function label(x, y, text, color) {
    labels.push({ x, y, text, color, age: 0 });
  }

  function update(dt) {
    const drag = Math.pow(SPARK_DRAG, dt);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.age += dt;
      if (s.age >= s.life) { sparks.splice(i, 1); continue; }
      s.vy += SPARK_GRAVITY * dt;
      s.vx *= drag;
      s.vy *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.angle += s.spin * dt;
    }
    for (let i = labels.length - 1; i >= 0; i--) {
      labels[i].age += dt;
      if (labels[i].age >= LABEL_LIFE) labels.splice(i, 1);
    }
  }

  // Drawn in board units, inside whatever transform the renderer has set up.
  function draw(ctx) {
    for (const s of sparks) {
      const fade = 1 - s.age / s.life;
      ctx.save();
      ctx.globalAlpha = Math.min(1, fade * 1.6);
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.fillStyle = s.color;
      ctx.fillRect(-s.size / 2, -s.size / 4, s.size, s.size / 2);
      ctx.restore();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of labels) {
      const t = l.age / LABEL_LIFE;
      // Quick out, slow finish: the number is readable almost immediately and
      // then drifts, rather than crawling up through the moment you need it.
      const ease = 1 - Math.pow(1 - t, 2.4);
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - t) * 2.2);
      ctx.translate(l.x, l.y - LABEL_RISE * ease);
      ctx.font = `800 34px ${FONT}`;
      ctx.lineWidth = 7;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(29, 8, 46, 0.85)';
      ctx.strokeText(l.text, 0, 0);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, 0, 0);
      ctx.restore();
    }
  }

  function clear() {
    sparks.length = 0;
    labels.length = 0;
  }

  return { burst, label, update, draw, clear };
}
