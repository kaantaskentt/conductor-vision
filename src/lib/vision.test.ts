import { describe, expect, it } from 'vitest'
import {
  analyzePixels,
  clamp,
  createEmptyAnalysis,
  rgbToHex,
  rgbToHsv,
  selectPrimaryHand,
  type HandSummary,
} from './vision'

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
    expect(second.pixelAnalysis.changeRegion).toBe('Change across frame')
  })

  it('reports the visible mirrored region without claiming a movement direction', () => {
    const previous = imageData(4, 2, Array.from({ length: 8 }, () => [0, 0, 0, 255]).flat())
    const changedOnRight = imageData(4, 2, [
      0, 0, 0, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ])

    const baseline = analyzePixels(previous, null, 'purple')
    const result = analyzePixels(changedOnRight, baseline.gray, 'purple')

    expect(result.pixelAnalysis.changeRegion).toBe('Change concentrated left')
    expect(result.pixelAnalysis.changeRegion).not.toContain('Moving')
  })

  it('distinguishes a localized center change from a frame-wide change', () => {
    const black = Array.from({ length: 25 }, () => [0, 0, 0, 255]).flat()
    const centered = [...black]
    centered.splice(12 * 4, 4, 255, 255, 255, 255)
    const baseline = analyzePixels(imageData(5, 5, black), null, 'purple')
    const result = analyzePixels(imageData(5, 5, centered), baseline.gray, 'purple')

    expect(result.pixelAnalysis.changeRegion).toBe('Change near center')
  })

  it('creates a complete, stable idle state', () => {
    const state = createEmptyAnalysis('cyan')
    expect(state.targetHex).toBe('#2dbedc')
    expect(state.motionHistory).toHaveLength(40)
    expect(state.hands).toEqual([])
    expect(state.changeRegion).toBe('Frame stable')
  })

  it('keeps control on the nearest hand when detector ordering changes', () => {
    const hand = (label: string, x: number, y: number): HandSummary => ({
      id: `${label}-${x}`,
      label,
      x,
      y,
      count: 5,
      wristAngle: 0,
      raised: { thumb: true, index: true, middle: true, ring: true, pinky: true },
    })
    const previous = hand('Right', 0.2, 0.4)
    const reordered = [hand('Left', 0.22, 0.4), hand('Right', 0.25, 0.42)]

    expect(selectPrimaryHand(reordered, previous)?.label).toBe('Right')
    expect(selectPrimaryHand([], previous)).toBeNull()
    expect(selectPrimaryHand([hand('Left', 0.21, 0.4)], previous)).toBeNull()
    expect(selectPrimaryHand([hand('Right', 0.8, 0.9)], previous)).toBeNull()
  })
})
