import { describe, expect, it } from 'vitest'
import {
  createFilterGestureState,
  FILTER_GESTURE_CALIBRATION_MS,
  FILTER_GESTURE_RELEASE_MS,
  filterValueFromGesture,
  shortestAngleDelta,
  transitionFilterGesture,
  type FilterGestureEvent,
  type FilterGestureState,
} from './gestureController'

function runTrace(events: FilterGestureEvent[]) {
  let state: FilterGestureState = createFilterGestureState()
  return events.map((event) => {
    const transition = transitionFilterGesture(state, event)
    state = transition.state
    return transition
  })
}

const degrees = (value: number) => (value * Math.PI) / 180

describe('filter gesture controller', () => {
  it('calibrates through jitter, restarts on movement, then tracks only deliberate rotation', () => {
    const trace = runTrace([
      { type: 'sample', deck: 'a', angle: 0, currentValue: 50, now: 0 },
      { type: 'sample', deck: 'a', angle: degrees(4), currentValue: 50, now: 100 },
      { type: 'sample', deck: 'a', angle: degrees(20), currentValue: 50, now: 200 },
      {
        type: 'sample',
        deck: 'a',
        angle: degrees(20),
        currentValue: 50,
        now: 200 + FILTER_GESTURE_CALIBRATION_MS - 1,
      },
      {
        type: 'sample',
        deck: 'a',
        angle: degrees(20),
        currentValue: 50,
        now: 200 + FILTER_GESTURE_CALIBRATION_MS,
      },
      { type: 'sample', deck: 'a', angle: degrees(25), currentValue: 50, now: 700 },
      { type: 'sample', deck: 'a', angle: degrees(57), currentValue: 50, now: 780 },
    ])

    expect(trace.map(({ feedback }) => feedback)).toEqual([
      'calibration-started',
      'calibrating',
      'calibration-restarted',
      'calibrating',
      'armed',
      'armed',
      'tracking',
    ])
    expect(trace.slice(0, 6).every(({ target }) => target === undefined)).toBe(true)
    expect(trace[6].target).toBeCloseTo(75)
  })

  it('preserves a non-neutral pickup until deliberate wrist rotation', () => {
    const trace = runTrace([
      { type: 'sample', deck: 'a', angle: degrees(90), currentValue: 82, now: 0 },
      { type: 'sample', deck: 'a', angle: degrees(94), currentValue: 82, now: 100 },
      {
        type: 'sample',
        deck: 'a',
        angle: degrees(92),
        currentValue: 82,
        now: FILTER_GESTURE_CALIBRATION_MS,
      },
      { type: 'sample', deck: 'a', angle: degrees(98), currentValue: 82, now: 500 },
      { type: 'sample', deck: 'a', angle: degrees(55), currentValue: 82, now: 580 },
    ])

    expect(trace.map(({ feedback }) => feedback)).toEqual([
      'calibration-started',
      'calibrating',
      'armed',
      'armed',
      'tracking',
    ])
    expect(trace.slice(0, 4).every(({ target }) => target === undefined)).toBe(true)
    expect(trace[2].state).toMatchObject({ phase: 'armed', baselineValue: 82 })
    expect(trace[4].target).toBeCloseTo(57)
  })

  it('invalidates pickup on loss and forces fresh calibration during the neutral grace window', () => {
    const trace = runTrace([
      { type: 'sample', deck: 'a', angle: 0, currentValue: 50, now: 0 },
      {
        type: 'sample',
        deck: 'a',
        angle: 0,
        currentValue: 50,
        now: FILTER_GESTURE_CALIBRATION_MS,
      },
      { type: 'sample', deck: 'a', angle: degrees(37), currentValue: 50, now: 500 },
      { type: 'lost', now: 600 },
      { type: 'sample', deck: 'a', angle: degrees(-45), currentValue: 57, now: 750 },
      { type: 'release-timeout', now: 600 + FILTER_GESTURE_RELEASE_MS },
      {
        type: 'sample',
        deck: 'a',
        angle: degrees(-45),
        currentValue: 57,
        now: 750 + FILTER_GESTURE_CALIBRATION_MS,
      },
    ])

    expect(trace[2].feedback).toBe('tracking')
    expect(trace[3]).toMatchObject({
      command: 'schedule-neutral',
      state: { phase: 'release-grace', releaseAt: 600 + FILTER_GESTURE_RELEASE_MS },
    })
    expect('baselineAngle' in trace[3].state).toBe(false)
    expect(trace[4]).toMatchObject({
      command: 'cancel-neutral',
      feedback: 'calibration-started',
      state: {
        phase: 'calibrating',
        baselineAngle: degrees(-45),
        baselineValue: 57,
        startedAt: 750,
      },
    })
    expect(trace[4].target).toBeUndefined()
    expect(trace[5]).toMatchObject({ command: 'none', state: { phase: 'calibrating' } })
    expect(trace[6]).toMatchObject({ command: 'none', feedback: 'armed' })
    expect(trace[6].target).toBeUndefined()
  })

  it('returns to neutral after the grace period only when the hand stays absent', () => {
    const trace = runTrace([
      { type: 'sample', deck: 'b', angle: 0.4, currentValue: 68, now: 0 },
      { type: 'lost', now: 100 },
      { type: 'release-timeout', now: 100 + FILTER_GESTURE_RELEASE_MS - 1 },
      { type: 'release-timeout', now: 100 + FILTER_GESTURE_RELEASE_MS },
    ])

    expect(trace[1]).toMatchObject({
      command: 'schedule-neutral',
      state: { phase: 'release-grace' },
    })
    expect(trace[2]).toMatchObject({ command: 'none', state: { phase: 'release-grace' } })
    expect(trace[3]).toMatchObject({
      command: 'reset-neutral',
      feedback: 'released',
      deck: 'b',
      state: { phase: 'idle' },
    })
  })

  it('keeps one release deadline when loss frames repeat', () => {
    const releaseAt = 100 + FILTER_GESTURE_RELEASE_MS
    const trace = runTrace([
      { type: 'sample', deck: 'b', angle: 0.4, currentValue: 68, now: 0 },
      { type: 'lost', now: 100 },
      { type: 'lost', now: 150 },
      { type: 'lost', now: 250 },
      { type: 'release-timeout', now: releaseAt - 1 },
      { type: 'release-timeout', now: releaseAt },
    ])

    expect(trace[1]).toMatchObject({
      command: 'schedule-neutral',
      state: { phase: 'release-grace', releaseAt },
    })
    expect(trace.slice(2, 5).every(({ command }) => command === 'none')).toBe(true)
    expect(trace.slice(2, 5).every(({ state }) => (
      state.phase === 'release-grace' && state.releaseAt === releaseAt
    ))).toBe(true)
    expect(trace[5]).toMatchObject({
      command: 'reset-neutral',
      deck: 'b',
      state: { phase: 'idle' },
    })
  })

  it('lets the deadline win when a hand sample runs before a delayed release callback', () => {
    const trace = runTrace([
      { type: 'sample', deck: 'a', angle: 0, currentValue: 72, now: 0 },
      { type: 'lost', now: 100 },
      {
        type: 'sample',
        deck: 'a',
        angle: degrees(-40),
        currentValue: 72,
        now: 100 + FILTER_GESTURE_RELEASE_MS,
      },
      {
        type: 'sample',
        deck: 'a',
        angle: degrees(-40),
        currentValue: 50,
        now: 100 + FILTER_GESTURE_RELEASE_MS + 70,
      },
    ])

    expect(trace[2]).toMatchObject({
      command: 'reset-neutral',
      feedback: 'released',
      deck: 'a',
      state: { phase: 'idle' },
    })
    expect(trace[2].target).toBeUndefined()
    expect(trace[3]).toMatchObject({
      command: 'none',
      feedback: 'calibration-started',
      state: {
        phase: 'calibrating',
        baselineAngle: degrees(-40),
        baselineValue: 50,
      },
    })
    expect(trace[3].target).toBeUndefined()
  })

  it('keeps filter math stable around wraparound and the center dead zone', () => {
    expect(shortestAngleDelta(-Math.PI + 0.05, Math.PI - 0.05)).toBeCloseTo(0.1)
    expect(filterValueFromGesture(50, 0.4, 0.4 + degrees(5))).toBe(50)
    expect(filterValueFromGesture(50, 0.4, 0.4 + degrees(37))).toBe(75)
    expect(filterValueFromGesture(50, 0.4, 0.4 - degrees(67))).toBe(0)
  })
})
