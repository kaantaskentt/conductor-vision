export type AirTarget = Readonly<{
  id: string
  left: number
  top: number
  right: number
  bottom: number
  disabled?: boolean
}>

export type AirPointerSample = Readonly<{
  detected: boolean
  pointing: boolean
  x: number
  y: number
  now: number
}>

export type AirTargetControllerState = Readonly<{
  hoveredTargetId: string | null
  dwellStartedAt: number | null
  blockedUntilExitTargetId: string | null
  cooldownUntil: number
}>

export type AirTargetControllerUpdate = Readonly<{
  state: AirTargetControllerState
  hoveredTargetId: string | null
  activatedTargetId: string | null
  dwellProgress: number
}>

export type AirTargetControllerOptions = Readonly<{
  dwellMs?: number
  cooldownMs?: number
}>

const DEFAULT_DWELL_MS = 700
const DEFAULT_COOLDOWN_MS = 450

export function createAirTargetControllerState(): AirTargetControllerState {
  return {
    hoveredTargetId: null,
    dwellStartedAt: null,
    blockedUntilExitTargetId: null,
    cooldownUntil: 0,
  }
}

function targetAtPoint(targets: readonly AirTarget[], x: number, y: number) {
  return targets.find(
    (target) =>
      !target.disabled &&
      x >= target.left &&
      x <= target.right &&
      y >= target.top &&
      y <= target.bottom,
  ) ?? null
}

export function updateAirTargetController(
  state: AirTargetControllerState,
  sample: AirPointerSample,
  targets: readonly AirTarget[],
  options: AirTargetControllerOptions = {},
): AirTargetControllerUpdate {
  const dwellMs = Math.max(1, options.dwellMs ?? DEFAULT_DWELL_MS)
  const cooldownMs = Math.max(0, options.cooldownMs ?? DEFAULT_COOLDOWN_MS)
  const now = Number.isFinite(sample.now) ? sample.now : 0
  const target =
    sample.detected && sample.pointing && Number.isFinite(sample.x) && Number.isFinite(sample.y)
      ? targetAtPoint(targets, sample.x, sample.y)
      : null

  if (!target) {
    const nextState = {
      ...state,
      hoveredTargetId: null,
      dwellStartedAt: null,
      blockedUntilExitTargetId: null,
    }
    return {
      state: nextState,
      hoveredTargetId: null,
      activatedTargetId: null,
      dwellProgress: 0,
    }
  }

  if (state.blockedUntilExitTargetId === target.id) {
    const nextState = {
      ...state,
      hoveredTargetId: target.id,
      dwellStartedAt: null,
    }
    return {
      state: nextState,
      hoveredTargetId: target.id,
      activatedTargetId: null,
      dwellProgress: 0,
    }
  }

  const blockedUntilExitTargetId =
    state.blockedUntilExitTargetId === target.id
      ? state.blockedUntilExitTargetId
      : null

  if (now < state.cooldownUntil) {
    const nextState = {
      ...state,
      hoveredTargetId: target.id,
      dwellStartedAt: null,
      blockedUntilExitTargetId,
    }
    return {
      state: nextState,
      hoveredTargetId: target.id,
      activatedTargetId: null,
      dwellProgress: 0,
    }
  }

  const dwellStartedAt =
    state.hoveredTargetId === target.id && state.dwellStartedAt !== null
      ? state.dwellStartedAt
      : now
  const dwellProgress = Math.min(1, Math.max(0, (now - dwellStartedAt) / dwellMs))

  if (dwellProgress < 1) {
    const nextState = {
      ...state,
      hoveredTargetId: target.id,
      dwellStartedAt,
      blockedUntilExitTargetId,
    }
    return {
      state: nextState,
      hoveredTargetId: target.id,
      activatedTargetId: null,
      dwellProgress,
    }
  }

  const nextState = {
    hoveredTargetId: target.id,
    dwellStartedAt: null,
    blockedUntilExitTargetId: target.id,
    cooldownUntil: now + cooldownMs,
  }
  return {
    state: nextState,
    hoveredTargetId: target.id,
    activatedTargetId: target.id,
    dwellProgress: 1,
  }
}
