import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp, type GestureFrame } from '../lib/vision'

export type DeckId = 'a' | 'b'
export type DjControl = 'crossfader' | 'volume' | 'filter' | 'tempo'

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
  filter: BiquadFilterNode
  analyser: AnalyserNode
  volume: GainNode
  crossfade: GainNode
  bins: Uint8Array<ArrayBuffer>
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
    volume: 82,
    filter: 100,
    tempo: 0,
    bpm: null,
    bpmStatus: 'Load a track',
    audioLevel: 0,
    error: null,
  }
}

function normalizedFilterFrequency(amount: number) {
  const normalized = clamp(amount / 100)
  return 240 + Math.pow(normalized, 2.25) * 17_760
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
  const decksRef = useRef(decks)
  const crossfaderRef = useRef(crossfader)
  const audioElementsRef = useRef<Record<DeckId, HTMLAudioElement | null>>({ a: null, b: null })
  const objectUrlsRef = useRef<Record<DeckId, string | null>>({ a: null, b: null })
  const audioContextRef = useRef<AudioContext | null>(null)
  const nodesRef = useRef<Partial<Record<DeckId, DeckNodes>>>({})
  const meterAnimationRef = useRef<number | null>(null)
  const bpmRequestRef = useRef<Record<DeckId, number>>({ a: 0, b: 0 })
  const tapTimesRef = useRef<Record<DeckId, number[]>>({ a: [], b: [] })
  const lastGestureUpdateAtRef = useRef(0)

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
      nodesRef.current[id]?.crossfade.gain.setTargetAtTime(gains[id], context.currentTime, 0.025)
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
        const filter = context.createBiquadFilter()
        const analyser = context.createAnalyser()
        const volume = context.createGain()
        const crossfade = context.createGain()
        filter.type = 'lowpass'
        filter.Q.value = 0.9
        filter.frequency.value = normalizedFilterFrequency(decksRef.current[id].filter)
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.78
        volume.gain.value = decksRef.current[id].volume / 100
        crossfade.gain.value = equalPowerCrossfade(crossfaderRef.current)[id]
        source.connect(filter)
        filter.connect(analyser)
        analyser.connect(volume)
        volume.connect(crossfade)
        crossfade.connect(context.destination)
        nodesRef.current[id] = {
          source,
          filter,
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
        nodesRef.current[id].volume.gain.setTargetAtTime(volume / 100, context.currentTime, 0.035)
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
        nodesRef.current[id].filter.frequency.setTargetAtTime(
          normalizedFilterFrequency(filter),
          context.currentTime,
          0.045,
        )
      }
      patchDeck(id, { filter })
    },
    [patchDeck],
  )

  const setDeckTempo = useCallback(
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

  const setCrossfader = useCallback(
    (value: number) => {
      const next = Math.round(clamp(value, -100, 100))
      crossfaderRef.current = next
      setCrossfaderState(next)
      updateCrossfadeNodes(next)
    },
    [updateCrossfadeNodes],
  )

  const syncDeck = useCallback(
    (id: DeckId, targetId: DeckId) => {
      const source = decksRef.current[id]
      const target = decksRef.current[targetId]
      if (!source.bpm || !target.bpm) {
        patchDeck(id, { error: 'Both decks need a detected or tapped BPM before sync.' })
        return
      }
      const targetEffectiveBpm = target.bpm * (1 + target.tempo / 100)
      const tempo = matchedTempoPercent(source.bpm, targetEffectiveBpm)
      if (tempo === null) {
        patchDeck(id, { error: 'The BPM difference exceeds the ±20% tempo range.' })
        return
      }
      setDeckTempo(id, tempo)
      const matchedBpm = source.bpm * (1 + tempo / 100)
      const relationship =
        Math.abs(matchedBpm - targetEffectiveBpm) < 1
          ? 'Matched'
          : matchedBpm < targetEffectiveBpm
            ? 'Half-time match'
            : 'Double-time match'
      patchDeck(id, {
        error: null,
        bpmStatus: `${relationship} to ${targetEffectiveBpm.toFixed(1)} BPM · align the downbeat manually`,
      })
    },
    [patchDeck, setDeckTempo],
  )

  const tapTempo = useCallback(
    (id: DeckId) => {
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
    [patchDeck],
  )

  const selectControl = useCallback((control: DjControl, deck: DeckId = activeDeck) => {
    setSelectedControl(control)
    setActiveDeck(deck)
    setGestureStatus(
      control === 'crossfader'
        ? 'Move your hand left or right'
        : control === 'filter'
          ? `Rotate your wrist for ${deckLabel(deck)}`
          : control === 'tempo'
            ? `Move left or right to trim ${deckLabel(deck)}`
            : `Move up or down for ${deckLabel(deck)}`,
    )
  }, [activeDeck])

  const handleGestureFrame = useCallback(
    (frame: GestureFrame) => {
      const now = performance.now()
      if (!frame.detected) {
        if (now - lastGestureUpdateAtRef.current > 350) {
          lastGestureUpdateAtRef.current = now
          setGestureStatus('Waiting for a hand')
        }
        return
      }
      if (now - lastGestureUpdateAtRef.current < 70) return
      lastGestureUpdateAtRef.current = now

      if (selectedControl === 'crossfader') {
        setCrossfader(frame.x * 200 - 100)
        setGestureStatus('Crossfader follows hand position')
        return
      }
      if (!decksRef.current[activeDeck].loaded) {
        setGestureStatus(`Load ${deckLabel(activeDeck)} to control it`)
        return
      }
      if (selectedControl === 'volume') {
        setDeckVolume(activeDeck, (1 - frame.y) * 100)
        setGestureStatus(`${deckLabel(activeDeck)} volume follows hand height`)
      } else if (selectedControl === 'filter') {
        const normalizedAngle = clamp((frame.wristAngle + Math.PI) / (Math.PI * 2))
        setDeckFilter(activeDeck, normalizedAngle * 100)
        setGestureStatus(`${deckLabel(activeDeck)} filter follows wrist angle`)
      } else if (selectedControl === 'tempo') {
        setDeckTempo(activeDeck, frame.x * 16 - 8)
        setGestureStatus(`${deckLabel(activeDeck)} tempo follows horizontal position`)
      }
    },
    [
      activeDeck,
      selectedControl,
      setCrossfader,
      setDeckFilter,
      setDeckTempo,
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
    setAudioElement,
    loadFile,
    togglePlayback,
    toggleBoth,
    seek,
    jumpToPhrase,
    setDeckVolume,
    setDeckFilter,
    setDeckTempo,
    setCrossfader,
    syncDeck,
    tapTempo,
    selectControl,
    handleGestureFrame,
  }
}
