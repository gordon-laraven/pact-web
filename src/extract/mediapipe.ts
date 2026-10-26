import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Landmark, TrackedClip } from './extract'

// Browser-only: runs MediaPipe Pose over a <video>, frame by frame. The video
// never leaves the device. The WebAssembly runtime is served by this app
// (copied from node_modules, see scripts/copy-mediapipe-wasm.mjs); the model
// file is fetched from Google's MediaPipe model storage on first use.

const WASM_BASE = `${import.meta.env.BASE_URL}mediapipe/wasm`
export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'

let landmarker: Promise<PoseLandmarker> | null = null
// VIDEO mode needs strictly increasing timestamps for the landmarker's lifetime.
let clockMs = 0

export function loadPoseLandmarker(): Promise<PoseLandmarker> {
  landmarker ??= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE)
    const create = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
    try {
      return await create('GPU')
    } catch {
      return await create('CPU') // no WebGL2 (some laptops, headless browsers)
    }
  })()
  landmarker.catch(() => {
    landmarker = null // allow a retry, e.g. after the network comes back
  })
  return landmarker
}

export type TrackOptions = {
  start: number
  end: number
  /** Frames per second to analyse. 15 gives ~16 samples per rep even for fast moves. */
  fps?: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
  /** Called after each frame with the landmarks found (for drawing an overlay). */
  onFrame?: (landmarks: Landmark[] | null) => void
  /**
   * Extra frames where they matter: after a frame where the person was lost
   * (often motion blur), or when the body moved fast between frames, the
   * moment halfway between is analysed too. Costs ~10–30% more time on
   * fast videos, nothing on slow ones. Default on.
   */
  extraFrames?: boolean
}

export async function trackVideo(video: HTMLVideoElement, o: TrackOptions): Promise<TrackedClip> {
  const lm = await loadPoseLandmarker()
  const fps = o.fps ?? 15
  const end = Math.min(o.end, video.duration || o.end)
  const count = Math.max(1, Math.floor((end - o.start) * fps) + 1)
  video.pause()
  const frames: TrackedClip['frames'] = []
  const detect = async (t: number, step: number) => {
    await seek(video, t)
    clockMs += step // timestamps only ever go up, as VIDEO mode requires
    const found = lm.detectForVideo(video, clockMs).landmarks[0]
    const landmarks = found ? found.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })) : null
    frames.push({ t, landmarks })
    o.onFrame?.(landmarks)
  }
  for (let i = 0; i < count; i++) {
    if (o.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError')
    const t = o.start + i / fps
    // Halfway frames go in before the next regular one, so video time keeps moving forward.
    if (o.extraFrames !== false && i > 0 && needsExtraFrame(frames[frames.length - 2]?.landmarks ?? null, frames[frames.length - 1].landmarks)) {
      await detect(t - 0.5 / fps, 500 / fps)
    }
    await detect(t, 1000 / fps)
    o.onProgress?.((i + 1) / count)
  }
  return { width: video.videoWidth, height: video.videoHeight, frames }
}

/** Torso-relative landmarks this fast between two frames get a frame in between. */
const FAST = 0.35
const HANDS_FEET_HIPS = [15, 16, 27, 28, 23, 24]

/**
 * Should the moment before the next frame be analysed too? Yes if the last
 * frame just lost the person (a blur, often), or if hands, feet or hips moved more
 * than about a third of the torso length since the frame before.
 */
export function needsExtraFrame(before: Landmark[] | null, last: Landmark[] | null): boolean {
  if (!last) return !!before // just lost the person; not every frame of a title card
  if (!before) return false
  const torso = Math.hypot((last[11].x + last[12].x - last[23].x - last[24].x) / 2, (last[11].y + last[12].y - last[23].y - last[24].y) / 2)
  if (!(torso > 1e-3)) return false
  const moved = Math.max(...HANDS_FEET_HIPS.map((i) => Math.hypot(last[i].x - before[i].x, last[i].y - before[i].y)))
  return moved / torso > FAST
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return resolve()
    const done = () => {
      clearTimeout(timer)
      video.removeEventListener('seeked', done)
      resolve()
    }
    const timer = setTimeout(done, 4000) // never hang on a stubborn codec
    video.addEventListener('seeked', done)
    video.currentTime = t
  })
}

/** Bones to draw over the video while analysing (MediaPipe landmark indices). */
export const OVERLAY_BONES: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [7, 8],
]
