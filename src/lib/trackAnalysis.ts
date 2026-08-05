export const DEFAULT_TRACK_OVERVIEW_BUCKETS = 512

const MAX_TRACK_OVERVIEW_BUCKETS = 8_192
const ANALYSIS_BLOCK_SIZE = 1_024

export type TrackTempoEstimate = Readonly<{
  bpm: number | null
  source: 'known' | 'detected' | 'none'
  bpmConfidence: number
  beatOffsetSeconds: number | null
  beatGridConfidence: number
}>

export type BeatGridMarker = Readonly<{
  timeSeconds: number
  beatInBar: number
  bar: number
  isEstimatedBarStart: boolean
}>

export type BeatGrid = Readonly<{
  beats: BeatGridMarker[]
  bars: number[]
}>

export type TrackAnalysisOptions = Readonly<{
  overviewBuckets?: number
  knownBpm?: number
  beatsPerBar?: number
}>

export type TrackAnalysis = TrackTempoEstimate &
  Readonly<{
    durationSeconds: number
    overview: number[]
    beats: BeatGridMarker[]
    bars: number[]
  }>

type OnsetPeak = Readonly<{
  timeSeconds: number
  strength: number
}>

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function normalizeBpm(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null
  let normalized = value
  while (normalized < 70) normalized *= 2
  while (normalized > 180) normalized /= 2
  return Math.round(normalized * 10) / 10
}

function safeBucketCount(bucketCount: number) {
  if (!Number.isFinite(bucketCount) || bucketCount <= 0) return 0
  return Math.min(MAX_TRACK_OVERVIEW_BUCKETS, Math.floor(bucketCount))
}

/** Builds a full-track peak envelope normalized to the loudest bucket. */
export function buildTrackOverview(
  samples: Float32Array,
  bucketCount = DEFAULT_TRACK_OVERVIEW_BUCKETS,
) {
  const count = safeBucketCount(bucketCount)
  if (count === 0) return []
  const peaks = Array.from({ length: count }, () => 0)
  if (!samples.length) return peaks

  let loudest = 0
  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor((bucket * samples.length) / count)
    const end = Math.min(
      samples.length,
      Math.max(start + 1, Math.floor(((bucket + 1) * samples.length) / count)),
    )
    let peak = 0
    for (let index = start; index < end; index += 1) {
      const sample = samples[index]
      if (!Number.isFinite(sample)) continue
      peak = Math.max(peak, Math.abs(sample))
    }
    peaks[bucket] = peak
    loudest = Math.max(loudest, peak)
  }

  if (loudest === 0) return peaks
  return peaks.map((peak) => Math.round((peak / loudest) * 10_000) / 10_000)
}

function findOnsetPeaks(samples: Float32Array, sampleRate: number): OnsetPeak[] {
  if (!samples.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return []
  const blockCount = Math.floor(samples.length / ANALYSIS_BLOCK_SIZE)
  if (blockCount < 4) return []

  const onset = new Float32Array(blockCount)
  let previousEnergy = 0
  let onsetTotal = 0
  for (let block = 0; block < blockCount; block += 1) {
    let energy = 0
    const start = block * ANALYSIS_BLOCK_SIZE
    for (let index = start; index < start + ANALYSIS_BLOCK_SIZE; index += 1) {
      const sample = samples[index]
      if (Number.isFinite(sample)) energy += Math.abs(sample)
    }
    energy /= ANALYSIS_BLOCK_SIZE
    const change = Math.max(0, energy - previousEnergy)
    onset[block] = change
    onsetTotal += change
    previousEnergy = energy
  }

  if (onsetTotal <= Number.EPSILON) return []
  const mean = onsetTotal / blockCount
  let variance = 0
  for (const value of onset) variance += Math.pow(value - mean, 2)
  const threshold = mean + Math.sqrt(variance / blockCount) * 0.8
  const minPeakGap = Math.max(1, Math.round((sampleRate * 0.18) / ANALYSIS_BLOCK_SIZE))
  const peaks: OnsetPeak[] = []

  for (let block = 1; block < onset.length - 1; block += 1) {
    const strength = onset[block]
    const previousPeakBlock = peaks.length
      ? Math.round((peaks[peaks.length - 1].timeSeconds * sampleRate) / ANALYSIS_BLOCK_SIZE)
      : null
    if (
      strength >= threshold &&
      strength >= onset[block - 1] &&
      strength > onset[block + 1] &&
      (previousPeakBlock === null || block - previousPeakBlock >= minPeakGap)
    ) {
      peaks.push({
        timeSeconds: (block * ANALYSIS_BLOCK_SIZE) / sampleRate,
        strength,
      })
    }
  }
  return peaks
}

function detectBpmFromPeaks(peaks: OnsetPeak[]) {
  if (peaks.length < 4) return { bpm: null, confidence: 0 }
  const scores = new Map<number, number>()
  let scoreTotal = 0

  for (let peakIndex = 0; peakIndex < peaks.length; peakIndex += 1) {
    for (let offset = 1; offset <= 4 && peakIndex + offset < peaks.length; offset += 1) {
      const seconds = peaks[peakIndex + offset].timeSeconds - peaks[peakIndex].timeSeconds
      const bpm = normalizeBpm((60 / seconds) * offset)
      if (!bpm) continue
      const bucket = Math.round(bpm)
      const weight = 1 / offset
      scores.set(bucket, (scores.get(bucket) ?? 0) + weight)
      scoreTotal += weight
    }
  }

  const clusters = [...scores.keys()].map((center) => {
    const members = [...scores.entries()].filter(([bucket]) => Math.abs(bucket - center) <= 3)
    const score = members.reduce((total, [, weight]) => total + weight, 0)
    const weightedBpm = members.reduce(
      (total, [bucket, weight]) => total + bucket * weight,
      0,
    ) / Math.max(score, Number.EPSILON)
    return { bpm: Math.round(weightedBpm), score }
  })
  const winner = clusters.sort((a, b) => b.score - a.score)[0]
  if (!winner || scoreTotal === 0) return { bpm: null, confidence: 0 }
  return {
    bpm: winner.bpm,
    confidence: Math.round(clamp(winner.score / scoreTotal) * 1_000) / 1_000,
  }
}

function estimateBeatOffset(peaks: OnsetPeak[], bpm: number) {
  const period = 60 / bpm
  if (!peaks.length || !Number.isFinite(period) || period <= 0) {
    return { offset: null, confidence: 0 }
  }

  let x = 0
  let y = 0
  let weightTotal = 0
  for (const peak of peaks) {
    const weight = Math.max(peak.strength, Number.EPSILON)
    const phase = ((peak.timeSeconds % period) / period) * Math.PI * 2
    x += Math.cos(phase) * weight
    y += Math.sin(phase) * weight
    weightTotal += weight
  }
  if (weightTotal === 0) return { offset: null, confidence: 0 }

  const phase = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2)
  return {
    offset: (phase / (Math.PI * 2)) * period,
    confidence: clamp(Math.hypot(x, y) / weightTotal),
  }
}

/** Estimates tempo and beat phase. Confidence describes evidence, not musical correctness. */
export function estimateTrackTempo(
  samples: Float32Array,
  sampleRate: number,
  knownBpm?: number,
): TrackTempoEstimate {
  const known = knownBpm === undefined ? null : normalizeBpm(knownBpm)
  if (!samples.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return {
      bpm: known,
      source: known ? 'known' : 'none',
      bpmConfidence: known ? 1 : 0,
      beatOffsetSeconds: null,
      beatGridConfidence: 0,
    }
  }

  const peaks = findOnsetPeaks(samples, sampleRate)
  const detected = detectBpmFromPeaks(peaks)
  const bpm = known ?? detected.bpm
  if (!bpm) {
    return {
      bpm: null,
      source: 'none',
      bpmConfidence: 0,
      beatOffsetSeconds: null,
      beatGridConfidence: 0,
    }
  }

  const phase = estimateBeatOffset(peaks, bpm)
  const bpmConfidence = known ? 1 : detected.confidence
  return {
    bpm,
    source: known ? 'known' : 'detected',
    bpmConfidence,
    beatOffsetSeconds: phase.offset,
    beatGridConfidence:
      Math.round(clamp(bpmConfidence * phase.confidence) * 1_000) / 1_000,
  }
}

/** Groups beats into estimated bars; it does not claim true musical downbeat detection. */
export function buildBeatGrid(
  durationSeconds: number,
  bpm: number | null,
  beatOffsetSeconds: number | null,
  beatsPerBar = 4,
): BeatGrid {
  const normalizedBpm = bpm === null ? null : normalizeBpm(bpm)
  const meter = Number.isFinite(beatsPerBar) ? Math.floor(beatsPerBar) : 0
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !normalizedBpm ||
    beatOffsetSeconds === null ||
    !Number.isFinite(beatOffsetSeconds) ||
    meter <= 0
  ) {
    return { beats: [], bars: [] }
  }

  const period = 60 / normalizedBpm
  const offset = ((beatOffsetSeconds % period) + period) % period
  const beats: BeatGridMarker[] = []
  const bars: number[] = []
  const epsilon = 1e-7

  for (let index = 0, time = offset; time <= durationSeconds + epsilon; index += 1, time = offset + index * period) {
    const beatInBar = (index % meter) + 1
    const roundedTime = Math.round(time * 100_000) / 100_000
    const marker: BeatGridMarker = {
      timeSeconds: roundedTime,
      beatInBar,
      bar: Math.floor(index / meter) + 1,
      isEstimatedBarStart: beatInBar === 1,
    }
    beats.push(marker)
    if (marker.isEstimatedBarStart) bars.push(roundedTime)
  }

  return { beats, bars }
}

export function analyzeTrackPcm(
  samples: Float32Array,
  sampleRate: number,
  options: TrackAnalysisOptions = {},
): TrackAnalysis {
  const durationSeconds =
    samples.length && Number.isFinite(sampleRate) && sampleRate > 0
      ? samples.length / sampleRate
      : 0
  const tempo = estimateTrackTempo(samples, sampleRate, options.knownBpm)
  const grid = buildBeatGrid(
    durationSeconds,
    tempo.bpm,
    tempo.beatOffsetSeconds,
    options.beatsPerBar,
  )

  return {
    durationSeconds,
    overview: buildTrackOverview(samples, options.overviewBuckets),
    ...tempo,
    ...grid,
  }
}
