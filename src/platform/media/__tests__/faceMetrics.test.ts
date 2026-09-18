import { describe, expect, it } from 'vitest'
import { facesSeat, headAngles, lookingAtCamera, lookingAtScreen } from '../faceMetrics'

/** Column-major 4×4 matrix for a head turned `yaw` degrees around the vertical axis. */
function yawMatrix(yawDegrees: number): number[] {
  const a = (yawDegrees * Math.PI) / 180
  // Rotation about Y: [[cos, 0, sin], [0, 1, 0], [-sin, 0, cos]], stored column by column.
  return [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]
}

function pitchMatrix(pitchDegrees: number): number[] {
  const a = (pitchDegrees * Math.PI) / 180
  // Rotation about X: [[1, 0, 0], [0, cos, -sin], [0, sin, cos]].
  return [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]
}

describe('headAngles', () => {
  it('reads yaw and pitch from the face transformation matrix', () => {
    expect(headAngles(yawMatrix(0))).toEqual({ yaw: 0, pitch: 0 })
    expect(headAngles(yawMatrix(30)).yaw).toBeCloseTo(30, 5)
    expect(headAngles(pitchMatrix(-20)).pitch).toBeCloseTo(-20, 5)
  })
})

describe('lookingAtCamera', () => {
  it('counts a face turned toward the camera with eyes forward', () => {
    expect(lookingAtCamera({ yaw: 5, pitch: -4 }, { eyeLookOutLeft: 0.1 })).toBe(true)
  })

  it('does not count a turned head or eyes looking away', () => {
    expect(lookingAtCamera({ yaw: 25, pitch: 0 }, {})).toBe(false)
    expect(lookingAtCamera({ yaw: 0, pitch: 0 }, { eyeLookDownLeft: 0.8 })).toBe(false)
  })
})

describe('in person', () => {
  it('counts looking anywhere on the screen, eyes lowered included, as looking at the interviewers', () => {
    expect(lookingAtScreen({ yaw: 5, pitch: 20 }, { eyeLookDownLeft: 0.8, eyeLookDownRight: 0.8 })).toBe(true)
    expect(lookingAtCamera({ yaw: 5, pitch: 20 }, { eyeLookDownLeft: 0.8 })).toBe(false)
    expect(lookingAtScreen({ yaw: 35, pitch: 0 }, {})).toBe(false)
    expect(lookingAtScreen({ yaw: 0, pitch: 0 }, { eyeLookOutLeft: 0.9 })).toBe(false)
  })

  it('knows which seat the head is turned toward', () => {
    expect(facesSeat(2, 0)).toBe(true)
    expect(facesSeat(15, 0)).toBe(false)
    expect(facesSeat(15, -1)).toBe(true)
    expect(facesSeat(-15, -1)).toBe(false)
    expect(facesSeat(-15, 1)).toBe(true)
    expect(facesSeat(3, 1)).toBe(false)
  })
})
