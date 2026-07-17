import { describe, expect, it } from 'vitest'
import { analyzePixels, clamp, createEmptyAnalysis, rgbToHex, rgbToHsv } from './vision'

function imageData(width: number, height: number, pixels: number[]) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(pixels),
    colorSpace: 'srgb',
  } as ImageData
}

describe('vision utilities', () => {
  it('clamps values into the requested range', () => {
    expect(clamp(-2)).toBe(0)
    expect(clamp(0.45)).toBe(0.45)
    expect(clamp(4)).toBe(1)
    expect(clamp(4, 2, 8)).toBe(4)
  })

  it('formats RGB values safely', () => {
    expect(rgbToHex(255, 128, 0)).toBe('#ff8000')
    expect(rgbToHex(300, -10, 15.4)).toBe('#ff000f')
  })

  it('converts primary red to HSV', () => {
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 })
  })

  it('detects target color coverage and motion between frames', () => {
    const redFrame = imageData(2, 1, [230, 42, 45, 255, 230, 42, 45, 255])
    const first = analyzePixels(redFrame, null, 'red')
    expect(first.pixelAnalysis.targetCoverage).toBe(100)
    expect(first.pixelAnalysis.bestColorName).toBe('red')
    expect(first.pixelAnalysis.motionScore).toBe(0)

    const whiteFrame = imageData(2, 1, [255, 255, 255, 255, 255, 255, 255, 255])
    const second = analyzePixels(whiteFrame, first.gray, 'red')
    expect(second.pixelAnalysis.targetCoverage).toBe(0)
    expect(second.pixelAnalysis.motionChangedPercent).toBe(100)
    expect(second.pixelAnalysis.motionScore).toBe(100)
  })

  it('creates a complete, stable idle state', () => {
    const state = createEmptyAnalysis('cyan')
    expect(state.targetHex).toBe('#2dbedc')
    expect(state.motionHistory).toHaveLength(40)
    expect(state.hands).toEqual([])
  })
})
