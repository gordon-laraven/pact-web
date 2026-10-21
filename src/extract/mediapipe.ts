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
}

export async function trackVideo(video: HTMLVideoElement, o: TrackOptions): Promise<TrackedClip> {
  const lm = await loadPoseLandmarker()
  const fps = o.fps ?? 15
  const end = Math.min(o.end, video.duration || o.end)
  const count = Math.max(1, Math.floor((end - o.start) * fps) + 1)
  video.pause()
  const frames: TrackedClip['frames'] = []
  for (let i = 0; i < count; i++) {
    if (o.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError')
    const t = o.start + i / fps
    await seek(video, t)
    clockMs += 1000 / fps
    const result = lm.detectForVideo(video, clockMs)
    const found = result.landmarks[0]
    const landmarks = found ? found.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })) : null
    frames.push({ t, landmarks })
    o.onFrame?.(landmarks)
    o.onProgress?.((i + 1) / count)
  }
  return { width: video.videoWidth, height: video.videoHeight, frames }
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
