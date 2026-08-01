// The one thing that outlives the tab. Photos are deliberately not kept: they
// never leave the browser and they do not linger in it either, so every visit
// starts by picking ten again.
//
// Both calls are wrapped, because localStorage throws rather than returning
// null in a Safari private window and in a page with storage blocked. A best
// score is not worth a broken game.
import { STORAGE_KEY } from './config.js';

export function loadBest() {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

export function saveBest(score) {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.floor(score)));
  } catch {
    // Nothing to do and nothing worth saying: the round still counts.
  }
}
