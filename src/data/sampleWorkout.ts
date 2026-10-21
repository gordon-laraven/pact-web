import type { Workout } from '../types'

// Hand-written for the prototype. Later this exact shape is what the
// reel/short -> workout extraction step will produce.

export const sampleWorkout: Workout = {
  id: 'sample-full-body-starter',
  title: 'Full-body starter',
  source: { platform: 'manual' },
  exercises: [
    {
      id: 'jumping-jacks',
      name: 'Jumping jacks',
      type: 'time_based',
      animationId: 'jumping-jacks',
      sets: [{ holdSec: 40, restAfterSec: 15 }],
    },
    {
      id: 'squat',
      name: 'Bodyweight squat',
      type: 'rep_based',
      animationId: 'squat',
      tempoSec: 2.2,
      sets: [
        { reps: 10, restAfterSec: 15 },
        { reps: 10, restAfterSec: 15 },
      ],
    },
    {
      id: 'push-up',
      name: 'Push-up',
      type: 'rep_based',
      animationId: 'push-up',
      sets: [
        { reps: 8, restAfterSec: 15 },
        { reps: 8, restAfterSec: 15 },
      ],
    },
    {
      id: 'plank',
      name: 'Plank',
      type: 'time_based',
      animationId: 'plank',
      sets: [
        { holdSec: 30, restAfterSec: 15 },
        { holdSec: 30, restAfterSec: 15 },
      ],
    },
    {
      id: 'glute-bridge',
      name: 'Glute bridge',
      type: 'rep_based',
      animationId: 'glute-bridge',
      tempoSec: 2.2,
      sets: [
        { reps: 12, restAfterSec: 15 },
        { reps: 12, restAfterSec: 15 },
      ],
    },
    {
      id: 'mountain-climbers',
      name: 'Mountain climbers',
      type: 'time_based',
      animationId: 'mountain-climbers',
      sets: [{ holdSec: 30, restAfterSec: 0 }],
    },
  ],
}
