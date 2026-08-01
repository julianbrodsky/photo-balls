// The setup screen: choose ten photos, check them, put them in order, roll.
// Every piece of text that came from a file goes through textContent, so a
// photo named after a script tag is just a photo with a strange name.
import { UPLOAD, TIERS } from './config.js';
import { validateSelection, decodePhotos, cropToCircle } from './photos.js';
import { createLadder } from './ladder.js';

const THUMB_RADIUS = 44;   // board units, only used to size the preview circles

export function initSetup({ onStart }) {
  const screen   = document.getElementById('setup');
  const input    = document.getElementById('file-input');
  const dropzone = document.getElementById('dropzone');
  const status   = document.getElementById('status');
  const panel    = document.getElementById('ladder-panel');
  const list     = document.getElementById('ladder');
  const startBtn = document.getElementById('start-btn');
  const shuffle  = document.getElementById('shuffle-btn');
  const redoBtn  = document.getElementById('redo-btn');

  let ladder = null;
  let busy = false;

  document.getElementById('required-count').textContent = String(UPLOAD.requiredCount);

  function setStatus(lines, tone = 'problem') {
    status.dataset.tone = tone;
    status.replaceChildren(...lines.map(text => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }));
  }

  function clear() {
    ladder = null;
    list.replaceChildren();
    panel.hidden = true;
    setStatus([]);
    input.value = '';
  }

  async function handleFiles(fileList) {
    if (busy) return;
    const files = [...fileList];   // snapshot, because clear() empties the input
    clear();

    const problems = validateSelection(files);
    if (problems.length) {
      setStatus(problems);
      return;
    }

    busy = true;
    setStatus(['Getting your photos rolling…'], 'working');
    try {
      const photos = await decodePhotos(files, (done, total) =>
        setStatus([`Rounding off photo ${done} of ${total}…`], 'working'));
      for (const photo of photos) photo.thumb = cropToCircle(photo.canvas, THUMB_RADIUS);
      ladder = createLadder(list, photos);
      panel.hidden = false;
      setStatus([]);
      startBtn.focus();
    } catch (err) {
      setStatus([err.message]);
    } finally {
      busy = false;
    }
  }

  input.addEventListener('change', () => handleFiles(input.files));

  dropzone.addEventListener('dragover', event => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', event => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
    handleFiles(event.dataTransfer.files);
  });
  // A photo dropped anywhere else should not navigate the page away from you.
  window.addEventListener('dragover', event => event.preventDefault());
  window.addEventListener('drop', event => event.preventDefault());

  shuffle.addEventListener('click', () => ladder?.shuffle());
  redoBtn.addEventListener('click', clear);

  startBtn.addEventListener('click', () => {
    if (!ladder) return;
    const photos = ladder.getOrder();

    // One circle per tier, cut to the size that tier is drawn at, made once
    // and reused for every ball of that tier for the rest of the session.
    const textures = photos.map((photo, i) => cropToCircle(photo.canvas, TIERS[i].radius));

    // The full resolution decodes have done their job. Releasing them here
    // gives a phone back the better part of a hundred megabytes before the
    // game asks it for sixty frames a second.
    for (const photo of photos) {
      photo.canvas.width = photo.canvas.height = 0;
    }

    screen.hidden = true;
    onStart({ textures, thumbs: photos.map(photo => photo.thumb) });
  });
}
