import { useEffect, useRef, useState } from 'react'
import {
  DrawingUtils,
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  type FaceLandmarkerResult,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import './App.css'

const TARGET_COLORS = {
  red: { rgb: [220, 56, 62], hue: 0, tolerance: 15 },
  orange: { rgb: [245, 132, 42], hue: 28, tolerance: 14 },
  yellow: { rgb: [246, 204, 67], hue: 50, tolerance: 14 },
  green: { rgb: [64, 190, 120], hue: 142, tolerance: 22 },
  cyan: { rgb: [45, 190, 220], hue: 188, tolerance: 18 },
  blue: { rgb: [64, 130, 255], hue: 218, tolerance: 18 },
  purple: { rgb: [170, 96, 255], hue: 265, tolerance: 20 },
  pink: { rgb: [235, 92, 172], hue: 326, tolerance: 18 },
  white: { rgb: [245, 247, 250], hue: 0, tolerance: 180, neutral: 'white' },
  black: { rgb: [25, 31, 42], hue: 0, tolerance: 180, neutral: 'black' },
} as const

const FINGER_JOINTS = {
  thumb: { tip: 4, pip: 3, mcp: 2 },
  index: { tip: 8, pip: 6, mcp: 5 },
  middle: { tip: 12, pip: 10, mcp: 9 },
  ring: { tip: 16, pip: 14, mcp: 13 },
  pinky: { tip: 20, pip: 18, mcp: 17 },
} as const

type CameraStatus = 'idle' | 'loading' | 'running' | 'error'
type VisionMode = 'fingers' | 'motion' | 'color' | 'face' | 'scan' | 'music'
type TargetColor = keyof typeof TARGET_COLORS
type FingerName = keyof typeof FINGER_JOINTS
type FingerState = Record<FingerName, boolean>
type EffectMode = 'filter' | 'reverb' | 'delay'

type HandSummary = {
  id: string
  label: string
  count: number
  raised: FingerState
  x: number
  y: number
}

type ColorCandidate = {
  name: TargetColor
  percent: number
  hex: string
}

type VisualState = {
  dominantColor: string
  targetCoverage: number
  targetHex: string
  bestColorName: TargetColor | 'none'
  bestColorPercent: number
  candidates: ColorCandidate[]
  motionScore: number
  motionDirection: string
  motionChangedPercent: number
  motionCenterX: number
  motionCenterY: number
}

type FaceState = {
  count: number
  smileScore: number
  eyeOpenScore: number
  label: string
}

type AnalysisState = VisualState & FaceState & {
  fingerCount: number | null
  handLabel: string
  hands: HandSummary[]
  fps: number
  targetColor: TargetColor
  aiStatement: string
  framesProcessed: number
  estimatedTokens: number
  raised: FingerState | null
  motionHistory: number[]
}

type DjState = {
  trackName: string
  isLoaded: boolean
  isPlaying: boolean
  volume: number
  muted: boolean
  filterAmount: number
  reverbAmount: number
  delayAmount: number
  bpm: number
  energy: number
  gesture: string
  activeControl: string
  aiStatus: string
  effectMode: EffectMode
  dropMode: boolean
  loopBuild: boolean
  cueIndex: number
}

const EFFECT_MODES: EffectMode[] = ['filter', 'reverb', 'delay']

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function percent(value: number) {
  return Math.round(clamp(value) * 100)
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, ((a.z ?? 0) - (b.z ?? 0)) * 0.35)
}

function angle(a: NormalizedLandmark, b: NormalizedLandmark, c: NormalizedLandmark) {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) }
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) }
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z
  const mag = Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(cb.x, cb.y, cb.z)
  return Math.acos(Math.max(-1, Math.min(1, dot / Math.max(mag, 0.00001)))) * (180 / Math.PI)
}

function countRaisedFingers(landmarks: NormalizedLandmark[], handedness: string) {
  const wrist = landmarks[0]
  const palmScale = Math.max(dist(wrist, landmarks[9]), 0.04)
  const raised = {} as FingerState

  ;(['index', 'middle', 'ring', 'pinky'] as FingerName[]).forEach((name) => {
    const joint = FINGER_JOINTS[name]
    const tip = landmarks[joint.tip]
    const pip = landmarks[joint.pip]
    const mcp = landmarks[joint.mcp]
    const radialOpen = dist(wrist, tip) > dist(wrist, pip) + palmScale * 0.14
    const jointStraight = angle(mcp, pip, tip) > 136
    const verticalOpen = tip.y < pip.y - palmScale * 0.03
    const zOpen = (tip.z ?? 0) < (pip.z ?? 0) + 0.025
    raised[name] = (radialOpen && jointStraight) || (radialOpen && verticalOpen) || (jointStraight && zOpen && dist(mcp, tip) > palmScale * 0.72)
  })

  const thumb = FINGER_JOINTS.thumb
  const thumbTip = landmarks[thumb.tip]
  const thumbIp = landmarks[thumb.pip]
  const thumbMcp = landmarks[thumb.mcp]
  const thumbRadial = dist(wrist, thumbTip) > dist(wrist, thumbIp) + palmScale * 0.1
  const thumbStraight = angle(thumbMcp, thumbIp, thumbTip) > 126
  const thumbSide = handedness === 'Left'
    ? thumbTip.x > thumbIp.x + palmScale * 0.06
    : thumbTip.x < thumbIp.x - palmScale * 0.06
  raised.thumb = (thumbRadial && thumbStraight) || (thumbRadial && thumbSide)

  return { count: Object.values(raised).filter(Boolean).length, raised }
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')).join('')}`
}

function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2)
    else h = 60 * ((rn - gn) / delta + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

function hueDistance(a: number, b: number) {
  const delta = Math.abs(a - b) % 360
  return Math.min(delta, 360 - delta)
}

function matchesColor(r: number, g: number, b: number, targetName: TargetColor) {
  const config = TARGET_COLORS[targetName]
  const hsv = rgbToHsv(r, g, b)
  if ('neutral' in config && config.neutral === 'white') return hsv.s < 0.22 && hsv.v > 0.72
  if ('neutral' in config && config.neutral === 'black') return hsv.v < 0.18
  return hsv.s > 0.28 && hsv.v > 0.18 && hueDistance(hsv.h, config.hue) <= config.tolerance
}

function nearestColorName(r: number, g: number, b: number): TargetColor | 'none' {
  const hsv = rgbToHsv(r, g, b)
  if (hsv.s < 0.18 && hsv.v > 0.72) return 'white'
  if (hsv.v < 0.16) return 'black'
  if (hsv.s < 0.24 || hsv.v < 0.18) return 'none'
  let best: TargetColor = 'red'
  let bestDistance = 999
  ;(Object.keys(TARGET_COLORS) as TargetColor[]).forEach((name) => {
    const config = TARGET_COLORS[name]
    if ('neutral' in config) return
    const distance = hueDistance(hsv.h, config.hue)
    if (distance < bestDistance) {
      best = name
      bestDistance = distance
    }
  })
  return bestDistance < 34 ? best : 'none'
}

function describeRaised(raised: FingerState | null) {
  if (!raised) return 'No hand yet'
  const names = Object.entries(raised).filter(([, value]) => value).map(([name]) => name)
  return names.length ? names.join(', ') : 'closed fist'
}

function classifySmile(face: FaceLandmarkerResult): FaceState {
  const categories = face.faceBlendshapes?.[0]?.categories ?? []
  const byName = Object.fromEntries(categories.map((item) => [item.categoryName, item.score]))
  const smileScore = Math.round((((byName.mouthSmileLeft ?? 0) + (byName.mouthSmileRight ?? 0)) / 2) * 100)
  const blinkScore = Math.round((((byName.eyeBlinkLeft ?? 0) + (byName.eyeBlinkRight ?? 0)) / 2) * 100)
  const count = face.faceLandmarks.length
  const label = count === 0 ? 'No face' : smileScore > 35 ? 'Smile detected' : 'Face tracking'
  return { count, smileScore, eyeOpenScore: Math.max(0, 100 - blinkScore), label }
}

function emptyVisual(targetColor: TargetColor): VisualState {
  const rgb = TARGET_COLORS[targetColor].rgb
  return {
    dominantColor: '#000000',
    targetCoverage: 0,
    targetHex: rgbToHex(rgb[0], rgb[1], rgb[2]),
    bestColorName: 'none',
    bestColorPercent: 0,
    candidates: [],
    motionScore: 0,
    motionDirection: 'still',
    motionChangedPercent: 0,
    motionCenterX: 0.5,
    motionCenterY: 0.5,
  }
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const samplerRef = useRef<HTMLCanvasElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const handRef = useRef<HandLandmarker | null>(null)
  const faceRef = useRef<FaceLandmarker | null>(null)
  const animationRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const filterRef = useRef<BiquadFilterNode | null>(null)
  const delayRef = useRef<DelayNode | null>(null)
  const feedbackRef = useRef<GainNode | null>(null)
  const wetRef = useRef<GainNode | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const lastFrameAtRef = useRef(performance.now())
  const previousGrayRef = useRef<Uint8ClampedArray | null>(null)
  const smoothedMotionRef = useRef(0)
  const handMotionRef = useRef<{ x: number; y: number; t: number; indexX: number; indexY: number }[]>([])
  const lastHandSeenAtRef = useRef(0)
  const fistStartedAtRef = useRef<number | null>(null)
  const twoFingerSwitchAtRef = useRef(0)
  const swipeAtRef = useRef(0)
  const circleAtRef = useRef(0)
  const targetVolumeRef = useRef(0.4)

  const [status, setStatus] = useState<CameraStatus>('idle')
  const [mode, setMode] = useState<VisionMode>('scan')
  const [targetColor, setTargetColor] = useState<TargetColor>('red')
  const [message, setMessage] = useState('Start camera. Hands and face can run together.')
  const [dj, setDj] = useState<DjState>({
    trackName: 'No track loaded',
    isLoaded: false,
    isPlaying: false,
    volume: 40,
    muted: false,
    filterAmount: 0,
    reverbAmount: 0,
    delayAmount: 0,
    bpm: 124,
    energy: 42,
    gesture: 'Waiting for track + hand',
    activeControl: 'Upload MP3/WAV',
    aiStatus: 'DJ deck idle',
    effectMode: 'filter',
    dropMode: false,
    loopBuild: false,
    cueIndex: 1,
  })
  const [analysis, setAnalysis] = useState<AnalysisState>({
    ...emptyVisual('red'),
    fingerCount: null,
    handLabel: '—',
    hands: [],
    fps: 0,
    targetColor: 'red',
    count: 0,
    smileScore: 0,
    eyeOpenScore: 0,
    label: 'Face off',
    aiStatement: 'Camera idle. Everything runs locally in the browser.',
    framesProcessed: 0,
    estimatedTokens: 0,
    raised: null,
    motionHistory: Array.from({ length: 36 }, () => 0),
  })

  useEffect(() => {
    return () => stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadVision() {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm',
    )

    if (!handRef.current) {
      handRef.current = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.32,
        minHandPresenceConfidence: 0.32,
        minTrackingConfidence: 0.32,
      })
    }

    if (!faceRef.current) {
      faceRef.current = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.35,
        minFacePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
        outputFaceBlendshapes: true,
      })
    }
  }

  async function startCamera() {
    try {
      setStatus('loading')
      setMessage('Loading local hand + face models…')
      await loadVision()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) throw new Error('Video element missing')
      video.srcObject = stream
      await video.play()
      setStatus('running')
      setMessage('Camera running. Show one or two hands; face tracking is active too.')
      predictLoop()
    } catch (error) {
      console.error(error)
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Could not start the camera/model.')
    }
  }

  function stopCamera() {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    animationRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    previousGrayRef.current = null
    smoothedMotionRef.current = 0
    if (videoRef.current) videoRef.current.srcObject = null
    setStatus('idle')
    setAnalysis((current) => ({
      ...current,
      fingerCount: null,
      handLabel: '—',
      hands: [],
      fps: 0,
      motionScore: 0,
      motionChangedPercent: 0,
      targetCoverage: 0,
      count: 0,
      raised: null,
      aiStatement: 'Stopped. Press Start to run local vision again.',
    }))
    setMessage('Stopped. Press Start to run it again.')
  }

  function setupAudioGraph() {
    const audio = audioRef.current
    if (!audio) throw new Error('Audio element missing')
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) throw new Error('Web Audio is not supported in this browser')
    const ctx = audioCtxRef.current ?? new AudioContextClass()
    audioCtxRef.current = ctx

    if (!sourceRef.current) {
      const source = ctx.createMediaElementSource(audio)
      const filter = ctx.createBiquadFilter()
      const gain = ctx.createGain()
      const delay = ctx.createDelay(1.2)
      const feedback = ctx.createGain()
      const wet = ctx.createGain()

      filter.type = 'lowpass'
      filter.frequency.value = 20000
      filter.Q.value = 0.75
      gain.gain.value = 0.4
      delay.delayTime.value = 0.18
      feedback.gain.value = 0.12
      wet.gain.value = 0

      source.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      filter.connect(delay)
      delay.connect(feedback)
      feedback.connect(delay)
      delay.connect(wet)
      wet.connect(ctx.destination)

      sourceRef.current = source
      filterRef.current = filter
      gainRef.current = gain
      delayRef.current = delay
      feedbackRef.current = feedback
      wetRef.current = wet
    }

    return ctx
  }

  async function handleMusicUpload(file: File | undefined) {
    if (!file) return
    const valid = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave'].includes(file.type) || /\.(mp3|wav)$/i.test(file.name)
    if (!valid) {
      setDj((current) => ({ ...current, aiStatus: 'Use MP3 or WAV for this deck' }))
      return
    }
    const audio = audioRef.current
    if (!audio) return
    const ctx = setupAudioGraph()
    if (ctx.state === 'suspended') await ctx.resume()
    const url = URL.createObjectURL(file)
    audio.src = url
    audio.loop = true
    audio.volume = 1
    targetVolumeRef.current = 0.4
    gainRef.current?.gain.setTargetAtTime(0.4, ctx.currentTime, 0.22)
    await audio.play()
    setDj((current) => ({
      ...current,
      trackName: file.name,
      isLoaded: true,
      isPlaying: true,
      volume: 40,
      muted: false,
      bpm: 124,
      energy: 48,
      gesture: 'Track loaded',
      activeControl: 'Hand height → volume',
      aiStatus: 'Listening to motion',
    }))
    setMode('music')
  }

  async function toggleMusicPlayback() {
    const audio = audioRef.current
    if (!audio || !dj.isLoaded) return
    const ctx = setupAudioGraph()
    if (ctx.state === 'suspended') await ctx.resume()
    if (audio.paused) {
      await audio.play()
      setDj((current) => ({ ...current, isPlaying: true, aiStatus: 'Listening to motion' }))
    } else {
      audio.pause()
      setDj((current) => ({ ...current, isPlaying: false, aiStatus: 'Paused' }))
    }
  }

  function setDeckVolume(nextVolume: number, timeConstant = 0.22) {
    const ctx = audioCtxRef.current
    const gain = gainRef.current
    if (!ctx || !gain) return
    const clamped = clamp(nextVolume, 0, 1)
    targetVolumeRef.current = clamped
    gain.gain.setTargetAtTime(dj.muted ? 0 : clamped, ctx.currentTime, timeConstant)
  }

  function toggleMute() {
    const ctx = audioCtxRef.current
    const gain = gainRef.current
    if (!ctx || !gain) return
    setDj((current) => {
      const muted = !current.muted
      gain.gain.setTargetAtTime(muted ? 0 : targetVolumeRef.current, ctx.currentTime, 0.18)
      return { ...current, muted, isPlaying: true, gesture: muted ? 'Closed fist mute' : 'Mute released', activeControl: muted ? 'Muted' : 'Volume restored', aiStatus: 'Gesture locked' }
    })
  }

  function cycleEffectMode() {
    setDj((current) => {
      const next = EFFECT_MODES[(EFFECT_MODES.indexOf(current.effectMode) + 1) % EFFECT_MODES.length]
      return { ...current, effectMode: next, gesture: 'Two fingers up', activeControl: `Effect mode: ${next}`, aiStatus: 'Gesture locked' }
    })
  }

  function detectCircle(history: { indexX: number; indexY: number }[]) {
    if (history.length < 18) return false
    const points = history.slice(-22)
    const cx = points.reduce((sum, point) => sum + point.indexX, 0) / points.length
    const cy = points.reduce((sum, point) => sum + point.indexY, 0) / points.length
    const radii = points.map((point) => Math.hypot(point.indexX - cx, point.indexY - cy))
    const avgRadius = radii.reduce((sum, value) => sum + value, 0) / radii.length
    if (avgRadius < 0.035) return false
    let sweep = 0
    for (let i = 1; i < points.length; i += 1) {
      const a = Math.atan2(points[i - 1].indexY - cy, points[i - 1].indexX - cx)
      const b = Math.atan2(points[i].indexY - cy, points[i].indexX - cx)
      let delta = b - a
      if (delta > Math.PI) delta -= Math.PI * 2
      if (delta < -Math.PI) delta += Math.PI * 2
      sweep += delta
    }
    return Math.abs(sweep) > Math.PI * 1.65
  }

  function updateDjFromHand(landmarks: NormalizedLandmark[] | undefined, summary: HandSummary | undefined) {
    const now = performance.now()
    const ctx = audioCtxRef.current
    if (!landmarks || !summary) {
      if (lastHandSeenAtRef.current && now - lastHandSeenAtRef.current > 2000) {
        setDeckVolume(0.4, 0.55)
        setDj((current) => current.isLoaded ? { ...current, volume: Math.round(targetVolumeRef.current * 100), gesture: 'Hand lost', activeControl: 'Returning to 40%', aiStatus: 'Re-centering deck' } : current)
      }
      return
    }

    lastHandSeenAtRef.current = now
    const wrist = landmarks[0]
    const indexTip = landmarks[8]
    const thumbTip = landmarks[4]
    const palmScale = Math.max(dist(wrist, landmarks[9]), 0.04)
    const handHighness = clamp((0.86 - wrist.y) / 0.62)
    const mappedVolume = 0.18 + handHighness * 0.82
    const isFist = summary.count === 0
    const isOpenPalm = summary.count >= 5
    const isTwoFingers = summary.count === 2 && summary.raised.index && summary.raised.middle
    const pinch = clamp(1 - (dist(indexTip, thumbTip) / palmScale - 0.28) / 0.72)
    const wristAngle = Math.atan2(landmarks[5].y - landmarks[17].y, landmarks[5].x - landmarks[17].x)
    const rotationAmount = clamp((wristAngle + Math.PI) / (Math.PI * 2))
    const filterFrequency = 420 + pinch * 15500
    const delayAmount = clamp(rotationAmount)
    const reverbAmount = clamp(Math.abs(rotationAmount - 0.5) * 2)

    handMotionRef.current = [...handMotionRef.current.slice(-30), { x: wrist.x, y: wrist.y, t: now, indexX: indexTip.x, indexY: indexTip.y }]
    const recent = handMotionRef.current
    const older = recent.find((point) => now - point.t > 220) ?? recent[0]
    const dx = wrist.x - older.x

    if (isFist) {
      fistStartedAtRef.current ??= now
      if (now - fistStartedAtRef.current > 1500) {
        fistStartedAtRef.current = now + 999999
        toggleMute()
      }
    } else {
      fistStartedAtRef.current = null
      setDeckVolume(mappedVolume, 0.28)
    }

    if (isTwoFingers && now - twoFingerSwitchAtRef.current > 1600) {
      twoFingerSwitchAtRef.current = now
      cycleEffectMode()
    }

    let cueIndex = dj.cueIndex
    let gesture = isOpenPalm ? 'Open palm: Full Energy Mode' : pinch > 0.62 ? 'Pinch: filter sweep' : isTwoFingers ? 'Two fingers: effect switch' : isFist ? 'Closed fist hold' : 'Hand height: volume ride'
    let activeControl = isFist ? 'Hold to mute' : 'Volume'
    if (Math.abs(dx) > 0.18 && now - swipeAtRef.current > 1200) {
      swipeAtRef.current = now
      cueIndex = clamp(cueIndex + (dx > 0 ? 1 : -1), 1, 8)
      gesture = dx > 0 ? 'Swipe right: next cue' : 'Swipe left: previous cue'
      activeControl = `Cue ${cueIndex}`
    }

    const circle = detectCircle(recent)
    if (circle && now - circleAtRef.current > 1800) {
      circleAtRef.current = now
      gesture = 'Finger circle: loop build-up'
      activeControl = 'Loop build'
    }

    if (ctx) {
      filterRef.current?.frequency.setTargetAtTime(filterFrequency, ctx.currentTime, 0.18)
      filterRef.current?.Q.setTargetAtTime(0.75 + pinch * 8, ctx.currentTime, 0.2)
      delayRef.current?.delayTime.setTargetAtTime(0.08 + delayAmount * 0.42, ctx.currentTime, 0.24)
      feedbackRef.current?.gain.setTargetAtTime(0.08 + delayAmount * 0.34, ctx.currentTime, 0.24)
      wetRef.current?.gain.setTargetAtTime((reverbAmount * 0.18) + (delayAmount * 0.12), ctx.currentTime, 0.28)
    }

    setDj((current) => ({
      ...current,
      volume: current.muted ? 0 : percent(mappedVolume),
      filterAmount: percent(pinch),
      reverbAmount: percent(reverbAmount),
      delayAmount: percent(delayAmount),
      energy: Math.max(percent(mappedVolume), isOpenPalm ? 100 : Math.round((current.energy * 0.7) + (percent(mappedVolume) * 0.3))),
      gesture,
      activeControl,
      aiStatus: isFist ? 'Gesture locking…' : current.isLoaded ? 'Listening to motion' : 'Upload a house track',
      dropMode: isOpenPalm,
      loopBuild: circle,
      cueIndex,
    }))
  }

  function predictLoop() {
    const video = videoRef.current
    if (!video || !canvasRef.current || !handRef.current || !faceRef.current) return

    if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime
      const timestamp = performance.now()
      const hands = handRef.current.detectForVideo(video, timestamp)
      const faces = faceRef.current.detectForVideo(video, timestamp)
      const visual = analyzePixels(video)
      drawResult(hands, faces, visual)

      const now = performance.now()
      const fps = Math.round(1000 / Math.max(now - lastFrameAtRef.current, 1))
      lastFrameAtRef.current = now
      setAnalysis((current) => ({
        ...current,
        fps,
        framesProcessed: current.framesProcessed + 1,
        estimatedTokens: 0,
        motionHistory: [...current.motionHistory.slice(1), visual.motionScore],
      }))
    }

    animationRef.current = requestAnimationFrame(predictLoop)
  }

  function analyzePixels(video: HTMLVideoElement): VisualState {
    const sampler = samplerRef.current ?? document.createElement('canvas')
    samplerRef.current = sampler
    sampler.width = 128
    sampler.height = 72
    const ctx = sampler.getContext('2d', { willReadFrequently: true })
    if (!ctx) return emptyVisual(targetColor)

    ctx.drawImage(video, 0, 0, sampler.width, sampler.height)
    const image = ctx.getImageData(0, 0, sampler.width, sampler.height)
    const data = image.data
    const pixels = data.length / 4
    const targetRgb = TARGET_COLORS[targetColor].rgb
    const counts = Object.fromEntries((Object.keys(TARGET_COLORS) as TargetColor[]).map((name) => [name, 0])) as Record<TargetColor, number>

    let r = 0
    let g = 0
    let b = 0
    let colorfulPixels = 0
    let targetHits = 0
    let motionEnergy = 0
    let changedPixels = 0
    let motionX = 0
    let motionY = 0
    let leftMotion = 0
    let rightMotion = 0
    let upMotion = 0
    let downMotion = 0
    const gray = new Uint8ClampedArray(pixels)
    const previous = previousGrayRef.current

    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4
      const x = pixelIndex % sampler.width
      const y = Math.floor(pixelIndex / sampler.width)
      const pr = data[i]
      const pg = data[i + 1]
      const pb = data[i + 2]
      const hsv = rgbToHsv(pr, pg, pb)
      const nearest = nearestColorName(pr, pg, pb)

      if (nearest !== 'none') counts[nearest] += 1
      if (matchesColor(pr, pg, pb, targetColor)) targetHits += 1
      if (hsv.s > 0.25 && hsv.v > 0.2) {
        r += pr
        g += pg
        b += pb
        colorfulPixels += 1
      }

      const luminance = Math.round(pr * 0.299 + pg * 0.587 + pb * 0.114)
      gray[pixelIndex] = luminance
      if (previous) {
        const delta = Math.abs(luminance - previous[pixelIndex])
        if (delta > 14) {
          const weighted = Math.min(70, delta)
          motionEnergy += weighted
          changedPixels += 1
          motionX += x * weighted
          motionY += y * weighted
          if (x < sampler.width / 2) leftMotion += weighted
          else rightMotion += weighted
          if (y < sampler.height / 2) upMotion += weighted
          else downMotion += weighted
        }
      }
    }

    previousGrayRef.current = gray
    const rawMotion = previous ? Math.min(100, Math.round((motionEnergy / pixels) * 1.45 + (changedPixels / pixels) * 180)) : 0
    smoothedMotionRef.current = smoothedMotionRef.current * 0.62 + rawMotion * 0.38
    const motionScore = Math.round(smoothedMotionRef.current)
    const motionChangedPercent = Math.round((changedPixels / pixels) * 100)
    const motionCenterX = motionEnergy ? motionX / motionEnergy / sampler.width : 0.5
    const motionCenterY = motionEnergy ? motionY / motionEnergy / sampler.height : 0.5
    const horizontal = rightMotion > leftMotion * 1.22 ? 'left side active' : leftMotion > rightMotion * 1.22 ? 'right side active' : ''
    const vertical = downMotion > upMotion * 1.25 ? 'lower frame' : upMotion > downMotion * 1.25 ? 'upper frame' : ''
    const motionDirection = motionScore < 5 ? 'still' : [horizontal, vertical].filter(Boolean).join(' · ') || 'center active'

    const dominantColor = colorfulPixels > 16
      ? rgbToHex(Math.round(r / colorfulPixels), Math.round(g / colorfulPixels), Math.round(b / colorfulPixels))
      : '#9aa7b5'
    const candidates = (Object.keys(TARGET_COLORS) as TargetColor[])
      .map((name) => ({
        name,
        percent: Math.round((counts[name] / pixels) * 100),
        hex: rgbToHex(TARGET_COLORS[name].rgb[0], TARGET_COLORS[name].rgb[1], TARGET_COLORS[name].rgb[2]),
      }))
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 4)
    const best = candidates[0]

    return {
      dominantColor,
      targetCoverage: Math.round((targetHits / pixels) * 100),
      targetHex: rgbToHex(targetRgb[0], targetRgb[1], targetRgb[2]),
      bestColorName: best?.percent ? best.name : 'none',
      bestColorPercent: best?.percent ?? 0,
      candidates,
      motionScore,
      motionDirection,
      motionChangedPercent,
      motionCenterX,
      motionCenterY,
    }
  }

  function drawResult(hands: HandLandmarkerResult, faces: FaceLandmarkerResult, visual: VisualState) {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const drawingUtils = new DrawingUtils(ctx)
    const summaries: HandSummary[] = hands.landmarks.map((landmarks, index) => {
      const handedness = hands.handedness[index]?.[0]?.categoryName ?? `Hand ${index + 1}`
      const result = countRaisedFingers(landmarks, handedness)
      const wrist = landmarks[0]
      const color = index === 0 ? '#58a6ff' : '#22c55e'
      if (mode === 'music') {
        drawDjHand(ctx, landmarks, canvas, index === 0 ? '#22d3ee' : '#f472b6')
      } else {
        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 3 })
        drawingUtils.drawLandmarks(landmarks, { color: '#ffffff', fillColor: '#0f172a', lineWidth: 2, radius: 4 })
      }
      drawPill(ctx, `${handedness}: ${result.count}`, wrist.x * canvas.width + 16, wrist.y * canvas.height - 18, color)
      return {
        id: `${handedness}-${index}`,
        label: handedness,
        count: result.count,
        raised: result.raised,
        x: wrist.x,
        y: wrist.y,
      }
    })

    const shouldDrawFace = mode === 'face' || mode === 'scan'
    if (shouldDrawFace) {
      faces.faceLandmarks.forEach((landmarks) => {
        const xs = landmarks.map((point) => point.x * canvas.width)
        const ys = landmarks.map((point) => point.y * canvas.height)
        const minX = Math.min(...xs)
        const maxX = Math.max(...xs)
        const minY = Math.min(...ys)
        const maxY = Math.max(...ys)
        ctx.strokeStyle = '#8b5cf6'
        ctx.lineWidth = 4
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY)
        drawPill(ctx, 'face active', minX, minY - 12, '#8b5cf6')
      })
    }

    if (mode === 'color' || mode === 'scan') {
      ctx.fillStyle = visual.targetHex
      ctx.globalAlpha = 0.22
      ctx.fillRect(0, canvas.height - 24, Math.max(3, (visual.targetCoverage / 100) * canvas.width), 24)
      ctx.globalAlpha = 1
      drawPill(ctx, `${targetColor}: ${visual.targetCoverage}%`, 16, canvas.height - 34, visual.targetHex)
    }

    if (mode === 'motion' || mode === 'scan') {
      const x = visual.motionCenterX * canvas.width
      const y = visual.motionCenterY * canvas.height
      ctx.beginPath()
      ctx.arc(x, y, Math.max(18, visual.motionScore * 0.75), 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.72)'
      ctx.lineWidth = 4
      ctx.stroke()
    }

    const totalFingers = summaries.reduce((sum, hand) => sum + hand.count, 0)
    const bestHand = summaries[0]
    updateDjFromHand(hands.landmarks[0], bestHand)
    const face = classifySmile(faces)
    const handLabel = summaries.length ? summaries.map((hand) => `${hand.label} ${hand.count}`).join(' + ') : 'No hand'
    const aiStatement = makeStatement(totalFingers, summaries, visual, face)
    setAnalysis((current) => ({
      ...current,
      fingerCount: summaries.length ? totalFingers : null,
      handLabel,
      hands: summaries,
      dominantColor: visual.dominantColor,
      targetColor,
      targetCoverage: visual.targetCoverage,
      targetHex: visual.targetHex,
      bestColorName: visual.bestColorName,
      bestColorPercent: visual.bestColorPercent,
      candidates: visual.candidates,
      motionScore: visual.motionScore,
      motionDirection: visual.motionDirection,
      motionChangedPercent: visual.motionChangedPercent,
      motionCenterX: visual.motionCenterX,
      motionCenterY: visual.motionCenterY,
      aiStatement,
      raised: bestHand?.raised ?? null,
      ...face,
    }))
  }

  function drawPill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#58a6ff') {
    ctx.font = '700 22px Inter, system-ui, sans-serif'
    const width = ctx.measureText(text).width + 24
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)'
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(Math.max(8, x), Math.max(36, y) - 28, width, 36, 18)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, Math.max(8, x) + 12, Math.max(36, y) - 5)
  }

  function drawDjHand(ctx: CanvasRenderingContext2D, landmarks: NormalizedLandmark[], canvas: HTMLCanvasElement, color: string) {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowColor = color
    ctx.shadowBlur = 18
    ctx.strokeStyle = color
    ctx.lineWidth = 3.2
    HandLandmarker.HAND_CONNECTIONS.forEach((connection) => {
      const a = landmarks[connection.start]
      const b = landmarks[connection.end]
      ctx.beginPath()
      ctx.moveTo(a.x * canvas.width, a.y * canvas.height)
      ctx.lineTo(b.x * canvas.width, b.y * canvas.height)
      ctx.stroke()
    })
    landmarks.forEach((point, index) => {
      const radius = [4, 8, 12, 16, 20].includes(index) ? 7 : 4.5
      ctx.beginPath()
      ctx.fillStyle = '#ffffff'
      ctx.arc(point.x * canvas.width, point.y * canvas.height, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.arc(point.x * canvas.width, point.y * canvas.height, radius + 5, 0, Math.PI * 2)
      ctx.stroke()
    })
    ctx.restore()
  }

  function makeStatement(totalFingers: number, hands: HandSummary[], visual: VisualState, face: FaceState) {
    if (mode === 'fingers') return hands.length ? `${hands.length} hand(s): ${totalFingers} total fingers.` : 'No hand yet. Show one or both hands.'
    if (mode === 'color') return `${targetColor}: ${visual.targetCoverage}% match. Best visible color: ${visual.bestColorName} ${visual.bestColorPercent}%.`
    if (mode === 'motion') return `Motion ${visual.motionScore}/100 · ${visual.motionChangedPercent}% of frame changing · ${visual.motionDirection}.`
    if (mode === 'face') return face.count ? `${face.label}. Smile ${face.smileScore}%, eyes open ${face.eyeOpenScore}%.` : 'Face tracking is active, but no face is centered yet.'
    return `${hands.length} hand(s), ${totalFingers} fingers · face: ${face.label} · ${targetColor}: ${visual.targetCoverage}% · motion ${visual.motionScore}/100.`
  }

  const modes: { id: VisionMode; title: string }[] = [
    { id: 'music', title: 'Music' },
    { id: 'scan', title: 'Hands + Face' },
    { id: 'fingers', title: 'Fingers' },
    { id: 'face', title: 'Face' },
    { id: 'motion', title: 'Motion' },
    { id: 'color', title: 'Color' },
  ]

  const graphPoints = analysis.motionHistory.map((value, index) => {
    const x = (index / Math.max(analysis.motionHistory.length - 1, 1)) * 100
    const y = 46 - (Math.min(value, 100) / 100) * 40
    return `${x},${y}`
  }).join(' ')

  if (mode === 'music') {
    return (
      <main className="conductor-app">
        <audio ref={audioRef} preload="metadata" />
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/flac,.mp3,.wav,.flac"
          onChange={(event) => handleMusicUpload(event.target.files?.[0])}
        />

        <aside className="conductor-sidebar">
          <div className="conductor-logo">
            <span>TC</span>
            <div><b>The Conductor</b><small>Don’t touch the deck.</small></div>
          </div>
          <nav className="conductor-nav" aria-label="Conductor navigation">
            {['Perform', 'Tracks', 'Effects', 'Visuals', 'Settings'].map((item) => (
              <button key={item} type="button" className={item === 'Perform' ? 'active' : ''}>{item}</button>
            ))}
          </nav>
          <div className="now-playing-card">
            <span>Now Playing</span>
            <strong>{dj.trackName}</strong>
            <small>AI DJ Mode: House · {dj.bpm} BPM</small>
            <div className="mini-wave">
              {Array.from({ length: 22 }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 19 + dj.energy) % 42)}px` }} />)}
            </div>
          </div>
          <button type="button" className="music-upload-main" onClick={() => fileInputRef.current?.click()}>Music</button>
          <button type="button" className="sidebar-ghost" onClick={() => setMode('scan')}>Back to Vision</button>
        </aside>

        <section className="conductor-main">
          <header className="conductor-header">
            <div>
              <span>Vision Mode — Hand Tracking Active</span>
              <h1>The Conductor</h1>
            </div>
            <div className="ai-badges">
              <b>{dj.isLoaded ? 'AI is listening' : 'AI standby'}</b>
              <b>{analysis.hands.length ? 'Calibrated' : 'Find hand'}</b>
              <b>{status === 'running' ? 'Camera active' : 'Camera idle'}</b>
            </div>
          </header>

          <div className="conductor-camera-card">
            <div className="camera-titlebar">
              <span>Command the track.</span>
              <b>{dj.aiStatus}</b>
            </div>
            <div className="conductor-video-wrap">
              <video ref={videoRef} className="camera" playsInline muted />
              <canvas ref={canvasRef} className="overlay" />
              <div className="conductor-layer" aria-hidden="true">
                <div className="conductor-status">
                  <span>{analysis.hands.length ? 'hand confidence high' : 'waiting for hand'}</span>
                  <span>{analysis.hands.length ? '21 tracking points' : '0 tracking points'}</span>
                  <span>{dj.dropMode ? 'drop armed' : 'gesture locked'}</span>
                </div>
                <div className="conductor-orb">
                  <i />
                  <b>{dj.dropMode ? 'DROP' : dj.effectMode.toUpperCase()}</b>
                </div>
                {status !== 'running' && <div className="camera-prompt">Turn on camera to conduct the track</div>}
              </div>
            </div>
            <div className="gesture-shortcuts">
              {[
                ['Raise hand', 'Volume up'],
                ['Lower hand', 'Volume down'],
                ['Pinch', 'Filter sweep'],
                ['Rotate', 'Echo / reverb'],
                ['Open palm', 'Drop mode'],
                ['Fist hold', 'Mute'],
                ['2 fingers', 'Effect mode'],
                ['Swipe', 'Cue jump'],
              ].map(([gesture, action]) => (
                <span key={gesture}><b>{gesture}</b><small>{action}</small></span>
              ))}
            </div>
          </div>

          <div className="conductor-waveform-panel">
            <div className="waveform-meta"><span>Uploaded house track timeline</span><b>Deck A · Cue {dj.cueIndex}</b></div>
            <div className="wave-strip conductor-wave">
              {Array.from({ length: 64 }, (_, index) => (
                <span key={index} style={{ height: `${16 + ((index * 17 + dj.energy) % 62)}px` }} />
              ))}
            </div>
          </div>
        </section>

        <aside className="conductor-controls">
          <div className="control-card primary-gesture">
            <span>Gesture Detected</span>
            <strong>{dj.gesture}</strong>
            <small>{dj.activeControl}</small>
          </div>
          <div className="control-card volume-card">
            <span>Volume</span>
            <strong>{dj.volume}%</strong>
            <div className="deck-meter"><i style={{ width: `${dj.volume}%` }} /></div>
          </div>
          <div className="control-grid-premium">
            <div><span>Filter</span><strong>{dj.filterAmount}%</strong></div>
            <div><span>Reverb</span><strong>{dj.reverbAmount}%</strong></div>
            <div><span>Delay</span><strong>{dj.delayAmount}%</strong></div>
            <div><span>Energy</span><strong>{dj.energy > 72 ? 'High' : dj.energy > 38 ? 'Medium' : 'Low'}</strong></div>
            <div><span>Effect</span><strong>{dj.effectMode}</strong></div>
            <div><span>Status</span><strong>{dj.muted ? 'Muted' : dj.isPlaying ? 'Live' : 'Armed'}</strong></div>
          </div>
          <div className="transport-card">
            <button type="button" onClick={() => fileInputRef.current?.click()}>Upload Track</button>
            <button type="button" className="secondary" onClick={toggleMusicPlayback} disabled={!dj.isLoaded}>{dj.isPlaying ? 'Pause' : 'Play'}</button>
            <button type="button" className="panic" onClick={toggleMute} disabled={!dj.isLoaded}>{dj.muted ? 'Unmute' : 'Mute'}</button>
          </div>
          <div className="copy-card">
            <b>Motion is the mixer.</b>
            <p>Upload a house track, open camera, then conduct volume, filter, echo, drops, loops, and cues with your hand.</p>
          </div>
          <div className={`status ${status}`}>{message}</div>
          <div className="actions">
            <button type="button" onClick={startCamera} disabled={status === 'loading' || status === 'running'}>{status === 'loading' ? 'Loading…' : 'Start Camera'}</button>
            <button type="button" className="secondary" onClick={stopCamera} disabled={status !== 'running'}>Stop</button>
          </div>
        </aside>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <audio ref={audioRef} preload="metadata" />
      <section className="hero-panel compact">
        <p className="eyebrow">Local camera vision · zero cloud tokens</p>
        <h1>Vision Playground</h1>
        <p className="lede">Hands, face, motion, and target color detection running locally in-browser.</p>
      </section>

      <section className="stage-card simple">
        <div className="video-wrap">
          <video ref={videoRef} className="camera" playsInline muted />
          <canvas ref={canvasRef} className="overlay" />
          <div className="hud top-left">
            <strong>{mode.toUpperCase()}</strong>
            <span>{analysis.aiStatement}</span>
          </div>
          <div className="hud top-right">
            <strong>Local</strong>
            <span>{analysis.estimatedTokens} cloud tokens</span>
          </div>
          {status !== 'running' && <div className="placeholder">Camera preview appears here</div>}
        </div>

        <aside className="control-panel simple-panel">
          <div className="mode-tabs" aria-label="Vision modes">
            {modes.map((item) => (
              <button key={item.id} type="button" className={mode === item.id ? 'active' : ''} onClick={() => setMode(item.id)}>{item.title}</button>
            ))}
          </div>

          <div className="dual-metric">
            <div className="hero-number compact-number">
              <span>Fingers</span>
              <strong>{analysis.fingerCount ?? '—'}</strong>
            </div>
            <div className="hero-number compact-number face-number">
              <span>Faces</span>
              <strong>{analysis.count}</strong>
            </div>
          </div>

          <div className="hands-card">
            <span className="section-label">Hands detected</span>
            {analysis.hands.length ? analysis.hands.map((hand) => (
              <div className="hand-row" key={hand.id}>
                <b>{hand.label}</b>
                <strong>{hand.count}</strong>
                <small>{describeRaised(hand.raised)}</small>
              </div>
            )) : <p>No hands yet. Show one or two hands.</p>}
          </div>

          {(mode === 'face' || mode === 'scan') && (
            <div className="mini-grid">
              <div><span>Face status</span><strong>{analysis.label}</strong></div>
              <div><span>Smile</span><strong>{analysis.smileScore}%</strong></div>
              <div><span>Eyes open</span><strong>{analysis.eyeOpenScore}%</strong></div>
              <div><span>Face scan</span><strong>{status === 'running' ? 'Active' : 'Idle'}</strong></div>
            </div>
          )}

          {(mode === 'motion' || mode === 'scan') && (
            <div className="graph-card">
              <div className="graph-head"><span>Motion curve</span><strong>{analysis.motionScore}/100</strong></div>
              <svg viewBox="0 0 100 50" preserveAspectRatio="none" aria-label="Motion graph">
                <path d="M0 46 C20 46 22 16 50 16 C78 16 80 46 100 46" className="bell" />
                <polyline points={graphPoints} className="motion-line" />
              </svg>
              <p>{analysis.motionChangedPercent}% changing · {analysis.motionDirection}</p>
            </div>
          )}

          {(mode === 'color' || mode === 'scan') && (
            <div className="color-card">
              <label>
                Target color
                <select value={targetColor} onChange={(event) => setTargetColor(event.target.value as TargetColor)}>
                  {Object.keys(TARGET_COLORS).map((color) => <option key={color} value={color}>{color}</option>)}
                </select>
              </label>
              <div className="color-result">
                <i style={{ background: analysis.targetHex }} />
                <strong>{analysis.targetCoverage}% {targetColor}</strong>
              </div>
              <p>Best visible match: <b>{analysis.bestColorName}</b> {analysis.bestColorPercent}%.</p>
              <div className="color-chips">
                {analysis.candidates.map((candidate) => (
                  <span key={candidate.name}><i style={{ background: candidate.hex }} />{candidate.name} {candidate.percent}%</span>
                ))}
              </div>
            </div>
          )}

          <div className="mini-grid">
            <div><span>FPS</span><strong>{analysis.fps || '—'}</strong></div>
            <div><span>Cloud tokens</span><strong>{analysis.estimatedTokens}</strong></div>
          </div>

          <div className={`status ${status}`}>{message}</div>
          <div className="actions">
            <button type="button" onClick={startCamera} disabled={status === 'loading' || status === 'running'}>{status === 'loading' ? 'Loading…' : 'Start'}</button>
            <button type="button" className="secondary" onClick={stopCamera} disabled={status !== 'running'}>Stop</button>
          </div>
        </aside>
      </section>
    </main>
  )}

export default App
