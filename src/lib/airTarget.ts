import { clamp } from './vision'

export const AIR_TARGET_DWELL_MS = 650

export type AirTargetId =
  | 'cue-a'
  | 'play-a'
  | 'cue-b'
  | 'play-b'
  | 'volume'
  | 'filter'

export type AirDwellState = {
  target: AirTargetId | null
  startedAt: number
  progress: number
  fired: boolean
}

export function createAirDwellState(): AirDwellState {
  return { target: null, startedAt: 0, progress: 0, fired: false }
}

export function airTargetAt(x: number, y: number): AirTargetId | null {
  const px = clamp(x)
  const py = clamp(y)

  if (px <= 0.22 && py >= 0.16 && py < 0.48) return 'cue-a'
  if (px <= 0.22 && py >= 0.48 && py <= 0.82) return 'play-a'
  if (px >= 0.78 && py >= 0.16 && py < 0.48) return 'cue-b'
  if (px >= 0.78 && py >= 0.48 && py <= 0.82) return 'play-b'
  if (py >= 0.72 && px >= 0.32 && px < 0.5) return 'volume'
  if (py >= 0.72 && px >= 0.5 && px <= 0.68) return 'filter'
  return null
}

export function transitionAirDwell(
  state: AirDwellState,
  event: { enabled: boolean; target: AirTargetId | null; now: number },
) {
  if (!event.enabled || !event.target) {
    return { state: createAirDwellState(), activate: null as AirTargetId | null }
  }

  if (state.target !== event.target) {
    return {
      state: {
        target: event.target,
        startedAt: event.now,
        progress: 0,
        fired: false,
      },
      activate: null as AirTargetId | null,
    }
  }

  const progress = clamp((event.now - state.startedAt) / AIR_TARGET_DWELL_MS)
  const shouldActivate = progress >= 1 && !state.fired
  return {
    state: { ...state, progress, fired: state.fired || shouldActivate },
    activate: shouldActivate ? event.target : null,
  }
}
