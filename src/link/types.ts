// The shape every "paste a link" path produces (caption, video model, typed
// list). Shared by the browser and the small server API in /server.
// toWorkout() turns it into the app's own Workout, so the player is unchanged.

export type LinkPlatform = 'youtube' | 'instagram' | 'facebook' | 'tiktok' | 'other'

export type LinkSource = 'caption' | 'video-model' | 'typed'

export type LinkConfidence = 'high' | 'medium' | 'low'

export type LinkExercise = {
  name: string
  sets: number | null
  reps: number | null
  duration_seconds: number | null
  rest_seconds: number | null
  notes: string | null
}

export type LinkWorkout = {
  title: string
  source: LinkSource
  exercises: LinkExercise[]
  confidence: LinkConfidence
}

/** Who posted it, from public metadata. Used for the player's attribution badge. */
export type LinkPost = { title: string | null; author: string | null; authorUrl: string | null }

/** Why a step couldn't produce a list. The browser turns these into friendly copy. */
export type LinkFailure =
  | 'bad_link'
  | 'no_text' // the platform didn't share a title or caption
  | 'no_exercises' // there was text, but it doesn't name exercises
  | 'not_configured' // no AI key on the server
  | 'not_youtube'
  | 'rate_limited'
  | 'timeout'
  | 'upstream' // the platform or model answered with an error
  | 'too_many_requests' // our own limit, per visitor

export type ReadResponse =
  | { ok: true; platform: LinkPlatform; url: string; post: LinkPost; workout: LinkWorkout }
  | { ok: false; platform: LinkPlatform | null; url: string | null; post: LinkPost | null; reason: LinkFailure; canWatch: boolean }

export type ExtractResponse = { ok: true; workout: LinkWorkout } | { ok: false; reason: LinkFailure }
