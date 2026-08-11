import { describe, expect, it } from 'vitest'
import {
  AIR_TARGET_DWELL_MS,
  airTargetAt,
  createAirDwellState,
  transitionAirDwell,
  visibleAirX,
} from './airTarget'

describe('air performance targets', () => {
  it('maps the six large camera zones without stealing the center performance area', () => {
    expect(airTargetAt(0.1, 0.25)).toBe('cue-a')
    expect(airTargetAt(0.1, 0.65)).toBe('play-a')
    expect(airTargetAt(0.9, 0.25)).toBe('cue-b')
    expect(airTargetAt(0.9, 0.65)).toBe('play-b')
    expect(airTargetAt(0.4, 0.8)).toBe('volume')
    expect(airTargetAt(0.6, 0.8)).toBe('filter')
    expect(airTargetAt(0.5, 0.45)).toBeNull()
  })

  it('mirrors camera coordinates before mapping the performer-facing targets', () => {
    expect(visibleAirX(0.9)).toBeCloseTo(0.1)
    expect(airTargetAt(visibleAirX(0.9), 0.25)).toBe('cue-a')
    expect(airTargetAt(visibleAirX(0.1), 0.25)).toBe('cue-b')
  })

  it('requires a steady dwell, fires once, and rearms only after leaving', () => {
    const first = transitionAirDwell(createAirDwellState(), {
      enabled: true,
      target: 'play-a',
      now: 100,
    })
    const waiting = transitionAirDwell(first.state, {
      enabled: true,
      target: 'play-a',
      now: 100 + AIR_TARGET_DWELL_MS - 1,
    })
    const fired = transitionAirDwell(waiting.state, {
      enabled: true,
      target: 'play-a',
      now: 100 + AIR_TARGET_DWELL_MS,
    })
    const held = transitionAirDwell(fired.state, {
      enabled: true,
      target: 'play-a',
      now: 100 + AIR_TARGET_DWELL_MS * 2,
    })
    const released = transitionAirDwell(held.state, {
      enabled: true,
      target: null,
      now: 100 + AIR_TARGET_DWELL_MS * 2 + 1,
    })

    expect(waiting.activate).toBeNull()
    expect(fired.activate).toBe('play-a')
    expect(held.activate).toBeNull()
    expect(released.state).toEqual(createAirDwellState())
  })

  it('cancels immediately when the performer stops pointing', () => {
    const aiming = transitionAirDwell(createAirDwellState(), {
      enabled: true,
      target: 'filter',
      now: 10,
    })
    const cancelled = transitionAirDwell(aiming.state, {
      enabled: false,
      target: 'filter',
      now: 400,
    })

    expect(cancelled.state).toEqual(createAirDwellState())
    expect(cancelled.activate).toBeNull()
  })
})
