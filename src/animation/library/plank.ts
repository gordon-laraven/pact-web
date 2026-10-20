import type { Animation } from '../../types'
import { along, BODY, ik, lerp, sampleLoop, sidePose, v, wave } from '../rig'

// Side view forearm plank. A hold, so the loop is one slow breath: the body
// rises a few millimetres on the inhale and the head settles on the exhale,
// just enough that it never looks frozen. Forearms and toes stay planted.

const toes = v(0.16, 0.885)
const anklesToShoulder = BODY.shin + BODY.thigh + BODY.spine - BODY.shoulderDrop
const elbowY = 0.893
const baseDeg = Math.asin((toes.y - (elbowY - BODY.upperArm)) / anklesToShoulder) * (180 / Math.PI)
const wrist = v(along(toes, -baseDeg, anklesToShoulder).x + BODY.forearm * 0.98, elbowY)

export const plank: Animation = {
  id: 'plank',
  view: 'side',
  defaultTempoSec: 4,
  loop: sampleLoop(12, (t) => {
    const breath = wave(t)
    const deg = -(baseDeg + 0.7 * breath)
    const knee = along(toes, deg, BODY.shin)
    const hip = along(knee, deg, BODY.thigh)
    const neck = along(hip, deg, BODY.spine)
    const shoulder = along(hip, deg, BODY.spine - BODY.shoulderDrop)
    const head = along(neck, deg + lerp(8, 5, breath), BODY.neck)
    const elbow = ik(shoulder, wrist, BODY.upperArm, BODY.forearm, v(shoulder.x, 1.2))
    return sidePose(head, neck, { shoulder, elbow, wrist, hip, knee, ankle: toes })
  }),
}
