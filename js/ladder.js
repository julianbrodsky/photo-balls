// The ten photos laid out in the order they will be worth, and a way to change
// that order. Position one is the Pebble you drop over and over, so it matters
// which photo lands there, and position ten is the one almost nobody sees.
//
// Reordering is built on pointer events rather than HTML drag and drop, which
// is the only way to get one implementation that a finger and a mouse both
// use. Arrow keys do the same job for anyone not dragging anything.
import { TIERS } from './config.js';

export function createLadder(list, photos) {
  let order = photos.slice();
  let drag = null;

  function getOrder() {
    return order.slice();
  }

  function shuffle() {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    render();
  }

  function render(focusIndex = -1) {
    list.replaceChildren(...order.map(buildTile));
    if (focusIndex >= 0) list.children[focusIndex].focus();
  }

  function buildTile(photo, index) {
    const spec = TIERS[index];
    const li = document.createElement('li');
    li.className = 'tile';
    li.tabIndex = 0;
    li.style.setProperty('--tier', spec.color);
    li.setAttribute('aria-label',
      `Slot ${index + 1} of ${TIERS.length}: ${spec.name}, worth ${spec.value}. `
      + 'Drag it, or press the left and right arrow keys, to move it.');

    const frame = document.createElement('div');
    frame.className = 'tile-photo';
    frame.append(photo.thumb);

    const value = document.createElement('span');
    value.className = 'tile-value';
    value.textContent = String(spec.value);

    const name = document.createElement('span');
    name.className = 'tile-name';
    name.textContent = spec.name;

    li.append(frame, value, name);
    return li;
  }

  // ── Dragging ─────────────────────────────────────────────────────────────

  // Capture is taken on the list, not the tile, because every reorder rebuilds
  // the tiles and a captured element that has been replaced stops reporting.
  list.addEventListener('pointerdown', event => {
    const tile = event.target.closest('.tile');
    if (!tile || drag) return;
    const index = [...list.children].indexOf(tile);
    if (index < 0) return;

    drag = { pointerId: event.pointerId, index, node: tile, x: event.clientX, y: event.clientY };
    // Capture keeps a drag reporting once the finger leaves the grid. It
    // throws if the pointer is already gone, which is not worth abandoning the
    // drag over.
    try { list.setPointerCapture(event.pointerId); } catch { /* fine */ }
    tile.classList.add('dragging');
    tile.focus();
    event.preventDefault();
  });

  list.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;

    const target = slotUnder(event.clientX, event.clientY);
    if (target !== -1 && target !== drag.index) {
      const [moved] = order.splice(drag.index, 1);
      order.splice(target, 0, moved);
      drag.index = target;
      render(target);
      // The tile is redrawn already sitting in its new slot, so the offset it
      // is carrying starts again from wherever the pointer is right now.
      drag.node = list.children[target];
      drag.node.classList.add('dragging');
      drag.x = event.clientX;
      drag.y = event.clientY;
    }

    drag.node.style.transform =
      `translate(${event.clientX - drag.x}px, ${event.clientY - drag.y}px)`;
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    list.addEventListener(type, event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.node.classList.remove('dragging');
      drag.node.style.transform = '';
      drag = null;
    });
  }

  function slotUnder(x, y) {
    return [...list.children].findIndex(tile => {
      const r = tile.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────

  list.addEventListener('keydown', event => {
    const tile = event.target.closest('.tile');
    if (!tile) return;
    const from = [...list.children].indexOf(tile);
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (!step) return;

    const to = from + step;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    render(to);
    event.preventDefault();
  });

  render();
  return { getOrder, shuffle };
}
