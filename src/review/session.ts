import type { UniformState } from '../components/VideoBuilder'
import { cleanUniform, DEFAULT_UNIFORM } from './uniform'

// The "Set for all movements" values for this browser tab's session
// (sessionStorage), so they survive going to the player and back, or a reload.

const KEY = 'pact-uniform'

export function loadUniform(storage: Pick<Storage, 'getItem'> | null = safeSession()): UniformState {
  try {
    const v = JSON.parse(storage?.getItem(KEY) ?? 'null') as UniformState | null
    if (v && v.values) return { values: cleanUniform(v.values), active: v.active ? cleanUniform(v.active) : null }
  } catch {
    // fall through to the defaults
  }
  return { values: DEFAULT_UNIFORM, active: null }
}

export function saveUniform(u: UniformState, storage: Pick<Storage, 'setItem'> | null = safeSession()) {
  try {
    storage?.setItem(KEY, JSON.stringify(u))
  } catch {
    // private mode or blocked: the values still last until the page closes
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}
