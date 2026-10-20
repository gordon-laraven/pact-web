import type { Animation } from '../../types'
import { along, BODY, FLOOR, ik, lerp, lerpV, sampleLoop, sidePose, v, wave } from '../rig'

// Side view, facing right. Stand -> sit back to thighs-parallel with the torso
// leaning ~45 degrees and arms reaching forward for balance -> stand.
// Feet stay planted; knees track forward over the toes.

const ankle = v(0.52, FLOOR)
const standHip = v(0.52, FLOOR - 0.405)
const bottomHip = v(0.4, 0.735)

export const squat: Animation = {
  id: 'squat',
  view: 'side',
  defaultTempoSec: 2.4,
  loop: sampleLoop(16, (t) => {
    const s = wave(t)
    const hip = lerpV(standHip, bottomHip, s)
    const knee = ik(hip, ankle, BODY.thigh, BODY.shin, v(hip.x + 1, hip.y))
    const lean = lerp(3, 44, s) // torso, degrees forward of vertical
    const neck = along(hip, -90 + lean, BODY.spine)
    const head = along(neck, -90 + lean * 0.6, BODY.neck)
    const shoulder = along(neck, 90 + lean, BODY.shoulderDrop)
    const arm = lerp(82, -2, s) // hanging by the sides -> reaching forward
    const elbow = along(shoulder, arm, BODY.upperArm)
    const wrist = along(elbow, arm - lerp(10, 0, s), BODY.forearm)
    return sidePose(head, neck, { shoulder, elbow, wrist, hip, knee, ankle })
  }),
}
