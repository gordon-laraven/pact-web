import type { Animation } from '../../types'
import { along, BODY, ik, lerp, sampleLoop, sidePose, v, wave } from '../rig'

// Side view, lying on the back with the head to the left, knees bent and feet
// flat. Hips drive up until shoulders, hips and knees form a straight line,
// pause briefly at the top, and lower. Shoulders, arms and feet stay down.

const shoulder = v(0.26, 0.872)
const neck = v(0.24, 0.87)
const head = v(0.172, 0.848)
const ankle = v(0.75, 0.885)
const elbow = v(shoulder.x + BODY.upperArm, 0.887)
const wrist = v(elbow.x + BODY.forearm, 0.89)

export const gluteBridge: Animation = {
  id: 'glute-bridge',
  view: 'side',
  defaultTempoSec: 2.4,
  loop: sampleLoop(16, (t) => {
    const w = wave(t)
    const s = 1 - (1 - w) * (1 - w) // lingers at the top: squeeze
    const hipLift = lerp(3, 23, s) // degrees, shoulder -> hip
    const hip = along(shoulder, -hipLift, BODY.spine - BODY.shoulderDrop)
    const knee = ik(hip, ankle, BODY.thigh, BODY.shin, v(hip.x + 0.1, 0.3))
    return sidePose(head, neck, { shoulder, elbow, wrist, hip, knee, ankle })
  }),
}
