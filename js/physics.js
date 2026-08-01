// A small rigid body world that only ever has to know about circles, two
// walls, and one curved floor. That narrowness is why it can be this short:
// there is no polygon clipping, every contact normal is one subtraction, and
// nothing rotates in a way the collision response has to care about.
//
// The solver runs sequential impulses. Each substep gathers the contacts,
// solves velocity against them a few times, moves everything, and only then
// pushes any leftover overlap apart, without letting that push become
// velocity. Those last five words are the whole design. This game creates deep
// overlap on purpose every time two balls merge into a wider one, and a solver
// that reads overlap as speed treats every merge in a crowded box as an
// explosion.
import { BOARD, PHYSICS, floorYAt, floorSlopeAt } from './config.js';

export function createWorld() {
  const bodies = [];
  // Body-to-body touches from the most recent step. The rules layer reads this
  // to decide what merges, because the solver has already worked out which
  // balls are in contact and there is no reason to look for them twice.
  const contacts = [];
  // Working list for the current substep, reused rather than rebuilt so a busy
  // box does not hand the collector a few thousand contact objects a second.
  const live = [];
  let liveCount = 0;
  let nextId = 1;

  function add({ x, y, radius, tier, vx = 0, vy = 0 }) {
    const body = {
      id: nextId++,
      x, y, vx, vy,
      radius,
      tier,
      mass: radius * radius,        // area, near enough for balls of one material
      invMass: 1 / (radius * radius),
      angle: Math.random() * Math.PI * 2,
      spin: 0,
      touching: false,   // did anything reach it in the last substep
      age: 0,            // seconds since it entered the box
      speed: 0,
      popTime: 0,        // set by the rules layer, read by the renderer
    };
    bodies.push(body);
    return body;
  }

  function remove(body) {
    const i = bodies.indexOf(body);
    if (i !== -1) bodies.splice(i, 1);
  }

  function step(dt) {
    const h = dt / PHYSICS.substeps;
    const damping = Math.pow(PHYSICS.linearDamping, h);
    contacts.length = 0;

    for (let s = 0; s < PHYSICS.substeps; s++) {
      applyGravity(h, damping);
      gather(s === PHYSICS.substeps - 1);
      for (let i = 0; i < PHYSICS.velocityIterations; i++) solveVelocity();
      integrate(h);
      for (let i = 0; i < PHYSICS.positionIterations; i++) separate();
      roll(h);
    }

    for (const body of bodies) {
      body.age += dt;
      body.speed = Math.hypot(body.vx, body.vy);
    }
  }

  // ── Substep stages ───────────────────────────────────────────────────────

  function applyGravity(h, damping) {
    for (const body of bodies) {
      body.vy += PHYSICS.gravity * h;
      body.vx *= damping;
      body.vy *= damping;
      body.touching = false;
    }
  }

  // Contacts are stored with the normal pointing from a toward whatever it is
  // resting against, so one impulse formula covers a neighbouring ball and an
  // immovable wall alike: the wall is simply a partner of infinite mass that is
  // not going anywhere.
  //
  // Every pair is tested against every other pair. Ten tiers of merging keeps
  // the population under about sixty balls even in a losing round, which is
  // 1800 distance checks a substep: far cheaper than the bookkeeping a spatial
  // grid would need to save them.
  function gather(record) {
    liveCount = 0;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = a.radius + b.radius;
        const sq = dx * dx + dy * dy;
        if (sq >= reach * reach || sq === 0) continue;

        const dist = Math.sqrt(sq);
        open(a, b, dx / dist, dy / dist, reach - dist);
        a.touching = b.touching = true;
        if (record) contacts.push({ a, b });
      }
      gatherBoundary(a);
    }
  }

  function gatherBoundary(body) {
    const limit = BOARD.halfWidth - body.radius;
    if (body.x < -limit) {
      open(body, null, -1, 0, -limit - body.x);
      body.touching = true;
    } else if (body.x > limit) {
      open(body, null, 1, 0, body.x - limit);
      body.touching = true;
    }

    // The floor is a parabola, so its normal tilts with x. The distance to the
    // curve is approximated by the vertical gap divided by the slope's length,
    // which is exact along the flat centre and errs by well under a percent
    // across the shallow curve this floor actually uses.
    const slope = floorSlopeAt(body.x);
    const nlen = Math.hypot(slope, 1);
    const depth = body.radius - (floorYAt(body.x) - body.y) / nlen;
    if (depth > 0) {
      open(body, null, -slope / nlen, 1 / nlen, depth);
      body.touching = true;
    }
  }

  function open(a, b, nx, ny, depth) {
    const c = live[liveCount] ??= {};
    c.a = a;
    c.b = b;
    c.nx = nx;
    c.ny = ny;
    c.depth = depth;
    c.invSum = a.invMass + (b ? b.invMass : 0);
    // An impact worth bouncing keeps some of its approach speed. A pile
    // settling under its own weight does not, or the whole box simmers.
    const approach = normalSpeed(c);
    c.bounce = approach < -PHYSICS.bounceThreshold ? -approach * PHYSICS.restitution : 0;
    liveCount++;
  }

  // Closing speed along the normal. Negative means the two are coming together.
  function normalSpeed(c) {
    const vx = (c.b ? c.b.vx : 0) - c.a.vx;
    const vy = (c.b ? c.b.vy : 0) - c.a.vy;
    return vx * c.nx + vy * c.ny;
  }

  function solveVelocity() {
    for (let i = 0; i < liveCount; i++) {
      const c = live[i];
      const vn = normalSpeed(c);
      if (vn < 0) applyImpulse(c, c.nx, c.ny, -(vn + c.bounce) / c.invSum);

      // Friction resists sliding across the contact. Capping it against the
      // body's own weight for the substep keeps it from acting like glue,
      // while still being enough grip for a pile to hold a shape instead of
      // pouring itself flat.
      const tx = -c.ny;
      const ty = c.nx;
      const vt = ((c.b ? c.b.vx : 0) - c.a.vx) * tx + ((c.b ? c.b.vy : 0) - c.a.vy) * ty;
      const grip = PHYSICS.friction * Math.abs(vn);
      const jt = Math.max(-grip, Math.min(grip, -vt)) / c.invSum;
      applyImpulse(c, tx, ty, jt);
    }
  }

  function applyImpulse(c, nx, ny, j) {
    c.a.vx -= nx * j * c.a.invMass;
    c.a.vy -= ny * j * c.a.invMass;
    if (c.b) {
      c.b.vx += nx * j * c.b.invMass;
      c.b.vy += ny * j * c.b.invMass;
    }
  }

  function integrate(h) {
    for (const body of bodies) {
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > PHYSICS.maxSpeed) {
        const k = PHYSICS.maxSpeed / speed;
        body.vx *= k;
        body.vy *= k;
      }
      body.x += body.vx * h;
      body.y += body.vy * h;
    }
  }

  // Overlap left over after the move is eased apart here, and here only.
  // Nothing in this function writes to a velocity, which is exactly why a
  // merge can bury three balls inside a new Bowling Ball without any of them
  // being flung anywhere: they simply arrive back outside it over the next
  // handful of substeps.
  function separate() {
    for (let i = 0; i < liveCount; i++) {
      const c = live[i];
      refresh(c);
      const push = (c.depth - PHYSICS.slop) * PHYSICS.positionCorrection;
      if (push <= 0) continue;
      const scaled = push / c.invSum;
      c.a.x -= c.nx * scaled * c.a.invMass;
      c.a.y -= c.ny * scaled * c.a.invMass;
      if (c.b) {
        c.b.x += c.nx * scaled * c.b.invMass;
        c.b.y += c.ny * scaled * c.b.invMass;
      }
    }
  }

  // Depths were measured before the bodies moved, so each pass re-reads them.
  // Correcting against stale numbers is how a pile ends up gently vibrating.
  function refresh(c) {
    if (c.b) {
      const dx = c.b.x - c.a.x;
      const dy = c.b.y - c.a.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) return;
      c.nx = dx / dist;
      c.ny = dy / dist;
      c.depth = c.a.radius + c.b.radius - dist;
      return;
    }
    if (c.ny === 0) {
      // A wall: the normal never changes, only how far past it the body is.
      const limit = BOARD.halfWidth - c.a.radius;
      c.depth = c.nx < 0 ? -limit - c.a.x : c.a.x - limit;
      return;
    }
    const slope = floorSlopeAt(c.a.x);
    const nlen = Math.hypot(slope, 1);
    c.nx = -slope / nlen;
    c.ny = 1 / nlen;
    c.depth = c.a.radius - (floorYAt(c.a.x) - c.a.y) / nlen;
  }

  // Spin is cosmetic. Nothing in the simulation reads it back, so rather than
  // carry angular momentum through the solver, a ball that is touching
  // something is eased toward the spin rolling without slipping would give it,
  // and a ball in mid air keeps whatever it had.
  function roll(h) {
    for (const body of bodies) {
      if (body.touching) {
        const target = body.vx / body.radius;
        body.spin += (target - body.spin) * Math.min(1, PHYSICS.spinResponse * h);
      }
      body.angle += body.spin * h;
    }
  }

  return { bodies, contacts, add, remove, step };
}
