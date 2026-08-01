# Photo Balls

Pick ten photos, watch the corners come off them, and drop them into a box.

The one you drop is always the same photo, worth one point. When two of them
touch they roll into one copy of your second photo, worth two. Two of those
make the third, worth four, and it carries on doubling all the way to your
tenth photo at 512. The photos get bigger as they get rarer, so the box fills
up while you are trying to empty it, which is the whole problem.

The floor curves, so whatever lands at the bottom drifts toward the middle and
finds its own kind. There is a dotted line near the top of the box. Let the
pile sit above it for a moment too long and the round is over.

Two of the tenth photo cannot become anything bigger, so they burst instead:
1024 points, a lot of confetti, and a hole in the middle of your pile.

**[Play it here](https://julianbrodsky.github.io/photo-balls/)**

Tap or click anywhere over the box to drop. Drag before you let go if you want
to change your mind. Arrow keys move the ball and the space bar drops it.

Everything happens on your own machine, right in the browser. Your photos are
never uploaded anywhere, there is no account to make, and nothing is kept once
you close the tab except your best score.

## Running it yourself

It is a folder of static files with no build step and no dependencies. Any web
server will do:

```bash
python3 -m http.server 8000
```

## How it is put together

| File | What it owns |
| --- | --- |
| `js/config.js` | The ten tiers, the shape of the box, every physics constant |
| `js/photos.js` | Reading files, decoding them safely, cutting them into circles |
| `js/ladder.js` | The draggable running order on the setup screen |
| `js/ui.js` | The setup screen, from file picker to the start button |
| `js/physics.js` | Circles, two walls, one curved floor, and a contact solver |
| `js/board.js` | The rules: what merges, what it scores, when a round ends |
| `js/render.js` | Drawing the box, the line, and the balls |
| `js/effects.js` | Confetti and floating scores, which cannot touch the simulation |
| `js/input.js` | One pointer or the keyboard, turned into aim and drop |
| `js/audio.js` | Synthesised blips, no files to load |
| `js/storage.js` | The best score, and nothing else |
| `js/main.js` | Wiring, and the frame loop |

The physics is worth a note, because a merge game breaks the naive version of
it. Merging replaces two balls with one wider ball, which means everything
leaning on them is suddenly buried deep inside it. A solver that turns overlap
into velocity reads that as an explosion and fires the pile out through the
open top of the box. So velocity is solved against the contacts first, and the
leftover overlap is eased apart afterwards without being allowed to touch
velocity again. A ball being born just quietly pushes its neighbours aside.
