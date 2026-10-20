# pact-web

**PACT** ("a promise to yourself") will eventually turn workout reels and shorts into long-form, follow-along workout videos.

This repo is a **frontend-only prototype** that tests one thing: **the hands-free feel**. You press Start once and follow a full workout, like putting in a P90X tape. A stick figure demonstrates each move. Reps, sets, rest timers and spoken cues advance on their own. You never touch the screen mid-workout.

### What it is not (yet)

- No backend, accounts, database or AI.
- No video import, pose extraction or stock footage.
- The workout is hand-written (`src/data/sampleWorkout.ts`), and so are the animations (`src/animation/library/`).

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
