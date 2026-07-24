import { clamp } from './vision'

export const FILTER_GESTURE_CALIBRATION_MS = 420
export const FILTER_GESTURE_RELEASE_MS = 300

const FILTER_GESTURE_DEAD_ZONE = (7 * Math.PI) / 180
const FILTER_GESTURE_SWEEP = (60 * Math.PI) / 180
const FILTER_CALIBRATION_TOLERANCE = (8 * Math.PI) / 180

type FilterDeckId = 'a' | 'b'

export type FilterGestureState =
  | { phase: 'idle' }
  | {
      phase: 'calibrating'
      deck: FilterDeckId
      baselineAngle: number
      baselineValue: number
      samples: number
      startedAt: number
    }
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
  | 'calibration-started'
  | 'calibration-restarted'
  | 'calibrating'
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

export function shortestAngleDelta(current: number, baseline: number) {
  return Math.atan2(Math.sin(current - baseline), Math.cos(current - baseline))
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

function beginCalibration(
  event: Extract<FilterGestureEvent, { type: 'sample' }>,
  command: FilterGestureCommand,
): FilterGestureTransition {
  return {
    state: {
      phase: 'calibrating',
      deck: event.deck,
      baselineAngle: event.angle,
      baselineValue: event.currentValue,
      samples: 1,
      startedAt: event.now,
    },
    command,
    feedback: 'calibration-started',
    deck: event.deck,
  }
}

function feedbackForState(state: FilterGestureState): FilterGestureFeedback {
  if (state.phase === 'idle') return 'idle'
  if (state.phase === 'calibrating') return 'calibrating'
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

  if (state.phase === 'idle') return beginCalibration(event, 'none')
  if (state.phase === 'release-grace') {
    if (event.now >= state.releaseAt) {
      return {
        state: createFilterGestureState(),
        command: 'reset-neutral',
        feedback: 'released',
        deck: state.deck,
      }
    }
    return beginCalibration(event, 'cancel-neutral')
  }
  if (state.deck !== event.deck) return beginCalibration(event, 'none')

  if (state.phase === 'calibrating') {
    const calibrationDelta = Math.abs(shortestAngleDelta(event.angle, state.baselineAngle))
    if (calibrationDelta > FILTER_CALIBRATION_TOLERANCE) {
      return {
        state: {
          phase: 'calibrating',
          deck: event.deck,
          baselineAngle: event.angle,
          baselineValue: event.currentValue,
          samples: 1,
          startedAt: event.now,
        },
        command: 'none',
        feedback: 'calibration-restarted',
        deck: event.deck,
      }
    }

    const samples = state.samples + 1
    const baselineAngle =
      state.baselineAngle + shortestAngleDelta(event.angle, state.baselineAngle) / samples
    if (event.now - state.startedAt < FILTER_GESTURE_CALIBRATION_MS) {
      return {
        state: { ...state, baselineAngle, samples },
        command: 'none',
        feedback: 'calibrating',
        deck: event.deck,
      }
    }

    return {
      state: {
        phase: 'armed',
        deck: state.deck,
        baselineAngle,
        baselineValue: state.baselineValue,
      },
      command: 'none',
      feedback: 'armed',
      deck: event.deck,
    }
  }

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
