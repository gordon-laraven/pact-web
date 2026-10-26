# Detection test set

Drop in videos with the list of movements you know they contain. `npm run eval` reports, for each one, which movements were **missed**, which came out as **fragments** (one movement split into pieces), which detections were **extra** (nothing there), and any **false holds**. Each run is compared with the last, so you can see before → after a change.

Everything in this folder except this README and `example/` is git-ignored, so your videos and tracking data stay on your machine.

## Add a case

1. Make a folder: `testset/<any-name>/`.
2. Write `truth.json` with the movements and where they really are, in seconds (see `example/truth.json`). Add `"kind": "hold"` for holds such as a plank, so false holds can be told apart.
3. Get the tracking. Run `npm run dev`, upload the video, and press **Find the moves**. Then open **Report a problem** (the "Something look off in these results?" link) and press **Download debug file (dev)**. Save that file into the folder; any name ending in `.json` works.
   - For a slow-analysis comparison, run it again with **Slow analysis** on and save a second file, e.g. `debug-slow.json`.
4. You can also keep the video in the folder for reference (it's ignored by git, and the script doesn't read it).

## Run

```bash
npm run eval
```

The report prints and is saved to `testset/report.txt`. Each case keeps its own `last-run.json` for the next before/after comparison.

Tracking happens in the browser (MediaPipe), so the script scores saved tracking files rather than raw videos. The splitting logic it runs is exactly the app's.
