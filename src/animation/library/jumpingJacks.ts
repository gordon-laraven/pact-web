import type { Animation, Pose } from '../../types'
import { add, BODY, ik, lerp, sampleLoop, v } from '../rig'

// Front view, facing the viewer (the figure's left is on screen-right).
// Closed (arms down, feet together) -> hop -> open (arms overhead, feet wide)
// -> hop -> closed. Arms swing out through the sides in an arc.

const floor = 0.965
const legReach = BODY.thigh + BODY.shin - 0.005

export const jumpingJacks: Animation = {
  id: 'jumping-jacks',
  view: 'front',
  defaultTempoSec: 1.1,
  loop: sampleLoop(40, (t): Pose => {
    const p = (1 - Math.cos(2 * Math.PI * t)) / 2
    const hop = 0.032 * Math.abs(Math.sin(2 * Math.PI * t)) // airborne between positions
    const footOut = lerp(0.05, 0.17, p)
    const hipY = floor - hop - Math.sqrt(legReach ** 2 - (footOut - BODY.hipHalf) ** 2)
    const neck = v(0.5, hipY - BODY.spine)
    const head = v(0.5, neck.y - BODY.neck)
    const armDeg = lerp(14, 166, p) // measured from straight down, outward: a V overhead
    const foreDeg = armDeg + lerp(6, 3, p)

    const side = (sgn: 1 | -1) => {
      const hip = v(0.5 + sgn * BODY.hipHalf, hipY)
      const ankle = v(0.5 + sgn * footOut, floor - hop)
      const knee = ik(hip, ankle, BODY.thigh, BODY.shin, v(0.5 + sgn, hip.y + 0.2))
      const shoulder = v(0.5 + sgn * BODY.shoulderHalf, neck.y + BODY.shoulderDrop)
      const rad = (d: number) => (d * Math.PI) / 180
      const elbow = add(shoulder, v(sgn * Math.sin(rad(armDeg)) * BODY.upperArm, Math.cos(rad(armDeg)) * BODY.upperArm))
      const wrist = add(elbow, v(sgn * Math.sin(rad(foreDeg)) * BODY.forearm, Math.cos(rad(foreDeg)) * BODY.forearm))
      return { hip, knee, ankle, shoulder, elbow, wrist }
    }
    const l = side(1)
    const r = side(-1)
    return {
      head,
      neck,
      lShoulder: l.shoulder,
      lElbow: l.elbow,
      lWrist: l.wrist,
      lHip: l.hip,
      lKnee: l.knee,
      lAnkle: l.ankle,
      rShoulder: r.shoulder,
      rElbow: r.elbow,
      rWrist: r.wrist,
      rHip: r.hip,
      rKnee: r.knee,
      rAnkle: r.ankle,
    }
  }),
}
