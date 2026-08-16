import { useCallback, useEffect, useRef, useState } from 'react'
import { equalPowerCrossfade } from '../lib/djAudio'
import {
  createFilterGestureState,
  createGestureClutchState,
  GESTURE_CLUTCH_FIST_RELEASE_MS,
  GESTURE_CLUTCH_LOST_RELEASE_MS,
  transitionGestureClutch,
  transitionFilterGesture,
  type FilterGestureState,
  type FilterGestureTransition,
  type GestureClutchState,
} from '../lib/gestureController'
import {
  analyzeTrackPcm,
  type BeatGridMarker,
  type TrackAnalysis,
} from '../lib/trackAnalysis'
import { clamp, type GestureFrame, type HandSummary } from '../lib/vision'

export type DeckId = 'a' | 'b'
export type DjControl = 'crossfader' | 'volume' | 'filter'
export type GestureSessionReleaseReason =
  | 'camera-stopped'
  | 'camera-error'
  | 'left-dj-room'

export type MasterCaptureHandle = {
  stream: MediaStream
  release: () => void
}

export const DJ_NEUTRAL_VALUES = {
  crossfader: 0,
  volume: 82,
  filter: 50,
  tempo: 0,
} as const

export const DJ_WAVEFORM_SAMPLES = 44

export type DeckState = {
  name: string
  loaded: boolean
  playing: boolean
  duration: number
  currentTime: number
  volume: number
  filter: number
  tempo: number
  bpm: number | null
  bpmStatus: string
  audioLevel: number
  waveform: number[]
  overview: number[]
  beats: BeatGridMarker[]
  bars: number[]
  beatGridConfidence: number
  analysisStatus: string
  error: string | null
}

type DeckNodes = {
  source: MediaElementAudioSourceNode
  highpass: BiquadFilterNode
  lowpass: BiquadFilterNode
  analyser: AnalyserNode
  volume: GainNode
  crossfade: GainNode
  bins: Uint8Array<ArrayBuffer>
}

type BpmSyncSnapshot = {
  masterId: DeckId
  targetId: DeckId
  originalTempos: Record<DeckId, number>
  originalStatuses: Record<DeckId, string>
}

type LoadFileOptions = {
  knownBpm?: number
  title?: string
  loop?: boolean
  demoGeneration?: AbortController
}

type PositionGesture = {
  control: 'crossfader' | 'volume'
  deck: DeckId | 'master'
  baselineInput: number
  baselineValue: number
  samples: number
  startedAt: number
  engaged: boolean
}

const DECK_IDS: DeckId[] = ['a', 'b']
const MAX_AUDIO_BYTES = 100 * 1024 * 1024
export const MAX_BPM_ANALYSIS_BYTES = 8 * 1024 * 1024
export const MAX_TRACK_ANALYSIS_BYTES = 32 * 1024 * 1024
const ACCEPTED_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/vnd.wave',
  'audio/flac',
  'audio/x-flac',
  'audio/ogg',
])
const AUDIO_EXTENSION = /\.(mp3|wav|flac|ogg)$/i
const FILTER_LOW_MIN_HZ = 220
const FILTER_LOW_OPEN_HZ = 20_000
const FILTER_HIGH_OPEN_HZ = 20
const FILTER_HIGH_MAX_HZ = 16_000
const FILTER_CURVE_EXPONENT = 0.68
const FILTER_Q_MIN = 0.82
const FILTER_Q_MAX = 2.1
const POSITION_GESTURE_DEAD_ZONE = 0.025
const GESTURE_CALIBRATION_MS = 420
const POSITION_CALIBRATION_TOLERANCE = 0.04
export const GESTURE_ENGAGE_FINGERS = 3
const GESTURE_SESSION_RELEASE_MESSAGES: Record<GestureSessionReleaseReason, string> = {
  'camera-stopped': 'Camera stopped · Air Controls released',
  'camera-error': 'Camera unavailable · Air Controls released',
  'left-dj-room': 'Air Controls released · open your palm to grab again',
}

export function validateAudioFile(file: File) {
  const hasSupportedType = ACCEPTED_AUDIO_TYPES.has(file.type)
  const hasSupportedExtension = AUDIO_EXTENSION.test(file.name)
  if ((!file.type && !hasSupportedExtension) || (file.type && !hasSupportedType)) {
    throw new Error('Choose an MP3, WAV, FLAC, or OGG audio file.')
  }
  if (file.size > MAX_AUDIO_BYTES) throw new Error('Choose an audio file smaller than 100 MB.')
}

export function shouldAutoAnalyzeBpm(file: Pick<File, 'size'>) {
  return file.size <= MAX_BPM_ANALYSIS_BYTES
}

export function phraseTimeForIndex(index: number, duration: number) {
  const boundedIndex = Math.max(1, Math.min(4, index))
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return ((boundedIndex - 1) / 4) * duration
}

export function normalizeBpm(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null
  let normalized = value
  while (normalized < 70) normalized *= 2
  while (normalized > 180) normalized /= 2
  return Math.round(normalized * 10) / 10
}

export function matchedTempoPercent(sourceBpm: number, targetBpm: number) {
  const source = normalizeBpm(sourceBpm)
  const target = normalizeBpm(targetBpm)
  if (!source || !target) return null
  const ratio = [target / source, target / 2 / source, (target * 2) / source]
    .filter((candidate) => candidate >= 0.8 && candidate <= 1.2)
    .sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1))[0]
  if (!ratio) return null
  return Math.round((ratio - 1) * 1000) / 10
}

export function bpmFromTapTimes(times: number[]) {
  if (times.length < 2) return null
  const intervals = times
    .slice(1)
    .map((time, index) => time - times[index])
    .filter((interval) => interval >= 250 && interval <= 2_000)
  if (!intervals.length) return null
  const average = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length
  return normalizeBpm(60_000 / average)
}

export function chooseSyncMaster(
  aPlaying: boolean,
  bPlaying: boolean,
  crossfader: number = DJ_NEUTRAL_VALUES.crossfader,
): DeckId {
  if (bPlaying && !aPlaying) return 'b'
  if (aPlaying && bPlaying && crossfader > DJ_NEUTRAL_VALUES.crossfader) return 'b'
  return 'a'
}

export function smoothControlValue(current: number, target: number, strength = 0.32) {
  const amount = clamp(strength, 0, 1)
  return current + (target - current) * amount
}

export function smoothBoundedControlValue(
  current: number,
  target: number,
  min: number,
  max: number,
  strength = 0.32,
) {
  return clamp(smoothControlValue(current, target, strength), min, max)
}

export function isGestureFrameEngaged(frame: GestureFrame, alreadyHeld = false) {
  return frame.detected && frame.openFingers >= (alreadyHeld ? 2 : GESTURE_ENGAGE_FINGERS)
}

export function relativeGestureValue(
  baselineValue: number,
  baselineInput: number,
  currentInput: number,
  sensitivity: number,
) {
  const delta = currentInput - baselineInput
  const adjusted = Math.sign(delta) * Math.max(0, Math.abs(delta) - POSITION_GESTURE_DEAD_ZONE)
  return baselineValue + adjusted * sensitivity
}

export function bipolarFilterFrequencies(amount: number) {
  const value = clamp(amount, 0, 100)
  if (value < 50) {
    const sweep = Math.pow((50 - value) / 50, FILTER_CURVE_EXPONENT)
    return {
      highpass: FILTER_HIGH_OPEN_HZ,
      lowpass: FILTER_LOW_OPEN_HZ * Math.pow(FILTER_LOW_MIN_HZ / FILTER_LOW_OPEN_HZ, sweep),
    }
  }
  if (value > 50) {
    const sweep = Math.pow((value - 50) / 50, FILTER_CURVE_EXPONENT)
    return {
      highpass:
        FILTER_HIGH_OPEN_HZ * Math.pow(FILTER_HIGH_MAX_HZ / FILTER_HIGH_OPEN_HZ, sweep),
      lowpass: FILTER_LOW_OPEN_HZ,
    }
  }
  return { highpass: FILTER_HIGH_OPEN_HZ, lowpass: FILTER_LOW_OPEN_HZ }
}

export function bipolarFilterResonance(amount: number) {
  const distanceFromNeutral = Math.abs(clamp(amount, 0, 100) - 50) / 50
  return FILTER_Q_MIN + (FILTER_Q_MAX - FILTER_Q_MIN) * Math.pow(distanceFromNeutral, 0.72)
}

export function channelGainFromPercent(amount: number) {
  const normalized = clamp(amount, 0, 100) / 100
  if (normalized === 0) return 0
  const decibels = -48 * Math.pow(1 - normalized, 2)
  return Math.pow(10, decibels / 20)
}

export function appendWaveformSample(
  history: number[],
  level: number,
  sampleCount = DJ_WAVEFORM_SAMPLES,
) {
  if (sampleCount <= 0) return []
  return [
    ...history.slice(Math.max(0, history.length - sampleCount + 1)),
    Math.round(clamp(level, 0, 100)),
  ].slice(-sampleCount)
}

export function estimateBpmFromSamples(samples: Float32Array, sampleRate: number) {
  if (!samples.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return null
  const blockSize = 1_024
  const blockCount = Math.floor(samples.length / blockSize)
  if (blockCount < 24) return null

  const onset = new Float32Array(blockCount)
  let previousEnergy = 0
  let onsetTotal = 0
  for (let block = 0; block < blockCount; block += 1) {
    let energy = 0
    const start = block * blockSize
    for (let index = start; index < start + blockSize; index += 1) {
      energy += Math.abs(samples[index])
    }
    energy /= blockSize
    const change = Math.max(0, energy - previousEnergy)
    onset[block] = change
    onsetTotal += change
    previousEnergy = energy
  }

  const mean = onsetTotal / blockCount
  let variance = 0
  for (const value of onset) variance += Math.pow(value - mean, 2)
  const threshold = mean + Math.sqrt(variance / blockCount) * 0.8
  const minPeakGap = Math.max(1, Math.round((sampleRate * 0.22) / blockSize))
  const peaks: number[] = []

  for (let index = 1; index < onset.length - 1; index += 1) {
    if (
      onset[index] >= threshold &&
      onset[index] >= onset[index - 1] &&
      onset[index] > onset[index + 1] &&
      (!peaks.length || index - peaks[peaks.length - 1] >= minPeakGap)
    ) {
      peaks.push(index)
    }
  }

  if (peaks.length < 4) return null
  const scores = new Map<number, number>()
  for (let peakIndex = 0; peakIndex < peaks.length; peakIndex += 1) {
    for (let offset = 1; offset <= 4 && peakIndex + offset < peaks.length; offset += 1) {
      const seconds = ((peaks[peakIndex + offset] - peaks[peakIndex]) * blockSize) / sampleRate
      const normalized = normalizeBpm((60 / seconds) * offset)
      if (!normalized) continue
      const bucket = Math.round(normalized)
      scores.set(bucket, (scores.get(bucket) ?? 0) + 1 / offset)
    }
  }

  const winner = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]
  return winner ? winner[0] : null
}

async function detectBpm(file: File) {
  const Context = window.AudioContext
  if (!Context) return null
  const context = new Context()
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer())
    const sampleCount = Math.min(buffer.length, Math.floor(buffer.sampleRate * 90))
    const mixed = new Float32Array(sampleCount)
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel)
      for (let index = 0; index < sampleCount; index += 1) {
        mixed[index] += data[index] / buffer.numberOfChannels
      }
    }
    return estimateBpmFromSamples(mixed, buffer.sampleRate)
  } finally {
    if (context.state !== 'closed') await context.close()
  }
}

async function analyzeAudioFile(file: File, knownBpm?: number): Promise<TrackAnalysis | null> {
  const Context = window.AudioContext
  if (
    !Context ||
    typeof Context.prototype.decodeAudioData !== 'function' ||
    file.size > MAX_TRACK_ANALYSIS_BYTES
  ) return null

  const context = new Context()
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer())
    const channels: Float32Array[] = []
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      channels.push(buffer.getChannelData(channel).slice())
    }
    if (typeof Worker === 'undefined') {
      const mixed = new Float32Array(buffer.length)
      for (const data of channels) {
        for (let index = 0; index < buffer.length; index += 1) {
          mixed[index] += data[index] / channels.length
        }
      }
      return analyzeTrackPcm(mixed, buffer.sampleRate, { knownBpm })
    }

    const worker = new Worker(
      new URL('../workers/trackAnalysisWorker.ts', import.meta.url),
      { type: 'module' },
    )
    return await new Promise<TrackAnalysis>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        worker.terminate()
        reject(new Error('Track analysis timed out.'))
      }, 20_000)
      worker.onmessage = (event: MessageEvent<{ analysis?: TrackAnalysis; error?: string }>) => {
        window.clearTimeout(timeout)
        worker.terminate()
        if (event.data.analysis) resolve(event.data.analysis)
        else reject(new Error(event.data.error ?? 'Track analysis failed.'))
      }
      worker.onerror = () => {
        window.clearTimeout(timeout)
        worker.terminate()
        reject(new Error('Track analysis worker failed.'))
      }
      worker.postMessage(
        { channels, sampleRate: buffer.sampleRate, knownBpm },
        channels.map((channel) => channel.buffer),
      )
    })
  } finally {
    if (context.state !== 'closed') await context.close()
  }
}

type BpmAnalyzer = (file: File) => Promise<number | null>

type QueuedBpmResult =
  | { status: 'complete'; bpm: number | null }
  | { status: 'stale' }

export function createBpmAnalysisQueue(analyze: BpmAnalyzer = detectBpm) {
  let tail = Promise.resolve()

  return {
    enqueue(
      file: File,
      isCurrent: () => boolean,
      onStart?: () => void,
    ): Promise<QueuedBpmResult> {
      const task = tail.then(async (): Promise<QueuedBpmResult> => {
        if (!isCurrent()) return { status: 'stale' }
        onStart?.()
        const bpm = await analyze(file)
        if (!isCurrent()) return { status: 'stale' }
        return { status: 'complete', bpm }
      })
      tail = task.then(
        () => undefined,
        () => undefined,
      )
      return task
    },
  }
}

function initialDeckState(): DeckState {
  return {
    name: 'No track loaded',
    loaded: false,
    playing: false,
    duration: 0,
    currentTime: 0,
    volume: DJ_NEUTRAL_VALUES.volume,
    filter: DJ_NEUTRAL_VALUES.filter,
    tempo: DJ_NEUTRAL_VALUES.tempo,
    bpm: null,
    bpmStatus: 'Load a track',
    audioLevel: 0,
    waveform: Array.from({ length: DJ_WAVEFORM_SAMPLES }, () => 0),
    overview: [],
    beats: [],
    bars: [],
    beatGridConfidence: 0,
    analysisStatus: 'Load a track',
    error: null,
  }
}

function generatedDemoOverview(id: DeckId, bucketCount = 512) {
  const phase = id === 'a' ? 0.35 : 1.2
  return Array.from({ length: bucketCount }, (_, index) => {
    const pulse = Math.abs(Math.sin(index * 0.17 + phase)) * 0.52
    const phrase = Math.abs(Math.sin(index * 0.043 + phase * 0.5)) * 0.24
    const contour = 0.72 + Math.sin((index / bucketCount) * Math.PI) * 0.28
    return Math.round(clamp((0.16 + pulse + phrase) * contour) * 10_000) / 10_000
  })
}

function deckLabel(id: DeckId) {
  return id === 'a' ? 'Deck A' : 'Deck B'
}

export function useDjMixer() {
  const [decks, setDecks] = useState<Record<DeckId, DeckState>>({
    a: initialDeckState(),
    b: initialDeckState(),
  })
  const [crossfader, setCrossfaderState] = useState(0)
  const [activeDeck, setActiveDeck] = useState<DeckId>('a')
  const [selectedControl, setSelectedControl] = useState<DjControl>('crossfader')
  const [gestureStatus, setGestureStatus] = useState('Waiting for a hand')
  const [gesturePhase, setGesturePhase] = useState<'locked' | 'calibrating' | 'armed'>(
    'locked',
  )
  const [gestureReleaseRequired, setGestureReleaseRequired] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)
  const [bpmSync, setBpmSync] = useState<BpmSyncSnapshot | null>(null)
  const [bpmSyncMessage, setBpmSyncMessage] = useState(
    'The playing deck leads. Click again to restore both original tempos.',
  )
  const decksRef = useRef(decks)
  const crossfaderRef = useRef(crossfader)
  const bpmSyncRef = useRef<BpmSyncSnapshot | null>(null)
  const audioElementsRef = useRef<Record<DeckId, HTMLAudioElement | null>>({ a: null, b: null })
  const objectUrlsRef = useRef<Record<DeckId, string | null>>({ a: null, b: null })
  const audioContextRef = useRef<AudioContext | null>(null)
  const masterNodeRef = useRef<DynamicsCompressorNode | null>(null)
  const masterCaptureReleasesRef = useRef(new Set<() => void>())
  const captureGenerationRef = useRef(0)
  const nodesRef = useRef<Partial<Record<DeckId, DeckNodes>>>({})
  const meterAnimationRef = useRef<number | null>(null)
  const bpmRequestRef = useRef<Record<DeckId, number>>({ a: 0, b: 0 })
  const demoGenerationRef = useRef<AbortController | null>(null)
  const bpmAnalysisQueueRef = useRef<ReturnType<typeof createBpmAnalysisQueue> | null>(null)
  const bpmAnalysisQueue =
    bpmAnalysisQueueRef.current ??
    (bpmAnalysisQueueRef.current = createBpmAnalysisQueue())
  const trackAnalysisTailRef = useRef(Promise.resolve())
  const tapTimesRef = useRef<Record<DeckId, number[]>>({ a: [], b: [] })
  const lastGestureUpdateAtRef = useRef(0)
  const gestureEngagedRef = useRef(false)
  const gestureRequiresReleaseRef = useRef(false)
  const gestureReleasePendingRef = useRef<{
    reason: 'fist' | 'lost'
    releaseAt: number
  } | null>(null)
  const smoothedGestureRef = useRef<{
    control: DjControl
    deck: DeckId | 'master'
    value: number
  } | null>(null)
  const filterGestureRef = useRef<FilterGestureState>(createFilterGestureState())
  const gestureClutchRef = useRef<GestureClutchState>(createGestureClutchState())
  const positionGestureRef = useRef<PositionGesture | null>(null)
  const filterReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    decksRef.current = decks
  }, [decks])

  useEffect(() => {
    crossfaderRef.current = crossfader
  }, [crossfader])

  const patchDeck = useCallback((id: DeckId, patch: Partial<DeckState>) => {
    setDecks((current) => {
      const next = { ...current, [id]: { ...current[id], ...patch } }
      decksRef.current = next
      return next
    })
  }, [])

  const queueTrackAnalysis = useCallback(
    (id: DeckId, file: File, requestId: number, knownBpm?: number | null) => {
      if (file.size > MAX_TRACK_ANALYSIS_BYTES) {
        patchDeck(id, { analysisStatus: 'Large track ready · beat overview skipped' })
        return
      }

      patchDeck(id, { analysisStatus: 'Analyzing waveform and estimated beat grid…' })
      const task = trackAnalysisTailRef.current.then(() =>
        analyzeAudioFile(file, knownBpm ?? undefined),
      )
      trackAnalysisTailRef.current = task.then(
        () => undefined,
        () => undefined,
      )

      void task.then((analysis) => {
        if (bpmRequestRef.current[id] !== requestId) return
        patchDeck(id, {
          overview: analysis?.overview ?? [],
          beats: analysis?.beats ?? [],
          bars: analysis?.bars ?? [],
          beatGridConfidence: analysis?.beatGridConfidence ?? 0,
          analysisStatus: analysis
            ? analysis.beats.length
              ? 'Waveform ready · beat and bar lines are estimated'
              : 'Waveform ready · no reliable beat grid found'
            : 'Track ready · waveform analysis unavailable',
        })
      }).catch(() => {
        if (bpmRequestRef.current[id] === requestId) {
          patchDeck(id, { analysisStatus: 'Track ready · waveform analysis unavailable' })
        }
      })
    },
    [patchDeck],
  )

  const setAudioElement = useCallback((id: DeckId, element: HTMLAudioElement | null) => {
    if (element) element.preservesPitch = true
    audioElementsRef.current[id] = element
  }, [])

  const cancelDemoMix = useCallback(() => {
    const generation = demoGenerationRef.current
    if (!generation) return
    generation.abort()
    if (demoGenerationRef.current === generation) {
      demoGenerationRef.current = null
      setDemoLoading(false)
    }
  }, [])

  const cancelFilterRelease = useCallback(() => {
    if (filterReleaseTimerRef.current !== null) {
      clearTimeout(filterReleaseTimerRef.current)
      filterReleaseTimerRef.current = null
    }
  }, [])

  const disarmGesture = useCallback(
    (message?: string) => {
      const wasEngaged = gestureClutchRef.current.phase !== 'locked'
      cancelFilterRelease()
      gestureEngagedRef.current = false
      if (wasEngaged) {
        gestureRequiresReleaseRef.current = true
        gestureReleasePendingRef.current = null
      }
      const requiresRelease = gestureRequiresReleaseRef.current
      gestureClutchRef.current = createGestureClutchState()
      positionGestureRef.current = null
      filterGestureRef.current = createFilterGestureState()
      smoothedGestureRef.current = null
      setGesturePhase('locked')
      setGestureReleaseRequired(requiresRelease)
      if (message) setGestureStatus(message)
      return requiresRelease
    },
    [cancelFilterRelease],
  )

  const updateCrossfadeNodes = useCallback((value: number) => {
    const context = audioContextRef.current
    if (!context) return
    const gains = equalPowerCrossfade(value)
    for (const id of DECK_IDS) {
      nodesRef.current[id]?.crossfade.gain.setTargetAtTime(gains[id], context.currentTime, 0.065)
    }
  }, [])

  const stopMeter = useCallback(() => {
    if (meterAnimationRef.current === null) return
    cancelAnimationFrame(meterAnimationRef.current)
    meterAnimationRef.current = null
  }, [])

  const shouldRunMeter = useCallback(
    () =>
      !document.hidden &&
      DECK_IDS.some((id) => decksRef.current[id].playing),
    [],
  )

  const startMeter = useCallback(() => {
    if (meterAnimationRef.current !== null || !shouldRunMeter()) return
    let lastUpdate = 0
    const update = (now: number) => {
      meterAnimationRef.current = null
      if (!shouldRunMeter()) return
      if (now - lastUpdate > 80) {
        for (const id of DECK_IDS) {
          const nodes = nodesRef.current[id]
          if (!nodes) continue
          nodes.analyser.getByteFrequencyData(nodes.bins)
          const sampleCount = Math.min(48, nodes.bins.length)
          let total = 0
          for (let index = 0; index < sampleCount; index += 1) total += nodes.bins[index]
          const audioLevel = Math.round((total / Math.max(sampleCount, 1) / 255) * 100)
          const current = decksRef.current[id]
          const waveform = appendWaveformSample(current.waveform, audioLevel)
          const waveformChanged = waveform.some(
            (value, index) => value !== current.waveform[index],
          )
          if (current.audioLevel !== audioLevel || waveformChanged) {
            patchDeck(id, { audioLevel, waveform })
          }
        }
        lastUpdate = now
      }
      meterAnimationRef.current = requestAnimationFrame(update)
    }
    meterAnimationRef.current = requestAnimationFrame(update)
  }, [patchDeck, shouldRunMeter])

  const clearMeterLevels = useCallback(() => {
    for (const id of DECK_IDS) {
      if (decksRef.current[id].audioLevel !== 0) patchDeck(id, { audioLevel: 0 })
    }
  }, [patchDeck])

  useEffect(() => {
    if (decks.a.playing || decks.b.playing) startMeter()
    else {
      stopMeter()
      clearMeterLevels()
    }
  }, [clearMeterLevels, decks.a.playing, decks.b.playing, startMeter, stopMeter])

  useEffect(() => {
    const syncMeterVisibility = () => {
      if (document.hidden) stopMeter()
      else startMeter()
    }
    document.addEventListener('visibilitychange', syncMeterVisibility)
    return () => document.removeEventListener('visibilitychange', syncMeterVisibility)
  }, [startMeter, stopMeter])

  const ensureDeckGraph = useCallback(
    async (id: DeckId) => {
      const audio = audioElementsRef.current[id]
      if (!audio) throw new Error(`${deckLabel(id)} is not ready.`)
      let context = audioContextRef.current
      if (!context) {
        context = new AudioContext()
        audioContextRef.current = context
      }
      let master = masterNodeRef.current
      if (!master) {
        master = context.createDynamicsCompressor()
        master.threshold.value = -6
        master.knee.value = 8
        master.ratio.value = 10
        master.attack.value = 0.003
        master.release.value = 0.18
        master.connect(context.destination)
        masterNodeRef.current = master
      }
      if (!nodesRef.current[id]) {
        const source = context.createMediaElementSource(audio)
        const highpass = context.createBiquadFilter()
        const lowpass = context.createBiquadFilter()
        const analyser = context.createAnalyser()
        const volume = context.createGain()
        const crossfade = context.createGain()
        const filterFrequencies = bipolarFilterFrequencies(decksRef.current[id].filter)
        const filterResonance = bipolarFilterResonance(decksRef.current[id].filter)
        highpass.type = 'highpass'
        highpass.Q.value = filterResonance
        highpass.frequency.value = filterFrequencies.highpass
        lowpass.type = 'lowpass'
        lowpass.Q.value = filterResonance
        lowpass.frequency.value = filterFrequencies.lowpass
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.78
        volume.gain.value = channelGainFromPercent(decksRef.current[id].volume)
        crossfade.gain.value = equalPowerCrossfade(crossfaderRef.current)[id]
        source.connect(highpass)
        highpass.connect(lowpass)
        lowpass.connect(volume)
        volume.connect(crossfade)
        crossfade.connect(analyser)
        analyser.connect(master)
        nodesRef.current[id] = {
          source,
          highpass,
          lowpass,
          analyser,
          volume,
          crossfade,
          bins: new Uint8Array(analyser.frequencyBinCount),
        }
      }
      if (context.state === 'suspended') await context.resume()
    },
    [],
  )

  const createMasterCapture = useCallback(async (): Promise<MasterCaptureHandle> => {
    const captureGeneration = captureGenerationRef.current
    const loadedDeckIds = DECK_IDS.filter((id) => decksRef.current[id].loaded)
    if (!loadedDeckIds.length) throw new Error('Load a track before recording a replay.')

    await Promise.all(loadedDeckIds.map(ensureDeckGraph))
    if (captureGeneration !== captureGenerationRef.current) {
      throw new Error('The master mix is no longer available.')
    }
    const context = audioContextRef.current
    const master = masterNodeRef.current
    if (!context || !master) throw new Error('The master mix is not ready yet.')
    if (typeof context.createMediaStreamDestination !== 'function') {
      throw new Error('This browser cannot record the master mix.')
    }

    const destination = context.createMediaStreamDestination()
    try {
      master.connect(destination)
    } catch {
      for (const track of destination.stream.getTracks()) track.stop()
      throw new Error('The browser could not connect the replay audio tap.')
    }
    let released = false
    const release = () => {
      if (released) return
      released = true
      masterCaptureReleasesRef.current.delete(release)
      try {
        master.disconnect(destination)
      } catch {
        // The audio context may already be closing during app teardown.
      }
      for (const track of destination.stream.getTracks()) track.stop()
    }
    masterCaptureReleasesRef.current.add(release)
    return { stream: destination.stream, release }
  }, [ensureDeckGraph])

  const resetDeckAudioParameters = useCallback((id: DeckId) => {
    const audio = audioElementsRef.current[id]
    if (audio) {
      audio.playbackRate = 1
      audio.preservesPitch = true
    }
    const context = audioContextRef.current
    const nodes = nodesRef.current[id]
    if (!context || !nodes) return
    const frequencies = bipolarFilterFrequencies(DJ_NEUTRAL_VALUES.filter)
    const resonance = bipolarFilterResonance(DJ_NEUTRAL_VALUES.filter)
    nodes.volume.gain.setTargetAtTime(
      channelGainFromPercent(DJ_NEUTRAL_VALUES.volume),
      context.currentTime,
      0.035,
    )
    nodes.highpass.frequency.setTargetAtTime(frequencies.highpass, context.currentTime, 0.035)
    nodes.lowpass.frequency.setTargetAtTime(frequencies.lowpass, context.currentTime, 0.035)
    nodes.highpass.Q.setTargetAtTime(resonance, context.currentTime, 0.035)
    nodes.lowpass.Q.setTargetAtTime(resonance, context.currentTime, 0.035)
  }, [])

  const loadFile = useCallback(
    async (id: DeckId, file?: File, options: LoadFileOptions = {}) => {
      if (!file) return false
      if (
        demoGenerationRef.current &&
        options.demoGeneration !== demoGenerationRef.current
      ) {
        cancelDemoMix()
      }
      try {
        validateAudioFile(file)
        const audio = audioElementsRef.current[id]
        if (!audio) throw new Error(`${deckLabel(id)} is not ready.`)
        const requestId = bpmRequestRef.current[id] + 1
        bpmRequestRef.current[id] = requestId
        disarmGesture(`${deckLabel(id)} changed · gesture pickup reset`)
        const syncSnapshot = bpmSyncRef.current
        if (syncSnapshot) {
          bpmSyncRef.current = null
          setBpmSync(null)
          for (const deckId of DECK_IDS) {
            const deckAudio = audioElementsRef.current[deckId]
            const originalTempo = syncSnapshot.originalTempos[deckId]
            if (deckAudio) {
              deckAudio.playbackRate = 1 + originalTempo / 100
              deckAudio.preservesPitch = true
            }
            patchDeck(deckId, {
              tempo: originalTempo,
              bpmStatus: syncSnapshot.originalStatuses[deckId],
              error: null,
            })
          }
          setBpmSyncMessage('New track loaded · BPM Sync reset')
        }
        if (objectUrlsRef.current[id]) URL.revokeObjectURL(objectUrlsRef.current[id] ?? '')
        const nextUrl = URL.createObjectURL(file)
        objectUrlsRef.current[id] = nextUrl
        audio.pause()
        audio.src = nextUrl
        audio.loop = options.loop ?? false
        resetDeckAudioParameters(id)
        audio.load()
        tapTimesRef.current[id] = []
        const knownBpm = options.knownBpm ? normalizeBpm(options.knownBpm) : null
        patchDeck(id, {
          ...initialDeckState(),
          name: options.title ?? file.name.replace(/\.[^.]+$/, ''),
          loaded: true,
          bpm: knownBpm,
          bpmStatus: knownBpm ? `${knownBpm} BPM demo` : 'Waiting for BPM analysis…',
          analysisStatus: 'Waiting for waveform analysis…',
        })
        if (knownBpm) {
          if (options.demoGeneration) {
            patchDeck(id, {
              overview: generatedDemoOverview(id),
              analysisStatus: 'Generated demo overview · known tempo grid',
            })
            return true
          }
          queueTrackAnalysis(id, file, requestId, knownBpm)
          return true
        }
        if (!shouldAutoAnalyzeBpm(file)) {
          patchDeck(id, {
            bpm: null,
            bpmStatus: 'Track ready · tap BPM (auto analysis is limited to 8 MB)',
          })
          queueTrackAnalysis(id, file, requestId)
          return true
        }
        try {
          const result = await bpmAnalysisQueue.enqueue(
            file,
            () => bpmRequestRef.current[id] === requestId,
            () => {
              if (bpmRequestRef.current[id] === requestId) {
                patchDeck(id, { bpmStatus: 'Analyzing BPM…' })
              }
            },
          )
          if (result.status === 'stale') return false
          patchDeck(id, {
            bpm: result.bpm,
            bpmStatus: result.bpm ? `${result.bpm} BPM detected` : 'Tap BPM to set tempo',
          })
          queueTrackAnalysis(id, file, requestId, result.bpm)
        } catch {
          if (bpmRequestRef.current[id] === requestId) {
            patchDeck(id, { bpm: null, bpmStatus: 'Tap BPM to set tempo' })
            queueTrackAnalysis(id, file, requestId)
          }
        }
        return true
      } catch (error) {
        patchDeck(id, {
          error: error instanceof Error ? error.message : 'The track could not be loaded.',
        })
        return false
      }
    },
    [
      bpmAnalysisQueue,
      cancelDemoMix,
      disarmGesture,
      patchDeck,
      queueTrackAnalysis,
      resetDeckAudioParameters,
    ],
  )

  const togglePlayback = useCallback(
    async (id: DeckId) => {
      const audio = audioElementsRef.current[id]
      if (!audio || !decksRef.current[id].loaded) return
      try {
        if (!audio.paused) {
          audio.pause()
          return
        }
        const graphReady = ensureDeckGraph(id)
        const playbackStarted = audio.play()
        await Promise.all([graphReady, playbackStarted])
      } catch (error) {
        patchDeck(id, {
          error: error instanceof Error ? error.message : 'Playback could not start.',
        })
      }
    },
    [ensureDeckGraph, patchDeck],
  )

  const toggleBoth = useCallback(async () => {
    const readyIds = DECK_IDS.filter((id) => decksRef.current[id].loaded)
    if (readyIds.length !== 2) {
      setGestureStatus('Load both decks to start them together')
      return
    }
    const shouldPause = readyIds.some((id) => decksRef.current[id].playing)
    if (shouldPause) {
      for (const id of readyIds) audioElementsRef.current[id]?.pause()
      return
    }
    try {
      const graphPromises = readyIds.map(ensureDeckGraph)
      const playbackPromises = readyIds.map((id) => {
          const audio = audioElementsRef.current[id]
          if (!audio) throw new Error(`${deckLabel(id)} is not ready.`)
          return audio.play()
        })
      const results = await Promise.allSettled([...graphPromises, ...playbackPromises])
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('One deck could not start.')
      }
    } catch {
      for (const id of readyIds) {
        audioElementsRef.current[id]?.pause()
        patchDeck(id, { playing: false })
      }
      setGestureStatus('The browser blocked one deck. Press play on each deck once.')
    }
  }, [ensureDeckGraph, patchDeck])

  const seek = useCallback(
    (id: DeckId, time: number) => {
      const audio = audioElementsRef.current[id]
      if (!audio || !Number.isFinite(audio.duration)) return
      audio.currentTime = clamp(time, 0, audio.duration)
      patchDeck(id, { currentTime: audio.currentTime })
    },
    [patchDeck],
  )

  const cueDeck = useCallback(
    (id: DeckId) => {
      const audio = audioElementsRef.current[id]
      if (!audio || !decksRef.current[id].loaded) return
      audio.pause()
      try {
        audio.currentTime = 0
        patchDeck(id, { currentTime: 0, playing: false, error: null })
        setGestureStatus(`${deckLabel(id)} returned to the start`)
      } catch (error) {
        patchDeck(id, {
          playing: false,
          error: error instanceof Error ? error.message : 'The cue point could not be restored.',
        })
      }
    },
    [patchDeck],
  )

  const jumpToPhrase = useCallback(
    (id: DeckId, index: number) => {
      const deck = decksRef.current[id]
      seek(id, phraseTimeForIndex(index, deck.duration))
    },
    [seek],
  )

  const setDeckVolume = useCallback(
    (id: DeckId, value: number) => {
      const volume = Math.round(clamp(value, 0, 100))
      const context = audioContextRef.current
      if (context && nodesRef.current[id]) {
        nodesRef.current[id].volume.gain.setTargetAtTime(
          channelGainFromPercent(volume),
          context.currentTime,
          0.045,
        )
      }
      patchDeck(id, { volume })
    },
    [patchDeck],
  )

  const setDeckFilter = useCallback(
    (id: DeckId, value: number, timeConstant = 0.045) => {
      const filter = Math.round(clamp(value, 0, 100))
      const context = audioContextRef.current
      if (context && nodesRef.current[id]) {
        const frequencies = bipolarFilterFrequencies(filter)
        const resonance = bipolarFilterResonance(filter)
        nodesRef.current[id].highpass.frequency.setTargetAtTime(
          frequencies.highpass,
          context.currentTime,
          timeConstant,
        )
        nodesRef.current[id].lowpass.frequency.setTargetAtTime(
          frequencies.lowpass,
          context.currentTime,
          timeConstant,
        )
        nodesRef.current[id].highpass.Q.setTargetAtTime(
          resonance,
          context.currentTime,
          timeConstant,
        )
        nodesRef.current[id].lowpass.Q.setTargetAtTime(
          resonance,
          context.currentTime,
          timeConstant,
        )
      }
      patchDeck(id, { filter })
    },
    [patchDeck],
  )

  const scheduleFilterRelease = useCallback(
    (releaseAt: number) => {
      cancelFilterRelease()
      const finishRelease = () => {
        const now = performance.now()
        const transition = transitionFilterGesture(filterGestureRef.current, {
          type: 'release-timeout',
          now,
        })
        filterGestureRef.current = transition.state
        if (
          transition.command === 'none' &&
          transition.state.phase === 'release-grace'
        ) {
          filterReleaseTimerRef.current = setTimeout(
            finishRelease,
            Math.max(0, transition.state.releaseAt - now),
          )
          return
        }
        filterReleaseTimerRef.current = null
        if (transition.command !== 'reset-neutral' || !transition.deck) return
        setDeckFilter(transition.deck, DJ_NEUTRAL_VALUES.filter, 0.12)
        smoothedGestureRef.current = null
        setGestureStatus(`${deckLabel(transition.deck)} filter returned to neutral`)
      }

      filterReleaseTimerRef.current = setTimeout(
        finishRelease,
        Math.max(0, releaseAt - performance.now()),
      )
    },
    [cancelFilterRelease, setDeckFilter],
  )

  const releaseGestureSession = useCallback(
    (reason: GestureSessionReleaseReason) => {
      const filterDeck =
        filterGestureRef.current.phase === 'idle' ? null : filterGestureRef.current.deck

      cancelFilterRelease()
      gestureEngagedRef.current = false
      gestureRequiresReleaseRef.current = false
      gestureReleasePendingRef.current = null
      setGestureReleaseRequired(false)
      gestureClutchRef.current = createGestureClutchState()
      positionGestureRef.current = null
      filterGestureRef.current = createFilterGestureState()
      smoothedGestureRef.current = null
      lastGestureUpdateAtRef.current = 0
      setGesturePhase('locked')
      if (filterDeck) {
        setDeckFilter(filterDeck, DJ_NEUTRAL_VALUES.filter, 0.12)
      }
      setGestureStatus(GESTURE_SESSION_RELEASE_MESSAGES[reason])
    },
    [cancelFilterRelease, setDeckFilter],
  )

  const applyDeckTempo = useCallback(
    (id: DeckId, value: number) => {
      const tempo = Math.round(clamp(value, -20, 20) * 10) / 10
      const audio = audioElementsRef.current[id]
      if (audio) {
        audio.playbackRate = 1 + tempo / 100
        audio.preservesPitch = true
      }
      patchDeck(id, { tempo })
    },
    [patchDeck],
  )

  const releaseBpmSync = useCallback(
    (message = 'Original BPMs restored') => {
      const snapshot = bpmSyncRef.current
      if (!snapshot) return false
      bpmSyncRef.current = null
      setBpmSync(null)
      for (const id of DECK_IDS) {
        applyDeckTempo(id, snapshot.originalTempos[id])
        patchDeck(id, {
          bpmStatus: snapshot.originalStatuses[id],
          error: null,
        })
      }
      setBpmSyncMessage(message)
      return true
    },
    [applyDeckTempo, patchDeck],
  )

  const setCrossfader = useCallback(
    (value: number) => {
      const next = Math.round(clamp(value, -100, 100))
      crossfaderRef.current = next
      setCrossfaderState(next)
      updateCrossfadeNodes(next)
    },
    [updateCrossfadeNodes],
  )

  const claimManualControl = useCallback(
    (control: DjControl, deck: DeckId = activeDeck) => {
      const label = control === 'volume' ? 'level' : control
      disarmGesture(
        control === 'crossfader'
          ? 'Crossfader under manual control'
          : `${deckLabel(deck)} ${label} under manual control`,
      )
    },
    [activeDeck, disarmGesture],
  )

  const toggleBpmSync = useCallback(() => {
    if (bpmSyncRef.current) {
      releaseBpmSync()
      setGestureStatus('BPM Sync off · original tempos restored')
      return
    }

    const current = decksRef.current
    if (!current.a.bpm || !current.b.bpm) {
      const error = 'Both decks need a detected or tapped BPM before sync.'
      patchDeck('a', { error })
      patchDeck('b', { error })
      setBpmSyncMessage('Set both BPMs first')
      return
    }

    const masterId = chooseSyncMaster(
      current.a.playing,
      current.b.playing,
      crossfaderRef.current,
    )
    const targetId: DeckId = masterId === 'a' ? 'b' : 'a'
    const master = current[masterId]
    const target = current[targetId]
    const masterBpm = master.bpm
    const targetBpm = target.bpm
    if (!masterBpm || !targetBpm) return
    const targetEffectiveBpm = masterBpm * (1 + master.tempo / 100)
    const targetTempo = matchedTempoPercent(targetBpm, targetEffectiveBpm)
    if (targetTempo === null) {
      const error = 'The BPM difference exceeds the ±20% tempo range.'
      patchDeck('a', { error })
      patchDeck('b', { error })
      setBpmSyncMessage('These tracks are outside the safe sync range')
      return
    }

    const snapshot: BpmSyncSnapshot = {
      masterId,
      targetId,
      originalTempos: {
        a: current.a.tempo,
        b: current.b.tempo,
      },
      originalStatuses: {
        a: current.a.bpmStatus,
        b: current.b.bpmStatus,
      },
    }
    bpmSyncRef.current = snapshot
    setBpmSync(snapshot)
    applyDeckTempo(targetId, targetTempo)
    patchDeck(masterId, { error: null })
    patchDeck(targetId, {
      error: null,
      bpmStatus: `Tempo matched to ${targetEffectiveBpm.toFixed(1)} BPM · align the downbeat manually`,
    })
    const message = `${deckLabel(targetId)} follows ${deckLabel(masterId)} at ${targetEffectiveBpm.toFixed(1)} BPM`
    setBpmSyncMessage(message)
    setGestureStatus(`${message} · click BPM Sync again to restore`)
  }, [applyDeckTempo, patchDeck, releaseBpmSync])

  const resetControl = useCallback(
    (control: DjControl = selectedControl, deck: DeckId = activeDeck) => {
      disarmGesture()
      if (control === 'crossfader') {
        setCrossfader(DJ_NEUTRAL_VALUES.crossfader)
        setGestureStatus('Crossfader centered')
        return
      }
      if (control === 'volume') {
        setDeckVolume(deck, DJ_NEUTRAL_VALUES.volume)
      } else {
        setDeckFilter(deck, DJ_NEUTRAL_VALUES.filter)
      }
      const label = control === 'volume' ? 'channel' : control
      setGestureStatus(`${deckLabel(deck)} ${label} reset`)
    },
    [
      activeDeck,
      selectedControl,
      disarmGesture,
      setCrossfader,
      setDeckFilter,
      setDeckVolume,
    ],
  )

  const resetMix = useCallback(() => {
    disarmGesture()
    const syncSnapshot = bpmSyncRef.current
    bpmSyncRef.current = null
    setBpmSync(null)
    setCrossfader(DJ_NEUTRAL_VALUES.crossfader)
    for (const id of DECK_IDS) {
      setDeckVolume(id, DJ_NEUTRAL_VALUES.volume)
      setDeckFilter(id, DJ_NEUTRAL_VALUES.filter)
      applyDeckTempo(id, DJ_NEUTRAL_VALUES.tempo)
      patchDeck(id, {
        error: null,
        ...(syncSnapshot ? { bpmStatus: syncSnapshot.originalStatuses[id] } : {}),
      })
    }
    setBpmSyncMessage('Mix reset · both decks are back at their own BPMs')
    setGestureStatus('Mix reset to neutral')
  }, [
    applyDeckTempo,
    disarmGesture,
    patchDeck,
    setCrossfader,
    setDeckFilter,
    setDeckVolume,
  ])

  const loadDemoMix = useCallback(async () => {
    if (demoGenerationRef.current) return false
    const generation = new AbortController()
    demoGenerationRef.current = generation
    setDemoLoading(true)
    setGestureStatus('Building the local demo set…')
    try {
      await Promise.race([
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 100)),
      ])
      if (generation.signal.aborted) return false
      const { createDemoTracksCooperatively } = await import('../lib/demoAudio')
      if (generation.signal.aborted) return false
      const [deckA, deckB] = await createDemoTracksCooperatively({
        signal: generation.signal,
      })
      if (generation.signal.aborted) return false
      const loaded = await Promise.all([
        loadFile('a', deckA.file, {
          knownBpm: deckA.bpm,
          title: deckA.title,
          loop: true,
          demoGeneration: generation,
        }),
        loadFile('b', deckB.file, {
          knownBpm: deckB.bpm,
          title: deckB.title,
          loop: true,
          demoGeneration: generation,
        }),
      ])
      if (generation.signal.aborted) return false
      if (!loaded.every(Boolean)) {
        setGestureStatus('The demo set could not load · try again')
        return false
      }
      resetMix()
      setGestureStatus('Demo set loaded · press Start both, then open your hand')
      return true
    } catch {
      if (generation.signal.aborted) return false
      setGestureStatus('The demo set could not be built · try again')
      return false
    } finally {
      if (demoGenerationRef.current === generation) {
        demoGenerationRef.current = null
        setDemoLoading(false)
      }
    }
  }, [loadFile, resetMix])

  const tapTempo = useCallback(
    (id: DeckId) => {
      releaseBpmSync('Tap BPM released BPM Sync')
      const now = performance.now()
      const recent = tapTimesRef.current[id].filter((time) => now - time < 2_500)
      recent.push(now)
      tapTimesRef.current[id] = recent.slice(-8)
      const bpm = bpmFromTapTimes(tapTimesRef.current[id])
      patchDeck(id, {
        bpm,
        bpmStatus: bpm ? `${bpm} BPM tapped` : 'Keep tapping on the beat',
      })
    },
    [patchDeck, releaseBpmSync],
  )

  const selectControl = useCallback(
    (control: DjControl, deck: DeckId = activeDeck) => {
      const requiresRelease = disarmGesture()
      if (
        selectedControl === 'filter' &&
        (control !== 'filter' || deck !== activeDeck)
      ) {
        setDeckFilter(activeDeck, DJ_NEUTRAL_VALUES.filter)
      }
      setSelectedControl(control)
      setActiveDeck(deck)
      setGestureStatus(
        requiresRelease
          ? 'Close your fist once, then open your palm to grab the new control'
          : control === 'crossfader'
          ? 'Open your hand, hold steady, then move left or right'
          : control === 'filter'
            ? `Open your palm to grab ${deckLabel(deck)} filter · rotate · fist releases`
            : `Open your palm to grab ${deckLabel(deck)} level · move up or down · fist locks`,
      )
    },
    [activeDeck, disarmGesture, selectedControl, setDeckFilter],
  )

  const handleHandsFrame = useCallback(
    (hands: HandSummary[]) => {
      const now = performance.now()
      const left = hands.find((hand) => hand.label.toLowerCase() === 'left')
      const right = hands.find((hand) => hand.label.toLowerCase() === 'right')
      const deck = decksRef.current[activeDeck].loaded
        ? activeDeck
        : decksRef.current.a.loaded
          ? 'a'
          : decksRef.current.b.loaded
            ? 'b'
            : activeDeck
      const leftOpen = Boolean(left && left.count >= 3)
      const rightOpen = Boolean(right && right.count >= 3)

      if (!decksRef.current[deck].loaded) {
        positionGestureRef.current = null
        filterGestureRef.current = createFilterGestureState()
        gestureEngagedRef.current = false
        setGesturePhase('locked')
        setGestureStatus('Load a track to use hand controls')
        return
      }

      if (!leftOpen) {
        if (positionGestureRef.current?.control === 'volume') positionGestureRef.current = null
      }

      if (!rightOpen) {
        const transition = transitionFilterGesture(filterGestureRef.current, {
          type: 'lost',
          now,
        })
        filterGestureRef.current = transition.state
        if (
          transition.command === 'schedule-neutral' &&
          transition.state.phase === 'release-grace'
        ) {
          scheduleFilterRelease(transition.state.releaseAt)
        }
      }

      if (!leftOpen && !rightOpen) {
        gestureEngagedRef.current = false
        setGesturePhase('locked')
        if (now - lastGestureUpdateAtRef.current > 280) {
          lastGestureUpdateAtRef.current = now
          setGestureStatus(hands.length ? 'Open a hand to grab its control' : 'Waiting for a hand')
        }
        return
      }

      if (now - lastGestureUpdateAtRef.current < 55) return
      lastGestureUpdateAtRef.current = now
      gestureEngagedRef.current = true
      setGesturePhase('armed')

      if (leftOpen && left) {
        const input = 1 - left.y
        let gesture = positionGestureRef.current
        if (gesture?.control !== 'volume' || gesture.deck !== deck) {
          gesture = {
            control: 'volume',
            deck,
            baselineInput: input,
            baselineValue: decksRef.current[deck].volume,
            samples: 1,
            startedAt: now,
            engaged: true,
          }
          positionGestureRef.current = gesture
        } else if (Math.abs(input - gesture.baselineInput) > POSITION_GESTURE_DEAD_ZONE) {
          const target = relativeGestureValue(
            gesture.baselineValue,
            gesture.baselineInput,
            input,
            170,
          )
          const value = smoothBoundedControlValue(
            decksRef.current[deck].volume,
            target,
            0,
            100,
            0.48,
          )
          setDeckVolume(deck, value)
        }
      }

      if (rightOpen && right) {
        const transition = transitionFilterGesture(filterGestureRef.current, {
          type: 'sample',
          deck,
          angle: right.wristAngle,
          currentValue: decksRef.current[deck].filter,
          now,
        })
        filterGestureRef.current = transition.state
        if (transition.command === 'cancel-neutral') cancelFilterRelease()
        if (transition.target !== undefined) {
          const value = smoothBoundedControlValue(
            decksRef.current[deck].filter,
            transition.target,
            0,
            100,
            0.48,
          )
          setDeckFilter(deck, value)
        }
      }

      setGestureStatus(
        `${leftOpen ? `Left hand · volume ${decksRef.current[deck].volume}%` : 'Left hand · volume ready'} · ${rightOpen ? `Right hand · filter ${decksRef.current[deck].filter}%` : 'Right hand · filter ready'}`,
      )
    },
    [
      activeDeck,
      cancelFilterRelease,
      scheduleFilterRelease,
      setDeckFilter,
      setDeckVolume,
    ],
  )

  const handleGestureFrame = useCallback(
    (frame: GestureFrame) => {
      const now = performance.now()
      const applyFilterSample = () => {
        const transition: FilterGestureTransition = transitionFilterGesture(
          filterGestureRef.current,
          {
            type: 'sample',
            deck: activeDeck,
            angle: frame.wristAngle,
            currentValue: decksRef.current[activeDeck].filter,
            now,
          },
        )
        filterGestureRef.current = transition.state
        if (transition.command === 'cancel-neutral') cancelFilterRelease()
        if (transition.command === 'reset-neutral' && transition.deck) {
          cancelFilterRelease()
          gestureEngagedRef.current = false
          smoothedGestureRef.current = null
          setGesturePhase('locked')
          setDeckFilter(transition.deck, DJ_NEUTRAL_VALUES.filter)
          setGestureStatus(`${deckLabel(transition.deck)} filter returned to neutral`)
          return
        }

        const armed = transition.state.phase === 'armed'
        gestureEngagedRef.current = armed
        setGesturePhase(armed ? 'armed' : 'locked')

        if (transition.feedback === 'grabbed') {
          setGestureStatus(
            `${deckLabel(activeDeck)} filter grabbed at ${decksRef.current[activeDeck].filter}% · rotate · fist releases`,
          )
          return
        }
        if (transition.feedback === 'armed' || transition.target === undefined) {
          setGestureStatus(`${deckLabel(activeDeck)} filter held · rotate your wrist`)
          return
        }

        const previous =
          smoothedGestureRef.current?.control === 'filter' &&
          smoothedGestureRef.current.deck === activeDeck
            ? smoothedGestureRef.current.value
            : decksRef.current[activeDeck].filter
        const value = smoothBoundedControlValue(previous, transition.target, 0, 100, 0.48)
        smoothedGestureRef.current = { control: 'filter', deck: activeDeck, value }
        setDeckFilter(activeDeck, value)
        setGestureStatus(
          `${deckLabel(activeDeck)} filter ${Math.round(value)}% · close fist to return to 50%`,
        )
      }

      if (gestureRequiresReleaseRef.current) {
        const releasedPose = !frame.detected || frame.openFingers <= 1
        if (!releasedPose) {
          gestureReleasePendingRef.current = null
          gestureEngagedRef.current = false
          setGesturePhase('locked')
          setGestureStatus('Close your fist once, then open your palm to grab')
          return
        }

        const reason = frame.detected ? 'fist' : 'lost'
        const pending = gestureReleasePendingRef.current
        if (!pending || pending.reason !== reason) {
          gestureReleasePendingRef.current = {
            reason,
            releaseAt:
              now +
              (reason === 'fist'
                ? GESTURE_CLUTCH_FIST_RELEASE_MS
                : GESTURE_CLUTCH_LOST_RELEASE_MS),
          }
          setGestureStatus(
            reason === 'fist'
              ? 'Keep your fist closed to release the previous control'
              : 'Keep your hand out of view to release the previous control',
          )
          return
        }

        if (now < pending.releaseAt) return
        gestureRequiresReleaseRef.current = false
        gestureReleasePendingRef.current = null
        setGestureReleaseRequired(false)
        gestureClutchRef.current = createGestureClutchState()
        setGestureStatus('Released · open your palm to grab the selected control')
        return
      }

      const clutchTransition = transitionGestureClutch(gestureClutchRef.current, {
        detected: frame.detected,
        openFingers: frame.openFingers,
        now,
      })
      gestureClutchRef.current = clutchTransition.state

      if (clutchTransition.feedback === 'release-pending') {
        setGestureStatus(
          clutchTransition.releaseReason === 'fist'
            ? 'Keep your fist closed to release'
            : 'Tracking paused · keep your hand in view',
        )
        return
      }

      if (clutchTransition.feedback === 'released') {
        gestureEngagedRef.current = false
        setGesturePhase('locked')
        positionGestureRef.current = null
        smoothedGestureRef.current = null
        if (selectedControl === 'filter') {
          if (clutchTransition.releaseReason === 'fist') {
            cancelFilterRelease()
            filterGestureRef.current = createFilterGestureState()
            setDeckFilter(activeDeck, DJ_NEUTRAL_VALUES.filter, 0.12)
            setGestureStatus(`${deckLabel(activeDeck)} filter returned to neutral`)
          } else {
            const transition = transitionFilterGesture(filterGestureRef.current, {
              type: 'lost',
              now,
            })
            filterGestureRef.current = transition.state
            if (
              transition.command === 'schedule-neutral' &&
              transition.state.phase === 'release-grace'
            ) {
              scheduleFilterRelease(transition.state.releaseAt)
              setGestureStatus(`${deckLabel(activeDeck)} filter released · returning to 50%`)
            }
          }
        } else {
          filterGestureRef.current = createFilterGestureState()
          setGestureStatus(
            selectedControl === 'volume'
              ? `${deckLabel(activeDeck)} level locked at ${decksRef.current[activeDeck].volume}%`
              : `Crossfader locked at ${Math.round(crossfaderRef.current)}`,
          )
        }
        return
      }

      if (clutchTransition.state.phase !== 'held') {
        gestureEngagedRef.current = false
        setGesturePhase('locked')
        if (now - lastGestureUpdateAtRef.current > 280) {
          lastGestureUpdateAtRef.current = now
          setGestureStatus(
            frame.detected
              ? 'Open your palm to grab the selected control'
              : 'Waiting for a hand',
          )
        }
        return
      }

      if (
        selectedControl === 'filter' &&
        decksRef.current[activeDeck].loaded &&
        filterGestureRef.current.phase === 'release-grace'
      ) {
        lastGestureUpdateAtRef.current = now
        applyFilterSample()
        return
      }
      if (now - lastGestureUpdateAtRef.current < 70) return
      lastGestureUpdateAtRef.current = now

      if (selectedControl === 'crossfader') {
        let gesture = positionGestureRef.current
        if (!gesture || gesture.control !== 'crossfader') {
          gesture = {
            control: 'crossfader',
            deck: 'master',
            baselineInput: frame.x,
            baselineValue: crossfaderRef.current,
            samples: 1,
            startedAt: now,
            engaged: false,
          }
          positionGestureRef.current = gesture
          setGesturePhase('calibrating')
          setGestureStatus('Hand seen · hold steady to arm the crossfader')
          return
        }
        if (!gesture.engaged) {
          if (Math.abs(frame.x - gesture.baselineInput) > POSITION_CALIBRATION_TOLERANCE) {
            gesture.baselineInput = frame.x
            gesture.samples = 1
            gesture.startedAt = now
            setGesturePhase('calibrating')
            setGestureStatus('Keep your hand still for a moment to arm the crossfader')
            return
          }
          gesture.samples += 1
          gesture.baselineInput += (frame.x - gesture.baselineInput) / gesture.samples
          if (now - gesture.startedAt < GESTURE_CALIBRATION_MS) {
            setGesturePhase('calibrating')
            setGestureStatus('Hold steady · calibrating the crossfader pickup')
            return
          }
          gesture.engaged = true
          gestureEngagedRef.current = true
          setGesturePhase('armed')
        }
        if (Math.abs(frame.x - gesture.baselineInput) <= POSITION_GESTURE_DEAD_ZONE) {
          setGestureStatus('Crossfader armed · move left or right')
          return
        }
        const target = relativeGestureValue(
          gesture.baselineValue,
          gesture.baselineInput,
          frame.x,
          200,
        )
        const previous =
          smoothedGestureRef.current?.control === 'crossfader'
            ? smoothedGestureRef.current.value
            : crossfaderRef.current
        const value = smoothBoundedControlValue(previous, target, -100, 100, 0.36)
        smoothedGestureRef.current = { control: 'crossfader', deck: 'master', value }
        setCrossfader(value)
        setGestureStatus('Crossfader follows hand position')
        return
      }
      if (!decksRef.current[activeDeck].loaded) {
        gestureEngagedRef.current = false
        setGesturePhase('locked')
        setGestureStatus(`Load ${deckLabel(activeDeck)} to control it`)
        return
      }
      if (selectedControl === 'volume') {
        const input = 1 - frame.y
        let gesture = positionGestureRef.current
        if (
          !gesture ||
          gesture.control !== 'volume' ||
          gesture.deck !== activeDeck
        ) {
          gesture = {
            control: 'volume',
            deck: activeDeck,
            baselineInput: input,
            baselineValue: decksRef.current[activeDeck].volume,
            samples: 1,
            startedAt: now,
            engaged: true,
          }
          positionGestureRef.current = gesture
          gestureEngagedRef.current = true
          setGesturePhase('armed')
          setGestureStatus(
            `${deckLabel(activeDeck)} level grabbed at ${gesture.baselineValue}% · move up or down · fist locks`,
          )
          return
        }
        if (Math.abs(input - gesture.baselineInput) <= POSITION_GESTURE_DEAD_ZONE) {
          setGestureStatus(`${deckLabel(activeDeck)} level armed · move up or down`)
          return
        }
        const target = relativeGestureValue(
          gesture.baselineValue,
          gesture.baselineInput,
          input,
          170,
        )
        const previous =
          smoothedGestureRef.current?.control === 'volume' &&
          smoothedGestureRef.current.deck === activeDeck
            ? smoothedGestureRef.current.value
            : decksRef.current[activeDeck].volume
        const value = smoothBoundedControlValue(previous, target, 0, 100, 0.48)
        smoothedGestureRef.current = { control: 'volume', deck: activeDeck, value }
        setDeckVolume(activeDeck, value)
        setGestureStatus(
          `${deckLabel(activeDeck)} level ${Math.round(value)}% · close fist to lock`,
        )
      } else if (selectedControl === 'filter') applyFilterSample()
    },
    [
      activeDeck,
      cancelFilterRelease,
      scheduleFilterRelease,
      selectedControl,
      setCrossfader,
      setDeckFilter,
      setDeckVolume,
    ],
  )

  useEffect(() => {
    const cleanups: Array<() => void> = []
    for (const id of DECK_IDS) {
      const audio = audioElementsRef.current[id]
      if (!audio) continue
      const updateMetadata = () =>
        patchDeck(id, { duration: Number.isFinite(audio.duration) ? audio.duration : 0 })
      const updateTime = () => patchDeck(id, { currentTime: audio.currentTime })
      const markPlaying = () => patchDeck(id, { playing: true, error: null })
      const markPaused = () => patchDeck(id, { playing: false })
      const markEnded = () =>
        patchDeck(id, { playing: false, currentTime: decksRef.current[id].duration })
      const markError = () =>
        patchDeck(id, {
          loaded: false,
          playing: false,
          bpm: null,
          bpmStatus: 'Replace this track to continue',
          error: 'This browser could not decode the selected audio file.',
        })
      audio.addEventListener('loadedmetadata', updateMetadata)
      audio.addEventListener('durationchange', updateMetadata)
      audio.addEventListener('timeupdate', updateTime)
      audio.addEventListener('play', markPlaying)
      audio.addEventListener('pause', markPaused)
      audio.addEventListener('ended', markEnded)
      audio.addEventListener('error', markError)
      cleanups.push(() => {
        audio.removeEventListener('loadedmetadata', updateMetadata)
        audio.removeEventListener('durationchange', updateMetadata)
        audio.removeEventListener('timeupdate', updateTime)
        audio.removeEventListener('play', markPlaying)
        audio.removeEventListener('pause', markPaused)
        audio.removeEventListener('ended', markEnded)
        audio.removeEventListener('error', markError)
      })
    }
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [patchDeck])

  useEffect(() => {
    const objectUrls = objectUrlsRef.current
    const bpmRequests = bpmRequestRef.current
    const demoGeneration = demoGenerationRef
    const captureReleases = masterCaptureReleasesRef.current
    const captureGeneration = captureGenerationRef
    return () => {
      captureGeneration.current += 1
      for (const id of DECK_IDS) bpmRequests[id] += 1
      demoGeneration.current?.abort()
      demoGeneration.current = null
      stopMeter()
      if (filterReleaseTimerRef.current !== null) clearTimeout(filterReleaseTimerRef.current)
      for (const id of DECK_IDS) {
        if (objectUrls[id]) URL.revokeObjectURL(objectUrls[id] ?? '')
      }
      for (const release of [...captureReleases]) release()
      const context = audioContextRef.current
      if (context && context.state !== 'closed') void context.close()
      masterNodeRef.current = null
    }
  }, [stopMeter])

  return {
    decks,
    crossfader,
    activeDeck,
    selectedControl,
    gestureStatus,
    gesturePhase,
    gestureReleaseRequired,
    gestureEngaged: gesturePhase === 'armed',
    demoLoading,
    bpmSyncActive: Boolean(bpmSync),
    bpmSyncMessage,
    bpmSyncMaster: bpmSync?.masterId ?? null,
    bpmSyncTarget: bpmSync?.targetId ?? null,
    createMasterCapture,
    setAudioElement,
    cancelDemoMix,
    loadFile,
    loadDemoMix,
    togglePlayback,
    toggleBoth,
    cueDeck,
    seek,
    jumpToPhrase,
    setDeckVolume,
    setDeckFilter,
    setCrossfader,
    claimManualControl,
    toggleBpmSync,
    tapTempo,
    selectControl,
    resetControl,
    resetMix,
    handleGestureFrame,
    handleHandsFrame,
    releaseGestureSession,
  }
}
