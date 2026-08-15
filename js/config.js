// Single source of truth for the ladder of balls, the shape of the box, and
// every physics constant. The tier list drives upload validation, the ladder
// preview, and all the copy that mentions a count, so adding an eleventh tier
// here is the only edit it would take.

// Radii in board units, growing about 20% a step. The whole ladder is sized
// off its top rung. Four Disco Balls are the entire playing field: two on the
// floor and two nestled on top of them come to rest just under the line, and a
// fifth ends the round. That ratio is what sets the pace. An earlier build had
// the top ball at about a third of the box's width, which left room for ten of
// them and made reaching a losing position take a hundred drops.
//
// Half the box width is too big, incidentally: two of those cannot sit side by
// side with the floor curving them together, so the pile becomes a column.
const RADII = [34, 38, 43, 49, 55, 62, 70, 79, 89, 100];

// Bright, slightly ridiculous, and ordered so neighbouring tiers never share a
// hue. Each colour is the ring drawn around its photo, so it has to read at
// 30 board units across as clearly as at 156.
const COLORS = [
  '#ff7ab8', // bubblegum
  '#ff9f43', // tangerine
  '#ffd93d', // lemon
  '#9be15d', // sour apple
  '#2fd6a5', // mint
  '#31c6f0', // pool
  '#6a8bff', // periwinkle
  '#a978ff', // grape
  '#f45fd0', // magenta
  '#ffc94d', // gold, and the only one that gets a rainbow ring
];

const NAMES = [
  'Pebble', 'Marble', 'Gumball', 'Bouncy Ball', 'Tennis Ball',
  'Grapefruit', 'Bowling Ball', 'Beach Ball', 'Planetoid', 'Disco Ball',
];

export const TIERS = RADII.map((radius, i) => ({
  index: i,
  radius,
  value: 2 ** i,          // 1, 2, 4 ... 512
  color: COLORS[i],
  name: NAMES[i],
}));

export const TOP_TIER = TIERS.length - 1;

// Two Disco Balls cannot become anything bigger, so they pop instead: both
// vanish, you collect double the top value, and the box gets its space back.
export const POP_VALUE = TIERS[TOP_TIER].value * 2;

// ── The box ────────────────────────────────────────────────────────────────
// Board units, y pointing down, x measured from the centre line. The interior
// runs from y = 0 at the open top to the floor curve at the bottom.
// The box is taller than it is wide for two reasons. One is the shape of a
// phone: a squarer box would leave dead screen above and below it. The other
// is that the part of the box that counts, from the line down to the floor, is
// only 440 units deep, which is four Disco Balls. Everything above the line is
// airspace to aim and drop through.
export const BOARD = {
  halfWidth: 220,
  floorY: 690,      // the floor's lowest point, on the centre line
  sag: 56,          // how much higher the floor sits where it meets a wall
  lineY: 235,       // rest above this line too long and the round is over
  spawnY: 110,      // where the ready ball hovers before it drops
  wallThickness: 14,
  rimThickness: 18,
};

// The floor is a shallow parabola rather than a flat plane, so whatever lands
// in the bottom row drifts toward the middle and touches its neighbours
// instead of parking against a wall forever.
export function floorYAt(x) {
  const n = x / BOARD.halfWidth;
  return BOARD.floorY - BOARD.sag * n * n;
}

// Slope of that curve, used to build the contact normal.
export function floorSlopeAt(x) {
  return (-2 * BOARD.sag * x) / (BOARD.halfWidth * BOARD.halfWidth);
}

// ── Physics ────────────────────────────────────────────────────────────────
// Sequential impulses: velocity is solved against the contacts, and leftover
// overlap is pushed apart afterwards without touching velocity. Keeping those
// two jobs separate is what makes this game survivable, because a merge is a
// deliberate act of deep overlap: two balls become one wider ball, and
// everything leaning on them is suddenly buried. A solver that turns overlap
// into velocity reads that as an explosion and fires the pile out of the box.
export const PHYSICS = {
  gravity: 2400,            // board units per second squared
  substeps: 5,              // per rendered frame at 60 Hz
  velocityIterations: 5,    // impulse passes per substep
  positionIterations: 3,    // overlap passes per substep, velocity untouched
  positionCorrection: 0.5,  // fraction of the leftover overlap taken per pass
  slop: 0.5,                // overlap left alone, so resting contacts stop twitching
  restitution: 0.12,        // rubbery, not bouncy
  bounceThreshold: 260,     // below this an impact just stops, it does not bounce
  friction: 0.26,           // enough grip for a pile to hold its shape
  linearDamping: 0.92,      // velocity kept per second, bleeds off jitter
  // A ball falling the length of the box tops out near 1850, so this never
  // touches an honest drop. It is here as a guard against a body ever moving
  // far enough in one substep to pass through a wall.
  maxSpeed: 2400,
  spinResponse: 9,          // how fast a rolling ball's spin catches up to its motion
};

// ── Round rules ────────────────────────────────────────────────────────────
export const RULES = {
  // How far up the ladder the ball waiting to be dropped can be. Handing out
  // one of the three smallest at random rather than always the Pebble means a
  // pile you were about to clear can be answered with the wrong size, and it
  // gives you something to plan around instead of a single repeated move.
  dropTiers: 3,
  dropCooldown: 0.3,      // seconds between drops, so a held tap cannot spray
  aimEase: 24,            // how quickly the ready ball slides to your finger
  spawnJitter: 1.5,       // board units of random x, to break perfect towers
  // A ball still falling past the line is not a loss. It has to be up there and
  // out of ideas for this long before the round ends.
  dangerGrace: 0.55,
  dangerLimit: 1.7,
};

// ── Photos ─────────────────────────────────────────────────────────────────
export const UPLOAD = {
  requiredCount: TIERS.length,
  maxFileBytes: 20 * 1024 * 1024,
  // Raw files are simply larger. A ProRAW frame off a phone runs to 25 MB and
  // a full frame camera can pass 60, so holding them to the same cap as a JPEG
  // would reject nearly every one of them.
  maxRawBytes: 100 * 1024 * 1024,
  acceptedTypes: [
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'image/x-adobe-dng', 'image/dng', 'image/tiff',
  ],
  // Browsers cannot agree on what a .dng is. Chrome usually reports an empty
  // type, macOS says image/x-adobe-dng, and some report image/tiff. The
  // extension is the only thing every one of them gets right, so it is allowed
  // to vouch for a file on its own.
  acceptedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'dng'],
  rawExtensions: ['dng'],
};

export function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isRaw(file) {
  return UPLOAD.rawExtensions.includes(extensionOf(file.name))
    || file.type === 'image/x-adobe-dng'
    || file.type === 'image/dng';
}

// Each photo is masked into a circle exactly once, at this multiple of its
// tier's radius. 2.4 covers a retina phone at the scale the box is drawn and
// still keeps the biggest texture under 400 pixels square.
export const TEXTURE_SCALE = 2.4;

// ── The funnel ─────────────────────────────────────────────────────────────
// A chute mounted above the box's top right corner. The ball you will be
// handed after this one sits in its mouth, so the next size is always visible,
// and when the current ball leaves your hand that one rolls down the chute and
// into the drop position. The delivery takes exactly one drop cooldown, which
// turns the wait between drops from a dead pause into something you watch.
//
// It sits above the rim rather than inside the box, because the widest ball
// you can be dealt is 86 units across and the airspace over the line has
// nowhere near that much room to spare.
// The widest ball you can be dealt is 43 units, so the throat has to clear
// that at both ends and the rails have to run a good way behind the waiting
// ball, or it looks like it is falling out of the back of the pipe. The mouth
// stays above the rim and inboard of the right wall, so the ball rolls out
// over the open box rather than through the side of it.
export const FUNNEL = {
  entryX: 148, entryY: -111,  // where the next ball waits, and is drawn
  exitX: 58, exitY: -78,      // where the chute lets go of it
  entryHalf: 60,              // half the throat's width at the wide end
  exitHalf: 54,               // ...and at the narrow end, so it reads as a funnel
  overhang: 60,               // how far the rails run on past the waiting ball
  railThickness: 11,
};

export const STORAGE_KEY = 'photo-balls:best';

// Nothing is fetched from anywhere, so the type has to come from the device.
// ui-rounded is SF Pro Rounded on Apple hardware, which is exactly the soft
// chunky look this wants, and every fallback after it is a stock face.
export const FONT = 'ui-rounded, "Trebuchet MS", "Segoe UI", system-ui, sans-serif';
