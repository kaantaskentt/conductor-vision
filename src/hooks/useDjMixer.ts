import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp, type GestureFrame } from '../lib/vision'

export type DeckId = 'a' | 'b'
export type DjControl = 'crossfader' | 'volume' | 'filter'

export const DJ_NEUTRAL_VALUES = {
  crossfader: 0,
  volume: 82,
  filter: 50,
  tempo: 0,
} as const

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

const DECK_IDS: DeckId[] = ['a', 'b']
const MAX_AUDIO_BYTES = 100 * 1024 * 1024
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
const FILTER_HIGH_MAX_HZ = 12_000
const FILTER_GESTURE_DEAD_ZONE = (7 * Math.PI) / 180
const FILTER_GESTURE_SWEEP = (60 * Math.PI) / 180
const FILTER_RELEASE_MS = 300

export function validateAudioFile(file: File) {
  const hasSupportedType = ACCEPTED_AUDIO_TYPES.has(file.type)
  const hasSupportedExtension = AUDIO_EXTENSION.test(file.name)
  if ((!file.type && !hasSupportedExtension) || (file.type && !hasSupportedType)) {
    throw new Error('Choose an MP3, WAV, FLAC, or OGG audio file.')
  }
  if (file.size > MAX_AUDIO_BYTES) throw new Error('Choose an audio file smaller than 100 MB.')
}

export function phraseTimeForIndex(index: number, duration: number) {
  const boundedIndex = Math.max(1, Math.min(4, index))
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return ((boundedIndex - 1) / 4) * duration
}

export function equalPowerCrossfade(value: number) {
  const position = clamp((value + 100) / 200)
  return {
    a: Math.cos(position * Math.PI * 0.5),
    b: Math.sin(position * Math.PI * 0.5),
  }
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

export function chooseSyncMaster(aPlaying: boolean, bPlaying: boolean): DeckId {
  if (bPlaying && !aPlaying) return 'b'
  return 'a'
}

export function smoothControlValue(current: number, target: number, strength = 0.32) {
  const amount = clamp(strength, 0, 1)
  return current + (target - current) * amount
}

export function bipolarFilterFrequencies(amount: number) {
  const value = clamp(amount, 0, 100)
  if (value < 50) {
    const sweep = (50 - value) / 50
    return {
      highpass: FILTER_HIGH_OPEN_HZ,
      lowpass: FILTER_LOW_OPEN_HZ * Math.pow(FILTER_LOW_MIN_HZ / FILTER_LOW_OPEN_HZ, sweep),
    }
  }
  if (value > 50) {
    const sweep = (value - 50) / 50
    return {
      highpass:
        FILTER_HIGH_OPEN_HZ * Math.pow(FILTER_HIGH_MAX_HZ / FILTER_HIGH_OPEN_HZ, sweep),
      lowpass: FILTER_LOW_OPEN_HZ,
    }
  }
  return { highpass: FILTER_HIGH_OPEN_HZ, lowpass: FILTER_LOW_OPEN_HZ }
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

export function shouldReleaseFilterGesture(lastSeenAt: number, now: number) {
  return now - lastSeenAt >= FILTER_RELEASE_MS
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
    error: null,
  }
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
  const nodesRef = useRef<Partial<Record<DeckId, DeckNodes>>>({})
  const meterAnimationRef = useRef<number | null>(null)
  const bpmRequestRef = useRef<Record<DeckId, number>>({ a: 0, b: 0 })
  const tapTimesRef = useRef<Record<DeckId, number[]>>({ a: [], b: [] })
  const lastGestureUpdateAtRef = useRef(0)
  const smoothedGestureRef = useRef<{
    control: DjControl
    deck: DeckId | 'master'
    value: number
  } | null>(null)
  const filterGestureRef = useRef<{
    deck: DeckId
    baselineAngle: number
    baselineValue: number
    samples: number
    lastSeenAt: number
    engaged: boolean
  } | null>(null)

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

  const setAudioElement = useCallback((id: DeckId, element: HTMLAudioElement | null) => {
    if (element) element.preservesPitch = true
    audioElementsRef.current[id] = element
  }, [])

  const updateCrossfadeNodes = useCallback((value: number) => {
    const context = audioContextRef.current
    if (!context) return
    const gains = equalPowerCrossfade(value)
    for (const id of DECK_IDS) {
      nodesRef.current[id]?.crossfade.gain.setTargetAtTime(gains[id], context.currentTime, 0.065)
    }
  }, [])

  const startMeter = useCallback(() => {
    if (meterAnimationRef.current !== null) return
    let lastUpdate = 0
    const update = (now: number) => {
      if (now - lastUpdate > 80) {
        for (const id of DECK_IDS) {
          const nodes = nodesRef.current[id]
          if (!nodes) continue
          nodes.analyser.getByteFrequencyData(nodes.bins)
          const sampleCount = Math.min(48, nodes.bins.length)
          let total = 0
          for (let index = 0; index < sampleCount; index += 1) total += nodes.bins[index]
          const audioLevel = Math.round((total / Math.max(sampleCount, 1) / 255) * 100)
          if (decksRef.current[id].audioLevel !== audioLevel) patchDeck(id, { audioLevel })
        }
        lastUpdate = now
      }
      meterAnimationRef.current = requestAnimationFrame(update)
    }
    meterAnimationRef.current = requestAnimationFrame(update)
  }, [patchDeck])

  const ensureDeckGraph = useCallback(
    async (id: DeckId) => {
      const audio = audioElementsRef.current[id]
      if (!audio) throw new Error(`${deckLabel(id)} is not ready.`)
      let context = audioContextRef.current
      if (!context) {
        context = new AudioContext()
        audioContextRef.current = context
      }
      if (!nodesRef.current[id]) {
        const source = context.createMediaElementSource(audio)
        const highpass = context.createBiquadFilter()
        const lowpass = context.createBiquadFilter()
        const analyser = context.createAnalyser()
        const volume = context.createGain()
        const crossfade = context.createGain()
        const filterFrequencies = bipolarFilterFrequencies(decksRef.current[id].filter)
        highpass.type = 'highpass'
        highpass.Q.value = 0.82
        highpass.frequency.value = filterFrequencies.highpass
        lowpass.type = 'lowpass'
        lowpass.Q.value = 0.82
        lowpass.frequency.value = filterFrequencies.lowpass
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.78
        volume.gain.value = decksRef.current[id].volume / 100
        crossfade.gain.value = equalPowerCrossfade(crossfaderRef.current)[id]
        source.connect(highpass)
        highpass.connect(lowpass)
        lowpass.connect(analyser)
        analyser.connect(volume)
        volume.connect(crossfade)
        crossfade.connect(context.destination)
        nodesRef.current[id] = {
          source,
          highpass,
          lowpass,
          analyser,
          volume,
          crossfade,
          bins: new Uint8Array(analyser.frequencyBinCount),
        }
        startMeter()
      }
      if (context.state === 'suspended') await context.resume()
    },
    [startMeter],
  )

  const loadFile = useCallback(
    async (id: DeckId, file?: File) => {
      if (!file) return
      const requestId = bpmRequestRef.current[id] + 1
      bpmRequestRef.current[id] = requestId
      try {
        validateAudioFile(file)
        const audio = audioElementsRef.current[id]
        if (!audio) throw new Error(`${deckLabel(id)} is not ready.`)
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
        audio.playbackRate = 1
        audio.preservesPitch = true
        audio.load()
        tapTimesRef.current[id] = []
        patchDeck(id, {
          ...initialDeckState(),
          name: file.name.replace(/\.[^.]+$/, ''),
          loaded: true,
          bpmStatus: 'Analyzing BPM…',
        })
        try {
          const bpm = await detectBpm(file)
          if (bpmRequestRef.current[id] !== requestId) return
          patchDeck(id, {
            bpm,
            bpmStatus: bpm ? `${bpm} BPM detected` : 'Tap BPM to set tempo',
          })
        } catch {
          if (bpmRequestRef.current[id] === requestId) {
            patchDeck(id, { bpm: null, bpmStatus: 'Tap BPM to set tempo' })
          }
        }
      } catch (error) {
        patchDeck(id, {
          error: error instanceof Error ? error.message : 'The track could not be loaded.',
        })
      }
    },
    [patchDeck],
  )

  const togglePlayback = useCallback(
    async (id: DeckId) => {
      const audio = audioElementsRef.current[id]
      if (!audio || !decksRef.current[id].loaded) return
      try {
        await ensureDeckGraph(id)
        if (audio.paused) await audio.play()
        else audio.pause()
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
      await Promise.all(readyIds.map(ensureDeckGraph))
      await Promise.all(readyIds.map((id) => audioElementsRef.current[id]?.play()))
    } catch {
      setGestureStatus('The browser blocked one deck. Press play on each deck once.')
    }
  }, [ensureDeckGraph])

  const seek = useCallback(
    (id: DeckId, time: number) => {
      const audio = audioElementsRef.current[id]
      if (!audio || !Number.isFinite(audio.duration)) return
      audio.currentTime = clamp(time, 0, audio.duration)
      patchDeck(id, { currentTime: audio.currentTime })
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
        nodesRef.current[id].volume.gain.setTargetAtTime(volume / 100, context.currentTime, 0.06)
      }
      patchDeck(id, { volume })
    },
    [patchDeck],
  )

  const setDeckFilter = useCallback(
    (id: DeckId, value: number) => {
      const filter = Math.round(clamp(value, 0, 100))
      const context = audioContextRef.current
      if (context && nodesRef.current[id]) {
        const frequencies = bipolarFilterFrequencies(filter)
        nodesRef.current[id].highpass.frequency.setTargetAtTime(
          frequencies.highpass,
          context.currentTime,
          0.06,
        )
        nodesRef.current[id].lowpass.frequency.setTargetAtTime(
          frequencies.lowpass,
          context.currentTime,
          0.06,
        )
      }
      patchDeck(id, { filter })
    },
    [patchDeck],
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

    const masterId = chooseSyncMaster(current.a.playing, current.b.playing)
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
      bpmStatus: `Synced to ${targetEffectiveBpm.toFixed(1)} BPM · align the downbeat manually`,
    })
    const message = `${deckLabel(targetId)} follows ${deckLabel(masterId)} at ${targetEffectiveBpm.toFixed(1)} BPM`
    setBpmSyncMessage(message)
    setGestureStatus(`${message} · click BPM Sync again to restore`)
  }, [applyDeckTempo, patchDeck, releaseBpmSync])

  const resetControl = useCallback(
    (control: DjControl = selectedControl, deck: DeckId = activeDeck) => {
      smoothedGestureRef.current = null
      filterGestureRef.current = null
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
      setCrossfader,
      setDeckFilter,
      setDeckVolume,
    ],
  )

  const resetMix = useCallback(() => {
    bpmSyncRef.current = null
    setBpmSync(null)
    setCrossfader(DJ_NEUTRAL_VALUES.crossfader)
    for (const id of DECK_IDS) {
      setDeckVolume(id, DJ_NEUTRAL_VALUES.volume)
      setDeckFilter(id, DJ_NEUTRAL_VALUES.filter)
      applyDeckTempo(id, DJ_NEUTRAL_VALUES.tempo)
      patchDeck(id, {
        error: null,
        bpmStatus: decksRef.current[id].bpm
          ? `${decksRef.current[id].bpm} BPM ready`
          : decksRef.current[id].bpmStatus,
      })
    }
    smoothedGestureRef.current = null
    filterGestureRef.current = null
    setBpmSyncMessage('Mix reset · both decks are back at their own BPMs')
    setGestureStatus('Mix reset to neutral')
  }, [applyDeckTempo, patchDeck, setCrossfader, setDeckFilter, setDeckVolume])

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

  const selectControl = useCallback((control: DjControl, deck: DeckId = activeDeck) => {
    smoothedGestureRef.current = null
    filterGestureRef.current = null
    setSelectedControl(control)
    setActiveDeck(deck)
    setGestureStatus(
      control === 'crossfader'
        ? 'Move your hand left or right'
        : control === 'filter'
          ? `Hold steady, then rotate your wrist for ${deckLabel(deck)}`
          : `Move up or down for ${deckLabel(deck)}`,
    )
  }, [activeDeck])

  const handleGestureFrame = useCallback(
    (frame: GestureFrame) => {
      const now = performance.now()
      if (!frame.detected) {
        const filterGesture = filterGestureRef.current
        if (
          selectedControl === 'filter' &&
          filterGesture &&
          shouldReleaseFilterGesture(filterGesture.lastSeenAt, now)
        ) {
          setDeckFilter(filterGesture.deck, DJ_NEUTRAL_VALUES.filter)
          filterGestureRef.current = null
          smoothedGestureRef.current = null
          lastGestureUpdateAtRef.current = now
          setGestureStatus(`${deckLabel(filterGesture.deck)} filter returned to neutral`)
          return
        }
        if (now - lastGestureUpdateAtRef.current > 350) {
          lastGestureUpdateAtRef.current = now
          setGestureStatus('Waiting for a hand')
        }
        return
      }
      if (now - lastGestureUpdateAtRef.current < 70) return
      lastGestureUpdateAtRef.current = now

      if (selectedControl === 'crossfader') {
        const target = frame.x * 200 - 100
        const previous =
          smoothedGestureRef.current?.control === 'crossfader'
            ? smoothedGestureRef.current.value
            : crossfaderRef.current
        const value = smoothControlValue(previous, target, 0.36)
        smoothedGestureRef.current = { control: 'crossfader', deck: 'master', value }
        setCrossfader(value)
        setGestureStatus('Crossfader follows hand position')
        return
      }
      if (!decksRef.current[activeDeck].loaded) {
        setGestureStatus(`Load ${deckLabel(activeDeck)} to control it`)
        return
      }
      if (selectedControl === 'volume') {
        const target = (1 - frame.y) * 100
        const previous =
          smoothedGestureRef.current?.control === 'volume' &&
          smoothedGestureRef.current.deck === activeDeck
            ? smoothedGestureRef.current.value
            : decksRef.current[activeDeck].volume
        const value = smoothControlValue(previous, target, 0.32)
        smoothedGestureRef.current = { control: 'volume', deck: activeDeck, value }
        setDeckVolume(activeDeck, value)
        setGestureStatus(`${deckLabel(activeDeck)} volume follows hand height`)
      } else if (selectedControl === 'filter') {
        let filterGesture = filterGestureRef.current
        if (!filterGesture || filterGesture.deck !== activeDeck) {
          filterGesture = {
            deck: activeDeck,
            baselineAngle: frame.wristAngle,
            baselineValue: decksRef.current[activeDeck].filter,
            samples: 1,
            lastSeenAt: now,
            engaged: false,
          }
          filterGestureRef.current = filterGesture
          setGestureStatus(`Hold steady to arm ${deckLabel(activeDeck)} filter`)
          return
        }

        filterGesture.lastSeenAt = now
        if (filterGesture.samples < 3) {
          filterGesture.samples += 1
          filterGesture.baselineAngle +=
            shortestAngleDelta(frame.wristAngle, filterGesture.baselineAngle) /
            filterGesture.samples
          setGestureStatus(
            filterGesture.samples < 3
              ? `Hold steady to arm ${deckLabel(activeDeck)} filter`
              : `${deckLabel(activeDeck)} filter ready · rotate your wrist`,
          )
          return
        }

        const angleDelta = Math.abs(
          shortestAngleDelta(frame.wristAngle, filterGesture.baselineAngle),
        )
        if (!filterGesture.engaged && angleDelta <= FILTER_GESTURE_DEAD_ZONE) {
          setGestureStatus(`${deckLabel(activeDeck)} filter ready · rotate your wrist`)
          return
        }
        filterGesture.engaged = true
        const target = filterValueFromGesture(
          filterGesture.baselineValue,
          filterGesture.baselineAngle,
          frame.wristAngle,
        )
        const previous =
          smoothedGestureRef.current?.control === 'filter' &&
          smoothedGestureRef.current.deck === activeDeck
            ? smoothedGestureRef.current.value
            : decksRef.current[activeDeck].filter
        const value = smoothControlValue(previous, target, 0.28)
        smoothedGestureRef.current = { control: 'filter', deck: activeDeck, value }
        setDeckFilter(activeDeck, value)
        setGestureStatus(`${deckLabel(activeDeck)} filter follows wrist movement`)
      }
    },
    [
      activeDeck,
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
          playing: false,
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
    return () => {
      if (meterAnimationRef.current !== null) cancelAnimationFrame(meterAnimationRef.current)
      for (const id of DECK_IDS) {
        if (objectUrls[id]) URL.revokeObjectURL(objectUrls[id] ?? '')
      }
      const context = audioContextRef.current
      if (context && context.state !== 'closed') void context.close()
    }
  }, [])

  return {
    decks,
    crossfader,
    activeDeck,
    selectedControl,
    gestureStatus,
    bpmSyncActive: Boolean(bpmSync),
    bpmSyncMessage,
    bpmSyncMaster: bpmSync?.masterId ?? null,
    bpmSyncTarget: bpmSync?.targetId ?? null,
    setAudioElement,
    loadFile,
    togglePlayback,
    toggleBoth,
    seek,
    jumpToPhrase,
    setDeckVolume,
    setDeckFilter,
    setCrossfader,
    toggleBpmSync,
    tapTempo,
    selectControl,
    resetControl,
    resetMix,
    handleGestureFrame,
  }
}
