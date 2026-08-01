// Aiming and dropping, from one pointer or from the keyboard.
//
// Press, slide, release. Committing on release rather than on press is what
// makes the same code work for a mouse and a thumb: you can drag along the top
// of the box, see the guide line move, and change your mind before letting go.
export function attachInput(canvas, { onAim, onNudge, onDrop }) {
  let active = null;

  canvas.addEventListener('pointerdown', event => {
    if (active !== null) return;
    active = event.pointerId;
    // Capture keeps a drag that wanders off the canvas reporting back. It
    // throws if the pointer has already been released, which is worth
    // shrugging off rather than losing the drop over.
    try { canvas.setPointerCapture(event.pointerId); } catch { /* fine */ }
    onAim(event.clientX);
    event.preventDefault();
  });

  canvas.addEventListener('pointermove', event => {
    // A mouse with no button down still aims, because a cursor hovering over
    // the board and nothing happening feels broken. A finger cannot hover, so
    // touch only aims once it is down.
    if (active === event.pointerId || (active === null && event.pointerType === 'mouse')) {
      onAim(event.clientX);
    }
  });

  canvas.addEventListener('pointerup', event => {
    if (active !== event.pointerId) return;
    active = null;
    onAim(event.clientX);
    onDrop();
  });

  // A cancelled pointer is the system taking over, usually a notification or a
  // system edge gesture. Nothing should fall out of the sky because of that.
  for (const type of ['pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => {
      if (active === event.pointerId) active = null;
    });
  }

  const NUDGE = 18;   // board units per key press
  window.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case 'ArrowLeft':  onNudge(-NUDGE); break;
      case 'ArrowRight': onNudge(NUDGE); break;
      case ' ':
      case 'Enter':
        // Only when nothing focusable is waiting for the same key, so Space
        // still works the way it should on a button.
        if (document.activeElement !== document.body) return;
        onDrop();
        break;
      default: return;
    }
    event.preventDefault();
  });
}
