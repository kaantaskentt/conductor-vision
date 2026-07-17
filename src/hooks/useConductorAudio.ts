import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp, type GestureFrame } from '../lib/vision'

export type ConductorControl = 'volume' | 'filter' | 'atmosphere' | 'cue'

export type TrackState = {
  name: string
  loaded: boolean
  playing: boolean
  muted: boolean
  duration: number
  currentTime: number
  volume: number
  filter: number
  atmosphere: number
  cueIndex: number
  audioLevel: number
  selectedControl: ConductorControl
  gestureStatus: string
  error: string | null
}

const MAX_AUDIO_BYTES = 100 * 1024 * 1024
const ACCEPTED_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
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

function initialTrackState(): TrackState {
  return {
    name: 'No track loaded',
    loaded: false,
    playing: false,
    muted: false,
    duration: 0,
    currentTime: 0,
    volume: 40,
    filter: 100,
    atmosphere: 0,
    cueIndex: 1,
    audioLevel: 0,
    selectedControl: 'volume',
    gestureStatus: 'Waiting for a hand',
    error: null,
  }
}

function normalizedFilterFrequency(amount: number) {
  const normalized = clamp(amount / 100)
  return 240 + Math.pow(normalized, 2.25) * 17_760
}

export function cueTimeForIndex(cueIndex: number, duration: number) {
  const boundedCue = Math.max(1, Math.min(8, cueIndex))
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return ((boundedCue - 1) / 7) * duration
}

export function useConductorAudio() {
  const [track, setTrack] = useState<TrackState>(initialTrackState)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const filterNodeRef = useRef<BiquadFilterNode | null>(null)
  const dryGainRef = useRef<GainNode | null>(null)
  const delayNodeRef = useRef<DelayNode | null>(null)
  const feedbackNodeRef = useRef<GainNode | null>(null)
  const wetGainRef = useRef<GainNode | null>(null)
  const masterGainRef = useRef<GainNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const analyserBinsRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const meterAnimationRef = useRef<number | null>(null)
  const trackRef = useRef(track)
  const gestureHistoryRef = useRef<Array<{ x: number; time: number }>>([])
  const lastCueGestureAtRef = useRef(0)
  const lastGestureUpdateAtRef = useRef(0)

  useEffect(() => {
    trackRef.current = track
  }, [track])

  const setAudioElement = useCallback((element: HTMLAudioElement | null) => {
    audioElementRef.current = element
  }, [])

  const updateAudioNodes = useCallback((next: Partial<TrackState>) => {
    const context = audioContextRef.current
    const now = context?.currentTime ?? 0
    if (next.volume !== undefined && masterGainRef.current && context) {
      const volume = trackRef.current.muted ? 0 : clamp(next.volume / 100)
      masterGainRef.current.gain.setTargetAtTime(volume, now, 0.035)
    }
    if (next.filter !== undefined && filterNodeRef.current && context) {
      filterNodeRef.current.frequency.setTargetAtTime(normalizedFilterFrequency(next.filter), now, 0.045)
    }
    if (next.atmosphere !== undefined && wetGainRef.current && feedbackNodeRef.current && context) {
      const wet = clamp(next.atmosphere / 100)
      wetGainRef.current.gain.setTargetAtTime(wet * 0.5, now, 0.06)
      feedbackNodeRef.current.gain.setTargetAtTime(0.08 + wet * 0.42, now, 0.06)
    }
  }, [])

  const startMeter = useCallback(() => {
    if (meterAnimationRef.current !== null) return
    let lastUpdate = 0

    const update = (now: number) => {
      const analyser = analyserRef.current
      const bins = analyserBinsRef.current
      if (analyser && bins && now - lastUpdate > 80) {
        analyser.getByteFrequencyData(bins)
        const sampleCount = Math.min(48, bins.length)
        let total = 0
        for (let index = 0; index < sampleCount; index += 1) total += bins[index]
        const audioLevel = Math.round((total / Math.max(sampleCount, 1) / 255) * 100)
        setTrack((current) =>
          current.audioLevel === audioLevel ? current : { ...current, audioLevel },
        )
        lastUpdate = now
      }
      meterAnimationRef.current = requestAnimationFrame(update)
    }

    meterAnimationRef.current = requestAnimationFrame(update)
  }, [])

  const ensureAudioGraph = useCallback(async () => {
    const audio = audioElementRef.current
    if (!audio) throw new Error('The audio player is not ready.')

    if (!audioContextRef.current) {
      const context = new AudioContext()
      const source = context.createMediaElementSource(audio)
      const filter = context.createBiquadFilter()
      const dry = context.createGain()
      const delay = context.createDelay(0.8)
      const feedback = context.createGain()
      const wet = context.createGain()
      const master = context.createGain()
      const analyser = context.createAnalyser()

      filter.type = 'lowpass'
      filter.Q.value = 0.9
      filter.frequency.value = normalizedFilterFrequency(trackRef.current.filter)
      dry.gain.value = 1
      delay.delayTime.value = 0.24
      feedback.gain.value = 0.08
      wet.gain.value = 0
      master.gain.value = trackRef.current.volume / 100
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.78

      source.connect(filter)
      filter.connect(dry)
      dry.connect(master)
      filter.connect(delay)
      delay.connect(feedback)
      feedback.connect(delay)
      delay.connect(wet)
      wet.connect(master)
      master.connect(analyser)
      analyser.connect(context.destination)

      audioContextRef.current = context
      sourceNodeRef.current = source
      filterNodeRef.current = filter
      dryGainRef.current = dry
      delayNodeRef.current = delay
      feedbackNodeRef.current = feedback
      wetGainRef.current = wet
      masterGainRef.current = master
      analyserRef.current = analyser
      analyserBinsRef.current = new Uint8Array(analyser.frequencyBinCount)
      startMeter()
    }

    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume()
  }, [startMeter])

  const loadFile = useCallback((file?: File) => {
    if (!file) return
    try {
      validateAudioFile(file)
      const audio = audioElementRef.current
      if (!audio) throw new Error('The audio player is not ready.')
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      const nextUrl = URL.createObjectURL(file)
      objectUrlRef.current = nextUrl
      audio.pause()
      audio.src = nextUrl
      audio.load()
      gestureHistoryRef.current = []
      setTrack({
        ...initialTrackState(),
        name: file.name.replace(/\.[^.]+$/, ''),
        loaded: true,
        error: null,
      })
    } catch (error) {
      setTrack((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'The track could not be loaded.',
      }))
    }
  }, [])

  const togglePlayback = useCallback(async () => {
    const audio = audioElementRef.current
    if (!audio || !trackRef.current.loaded) return
    try {
      await ensureAudioGraph()
      if (audio.paused) await audio.play()
      else audio.pause()
    } catch (error) {
      setTrack((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Playback could not start.',
      }))
    }
  }, [ensureAudioGraph])

  const seek = useCallback((time: number) => {
    const audio = audioElementRef.current
    if (!audio || !Number.isFinite(audio.duration)) return
    audio.currentTime = clamp(time, 0, audio.duration)
    setTrack((current) => ({ ...current, currentTime: audio.currentTime }))
  }, [])

  const jumpToCue = useCallback((cueIndex: number) => {
    const boundedCue = Math.max(1, Math.min(8, cueIndex))
    const audio = audioElementRef.current
    const duration = audio && Number.isFinite(audio.duration) ? audio.duration : trackRef.current.duration
    if (audio && duration > 0) audio.currentTime = cueTimeForIndex(boundedCue, duration)
    setTrack((current) => ({
      ...current,
      cueIndex: boundedCue,
      currentTime: audio?.currentTime ?? current.currentTime,
      gestureStatus: `Jumped to cue ${boundedCue}`,
    }))
  }, [])

  const toggleMute = useCallback(() => {
    setTrack((current) => {
      const muted = !current.muted
      if (masterGainRef.current && audioContextRef.current) {
        masterGainRef.current.gain.setTargetAtTime(
          muted ? 0 : current.volume / 100,
          audioContextRef.current.currentTime,
          0.035,
        )
      }
      return { ...current, muted }
    })
  }, [])

  const selectControl = useCallback((selectedControl: ConductorControl) => {
    gestureHistoryRef.current = []
    setTrack((current) => ({
      ...current,
      selectedControl,
      gestureStatus:
        selectedControl === 'cue'
          ? 'Swipe left or right'
          : selectedControl === 'filter'
            ? 'Rotate your wrist'
            : 'Move your hand up or down',
    }))
  }, [])

  const handleGestureFrame = useCallback(
    (frame: GestureFrame) => {
      const now = performance.now()
      if (!frame.detected) {
        gestureHistoryRef.current = []
        if (now - lastGestureUpdateAtRef.current > 300) {
          lastGestureUpdateAtRef.current = now
          setTrack((current) =>
            current.gestureStatus === 'Waiting for a hand'
              ? current
              : { ...current, gestureStatus: 'Waiting for a hand' },
          )
        }
        return
      }
      if (!trackRef.current.loaded) {
        if (now - lastGestureUpdateAtRef.current > 500) {
          lastGestureUpdateAtRef.current = now
          setTrack((current) => ({ ...current, gestureStatus: 'Upload a track to begin' }))
        }
        return
      }

      const selected = trackRef.current.selectedControl
      if (selected === 'cue') {
        const history = gestureHistoryRef.current.filter((sample) => now - sample.time < 420)
        history.push({ x: frame.x, time: now })
        gestureHistoryRef.current = history
        const first = history[0]
        const change = first ? frame.x - first.x : 0
        if (Math.abs(change) > 0.18 && now - lastCueGestureAtRef.current > 700) {
          lastCueGestureAtRef.current = now
          jumpToCue(trackRef.current.cueIndex + (change > 0 ? 1 : -1))
          gestureHistoryRef.current = []
        }
        return
      }

      if (now - lastGestureUpdateAtRef.current < 70) return
      lastGestureUpdateAtRef.current = now
      const updates: Partial<TrackState> = {}
      if (selected === 'volume') {
        updates.volume = Math.round(clamp(1 - frame.y) * 100)
        updates.gestureStatus = 'Volume follows hand height'
      } else if (selected === 'filter') {
        const normalizedAngle = clamp((frame.wristAngle + Math.PI) / (Math.PI * 2))
        updates.filter = Math.round(normalizedAngle * 100)
        updates.gestureStatus = 'Filter follows wrist angle'
      } else if (selected === 'atmosphere') {
        updates.atmosphere = Math.round(clamp(1 - frame.y) * 100)
        updates.gestureStatus = 'Atmosphere follows hand height'
      }

      updateAudioNodes(updates)
      setTrack((current) => ({ ...current, ...updates }))
    },
    [jumpToCue, updateAudioNodes],
  )

  useEffect(() => {
    const audio = audioElementRef.current
    if (!audio) return
    const updateMetadata = () => {
      setTrack((current) => ({
        ...current,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      }))
    }
    const updateTime = () => {
      setTrack((current) => ({ ...current, currentTime: audio.currentTime }))
    }
    const markPlaying = () => setTrack((current) => ({ ...current, playing: true, error: null }))
    const markPaused = () => setTrack((current) => ({ ...current, playing: false }))
    const markEnded = () =>
      setTrack((current) => ({ ...current, playing: false, currentTime: current.duration }))
    const markError = () =>
      setTrack((current) => ({
        ...current,
        playing: false,
        error: 'This browser could not decode the selected audio file.',
      }))

    audio.addEventListener('loadedmetadata', updateMetadata)
    audio.addEventListener('durationchange', updateMetadata)
    audio.addEventListener('timeupdate', updateTime)
    audio.addEventListener('play', markPlaying)
    audio.addEventListener('pause', markPaused)
    audio.addEventListener('ended', markEnded)
    audio.addEventListener('error', markError)

    return () => {
      audio.removeEventListener('loadedmetadata', updateMetadata)
      audio.removeEventListener('durationchange', updateMetadata)
      audio.removeEventListener('timeupdate', updateTime)
      audio.removeEventListener('play', markPlaying)
      audio.removeEventListener('pause', markPaused)
      audio.removeEventListener('ended', markEnded)
      audio.removeEventListener('error', markError)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (meterAnimationRef.current !== null) cancelAnimationFrame(meterAnimationRef.current)
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      const context = audioContextRef.current
      if (context && context.state !== 'closed') void context.close()
    }
  }, [])

  return {
    track,
    setAudioElement,
    loadFile,
    togglePlayback,
    seek,
    jumpToCue,
    toggleMute,
    selectControl,
    handleGestureFrame,
  }
}
