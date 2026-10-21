# pact-web

**PACT** ("a promise to yourself") will eventually turn workout reels and shorts into long-form, follow-along workout videos.

This repo is a **frontend-only prototype** that tests one thing: **the hands-free feel**. You press Start once and follow a full workout, like putting in a P90X tape. A stick figure demonstrates each move. Reps, sets, rest timers and spoken cues advance on their own. You never touch the screen mid-workout.

It also has a first version of the core idea: **Make a workout from video.** Pick a clip on your device. PACT tracks the body, splits the video into its separate movements, cuts one clean rep of each, and turns them into stick-figure moves for a hands-free workout. See [Make a workout from video](#make-a-workout-from-video).

### What it is not (yet)

- No backend, accounts, database or AI. Workouts you build from videos live in memory and are gone when you refresh.
- No downloading from Facebook, Instagram or YouTube: you pick a video file you have the rights to. It never leaves your device.
- Movement names and form cues for a video are typed in by you; sets, reps and durations are detected. AI naming will come later.
- The sample workout is hand-written (`src/data/sampleWorkout.ts`), and so are its animations (`src/animation/library/`).

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # Vitest unit tests
pnpm build      # type-check + production build into dist/
pnpm preview    # serve the production build
```

(npm works too: `npm install`, `npm run dev`, and so on.)

### Fast testing: `?speed=`

In **dev builds only** (`pnpm dev`), append `?speed=N` to multiply the player clock, e.g. <http://localhost:5173/?speed=4> runs the 6:45 workout in about 1:41.
- Accepts values from 0.1 to 32.
- It speeds up everything together (figure, counters, countdowns and cues), because they all share one clock.
- Production builds ignore it.

## Using the player

- **Start** begins a 5-second get-ready countdown, then everything auto-advances.
- **Tap anywhere** or press **Space** to pause and resume.
- **← / →** go to the previous or next exercise:
  - ← restarts the current exercise, or goes to the previous one if pressed within 2 s of an exercise's start.
  - → past the last exercise finishes the workout.
- **Esc** or **✕** goes back to the overview.
- **Mute** silences all voice cues and beeps.
- **Fullscreen** uses the Fullscreen API. The button is hidden where that's unsupported, e.g. iPhone Safari.
- **Wake lock:** a Screen Wake Lock is held while playing and released on pause, finish and exit. It's re-acquired when the tab becomes visible again, and any failure is ignored.

**Spoken cues** use `speechSynthesis`; beeps use Web Audio:

| When | Cue |
| --- | --- |
| Get-ready starts | "Get ready" |
| Last 3 s of get-ready or rest | "3", "2", "1" + short beep each |
| Work begins | Long beep. On an exercise's first set, its name is also spoken. |
| Rest begins | "Rest" |
| Halfway through a time-based set of 30 s or more | "Halfway" |
| End | "Done. Workout complete." |

If the speech API is missing or fails, the workout runs silently, with no errors.

## Make a workout from video

On the overview, press **Make a workout from video**.

1. **Choose a clip.** Best results come from one person, whole body in frame, filmed side-on or facing the camera. A clip can contain several exercises. Use **Start / End** if you only want part of it.
2. **Analyze movement.** PACT steps through the clip at 15 frames per second with [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) and draws the tracked skeleton over the video.
   - It runs on your computer's graphics card, falling back to the processor.
   - The first run downloads the ~9 MB pose model from Google; after that it's cached.
3. **Check the moves.** There's one card per movement, in video order. Each card has:
   - **▶ 0:13–0:22**, which plays that part of your video.
   - A **confidence** rating (high/medium/low). Low ones get a **Check this one** tag and say why.
   - A preview loop of the extracted rep, and what was detected: sets, reps per set, seconds per rep, and the view.

   On each card you can:
   - Name the movement, adjust Reps/Timed, sets, reps and rest, and optionally add form cues.
   - Fix the **start / end** if they're off. **Update range** re-analyses just that range.
   - **Delete** anything that isn't an exercise.
   - **Add a movement that was missed**, from a range you enter.
   - Use **Add other side (reverse)**. It's highlighted on moves that work one side (lunges, single-leg or single-arm work, side planks) when the video doesn't already show both sides.
     - It adds a copy right after the original, named "(Left)" / "(Right)", or flipped if the name already says a side.
     - The copy's **Mirror** toggle (off by default) flips the stick figure, and the video when you watch it here, so it looks like the other side. On-screen text in the video appears backwards when mirrored.
     - **Remove this copy** deletes it in one click.

   Then press **Add to workout**.
4. Add more clips if you like. In the workout list, **▶** plays one movement on its own. **Start workout** plays them all in order in the hands-free player, with the badge reading "From your videos". Form cues show under the counter while you do that exercise.

**How a video is split into movements** (`src/extract/segment.ts`, pure and unit-tested). It runs in two passes, and nothing is sent anywhere.

*Pass 1, candidates:*
- **Describe each moment:** each frame's posture is measured relative to the hips, in spine lengths.
  - Turning around doesn't count as a change.
  - Whole-body bounce is included, which catches calf raises and jumps.
  - In clear side views, it also records which leg and arm are forward, so a left-leg and a right-leg lunge differ.
- **Breaks:** the video is cut wherever nobody is tracked for 0.7 s or more (a title card, a cut away), and at camera cuts (the body jumps in the frame and changes size).
- **Changes of exercise:** at every quarter second, PACT compares the 3 s before with the 3 s after: the average posture, and how much each body part moves. A big difference marks a new movement, and the exact moment is then pinned down with 1 s windows. Back-to-back movements with no break are split this way.
- **Labelling the pieces:**
  - **Transition:** shorter than 2 s, like getting down to the floor. It's absorbed into the movement before it if it looks like that move, otherwise dropped.
  - **Rest:** still while standing, kneeling, sitting or lying on the mat. These are never holds.
  - **Hold:** still in an exercise position for at least 5 s. It gets high confidence if held up on the arms (plank, side plank), low confidence otherwise.
  - Anything else is a **movement**.
- **Merging:** neighbouring pieces that look like the same movement are merged into one entry.
  - If a rest or a break separates them, they become **separate sets** of that entry.
  - The same movement coming back after a *different* movement stays a **separate entry**.
- **Extraction:** each set is extracted with the single-movement step below. The loop comes from the best-tracked set, and reps are counted per set.

*Pass 2, verification:*
- **Extend:** while the same motion continues right next to a movement, the movement grows into it, so fragments get their full range.
- **Trim:** still edges are removed, so a movement doesn't start while you're still lying on the mat. A range is then trimmed to its first and last rep, allowing one rep of slack for partial reps.
- **Gap check:** any uncovered stretch over 3 s that isn't a rest, and isn't empty (nobody in frame), gets a second look. Anything found there is marked low confidence.
- **No rhythm:** moving with no steady rhythm becomes an "unclear" movement (low confidence) if it lasts 4 s or more, and is dropped as a transition if shorter. It's never called a hold.
- **Merge:** neighbouring fragments of the same movement are merged.
- **Clamp:** timestamps are clamped to the video, and ranges never overlap.
- **Confidence:** each movement is rated high/medium/low, with plain reasons: irregular reps, few reps, the body lost in frames, found on a second look.
- **One-sided:** a movement is one-sided when left and right limbs sit in clearly different places. If the same move follows with the sides swapped, both are marked as "both sides shown", labelled Left/Right, and the button isn't suggested.
- **Nothing found:** if there's no clear movement at all, you get a friendly message instead of an error.

**Debug file.** After analysing, **Download debug file** saves everything behind the result:
- the video's name and length, and the analysed range;
- the sampling (15 frames per second) and every frame's timestamp;
- each piece with its label and why;
- every decision in plain words;
- the final movement list;
- the raw body tracking.

In dev builds (`npm run dev`), **Load a debug file instead** re-runs the splitting on a saved file without the video, which is how a problem video can be reproduced and fixed.

**How one movement is extracted** (`src/extract/extract.ts`, pure and unit-tested):
- **Map:** MediaPipe's 33 landmarks become our 14 joints. The head is the midpoint of the ears; the neck is the midpoint of the shoulders.
- **Clean up:** frames without a person are filled in from their neighbours, everything is resampled to 30 fps, single-frame spikes are removed and the jitter is smoothed.
- **View and facing:** if the shoulders overlap it's a side view, otherwise front. Side views are mirrored to face right, like the library.
- **Near and far limbs (side view):**
  - The more visible arm and leg become the near (bright) side, re-chosen every frame because trackers swap left and right mid-clip.
  - A mostly hidden far limb is drawn right behind the near one instead of where the tracker guessed it.
- **Find the reps:** the main direction of motion (PCA) gives one signal, and its autocorrelation gives the rep length. The clip is cut into reps that start where the clip starts (usually the start position).
- **Make one loop:** the consistent reps are combined (the median at each moment of the rep) into one rep, and the loop is closed.
- **Holds:** a clip with no real repetition (plank, wall sit) becomes a hold, with a subtle breathing loop.
- **Fit:** the result is scaled to the library's body proportions and placed in the 0..1 frame, feet on the floor line. The output is a plain `Animation`, registered at runtime.

**Known limits:**
- Side views of arms are the weak spot. The tracker has to guess the hidden arm and can mislocate the visible one when it crosses the face or body. Check the preview, and if an arm looks wrong, try trimming to a cleaner section or a clip with better lighting.
- Analysis speed depends on the device: a few seconds per 10 s of video with a decent graphics card, much slower without one.
- Splitting is based on how the body moves only. Speech, captions, title cards and the instructor naming the next move aren't read; that needs the later AI step. For the same reason, movement names are typed in by you.
- "Left/Right" for a generated other side comes from the name, not from the video. Which leg the person actually used can't be told reliably from body tracking alone, so check the label.
- One-sided detection compares where the left and right limbs sit. Single-arm moves filmed exactly side-on can be missed, because the hidden arm is drawn behind the visible one.
- A glute-bridge-style hold (still, hips up, arms not holding the body up) is rated low confidence rather than high.
- Two different exercises that look very alike from the camera's angle (e.g. a squat and a sumo squat) may be kept as one movement. The same exercise filmed from a very different angle may be split into two.
- Movements shorter than 2 seconds are treated as transitions.
- In dev builds, the raw tracking of the last analysed clip is available in the browser console as `window.__pactClip`, for debugging.

`src/extract/mediapipe.ts` is the only browser-specific part.
- **The WebAssembly runtime** is copied from `node_modules` into `public/mediapipe/` by `scripts/copy-mediapipe-wasm.mjs`. This runs automatically on install, dev and build, and the copy is git-ignored.
- **The tracking library** only loads when you open the video screen.

## Architecture

The separations below are deliberate: later steps (automatic workout extraction, MediaPipe pose tracking) plug into them.

```
src/
  types.ts                 Workout / Exercise / Pose / Animation shapes (below)
  data/sampleWorkout.ts    1. Workout data: the single source of truth
  animation/
    library/*.ts           2. Animation library: one file per move, plus index.ts registry
    interpolate.ts            samplePose(animation, t): keyframes -> pose at any t
    rig.ts                    authoring helpers (bone lengths, 2-bone IK), used only to *make* keyframes
    figureGeometry.ts         which bones and dots get drawn, framing, floor line
  engine/
    timeline.ts            3. Timeline engine: pure, unit-tested
    cues.ts                   voice/beep schedule derived from the timeline (pure)
    clock.ts               4. Player clock: pause-safe, no timers
  components/
    Player.tsx                the one requestAnimationFrame loop
    StickFigure.tsx           SVG renderer, updated imperatively each frame
    Overview.tsx, ProgressBar.tsx, AttributionBadge.tsx, icons.tsx
  player/                     browser wrappers: audio.ts, wakeLock.ts, fullscreen.ts, format.ts
  extract/
    segment.ts                one video -> its movements, in order (pure, unit-tested)
    extract.ts                one movement's landmarks -> one looping Animation (pure, unit-tested)
    mediapipe.ts              runs MediaPipe Pose over a <video>, frame by frame
  components/VideoBuilder.tsx "Make a workout from video" screen
```

**One clock drives everything.** Each frame, `Player` does:
1. `clock.tick(performance.now())`
2. `getStateAt(timeline, elapsed)`
3. Draws the stick figure at `state.figure.t`.
4. Fills the progress bar.
5. Fires any cues whose time fell inside the frame.
6. Updates the HUD only if its text changed.

There are no per-exercise timers. Because the figure's loop phase and the rep counter come from the same `elapsed`, the counter increments on exactly the frame the figure completes a rep (this is unit-tested). Pausing stops the clock accumulating, so nothing drifts; seeking just sets `elapsed`.

### 1. Workout data

```ts
type Workout = {
  id: string; title: string;
  creator?: { name: string; attributionUrl?: string };   // optional, unused for now
  source?: { platform: 'youtube'|'instagram'|'facebook'|'manual'; url?: string };
  exercises: Exercise[];
};
type Exercise = {
  id: string; name: string;
  type: 'rep_based' | 'time_based';
  animationId: string;           // key into the animation library
  sets: { reps?: number; holdSec?: number; restAfterSec: number }[];
  tempoSec?: number;             // seconds per rep, rep_based only (override of animation default)
  clip?: { startSec: number; endSec: number };  // made from video: where this movement is in the source video
  notes?: string;                // form cues, shown under the counter during the exercise
  side?: 'none' | 'left' | 'right' | 'both';  // which side works, for one-sided moves
  mirroredFrom?: string;         // id of the exercise this is the generated other side of
  mirrorFigure?: boolean;        // show the stick figure mirrored (the other side)
};
```

The player's top-bar badge reads "Sample workout". When a workout has a `creator`, it shows `creator.name` instead, linked to `attributionUrl` (see `AttributionBadge.tsx`).

### 2. Animation library

```ts
type Joint = 'head'|'neck'|'lShoulder'|'rShoulder'|'lElbow'|'rElbow'|'lWrist'|'rWrist'|'lHip'|'rHip'|'lKnee'|'rKnee'|'lAnkle'|'rAnkle';
type Pose = Record<Joint, {x:number; y:number}>;        // normalized coordinates, 0..1, y down
type Animation = { id: string; view: 'front'|'side'; defaultTempoSec: number; loop: {t:number; pose:Pose}[] };  // t in 0..1 across ONE repetition
```

- **One loop is exactly one rep.**
- **The pose shape is the same one MediaPipe-style pose tracking will output**, so real extracted reps can replace these keyframes without changing the player.
- **Interpolation** (`interpolate.ts`): a cyclic, monotone cubic spline per coordinate. It eases in and out wherever a joint reverses direction, passes smoothly through in-between keys, and never overshoots. It treats a handful of hand-made keyframes and dense tracked frames the same way.
- **Drawing:** bones are rounded SVG lines with joint dots, plus a filled circle for the head.
- **Side view:** the figure faces right; its left limbs are nearest you and the right limbs are drawn dimmed as the far side.
- **Framing:** each animation is centred on its own range of motion, at one shared scale so the figure is the same size in every exercise. A floor line is drawn just under the lowest joint.

### 3. Timeline engine

`buildTimeline(workout, { loopSecFor, prepSec })` flattens a workout into ordered phases: `prep | work | rest`. Each phase has its exercise, set, start and duration, plus `targetReps` and `loopSec` for work phases.
- Rep-based work lasts `reps × tempo`.
- Time-based work lasts `holdSec`, and the animation loops at its `defaultTempoSec`.
- A rest uses that set's `restAfterSec`. The final set of the final exercise has no rest, and zero-length rests are dropped.

`getStateAt(timeline, elapsedSec)` returns:
- the current phase, time elapsed and remaining in it
- set number, completed reps (`floor(phaseElapsed / tempo)`) and overall progress
- the next work phase (`nextUp`)
- what the figure should show: the live move, or a dimmed, 1.8× slower preview of the next move during get-ready and rest

`getSegmentFills`, `nextExerciseTime` and `prevExerciseTime` drive the progress bar and the ←/→ seeking.

## Adding a new exercise animation

1. Create `src/animation/library/myMove.ts` exporting an `Animation`. Its `loop` is a list of `{ t, pose }` keyframes for **one rep**, with `t` running from 0 to 1. The `t = 1` pose should equal `t = 0`.
   - **Simplest:** write a few key poses by hand (for example start, end of the movement, start). The interpolator eases between them.
   - **More robust:** do what the existing moves do and generate the keyframes with `sampleLoop(n, t => pose)` from `rig.ts`. Build each pose from bone lengths (`BODY`, `along`) and use `ik()` for knees and elbows. Limbs then keep a constant length, and planted hands and feet stay exactly still.
2. Register it in `src/animation/library/index.ts`.
3. Reference it from a workout exercise via `animationId`.
4. Run `pnpm test`. Every library animation is automatically checked for loop closure, 0..1 bounds, constant limb lengths between keyframes, and smooth motion at 60 fps.
5. Then look at it: run `pnpm dev`, press Start, and use → to skip to the exercise.

## Decisions on ambiguous points

- The get-ready countdown (5 s) happens only before the first exercise. Rests are the countdown between moves.
- The exercise name is announced as its first set starts, together with the go-beep. Later sets just beep. "Rest" with "Up next" is shown on screen.
- "Done" is spoken once, at the end of the workout.
- "Halfway" applies to time-based sets of 30 s or more.
- The rep counter shows **completed** reps (0 / 10 → 10 / 10).
- ← / → jump straight to an exercise's first set (skipping the rest before it), and that exercise's announcement plays. Cues don't fire while paused.
- The finish screen's total time is the time actually worked through, so skipped sections don't count.
- The clock follows real time. If the tab is backgrounded mid-workout, the workout keeps going, and on return only cues from the last second play.
- The sample's rests are all 15 s, giving a total of 6:45.
- The accent colour is the single `--accent` CSS variable in `src/styles.css`; its light tint is derived from it.
