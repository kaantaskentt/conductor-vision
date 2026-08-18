import { clamp } from './vision'

export const AIR_TARGET_DWELL_MS = 650
export const AIR_TARGET_MAX_DRIFT = 0.055

export type AirHandSlot = 'left' | 'right'

export type AirTargetId =
  | 'cue-a'
  | 'play-a'
  | 'cue-b'
  | 'play-b'
  | 'volume'
  | 'filter'
  | 'volume-a'
  | 'filter-a'
  | 'volume-b'
  | 'filter-b'

export type AirTargetRect = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

export type AirTargetBounds = Readonly<
  Partial<Record<AirTargetId, AirTargetRect>>
>

const AIR_TARGET_IDS: readonly AirTargetId[] = [
  'cue-a',
  'play-a',
  'cue-b',
  'play-b',
  'volume',
  'filter',
  'volume-a',
  'filter-a',
  'volume-b',
  'filter-b',
]

const SLOT_TARGETS: Readonly<Record<AirHandSlot, ReadonlySet<AirTargetId>>> = {
  left: new Set(['cue-a', 'play-a', 'volume-a', 'filter-a']),
  right: new Set(['cue-b', 'play-b', 'volume-b', 'filter-b']),
}

export type AirDwellState = {
  target: AirTargetId | null
  startedAt: number
  progress: number
  fired: boolean
  originX: number | null
  originY: number | null
}

export function createAirDwellState(): AirDwellState {
  return {
    target: null,
    startedAt: 0,
    progress: 0,
    fired: false,
    originX: null,
    originY: null,
  }
}

export function airTargetAt(
  x: number,
  y: number,
  slot?: AirHandSlot,
): AirTargetId | null {
  const px = clamp(x)
  const py = clamp(y)

  if (slot !== 'right' && px <= 0.22 && py >= 0.16 && py < 0.48) return 'cue-a'
  if (slot !== 'right' && px <= 0.22 && py >= 0.48 && py <= 0.82) return 'play-a'
  if (slot !== 'left' && px >= 0.78 && py >= 0.16 && py < 0.48) return 'cue-b'
  if (slot !== 'left' && px >= 0.78 && py >= 0.48 && py <= 0.82) return 'play-b'
  if (slot === 'left' && py >= 0.72 && px >= 0.26 && px < 0.38) return 'volume-a'
  if (slot === 'left' && py >= 0.72 && px >= 0.38 && px <= 0.5) return 'filter-a'
  if (slot === 'right' && py >= 0.72 && px >= 0.5 && px < 0.62) return 'volume-b'
  if (slot === 'right' && py >= 0.72 && px >= 0.62 && px <= 0.74) return 'filter-b'
  if (py >= 0.72 && px >= 0.32 && px < 0.5) return 'volume'
  if (py >= 0.72 && px >= 0.5 && px <= 0.68) return 'filter'
  return null
}

export function airTargetAtBounds(
  x: number,
  y: number,
  bounds: AirTargetBounds,
  slot?: AirHandSlot,
): AirTargetId | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null

  let match: { target: AirTargetId; area: number } | null = null
  for (const target of AIR_TARGET_IDS) {
    if (slot && !SLOT_TARGETS[slot].has(target)) continue
    const rect = bounds[target]
    if (
      !rect ||
      x < rect.left || x > rect.right ||
      y < rect.top || y > rect.bottom
    ) {
      continue
    }

    const area = Math.max(0, rect.right - rect.left) *
      Math.max(0, rect.bottom - rect.top)
    if (!match || area < match.area) match = { target, area }
  }

  return match?.target ?? null
}

export function transitionAirDwell(
  state: AirDwellState,
  event: {
    enabled: boolean
    target: AirTargetId | null
    now: number
    x?: number
    y?: number
  },
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
        originX: event.x ?? null,
        originY: event.y ?? null,
      },
      activate: null as AirTargetId | null,
    }
  }

  const drift =
    state.originX === null ||
    state.originY === null ||
    event.x === undefined ||
    event.y === undefined
      ? 0
      : Math.hypot(event.x - state.originX, event.y - state.originY)
  if (!state.fired && drift > AIR_TARGET_MAX_DRIFT) {
    return {
      state: {
        target: event.target,
        startedAt: event.now,
        progress: 0,
        fired: false,
        originX: event.x ?? null,
        originY: event.y ?? null,
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
