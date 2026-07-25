import { describe, expect, it } from 'vitest'
import {
  createFilterGestureState,
  createGestureClutchState,
  FILTER_GESTURE_RELEASE_MS,
  filterValueFromGesture,
  GESTURE_CLUTCH_FIST_RELEASE_MS,
  GESTURE_CLUTCH_LOST_RELEASE_MS,
  rotaryValueFromVerticalDrag,
  shortestAngleDelta,
  transitionFilterGesture,
  transitionGestureClutch,
  type FilterGestureEvent,
  type FilterGestureState,
  type GestureClutchState,
} from './gestureController'

function runFilterTrace(events: FilterGestureEvent[]) {
  let state: FilterGestureState = createFilterGestureState()
  return events.map((event) => {
    const transition = transitionFilterGesture(state, event)
    state = transition.state
    return transition
  })
}

function runClutchTrace(
  events: Array<{ detected: boolean; openFingers: number; now: number }>,
) {
  let state: GestureClutchState = createGestureClutchState()
  return events.map((event) => {
    const transition = transitionGestureClutch(state, event)
    state = transition.state
    return transition
  })
}

const degrees = (value: number) => (value * Math.PI) / 180

describe('gesture clutch', () => {
  it('requires a clear open palm to grab, but holds through two-finger landmark flicker', () => {
    const trace = runClutchTrace([
      { detected: true, openFingers: 2, now: 0 },
      { detected: true, openFingers: 4, now: 20 },
      { detected: true, openFingers: 2, now: 90 },
      { detected: true, openFingers: 5, now: 160 },
    ])

    expect(trace.map(({ feedback }) => feedback)).toEqual([
      'locked',
      'grabbed',
      'held',
      'held',
    ])
    expect(trace.slice(1).every(({ state }) => state.phase === 'held')).toBe(true)
  })

  it('ignores one-frame fist noise and releases only after a deliberate closed fist', () => {
    const trace = runClutchTrace([
      { detected: true, openFingers: 5, now: 0 },
      { detected: true, openFingers: 1, now: 70 },
      { detected: true, openFingers: 3, now: 120 },
      { detected: true, openFingers: 0, now: 200 },
      { detected: true, openFingers: 0, now: 200 + GESTURE_CLUTCH_FIST_RELEASE_MS - 1 },
      { detected: true, openFingers: 0, now: 200 + GESTURE_CLUTCH_FIST_RELEASE_MS },
    ])

    expect(trace.map(({ feedback }) => feedback)).toEqual([
      'grabbed',
      'release-pending',
      'recovered',
      'release-pending',
      'release-pending',
      'released',
    ])
    expect(trace.at(-1)?.state).toEqual({ phase: 'locked' })
  })

  it('waits through a brief tracking gap and releases after sustained loss', () => {
    const trace = runClutchTrace([
      { detected: true, openFingers: 5, now: 0 },
      { detected: false, openFingers: 0, now: 70 },
      { detected: true, openFingers: 4, now: 120 },
      { detected: false, openFingers: 0, now: 200 },
      { detected: false, openFingers: 0, now: 200 + GESTURE_CLUTCH_LOST_RELEASE_MS },
    ])

    expect(trace.map(({ feedback }) => feedback)).toEqual([
      'grabbed',
      'release-pending',
      'recovered',
      'release-pending',
      'released',
    ])
  })
})

describe('filter gesture controller', () => {
  it('grabs at the existing value without a jump and tracks only deliberate rotation', () => {
    const trace = runFilterTrace([
      { type: 'sample', deck: 'a', angle: degrees(90), currentValue: 82, now: 0 },
      { type: 'sample', deck: 'a', angle: degrees(93), currentValue: 82, now: 70 },
      { type: 'sample', deck: 'a', angle: degrees(115), currentValue: 82, now: 140 },
    ])

    expect(trace.map(({ feedback }) => feedback)).toEqual(['grabbed', 'armed', 'tracking'])
    expect(trace[0]).toMatchObject({
      state: { phase: 'armed', baselineAngle: degrees(90), baselineValue: 82 },
    })
    expect(trace[0].target).toBeUndefined()
    expect(trace[1].target).toBeUndefined()
    expect(trace[2].target).toBeGreaterThan(82)
  })

  it('invalidates pickup on release and makes a returning hand grab from its current value', () => {
    const trace = runFilterTrace([
      { type: 'sample', deck: 'a', angle: 0, currentValue: 50, now: 0 },
      { type: 'sample', deck: 'a', angle: degrees(25), currentValue: 50, now: 70 },
      { type: 'lost', now: 100 },
      { type: 'sample', deck: 'a', angle: degrees(-45), currentValue: 72, now: 180 },
    ])

    expect(trace[1].feedback).toBe('tracking')
    expect(trace[2]).toMatchObject({
      command: 'schedule-neutral',
      state: { phase: 'release-grace', releaseAt: 100 + FILTER_GESTURE_RELEASE_MS },
    })
    expect(trace[3]).toMatchObject({
      command: 'cancel-neutral',
      feedback: 'grabbed',
      state: { phase: 'armed', baselineAngle: degrees(-45), baselineValue: 72 },
    })
    expect(trace[3].target).toBeUndefined()
  })

  it('returns to neutral after the grace period only when the hand stays absent', () => {
    const trace = runFilterTrace([
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
    const trace = runFilterTrace([
      { type: 'sample', deck: 'b', angle: 0.4, currentValue: 68, now: 0 },
      { type: 'lost', now: 100 },
      { type: 'lost', now: 150 },
      { type: 'lost', now: 200 },
      { type: 'release-timeout', now: releaseAt },
    ])

    expect(trace.slice(1, 4).every(({ state }) => (
      state.phase === 'release-grace' && state.releaseAt === releaseAt
    ))).toBe(true)
    expect(trace[4]).toMatchObject({ command: 'reset-neutral', deck: 'b' })
  })

  it('keeps filter math stable around wraparound and gives a useful wrist sweep', () => {
    expect(shortestAngleDelta(-Math.PI + 0.05, Math.PI - 0.05)).toBeCloseTo(0.1)
    expect(filterValueFromGesture(50, 0.4, 0.4 + degrees(3))).toBe(50)
    expect(filterValueFromGesture(50, 0.4, 0.4 + degrees(25))).toBe(75)
    expect(filterValueFromGesture(50, 0.4, 0.4 - degrees(46))).toBeCloseTo(0)
  })
})

describe('rotary pointer control', () => {
  it('does not jump on grab and changes only from relative vertical drag', () => {
    expect(rotaryValueFromVerticalDrag(82, 400, 400)).toBe(82)
    expect(rotaryValueFromVerticalDrag(82, 400, 425)).toBe(62)
    expect(rotaryValueFromVerticalDrag(50, 400, 350)).toBe(90)
  })

  it('supports fine adjustment and clamps at both end stops', () => {
    expect(rotaryValueFromVerticalDrag(50, 400, 380, true)).toBe(55)
    expect(rotaryValueFromVerticalDrag(95, 400, 200)).toBe(100)
    expect(rotaryValueFromVerticalDrag(5, 400, 600)).toBe(0)
  })
})
