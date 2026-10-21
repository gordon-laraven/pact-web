import { normalizeWorkout } from './normalize.ts'
import type { LinkExercise, LinkSource, LinkWorkout } from './types.ts'

// A plain-rules reader for exercise lists, used when no AI key is set (and as
// a backstop when the server can't be reached). It understands the way people
// usually write workouts: "Squats 3x12", "12 push-ups", "Plank 30s",
// "Lunges x10 each leg", "3 rounds".

/** Words that make a line look like an exercise rather than chatter. */
const MOVES =
  /\b(squat|lunge|push[- ]?ups?|press[- ]?ups?|pull[- ]?ups?|chin[- ]?ups?|plank|bridge|thrust|deadlift|rdl|row|press|curl|raise|fly|flye|dip|crunch|sit[- ]?ups?|burpee|jack|climber|knee|kick|jump|skater|step[- ]?ups?|calf|calves|swing|snatch|clean|twist|hold|wall sit|superman|bird[- ]?dog|dead ?bug|hollow|v[- ]?ups?|toe touch|shoulder tap|inchworm|march|bear crawl|crab|extension|pulse|circle|stretch|reach|shuffle|sprint|run|walk|skip|hop|boxing|punch|jab|hook|uppercut|good morning|hinge|clam|donkey|fire hydrant|glute|tricep|bicep|lat|chest|ab)s?\b/i

/** Lines that are almost never exercises in a caption. */
const CHATTER = /(#|https?:\/\/|@\w|\b(follow|save this|share|comment|subscribe|link in bio|like|dm me|tag a|day \d+ of|challenge|giveaway|discount|code)\b)/i

export function parseExerciseList(text: string, source: LinkSource): LinkWorkout | null {
  const lines = text
    .split(/\r?\n|•|·|;|\|/)
    .map((l) => l.trim())
    .filter(Boolean)
  const roundsLine = text.match(/\b(\d{1,2})\s*(rounds?|sets?|circuits?)\b(?!\s*of\s+\d)/i)
  const globalSets = roundsLine ? Number(roundsLine[1]) : null

  const exercises: LinkExercise[] = []
  for (const line of lines) {
    // A comma list on one line ("squats, lunges, plank") becomes separate moves.
    // A comma before a number alone ("10, 8, 6") stays: that's a rep scheme.
    const parts = line.length < 140 ? line.split(/,(?=\s*(?:\d+\s*)?[a-z])/i) : [line]
    for (const part of parts) {
      const ex = parseLine(part, source === 'typed')
      if (ex) exercises.push(ex)
    }
  }
  if (globalSets) for (const e of exercises) e.sets ??= globalSets

  const allMeasured = exercises.length > 0 && exercises.every((e) => e.reps != null || e.duration_seconds != null)
  return normalizeWorkout(
    { title: source === 'typed' ? 'My workout' : undefined, exercises, confidence: allMeasured ? 'medium' : 'low' },
    source,
  )
}

export function parseLine(raw: string, lenient: boolean): LinkExercise | null {
  let line = raw
    .replace(/^\s*(?:[-*–—>+]+|\d{1,2}\s*[.)]|\d️?⃣|[\p{Extended_Pictographic}️‍]+)\s*/u, '')
    .replace(/[\p{Extended_Pictographic}️‍]/gu, ' ')
    .trim()
  if (!line || line.length > 120) return null
  if (CHATTER.test(line) && !MOVES.test(line.replace(CHATTER, ''))) return null
  if (/^(\d+)\s*(rounds?|sets?|circuits?)\b/i.test(line) && !MOVES.test(line)) return null

  let sets: number | null = null
  let reps: number | null = null
  let duration: number | null = null
  const notes: string[] = []
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = line.match(re)
    if (m) {
      fn(m)
      line = line.replace(m[0], ' ')
    }
  }

  take(/\(?\b(each|per)\s+(side|leg|arm|way)\b\)?/i, (m) => notes.push(`${m[1].toLowerCase()} ${m[2].toLowerCase()}`))
  take(/\b(\d{1,2})\s*[x×*]\s*(\d{1,4})\s*(s|sec|secs|seconds|")(?![a-z])/i, (m) => {
    sets = +m[1]
    duration = +m[2]
  })
  take(/\b(\d{1,2})\s*[x×*]\s*(\d{1,3})\b/i, (m) => {
    sets = +m[1]
    reps = +m[2]
  })
  take(/\b(\d{1,2})\s*(sets?|rounds?)\b(\s*of)?/i, (m) => (sets = +m[1]))
  take(/\b(\d{1,3}(?:\.\d)?)\s*(m|min|mins|minutes)(?![a-z])/i, (m) => (duration = Math.round(+m[1] * 60)))
  take(/\b(\d{1,4})\s*(s|sec|secs|seconds|")(?![a-z])/i, (m) => (duration = +m[1]))
  take(/\b(\d{1,3})\s*(reps?|times|x)(?![a-z0-9])/i, (m) => (reps = +m[1]))
  take(/(?:^|\s)[x×]\s*(\d{1,3})\b/i, (m) => (reps = +m[1]))
  if (reps == null && duration == null) take(/^\s*(\d{1,3})\b/, (m) => (reps = +m[1]))
  if (reps == null && duration == null) take(/\b(\d{1,3})\s*$/, (m) => (reps = +m[1]))

  const name = line
    .replace(/[()[\]{}:=|~"“”]/g, ' ')
    .replace(/\s[-–—]\s|^[-–—\s]+|[-–—,.\s]+$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!/[a-z]{3}/i.test(name) || name.length > 50) return null
  const measured = reps != null || duration != null
  const words = name.split(' ').length
  // In a caption, a move needs a number or a move word. Typed lists are trusted more.
  if (!lenient && !(MOVES.test(name) && (measured || words <= 5))) return null
  if (lenient && !measured && words > 6) return null

  return { name: capitalise(name), sets, reps, duration_seconds: duration, rest_seconds: null, notes: notes.join(', ') || null }
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
