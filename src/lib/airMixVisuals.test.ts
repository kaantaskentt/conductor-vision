import { describe, expect, it } from 'vitest'
import { airMixWaveformOpacities } from './airMixVisuals'

describe('Air Mix waveform cue', () => {
  it('follows the full -100 to +100 equal-power crossfader range', () => {
    expect(airMixWaveformOpacities(-100)).toEqual({ a: 1, b: 0.35 })
    expect(airMixWaveformOpacities(0).a).toBeCloseTo(
      0.35 + Math.SQRT1_2 * 0.65,
      8,
    )
    expect(airMixWaveformOpacities(0).b).toBeCloseTo(
      0.35 + Math.SQRT1_2 * 0.65,
      8,
    )
    expect(airMixWaveformOpacities(100).a).toBeCloseTo(0.35, 8)
    expect(airMixWaveformOpacities(100).b).toBe(1)
  })
})
