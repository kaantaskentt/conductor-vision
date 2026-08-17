export type AirMixDeckId = 'a' | 'b'
export type AirMixSourceKind = 'none' | 'demo' | 'local'
export type AirMixMode = 'demo-air-mix' | 'assisted-fade'

export type AirMixDeckInput = {
  authoredBarOffsetSeconds: number | null
  authoredBeatsPerBar: number | null
  beatGridConfidence: number
  bpm: number | null
  currentTime: number
  loaded: boolean
  playing: boolean
  sourceKind: AirMixSourceKind
  tempo: number
}

export type AirMixPlanInput = {
  crossfader: number
  decks: Record<AirMixDeckId, AirMixDeckInput>
}

export type AirMixPlan = {
  copy: string
  fadeDurationMs: number
  mode: AirMixMode
  sourceId: AirMixDeckId
  startDelayMs: number
  targetId: AirMixDeckId
  targetTempoPercent: number | null
}

export type AirMixPlanResult =
  | { ok: true; plan: AirMixPlan }
  | { ok: false; reason: string }

export const AIR_MIX_MIN_GRID_CONFIDENCE = 0.65
export const AIR_MIX_MIN_FADE_MS = 3_200
export const AIR_MIX_MAX_FADE_MS = 6_400
export const AIR_MIX_SCHEDULE_LATE_TOLERANCE_MS = 80

function normalizedBpm(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null
  let normalized = value
  while (normalized < 70) normalized *= 2
  while (normalized > 180) normalized /= 2
  return normalized
}

export function safeTempoMatchPercent(sourceBpm: number, targetBpm: number) {
  const source = normalizedBpm(sourceBpm)
  const target = normalizedBpm(targetBpm)
  if (!source || !target) return null
  const ratio = [source / target, source / 2 / target, (source * 2) / target]
    .filter((candidate) => candidate >= 0.8 && candidate <= 1.2)
    .sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1))[0]
  return ratio === undefined ? null : Math.round((ratio - 1) * 1_000) / 10
}

export function sourceOnlyCrossfader(deck: AirMixDeckId) {
  return deck === 'a' ? -100 : 100
}

export function nextAuthoredBarDelayMs(
  currentTime: number,
  authoredBpm: number,
  firstBarSeconds = 0,
  beatsPerBar = 4,
  playbackRate = 1,
) {
  if (!Number.isFinite(currentTime) || currentTime < 0) return 0
  const bpm = normalizedBpm(authoredBpm)
  if (
    !bpm ||
    !Number.isFinite(firstBarSeconds) ||
    !Number.isFinite(beatsPerBar) ||
    !Number.isFinite(playbackRate) ||
    playbackRate <= 0
  ) return 0
  if (currentTime < firstBarSeconds) {
    return Math.round(((firstBarSeconds - currentTime) / playbackRate) * 1_000)
  }
  const barSeconds = (60 / bpm) * Math.max(1, beatsPerBar)
  const positionInBar = (currentTime - firstBarSeconds) % barSeconds
  const mediaSecondsUntilNextBar = positionInBar < 0.01
    ? barSeconds
    : barSeconds - positionInBar
  return Math.max(0, Math.round((mediaSecondsUntilNextBar / playbackRate) * 1_000))
}

/**
 * Browser timers cannot guarantee an exact audio boundary. If the main thread
 * delivers the scheduled callback late, use the live media clock to target the
 * following authored bar rather than beginning part-way through the missed one.
 */
export function authoredBarRescheduleDelayMs(
  scheduledAtMs: number,
  firedAtMs: number,
  currentTime: number,
  authoredBpm: number,
  firstBarSeconds = 0,
  beatsPerBar = 4,
  playbackRate = 1,
  lateToleranceMs = AIR_MIX_SCHEDULE_LATE_TOLERANCE_MS,
) {
  if (
    !Number.isFinite(scheduledAtMs) ||
    !Number.isFinite(firedAtMs) ||
    firedAtMs - scheduledAtMs <= Math.max(0, lateToleranceMs)
  ) return null

  return nextAuthoredBarDelayMs(
    currentTime,
    authoredBpm,
    firstBarSeconds,
    beatsPerBar,
    playbackRate,
  )
}

function chooseSource(input: AirMixPlanInput): AirMixDeckId | null {
  const { a, b } = input.decks
  if (a.playing && !b.playing) return 'a'
  if (b.playing && !a.playing) return 'b'
  if (a.playing && b.playing) return input.crossfader > 0 ? 'b' : 'a'
  return null
}

export function planAirMix(input: AirMixPlanInput): AirMixPlanResult {
  const { a, b } = input.decks
  if (!a.loaded || !b.loaded) {
    return { ok: false, reason: 'Load both decks before starting Air Mix.' }
  }

  const sourceId = chooseSource(input)
  if (!sourceId) {
    return { ok: false, reason: 'Start one deck before starting Air Mix.' }
  }
  const targetId: AirMixDeckId = sourceId === 'a' ? 'b' : 'a'
  const source = input.decks[sourceId]
  const target = input.decks[targetId]
  const sourceEffectiveBpm = source.bpm
    ? source.bpm * (1 + source.tempo / 100)
    : null
  const bothDemo = a.sourceKind === 'demo' && b.sourceKind === 'demo'

  if (bothDemo) {
    if (
      !source.bpm ||
      !sourceEffectiveBpm ||
      !target.bpm ||
      source.authoredBarOffsetSeconds === null ||
      source.authoredBeatsPerBar === null
    ) {
      return { ok: false, reason: 'The demo tempo metadata is not ready yet.' }
    }
    const targetTempoPercent = safeTempoMatchPercent(sourceEffectiveBpm, target.bpm)
    if (targetTempoPercent === null) {
      return { ok: false, reason: 'These demo tracks are outside the safe tempo range.' }
    }
    const barMs = (60_000 / sourceEffectiveBpm) * 4
    return {
      ok: true,
      plan: {
        copy: 'Demo Air Mix · aiming for the next authored bar',
        fadeDurationMs: Math.round(
          Math.min(AIR_MIX_MAX_FADE_MS, Math.max(AIR_MIX_MIN_FADE_MS, barMs * 2)),
        ),
        mode: 'demo-air-mix',
        sourceId,
        startDelayMs: nextAuthoredBarDelayMs(
          source.currentTime,
          source.bpm,
          source.authoredBarOffsetSeconds,
          source.authoredBeatsPerBar,
          1 + source.tempo / 100,
        ),
        targetId,
        targetTempoPercent,
      },
    }
  }

  const gridsAreReliable =
    a.beatGridConfidence >= AIR_MIX_MIN_GRID_CONFIDENCE &&
    b.beatGridConfidence >= AIR_MIX_MIN_GRID_CONFIDENCE
  const targetTempoPercent = gridsAreReliable && sourceEffectiveBpm && target.bpm
    ? safeTempoMatchPercent(sourceEffectiveBpm, target.bpm)
    : null
  const tempoCopy = targetTempoPercent === null
    ? 'no automatic beat-grid lock'
    : 'estimated tempo match'

  return {
    ok: true,
    plan: {
      copy: `Assisted Fade · ${tempoCopy}`,
      fadeDurationMs: 4_800,
      mode: 'assisted-fade',
      sourceId,
      startDelayMs: 0,
      targetId,
      targetTempoPercent,
    },
  }
}
