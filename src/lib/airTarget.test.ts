import { describe, expect, it } from 'vitest'
import {
  AIR_TARGET_DWELL_MS,
  airTargetAt,
  airTargetAtBounds,
  createAirDwellState,
  transitionAirDwell,
} from './airTarget'

describe('air performance targets', () => {
  const mobileBounds = {
    'cue-a': { left: 0.02, top: 0.16, right: 0.22, bottom: 0.44 },
    'play-a': { left: 0.02, top: 0.46, right: 0.22, bottom: 0.74 },
    'cue-b': { left: 0.78, top: 0.16, right: 0.98, bottom: 0.44 },
    'play-b': { left: 0.78, top: 0.46, right: 0.98, bottom: 0.74 },
    'volume-a': { left: 0.19, top: 0.79, right: 0.337, bottom: 0.97 },
    'filter-a': { left: 0.347, top: 0.79, right: 0.494, bottom: 0.97 },
    'volume-b': { left: 0.506, top: 0.79, right: 0.653, bottom: 0.97 },
    'filter-b': { left: 0.663, top: 0.79, right: 0.81, bottom: 0.97 },
  } as const

  it('maps the six large camera zones without stealing the center performance area', () => {
    expect(airTargetAt(0.1, 0.25)).toBe('cue-a')
    expect(airTargetAt(0.1, 0.65)).toBe('play-a')
    expect(airTargetAt(0.9, 0.25)).toBe('cue-b')
    expect(airTargetAt(0.9, 0.65)).toBe('play-b')
    expect(airTargetAt(0.4, 0.8)).toBe('volume')
    expect(airTargetAt(0.6, 0.8)).toBe('filter')
    expect(airTargetAt(0.5, 0.45)).toBeNull()
  })

  it('restricts each hand to its own deck transport and control targets', () => {
    expect(airTargetAt(0.1, 0.25, 'left')).toBe('cue-a')
    expect(airTargetAt(0.9, 0.25, 'left')).toBeNull()
    expect(airTargetAt(0.32, 0.8, 'left')).toBe('volume-a')
    expect(airTargetAt(0.44, 0.8, 'left')).toBe('filter-a')
    expect(airTargetAt(0.1, 0.25, 'right')).toBeNull()
    expect(airTargetAt(0.9, 0.25, 'right')).toBe('cue-b')
    expect(airTargetAt(0.56, 0.8, 'right')).toBe('volume-b')
    expect(airTargetAt(0.68, 0.8, 'right')).toBe('filter-b')
  })

  it('uses measured mobile rectangles where the fixed desktop zones diverge', () => {
    expect(airTargetAtBounds(0.36, 0.86, mobileBounds, 'left')).toBe('filter-a')
    expect(airTargetAtBounds(0.64, 0.86, mobileBounds, 'right')).toBe('volume-b')
  })

  it('includes the outer portions of measured mobile control buttons', () => {
    expect(airTargetAtBounds(0.2, 0.86, mobileBounds, 'left')).toBe('volume-a')
    expect(airTargetAtBounds(0.8, 0.86, mobileBounds, 'right')).toBe('filter-b')
    expect(airTargetAtBounds(0.19, 0.79, mobileBounds, 'left')).toBe('volume-a')
    expect(airTargetAtBounds(0.81, 0.97, mobileBounds, 'right')).toBe('filter-b')
  })

  it('preserves deck ownership when measured bounds are queried by the other hand', () => {
    expect(airTargetAtBounds(0.36, 0.86, mobileBounds, 'right')).toBeNull()
    expect(airTargetAtBounds(0.64, 0.86, mobileBounds, 'left')).toBeNull()
    expect(airTargetAtBounds(0.1, 0.3, mobileBounds, 'right')).toBeNull()
    expect(airTargetAtBounds(0.9, 0.3, mobileBounds, 'left')).toBeNull()
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

  it('restarts dwell when the fingertip moves too far inside one large target', () => {
    const aiming = transitionAirDwell(createAirDwellState(), {
      enabled: true,
      target: 'play-a',
      now: 10,
      x: 0.1,
      y: 0.55,
    })
    const moved = transitionAirDwell(aiming.state, {
      enabled: true,
      target: 'play-a',
      now: 500,
      x: 0.18,
      y: 0.7,
    })
    const tooSoon = transitionAirDwell(moved.state, {
      enabled: true,
      target: 'play-a',
      now: 500 + AIR_TARGET_DWELL_MS - 1,
      x: 0.18,
      y: 0.7,
    })

    expect(moved.state.progress).toBe(0)
    expect(moved.state.startedAt).toBe(500)
    expect(tooSoon.activate).toBeNull()
  })
})
