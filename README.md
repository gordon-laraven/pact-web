# pact-web

**pact** ("Keep the pact.") will eventually turn workout reels and shorts into long-form, follow-along workout videos.

This repo is a **frontend-only prototype** that tests one thing: **the hands-free feel**. You press Start once and follow a full workout, like putting in a P90X tape. A stick figure demonstrates each move. Reps, sets, rest timers and spoken cues advance on their own. You never touch the screen mid-workout.

There is also a **Paste a link** feature (read a post's caption to find its exercises). It is **switched off** for now and will return as a paid feature. See [Paste a link](#paste-a-link).

It also has a first version of the core idea: **Make a workout from video.** Pick a clip on your device. pact tracks the body, splits the video into its separate movements, cuts one clean rep of each, and turns them into stick-figure moves for a hands-free workout. See [Make a workout from video](#make-a-workout-from-video).

### What it is not (yet)

- No accounts or database. Workouts you build live in memory and are gone when you refresh.
- The only server code is the small link API in `server/` (it runs inside `npm run dev` / `npm run preview`). The only AI is the optional Gemini step for links.
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
| End | "Done. Pact kept." |

If the speech API is missing or fails, the workout runs silently, with no errors.

## Paste a link

> **Currently off.** `ENABLE_LINK_IMPORT` in `src/features.ts` is `false`. While it's off, the home screen shows only **Upload a video**, the link screen never renders, and the dev/preview server doesn't mount `/api/link/*`, so no link requests happen. All the code and its tests are kept. They still run, because none of them need the UI. Set the flag to `true` to bring it back; nothing else needs to change.

On the home screen, **Paste a link** takes a YouTube / Shorts, Instagram, Facebook or TikTok link and finds the exercises in it. **Nothing from the video is downloaded, stored or re-hosted.** Only the post's public title and caption are read, and the workout still plays with the stick figure. The original upload flow is unchanged and is one tap away from here.

### The pipeline

It stops at the first step that gives a usable list. Each step is its own function (and its own API route, so the screen can say "Reading the post…" / "Watching the video…"):

| Step | What it does | Code |
|---|---|---|
| 1. Check the link | Validates the URL, works out the platform, normalises YouTube links to `watch?v=` | `server/link/platform.ts` → `parseLink` |
| 2. Text first | Reads public text only: official oEmbed (YouTube, TikTok, and Instagram/Facebook when a Meta token is set), the YouTube Data API description (optional key), or the page's public title/description tags. No logins, no cookies. Then it extracts a list from that text: Gemini when `GEMINI_API_KEY` is set, a plain-rules parser otherwise. | `metadata.ts` → `readPostText`, `extract.ts` → `extractFromText` |
| 3. Video model (YouTube only) | If step 2 finds no list, Gemini watches the public YouTube video by its URL (`file_data.file_uri`). Gemini fetches it; this server never does. | `extract.ts` → `extractFromYouTube` |
| 4. Fallback | Two options, presented as one more step rather than an error: type or paste the list (same extraction as step 2), or open the existing upload flow. | `src/components/LinkBuilder.tsx` |

Before building, the list is shown for checking. You can rename, reorder (↑ ↓), add and remove moves, change sets, reps, seconds and rest, and pick the stick-figure move. A note appears when confidence is low.

Every path returns the same shape (`src/link/types.ts`), which `toWorkout()` (`src/link/toWorkout.ts`) turns into the app's normal `Workout`, so the player is untouched:

```json
{ "title": "Leg day", "source": "caption" | "video-model" | "typed",
  "exercises": [{ "name": "Squat", "sets": 3, "reps": 12, "duration_seconds": null, "rest_seconds": null, "notes": null }],
  "confidence": "high" | "medium" | "low" }
```

(`sets` and `rest_seconds` were added to the shape, because captions often include them.)

Rate limits, timeouts and bad links come back as reason codes (`src/link/types.ts` → `LinkFailure`) and become calm messages (`src/link/messages.ts`). Every outside request has a timeout and a size cap. Pages on private or local addresses are never fetched. Each visitor can make 30 link requests per 10 minutes.

### Environment variables (server-side only)

Put them in `.env.local` next to `package.json` (it's git-ignored), then restart `npm run dev`. **Never prefix them with `VITE_`**, because Vite would then ship them to the browser.

```bash
GEMINI_API_KEY=...        # Google AI Studio key. Turns on AI caption reading and the YouTube video step.
GEMINI_MODEL=gemini-flash-latest   # optional; any Gemini model id that accepts video
YOUTUBE_API_KEY=...       # optional; full YouTube descriptions (oEmbed only gives the title)
META_OEMBED_TOKEN=app-id|client-token   # optional; Instagram/Facebook oEmbed
```

With no keys at all, links still work wherever the caption lists the moves clearly (for example TikTok captions or YouTube titles), and typed lists always work. Instagram and Facebook usually hide captions from logged-out readers, so expect the fallback there unless a Meta token is set.

**Before launch:** verify Google's current Gemini API terms and limits for YouTube URL input. It has been a preview feature, works for public videos only, and has a daily free-tier cap on hours of video. Also check YouTube's and Meta's terms for oEmbed and the Data API (see the comment in `server/link/extract.ts`).

### Hosting

`npm run dev` and `npm run preview` include the API (`server/vitePlugin.ts`). On a static host without it, link reading shows the fallback, and typed lists are parsed in the browser instead. To host it elsewhere, mount `createLinkApi(env)` from `server/link/api.ts`: it's a plain Node `(req, res, next)` middleware.

## Report a problem

When something goes wrong on the upload screen (body tracking doesn't start, no moves are found, a range can't be tracked), the error comes with a **Report a problem** button. On the "Check the moves" step, a quieter link asks "Something look off in these results?". This replaces the old "Download debug file" button, which now shows only in dev builds.

The form asks what you were trying to do (optional), an email (optional), and has **Include technical details** (checked by default). A ticket records:
- the time, app version, and step;
- if technical details are included: browser and device, the error message and stack, the video's name, size and length, and what was detected so far (movements, pieces, decisions).

The video itself and the raw body tracking are never included. After sending, you see a ticket ID to copy and **Try again**. If saving fails, the details appear as text with **Copy details**.

**Where tickets go:** `src/support/tickets.ts`. Tickets are saved through one small interface, `TicketStore { save(ticket) }`. For now that's `localTicketStore()`, this browser's `localStorage` (key `pact-tickets`, latest 50). To send them somewhere else (email, a form service, a helpdesk), write another `TicketStore` and change the `ticketStore` line.

**Reading tickets:** open the app, open the browser console (F12), and run `pactTickets.list()` to see them, or `pactTickets.download()` to save `pact-tickets.json`. Because they live in that browser, you only see tickets made on the same browser and device. Reports from other people need a real destination (above).

## Brand: where to change things

- **Colors, fonts, radii:** `src/theme/tokens.css`. It's the only file with color values. Values marked `PLACEHOLDER` wait for official hex codes, and values marked `AA` were adjusted for contrast. After changing a color, run `npm test`: `src/theme/contrast.test.ts` checks every text and button pair against WCAG AA in both modes.
- **Light · Cyan / Dark · Amber:** `src/theme/theme.ts` (follows the system until you pick, then remembers the pick). A matching snippet in `index.html` sets the mode before first paint.
- **Wordmark:** `src/components/Wordmark.tsx`, drawn as SVG strokes. Swap the final logo in there; `mono` gives a one-color version. The favicon is `public/favicon.svg`.
- **Fonts:** Sora (headlines, semibold) and Inter (body) are bundled with the app via `@fontsource-variable/*` and imported in `src/main.tsx`. The family names are in `tokens.css` (`--font-head`, `--font-body`).

## Make a workout from video

On the overview, press **Upload a video** (or pick it from the fallback after pasting a link).

1. **Choose a clip.** Best results come from one person, whole body in frame, filmed side-on or facing the camera. A clip can contain several exercises. Use **Start / End** if you only want part of it.
2. **Find the moves.** pact steps through the clip at 15 frames per second with [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) and draws the tracked skeleton over the video.
   - It runs on your computer's graphics card, falling back to the processor.
   - The first run downloads the ~9 MB pose model from Google; after that it's cached.
   - **Slow analysis** (a checkbox above the button) is for fast videos, or when a move was missed. It tracks 30 frames per second instead of 15, and tries more analysis speeds (see below). It takes about twice as long and stays on your device, so there's no API cost. After a result with moves to check, a **Look again with slow analysis** link offers it.
   - On every run, the tracker also analyses the moment halfway between two frames when it just lost the person (often motion blur) or when the hands, feet or hips moved fast. That adds roughly 10–30% time on fast videos and almost nothing on slow ones.
3. **Check the moves.** There's one card per movement, numbered in video order. Cards detected with low confidence are listed first, so you check those before anything else. Each card has:
   - **▶ 0:13–0:22**, which plays that part of your video.
   - A **confidence** rating (high/medium/low). Low ones get a **Check this one** tag and say why.
   - A preview loop of the extracted rep, and what was detected: sets, reps per set, seconds per rep, and the view.

   On each card you can:
   - Name the movement, adjust Reps/Timed, sets, reps and rest, and optionally add form cues.
   - Fix the **start / end** if they're off. **Update range** re-analyses just that range.
   - **Split into two here** cuts a card that holds two exercises at the second you choose. Each part is re-analysed, and the second becomes "(part 2)".
   - **Merge with the next move** joins two cards that are really one exercise, re-analysed as one range. If the merged card comes back low confidence, they were probably two different moves: split it again.
   - **Delete** anything that isn't an exercise.
   - **Add a movement that was missed**, from a range you enter.
   - Use **Add other side (reverse)**. It's highlighted on moves that work one side (lunges, single-leg or single-arm work, side planks) when the video doesn't already show both sides.
     - It adds a copy right after the original, named "(Left)" / "(Right)", or flipped if the name already says a side.
     - The copy's **Mirror** toggle (off by default) flips the stick figure, and the video when you watch it here, so it looks like the other side. On-screen text in the video appears backwards when mirrored.
     - **Remove this copy** deletes it in one click.

   Then press **Add to workout**.
4. Add more clips if you like. In the workout list, **▶** plays one movement on its own. **Start workout** plays them all in order in the hands-free player, with the badge reading "From your videos". Form cues show under the counter while you do that exercise.

**How a video is split into movements** (`src/extract/segment.ts`, pure and unit-tested). It runs in two passes, and nothing is sent anywhere.

*Fast videos:* the rules below are in seconds, tuned for videos at normal speed. A sped-up reel squeezes each exercise into fewer seconds, so two look-alike moves can blur into one. If the first result isn't clear (clarity below 0.85, or anything low confidence), the same tracking is analysed again as if slowed to half speed. Only the timestamps are stretched; the video isn't re-read or altered. The clearer result wins, and normal speed is kept unless the slowed one is clearly better. Clarity is the share of the video covered by movements, weighted by confidence. Slow analysis also tries ×1.5 and ×3. The debug file's notes say which speed was kept.

*Frozen frames:* when the tracker repeats its last answer exactly (it does this when it loses the person in a blur), those frames count as "not tracked". Otherwise they'd look perfectly still and could become a hold that isn't there.

*Pass 1, candidates:*
- **Describe each moment:** each frame's posture is measured relative to the hips, in spine lengths.
  - Turning around doesn't count as a change.
  - Whole-body bounce is included, which catches calf raises and jumps.
  - In clear side views, it also records which leg and arm are forward, so a left-leg and a right-leg lunge differ.
- **Breaks:** the video is cut wherever nobody is tracked for 0.7 s or more (a title card, a cut away), and at camera cuts (the body jumps in the frame and changes size).
- **Changes of exercise:** at every quarter second, pact compares the 3 s before with the 3 s after: the average posture, and how much each body part moves. A big difference marks a new movement, and the exact moment is then pinned down with 1 s windows. Back-to-back movements with no break are split this way.
- **Labelling the pieces:**
  - **Transition:** shorter than 2 s, like getting down to the floor. It's absorbed into the movement before it if it looks like that move, otherwise dropped.
  - **Rest:** still while standing, kneeling, sitting or lying on the mat. These are never holds.
  - **Hold:** still in an exercise position for at least 5 s. It gets high confidence if held up on the arms (plank, side plank), low confidence otherwise. A hold has to pass all three checks:
    - **Every body part is still,** not just the average, so arm pulses in a plank position count as a movement.
    - **It's still in at least 80% of its seconds,** not just on average.
    - **The body is tracked in at least 80% of the frames.**
  - Anything else is a **movement**.
- **Rhythm decides close calls.** The splitter cuts eagerly, then rhythm decides which pieces to put back together. A stretch's rhythm score says how steadily it repeats.
  - **Look-alikes stay apart:** two neighbouring pieces that look alike but each have a steady rhythm of their own, and *lose* it when joined, are different exercises. This happens with combo moves that share the same legs and differ in the arms.
  - **Halves rejoin:** pieces that only repeat steadily when joined (a slow rep cut in half) are rejoined.
  - **Leftovers:** short leftovers between two movements, usually a transition plus a first rep, are shared out where both neighbours keep their steadiest rhythm.
  - **Boundaries:** where two movements meet directly, the boundary is nudged (up to 2 s) to where both repeat most steadily.
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
- **One-sided:**
  - From the side, a movement is one-sided when left and right limbs sit in clearly different places.
  - From the front, it's one-sided when one leg or arm moves much more than the other. Positions aren't compared there, because a slight camera angle shifts left and right apart anyway. If the same move follows with the sides swapped, both are marked as "both sides shown", labelled Left/Right, and the button isn't suggested.
- **Nothing found:** if there's no clear movement at all, you get a friendly message instead of an error.

**Debug file (dev builds only).** After analysing, **Download debug file (dev)** saves everything behind the result:
- the video's name and length, and the analysed range;
- the sampling (15 frames per second, or 30 with slow analysis) and every frame's timestamp;
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

**Measuring detection: the test set.** `testset/` holds videos with the movements you know they contain (see `testset/README.md`). For each one, `npm run eval` reports missed movements, fragments, extra detections and false holds, compared with the previous run. Your videos and tracking stay local: the folder is git-ignored except its README and an example.

**Known limits:**
- Side views of arms are the weak spot. The tracker has to guess the hidden arm and can mislocate the visible one when it crosses the face or body. Check the preview, and if an arm looks wrong, try trimming to a cleaner section or a clip with better lighting.
- Analysis speed depends on the device: a few seconds per 10 s of video with a decent graphics card, much slower without one.
- Splitting is based on how the body moves only. Speech, captions, title cards and the instructor naming the next move aren't read; that needs the later AI step. For the same reason, movement names are typed in by you.
- "Left/Right" for a generated other side comes from the name, not from the video. Which leg the person actually used can't be told reliably from body tracking alone, so check the label.
- One-sided detection compares where the left and right limbs sit. Single-arm moves filmed exactly side-on can be missed, because the hidden arm is drawn behind the visible one.
- A glute-bridge-style hold (still, hips up, arms not holding the body up) is rated low confidence rather than high.
- Two different exercises that look very alike from the camera's angle (e.g. a squat and a sumo squat) may be kept as one movement. The same exercise filmed from a very different angle may be split into two.
- Movements shorter than 2 seconds are treated as transitions. A short burst (2–4 s) is kept only if it shows 2.5 or more clean repetitions.
- A big change of tempo partway through one exercise can split it into two entries (each has its own rhythm). Delete or rename one if that happens.
- A short transition (like getting down to the floor) can be attached to the start or end of a neighbouring movement. That's on purpose, so a first or last rep is never cut off.
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
  components/VideoBuilder.tsx "Make it from a video" (upload) screen
  components/LinkBuilder.tsx  "Paste a link" screen
  components/Wordmark.tsx     the wordmark (swap the logo here)
  link/                       link list shape, rules parser, client pipeline, toWorkout (browser + server)
  theme/                      tokens.css (all colors and fonts), theme.ts (light/dark), contrast test
server/
  vitePlugin.ts               mounts the link API on the dev and preview servers
  link/                       platform, metadata, gemini, extract, api: one file per pipeline step
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
