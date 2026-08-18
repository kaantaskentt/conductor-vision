import { clamp } from './vision'

export const FILTER_GESTURE_RELEASE_MS = 220
export const GESTURE_CLUTCH_GRAB_FINGERS = 3
export const GESTURE_CLUTCH_RELEASE_FINGERS = 1
export const GESTURE_CLUTCH_FIST_RELEASE_MS = 120
export const GESTURE_CLUTCH_LOST_RELEASE_MS = 220

const FILTER_GESTURE_DEAD_ZONE = (4 * Math.PI) / 180
const FILTER_GESTURE_SWEEP = (42 * Math.PI) / 180

type FilterDeckId = 'a' | 'b'

export type FilterGestureState =
  | { phase: 'idle' }
  | {
      phase: 'armed'
      deck: FilterDeckId
      baselineAngle: number
      baselineValue: number
    }
  | {
      phase: 'release-grace'
      deck: FilterDeckId
      releaseAt: number
    }

export type FilterGestureEvent =
  | {
      type: 'sample'
      deck: FilterDeckId
      angle: number
      currentValue: number
      now: number
    }
  | { type: 'lost'; now: number }
  | { type: 'release-timeout'; now: number }

export type FilterGestureCommand =
  | 'none'
  | 'schedule-neutral'
  | 'cancel-neutral'
  | 'reset-neutral'

export type FilterGestureFeedback =
  | 'idle'
  | 'grabbed'
  | 'armed'
  | 'tracking'
  | 'lost'
  | 'released'

export type FilterGestureTransition = {
  state: FilterGestureState
  command: FilterGestureCommand
  feedback: FilterGestureFeedback
  deck?: FilterDeckId
  target?: number
}

export function createFilterGestureState(): FilterGestureState {
  return { phase: 'idle' }
}

export type GestureClutchState =
  | { phase: 'locked' }
  | { phase: 'held' }
  | {
      phase: 'release-pending'
      reason: 'fist' | 'lost'
      releaseAt: number
    }

export type GestureClutchTransition = {
  state: GestureClutchState
  feedback: 'locked' | 'grabbed' | 'held' | 'release-pending' | 'recovered' | 'released'
  releaseReason?: 'fist' | 'lost'
}

export function createGestureClutchState(): GestureClutchState {
  return { phase: 'locked' }
}

export function transitionGestureClutch(
  state: GestureClutchState,
  event: { detected: boolean; openFingers: number; now: number },
): GestureClutchTransition {
  if (state.phase === 'locked') {
    if (event.detected && event.openFingers >= GESTURE_CLUTCH_GRAB_FINGERS) {
      return { state: { phase: 'held' }, feedback: 'grabbed' }
    }
    return { state, feedback: 'locked' }
  }

  if (state.phase === 'release-pending' && event.now >= state.releaseAt) {
    return {
      state: createGestureClutchState(),
      feedback: 'released',
      releaseReason: state.reason,
    }
  }

  if (event.detected && event.openFingers > GESTURE_CLUTCH_RELEASE_FINGERS) {
    return {
      state: { phase: 'held' },
      feedback: state.phase === 'release-pending' ? 'recovered' : 'held',
    }
  }

  const reason = event.detected ? 'fist' : 'lost'
  const releaseDelay =
    reason === 'fist' ? GESTURE_CLUTCH_FIST_RELEASE_MS : GESTURE_CLUTCH_LOST_RELEASE_MS

  if (state.phase !== 'release-pending' || state.reason !== reason) {
    return {
      state: { phase: 'release-pending', reason, releaseAt: event.now + releaseDelay },
      feedback: 'release-pending',
      releaseReason: reason,
    }
  }

  return { state, feedback: 'release-pending', releaseReason: reason }
}

export function shortestAngleDelta(current: number, baseline: number) {
  return Math.atan2(Math.sin(current - baseline), Math.cos(current - baseline))
}

export function rotaryValueFromVerticalDrag(
  startValue: number,
  startY: number,
  currentY: number,
  fine = false,
) {
  const unitsPerPixel = fine ? 0.25 : 0.8
  return Math.round(clamp(startValue + (startY - currentY) * unitsPerPixel, 0, 100))
}

export function filterValueFromGesture(
  baselineValue: number,
  baselineAngle: number,
  currentAngle: number,
) {
  const delta = shortestAngleDelta(currentAngle, baselineAngle)
  const adjusted = Math.sign(delta) * Math.max(0, Math.abs(delta) - FILTER_GESTURE_DEAD_ZONE)
  return clamp(baselineValue + (adjusted / FILTER_GESTURE_SWEEP) * 50, 0, 100)
}

function beginPickup(
  event: Extract<FilterGestureEvent, { type: 'sample' }>,
  command: FilterGestureCommand,
): FilterGestureTransition {
  return {
    state: {
      phase: 'armed',
      deck: event.deck,
      baselineAngle: event.angle,
      baselineValue: event.currentValue,
    },
    command,
    feedback: 'grabbed',
    deck: event.deck,
  }
}

function feedbackForState(state: FilterGestureState): FilterGestureFeedback {
  if (state.phase === 'idle') return 'idle'
  if (state.phase === 'armed') return 'armed'
  return 'lost'
}

export function transitionFilterGesture(
  state: FilterGestureState,
  event: FilterGestureEvent,
): FilterGestureTransition {
  if (event.type === 'lost') {
    if (state.phase === 'idle' || state.phase === 'release-grace') {
      return { state, command: 'none', feedback: state.phase === 'idle' ? 'idle' : 'lost' }
    }
    const releaseAt = event.now + FILTER_GESTURE_RELEASE_MS
    return {
      state: { phase: 'release-grace', deck: state.deck, releaseAt },
      command: 'schedule-neutral',
      feedback: 'lost',
      deck: state.deck,
    }
  }

  if (event.type === 'release-timeout') {
    if (state.phase !== 'release-grace' || event.now < state.releaseAt) {
      return { state, command: 'none', feedback: feedbackForState(state) }
    }
    return {
      state: createFilterGestureState(),
      command: 'reset-neutral',
      feedback: 'released',
      deck: state.deck,
    }
  }

  if (state.phase === 'idle') return beginPickup(event, 'none')
  if (state.phase === 'release-grace') {
    if (event.now >= state.releaseAt) {
      return {
        state: createFilterGestureState(),
        command: 'reset-neutral',
        feedback: 'released',
        deck: state.deck,
      }
    }
    return beginPickup(event, 'cancel-neutral')
  }
  if (state.deck !== event.deck) return beginPickup(event, 'none')

  const angleDelta = Math.abs(shortestAngleDelta(event.angle, state.baselineAngle))
  if (angleDelta <= FILTER_GESTURE_DEAD_ZONE) {
    return { state, command: 'none', feedback: 'armed', deck: event.deck }
  }
  return {
    state,
    command: 'none',
    feedback: 'tracking',
    deck: event.deck,
    target: filterValueFromGesture(state.baselineValue, state.baselineAngle, event.angle),
  }
}
