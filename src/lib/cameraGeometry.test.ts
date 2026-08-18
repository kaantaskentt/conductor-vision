import { describe, expect, it } from 'vitest'
import { airTargetAt } from './airTarget'
import { mapCameraPointToStage } from './cameraGeometry'

describe('camera cover geometry', () => {
  it('maps vertical cover cropping and the DJ camera object position into stage space', () => {
    const geometry = {
      sourceWidth: 1280,
      sourceHeight: 720,
      stageWidth: 1160,
      stageHeight: 500,
      objectPositionX: 0.5,
      objectPositionY: 0.42,
    }

    expect(mapCameraPointToStage(0.5, 0.5, geometry)).toEqual({
      x: 0.5,
      y: expect.closeTo(0.5244, 5),
      visible: true,
    })
    expect(mapCameraPointToStage(0.5, 0.05, geometry).visible).toBe(false)
  })

  it('maps horizontal cover cropping on a narrow stage', () => {
    const geometry = {
      sourceWidth: 1280,
      sourceHeight: 720,
      stageWidth: 390,
      stageHeight: 330,
      objectPositionX: 0.5,
      objectPositionY: 0.42,
    }

    expect(mapCameraPointToStage(0.2, 0.5, geometry)).toEqual({
      x: expect.closeTo(0.04872, 5),
      y: 0.5,
      visible: true,
    })
    expect(mapCameraPointToStage(0.1, 0.5, geometry).visible).toBe(false)
  })

  it('puts cover-mapped points in the same coordinate space as dwell targets', () => {
    const geometry = {
      sourceWidth: 1280,
      sourceHeight: 720,
      stageWidth: 390,
      stageHeight: 330,
      objectPositionX: 0.5,
      objectPositionY: 0.42,
    }
    const pointer = mapCameraPointToStage(0.27, 0.3, geometry)

    expect(airTargetAt(0.27, 0.3, 'left')).toBeNull()
    expect(pointer.visible).toBe(true)
    expect(airTargetAt(pointer.x, pointer.y, 'left')).toBe('cue-a')
  })

  it('preserves display-oriented mirrored x coordinates instead of flipping twice', () => {
    const geometry = {
      sourceWidth: 1280,
      sourceHeight: 720,
      stageWidth: 390,
      stageHeight: 330,
      objectPositionX: 0.5,
      objectPositionY: 0.42,
    }

    const left = mapCameraPointToStage(0.2, 0.5, geometry)
    const right = mapCameraPointToStage(0.8, 0.5, geometry)

    expect(left.x).toBeLessThan(0.5)
    expect(right.x).toBeGreaterThan(0.5)
    expect(left.x + right.x).toBeCloseTo(1)
  })

  it('marks an unmeasured stage as unavailable', () => {
    expect(mapCameraPointToStage(0.5, 0.5, {
      sourceWidth: 0,
      sourceHeight: 0,
      stageWidth: 0,
      stageHeight: 0,
      objectPositionX: 0.5,
      objectPositionY: 0.42,
    })).toEqual({ x: 0.5, y: 0.5, visible: false })
  })
})
