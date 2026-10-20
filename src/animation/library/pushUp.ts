import type { Animation } from '../../types'
import { along, BODY, FLOOR, ik, lerp, len, sampleLoop, sidePose, sub, v, wave } from '../rig'

// Side view, head to the right. A rigid plank pivots on the toes. At the top
// the arms are straight with the shoulders just ahead of the wrists; at the
// bottom the forearms are near vertical, the elbows track back toward the feet
// at shoulder height, and the chest is just above the floor. Hands and toes
// stay planted.

const toes = v(0.16, 0.885)
const anklesToShoulder = BODY.shin + BODY.thigh + BODY.spine - BODY.shoulderDrop
const deg = (r: number) => (r * 180) / Math.PI
const shoulderAt = (bodyDeg: number) => along(toes, -bodyDeg, anklesToShoulder)

// Bottom: shoulders ~0.1 off the floor, lower than the forearm is long, so
// the elbows rise above the line of the back (the classic side view).
const bottomDeg = deg(Math.asin((toes.y - 0.8) / anklesToShoulder))
const hand = v(shoulderAt(bottomDeg).x - 0.1, FLOOR)

// Top: the body angle at which the arm is (almost) fully straight.
const reach = BODY.upperArm + BODY.forearm - 0.003
let lo = bottomDeg
let hi = 45
for (let i = 0; i < 40; i++) {
  const mid = (lo + hi) / 2
  if (len(sub(shoulderAt(mid), hand)) < reach) lo = mid
  else hi = mid
}
const topDeg = lo

export const pushUp: Animation = {
  id: 'push-up',
  view: 'side',
  defaultTempoSec: 2.4,
  loop: sampleLoop(16, (t) => {
    const a = -lerp(topDeg, bottomDeg, wave(t))
    const knee = along(toes, a, BODY.shin)
    const hip = along(knee, a, BODY.thigh)
    const neck = along(hip, a, BODY.spine)
    const shoulder = along(hip, a, BODY.spine - BODY.shoulderDrop)
    const head = along(neck, a + 6, BODY.neck)
    const elbow = ik(shoulder, hand, BODY.upperArm, BODY.forearm, v(shoulder.x - 1, shoulder.y - 0.6))
    return sidePose(head, neck, { shoulder, elbow, wrist: hand, hip, knee, ankle: toes })
  }),
}
