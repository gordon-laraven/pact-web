import type { Animation } from '../../types'
import { along, BODY, FLOOR, ik, lerpV, sampleLoop, sidePose, v, wave, type Vec } from '../rig'

// Side view, high plank with straight arms, head to the right. Knees drive
// alternately toward the chest while the other leg extends back, feet lifting
// off the floor as they travel. One loop = left knee in + right knee in.

const torsoDeg = 11 // shoulders a little higher than hips
const hipBase = v(0.49, 0.675)
const shoulderBase = along(hipBase, -torsoDeg, BODY.spine - BODY.shoulderDrop)
const hand = v(shoulderBase.x, FLOOR)
const back = v(0.144, 0.885) // extended leg, toes on the floor

function leg(hip: Vec, p: number) {
  // p: 0 = extended back, 1 = knee driven to the chest
  // Tucked: thigh ~35 degrees below horizontal, foot hovering under the hips.
  const tucked = v(hip.x - 0.02, 0.86)
  // The foot stays back a little longer, so the knee clears the floor mid-swing.
  const a = lerpV(back, tucked, p ** 1.5)
  const ankle = v(a.x, a.y - 0.04 * Math.sin(Math.PI * p))
  const knee = ik(hip, ankle, BODY.thigh, BODY.shin, v(hip.x + 0.3, 1))
  return { knee, ankle }
}

export const mountainClimbers: Animation = {
  id: 'mountain-climbers',
  view: 'side',
  defaultTempoSec: 0.9,
  loop: sampleLoop(36, (t) => {
    const hip = v(hipBase.x, hipBase.y - 0.008 * wave((2 * t) % 1))
    const neck = along(hip, -torsoDeg, BODY.spine)
    const shoulder = along(hip, -torsoDeg, BODY.spine - BODY.shoulderDrop)
    const head = along(neck, -torsoDeg + 10, BODY.neck)
    const elbow = ik(shoulder, hand, BODY.upperArm, BODY.forearm, v(shoulder.x - 1, shoulder.y))
    const pl = wave(t)
    const near = leg(hip, pl)
    const far = leg(hip, 1 - pl)
    const arm = { shoulder, elbow, wrist: hand, hip }
    return sidePose(head, neck, { ...arm, ...near }, { ...arm, ...far })
  }),
}
