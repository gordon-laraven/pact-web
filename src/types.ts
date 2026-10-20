// Core data shapes. These are deliberately plain data so they can later be
// produced automatically (workout extraction, MediaPipe pose tracking).

export type Workout = {
  id: string
  title: string
  creator?: { name: string; attributionUrl?: string } // optional, unused for now
  source?: { platform: 'youtube' | 'instagram' | 'facebook' | 'manual'; url?: string }
  exercises: Exercise[]
}

export type Exercise = {
  id: string
  name: string
  type: 'rep_based' | 'time_based'
  animationId: string // key into the animation library
  sets: { reps?: number; holdSec?: number; restAfterSec: number }[]
  tempoSec?: number // seconds per rep, rep_based only (override of animation default)
}

export type Joint =
  | 'head'
  | 'neck'
  | 'lShoulder'
  | 'rShoulder'
  | 'lElbow'
  | 'rElbow'
  | 'lWrist'
  | 'rWrist'
  | 'lHip'
  | 'rHip'
  | 'lKnee'
  | 'rKnee'
  | 'lAnkle'
  | 'rAnkle'

export const JOINTS: readonly Joint[] = [
  'head',
  'neck',
  'lShoulder',
  'rShoulder',
  'lElbow',
  'rElbow',
  'lWrist',
  'rWrist',
  'lHip',
  'rHip',
  'lKnee',
  'rKnee',
  'lAnkle',
  'rAnkle',
]

// Normalized coordinates, 0..1, y down. Same shape pose tracking will output.
export type Pose = Record<Joint, { x: number; y: number }>

// t in 0..1 across ONE repetition. One full loop = exactly one rep.
export type Animation = {
  id: string
  view: 'front' | 'side'
  defaultTempoSec: number
  loop: { t: number; pose: Pose }[]
}
