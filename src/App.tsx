import { useEffect, useRef, useState, type MouseEvent } from 'react'
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
type VisionMode = 'fingers' | 'motion' | 'color' | 'face' | 'scan' | 'music' | 'lab'
type TargetColor = keyof typeof TARGET_COLORS
type FingerName = keyof typeof FINGER_JOINTS
type FingerState = Record<FingerName, boolean>
type EffectMode = 'filter' | 'reverb' | 'delay'
type GestureMode = 'none' | 'volume' | 'filter' | 'reverb' | 'mute' | 'swipe'
type DeckControl = 'none' | 'volume' | 'filter' | 'reverb' | 'mute' | 'cue'
type LabModuleId = 'segment' | 'depth' | 'hands' | 'music'
type LabPoint = { x: number; y: number; displayX: number; displayY: number }
type LabSourceSize = { width: number; height: number }

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
  confidence: number
  gestureLocked: boolean
  nextHint: string
  selectedControl: DeckControl
  tapTarget: DeckControl
  tapProgress: number
  audioLevel: number
  beatPulse: number
}


const CONTROL_LABELS: Record<DeckControl, { title: string; hint: string; action: string }> = {
  none: { title: 'No control', hint: 'Tap a control to begin.', action: 'Idle' },
  volume: { title: 'Volume', hint: 'Move hand up/down.', action: 'Vertical hand motion' },
  filter: { title: 'Filter', hint: 'Rotate wrist like a knob.', action: 'Wrist rotation' },
  reverb: { title: 'Reverb', hint: 'Move hand up/down.', action: 'Atmosphere lift' },
  mute: { title: 'Mute / Pause', hint: 'Tap to toggle.', action: 'Direct toggle' },
  cue: { title: 'Cue Jump', hint: 'Swipe left/right.', action: 'Horizontal swipe' },
}
const CONTROL_ORDER: DeckControl[] = ['volume', 'filter', 'reverb', 'mute', 'cue']

const LAB_MODULES: Array<{
  id: LabModuleId
  title: string
  model: string
  status: 'Live' | 'On-demand'
  description: string
  examples: string[]
}> = [
  { id: 'segment', title: 'Segment', model: 'SlimSAM / Segment Anything', status: 'On-demand', description: 'Upload or capture a frame, click the object, and generate a real segmentation mask in the browser.', examples: ['Click person', 'Click mug', 'Click chair'] },
  { id: 'depth', title: 'Depth', model: 'Depth Anything V2 Small', status: 'On-demand', description: 'Turn an uploaded/captured frame into a real near/far depth map in the browser.', examples: ['Room depth', 'Desk depth', 'AR map'] },
  { id: 'hands', title: 'Hands', model: 'MediaPipe Hands', status: 'Live', description: 'Real-time hands, landmarks, fingers, pinch, fist, and palm signals.', examples: ['Fingers up', 'Air mouse', 'Gesture test'] },
  { id: 'music', title: 'Conductor', model: 'MediaPipe Hands + Web Audio', status: 'Live', description: 'Gesture-controlled DJ deck with selected controls.', examples: ['Volume hand ride', 'Filter knob', 'Cue jump'] },
]

const SAM_MODEL_ID = 'Xenova/slimsam-77-uniform'
const DEPTH_MODEL_ID = 'onnx-community/depth-anything-v2-small'

let samLoader: Promise<{ model: any; processor: any; RawImage: any }> | null = null
let depthLoader: Promise<{ estimator: any; RawImage: any }> | null = null

async function loadSam() {
  samLoader ??= import('@huggingface/transformers').then(async ({ SamModel, AutoProcessor, RawImage }) => ({
    model: await SamModel.from_pretrained(SAM_MODEL_ID, { dtype: 'q8', device: 'wasm' } as any),
    processor: await AutoProcessor.from_pretrained(SAM_MODEL_ID),
    RawImage,
  }))
  return samLoader
}

async function loadDepth() {
  depthLoader ??= import('@huggingface/transformers').then(async ({ pipeline, RawImage }) => ({
    estimator: await pipeline('depth-estimation', DEPTH_MODEL_ID, { dtype: 'q8', device: 'wasm' } as any),
    RawImage,
  }))
  return depthLoader
}

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


function cameraErrorMessage(error: unknown) {
  if (!window.isSecureContext) return 'Camera requires HTTPS or localhost. Open the secure Vercel URL and try again.'
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Camera permission was blocked. Allow camera access in the browser, then press Start Camera again.'
    if (error.name === 'NotFoundError') return 'No camera was found. Connect a webcam or use a device with a camera.'
    if (error.name === 'NotReadableError') return 'The camera is already in use by another app. Close it and try again.'
  }
  if (error instanceof Error && /fetch|network|model|wasm/i.test(error.message)) return 'The local vision model could not load. Check the connection and refresh.'
  return 'Could not start the camera. Refresh once, then try Start Camera again.'
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
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioBinsRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const lastFrameAtRef = useRef(performance.now())
  const previousGrayRef = useRef<Uint8ClampedArray | null>(null)
  const smoothedMotionRef = useRef(0)
  const handMotionRef = useRef<{ x: number; y: number; t: number; indexX: number; indexY: number }[]>([])
  const lastHandSeenAtRef = useRef(0)
  const fistStartedAtRef = useRef<number | null>(null)
  const swipeAtRef = useRef(0)
  const targetVolumeRef = useRef(0.4)
  const gestureLockRef = useRef<{ mode: GestureMode; until: number; confidence: number }>({ mode: 'none', until: 0, confidence: 0 })
  const calibrationRef = useRef<{ ready: boolean; samples: number; baselineY: number; handScale: number }>({ ready: false, samples: 0, baselineY: 0.62, handScale: 0.16 })
  const previousTwoHandYRef = useRef<number | null>(null)
  const smoothedFilterRef = useRef(1)
  const smoothedReverbRef = useRef(0)
  const gestureCandidateRef = useRef<{ mode: GestureMode; since: number }>({ mode: 'none', since: 0 })
  const controlHoverRef = useRef<{ control: DeckControl; since: number; toggled: boolean }>({ control: 'none', since: 0, toggled: false })
  const audioUrlRef = useRef<string | null>(null)
  const modeRef = useRef<VisionMode>('scan')
  const targetColorRef = useRef<TargetColor>('red')
  const djRef = useRef<DjState | null>(null)
  const statusRef = useRef<CameraStatus>('idle')

  const [status, setStatus] = useState<CameraStatus>('idle')
  const [mode, setMode] = useState<VisionMode>('scan')
  const [targetColor, setTargetColor] = useState<TargetColor>('red')
  const [labModule, setLabModule] = useState<LabModuleId>('segment')
  const [labPrompt, setLabPrompt] = useState('Click an object')
  const [labUpload, setLabUpload] = useState<string | null>(null)
  const [labArtifact, setLabArtifact] = useState<string | null>(null)
  const [labPoint, setLabPoint] = useState<LabPoint | null>(null)
  const [labSourceSize, setLabSourceSize] = useState<LabSourceSize | null>(null)
  const [labResult, setLabResult] = useState('Two real model demos: Segment Anything and Depth Anything. Upload/capture a frame to start.')
  const [labBusy, setLabBusy] = useState(false)
  const [message, setMessage] = useState('Start camera. Hands and face can run together.')
  const [dj, setDj] = useState<DjState>({
    trackName: 'No track loaded',
    isLoaded: false,
    isPlaying: false,
    volume: 40,
    muted: false,
    filterAmount: 100,
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
    confidence: 0,
    gestureLocked: false,
    nextHint: 'Upload a track, then select a control.',
    selectedControl: 'none',
    tapTarget: 'none',
    tapProgress: 0,
    audioLevel: 0,
    beatPulse: 0,
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
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    targetColorRef.current = targetColor
  }, [targetColor])

  useEffect(() => {
    djRef.current = dj
  }, [dj])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !streamRef.current) return
    video.srcObject = streamRef.current
    void video.play().catch(() => undefined)
  }, [mode])

  useEffect(() => {
    return () => {
      stopCamera()
      cleanupAudio()
    }
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
    if (statusRef.current === 'loading' || statusRef.current === 'running') return
    try {
      setStatus('loading')
      calibrationRef.current = { ready: false, samples: 0, baselineY: 0.62, handScale: 0.16 }
      gestureLockRef.current = { mode: 'none', until: 0, confidence: 0 }
      gestureCandidateRef.current = { mode: 'none', since: 0 }
      controlHoverRef.current = { control: 'none', since: 0, toggled: false }
      setMessage('Loading local hand + face models…')
      await loadVision()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      animationRef.current = null
      lastVideoTimeRef.current = -1
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
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
      setStatus('error')
      setMessage(cameraErrorMessage(error))
    }
  }

  function stopCamera() {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    animationRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    previousGrayRef.current = null
    smoothedMotionRef.current = 0
    handMotionRef.current = []
    previousTwoHandYRef.current = null
    fistStartedAtRef.current = null
    gestureLockRef.current = { mode: 'none', until: 0, confidence: 0 }
    if (videoRef.current) videoRef.current.srcObject = null
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
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

  function cleanupAudio() {
    audioRef.current?.pause()
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = null
    audioRef.current = null
    sourceRef.current?.disconnect()
    filterRef.current?.disconnect()
    gainRef.current?.disconnect()
    delayRef.current?.disconnect()
    feedbackRef.current?.disconnect()
    wetRef.current?.disconnect()
    analyserRef.current?.disconnect()
    sourceRef.current = null
    filterRef.current = null
    gainRef.current = null
    delayRef.current = null
    feedbackRef.current = null
    wetRef.current = null
    analyserRef.current = null
    audioBinsRef.current = null
    void audioCtxRef.current?.close().catch(() => undefined)
    audioCtxRef.current = null
  }

  function setupAudioGraph() {
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    audio.preload = 'metadata'
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) throw new Error('Web Audio is not supported in this browser')
    const ctx = audioCtxRef.current ?? new AudioContextClass()
    audioCtxRef.current = ctx

    if (!sourceRef.current) {
      const source = ctx.createMediaElementSource(audio)
      const analyser = ctx.createAnalyser()
      const filter = ctx.createBiquadFilter()
      const gain = ctx.createGain()
      const delay = ctx.createDelay(1.2)
      const feedback = ctx.createGain()
      const wet = ctx.createGain()

      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.82
      filter.type = 'lowpass'
      filter.frequency.value = 20000
      filter.Q.value = 0.75
      gain.gain.value = 0.4
      delay.delayTime.value = 0.18
      feedback.gain.value = 0.12
      wet.gain.value = 0

      source.connect(analyser)
      analyser.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      filter.connect(delay)
      delay.connect(feedback)
      feedback.connect(delay)
      delay.connect(wet)
      wet.connect(ctx.destination)

      sourceRef.current = source
      analyserRef.current = analyser
      audioBinsRef.current = new Uint8Array(analyser.frequencyBinCount)
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
    const valid = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'audio/x-flac'].includes(file.type) || /\.(mp3|wav|flac)$/i.test(file.name)
    if (!valid) {
      setDj((current) => ({ ...current, aiStatus: 'Use MP3, WAV, or FLAC for this deck' }))
      return
    }
    try {
      const ctx = setupAudioGraph()
    const audio = audioRef.current
    if (!audio) return
    if (ctx.state === 'suspended') await ctx.resume()
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    const url = URL.createObjectURL(file)
    audioUrlRef.current = url
    audio.src = url
    audio.loop = true
    audio.volume = 1
    targetVolumeRef.current = 0.4
    smoothedFilterRef.current = 1
    smoothedReverbRef.current = 0
    calibrationRef.current = { ready: false, samples: 0, baselineY: 0.62, handScale: 0.16 }
    gestureLockRef.current = { mode: 'none', until: 0, confidence: 0 }
    gestureCandidateRef.current = { mode: 'none', since: 0 }
    controlHoverRef.current = { control: 'none', since: 0, toggled: false }
    gainRef.current?.gain.setTargetAtTime(0.4, ctx.currentTime, 0.22)
    filterRef.current?.frequency.setTargetAtTime(18000, ctx.currentTime, 0.12)
    filterRef.current?.Q.setTargetAtTime(0.85, ctx.currentTime, 0.12)
    try {
      await audio.play()
    } catch {
      setDj((current) => ({ ...current, aiStatus: 'Browser blocked autoplay. Press Play to start the deck.', isLoaded: true, isPlaying: false, trackName: file.name, filterAmount: 100, confidence: 0, gestureLocked: false, nextHint: 'Press Play, then tap Volume, Filter, Reverb, Mute, or Cue.' }))
      setMode('music')
      if (statusRef.current !== 'running' && statusRef.current !== 'loading') void startCamera()
      return
    }
    setDj((current) => ({
      ...current,
      trackName: file.name,
      isLoaded: true,
      isPlaying: true,
      volume: 40,
      muted: false,
      filterAmount: 100,
      reverbAmount: 0,
      delayAmount: 0,
      bpm: 124,
      energy: 48,
      gesture: 'Track loaded',
      activeControl: 'Show open right palm',
      aiStatus: statusRef.current === 'running' ? 'Calibrating hand position…' : 'Camera arming…',
      confidence: 0,
      gestureLocked: false,
      nextHint: 'Tap a control card first. Only the selected control will listen.',
      selectedControl: 'none',
      tapTarget: 'none',
      tapProgress: 0,
      audioLevel: 0,
      beatPulse: 0,
    }))
    setMode('music')
    if (statusRef.current !== 'running' && statusRef.current !== 'loading') void startCamera()
    } catch {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
      setDj((current) => ({ ...current, isPlaying: false, aiStatus: 'Could not load this audio file. Try MP3 or WAV.' }))
    }
  }

  async function toggleMusicPlayback() {
    const audio = audioRef.current
    if (!audio || !dj.isLoaded) return
    const ctx = setupAudioGraph()
    if (ctx.state === 'suspended') await ctx.resume()
    if (audio.paused) {
      try {
        await audio.play()
        setDj((current) => ({ ...current, isPlaying: true, muted: false, aiStatus: 'Listening to motion' }))
      } catch {
        setDj((current) => ({ ...current, isPlaying: false, aiStatus: 'Press Play again or choose another audio file.' }))
      }
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
    gain.gain.setTargetAtTime(djRef.current?.muted ? 0 : clamped, ctx.currentTime, timeConstant)
  }

  function toggleMute() {
    const ctx = audioCtxRef.current
    const gain = gainRef.current
    const audio = audioRef.current
    if (!ctx || !gain) return
    setDj((current) => {
      const muted = !current.muted
      gain.gain.setTargetAtTime(muted ? 0 : targetVolumeRef.current, ctx.currentTime, 0.18)
      if (muted) audio?.pause()
      else void audio?.play().catch(() => undefined)
      return { ...current, muted, isPlaying: muted ? false : true, gesture: muted ? 'Closed fist hold — muted/paused' : 'Mute released', activeControl: muted ? 'Muted / paused' : 'Previous control held', aiStatus: 'Gesture locked', confidence: 100, gestureLocked: true, nextHint: muted ? 'Hold fist again or press Unmute to resume.' : 'Choose a clear gesture to resume control.' }
    })
  }



  function selectDeckControl(control: DeckControl) {
    if (control === 'none') {
      setDj((current) => ({ ...current, selectedControl: 'none', tapTarget: 'none', tapProgress: 0, gesture: 'No control selected', activeControl: 'Values held', aiStatus: 'Idle', confidence: 0, gestureLocked: false, nextHint: 'Tap Volume, Filter, Reverb, Mute, or Cue to begin.' }))
      return
    }
    if (control === 'mute') {
      toggleMute()
      setDj((current) => ({ ...current, selectedControl: 'none', tapTarget: 'none', tapProgress: 0 }))
      return
    }
    calibrationRef.current = { ...calibrationRef.current, ready: false, samples: 0 }
    gestureLockRef.current = { mode: control === 'cue' ? 'swipe' : control, until: performance.now() + 700, confidence: 0.9 }
    setDj((current) => ({
      ...current,
      selectedControl: control,
      tapTarget: 'none',
      tapProgress: 0,
      gesture: `${CONTROL_LABELS[control].title} active`,
      activeControl: CONTROL_LABELS[control].action,
      aiStatus: 'Selected control is listening',
      confidence: 90,
      gestureLocked: true,
      nextHint: CONTROL_LABELS[control].hint,
    }))
  }

  function controlFromFinger(displayX: number, y: number): DeckControl {
    if (y < 0.68 || y > 0.96) return 'none'
    const index = Math.floor(clamp(displayX, 0, 0.999) * CONTROL_ORDER.length)
    return CONTROL_ORDER[index] ?? 'none'
  }


  function updateDjFromHands(landmarksList: NormalizedLandmark[][], summaries: HandSummary[]) {
    if (modeRef.current !== 'music') return
    const currentDj = djRef.current
    if (!currentDj?.isLoaded) {
      setDj((current) => current.gesture === 'Upload a track first' ? current : { ...current, gesture: 'Upload a track first', activeControl: 'Music button', aiStatus: 'Load MP3/WAV/FLAC to arm controls', confidence: 0, gestureLocked: false, selectedControl: 'none', tapTarget: 'none', tapProgress: 0, nextHint: 'Upload a track to enable the deck.' })
      return
    }

    const now = performance.now()
    const ctx = audioCtxRef.current
    const hands = summaries.map((summary, index) => ({ summary, landmarks: landmarksList[index] })).filter((hand) => hand.landmarks)
    if (!hands.length) {
      previousTwoHandYRef.current = null
      fistStartedAtRef.current = null
      controlHoverRef.current = { control: 'none', since: 0, toggled: false }
      if (lastHandSeenAtRef.current && now - lastHandSeenAtRef.current > 700) {
        setDj((current) => current.isLoaded ? { ...current, gesture: current.selectedControl === 'none' ? 'No control selected' : `${CONTROL_LABELS[current.selectedControl].title} active`, activeControl: 'Tracking lost — values held', aiStatus: 'Hold still to recalibrate', confidence: 0, gestureLocked: false, tapTarget: 'none', tapProgress: 0, nextHint: current.selectedControl === 'none' ? 'Tap a control to begin.' : CONTROL_LABELS[current.selectedControl].hint } : current)
      }
      return
    }
    lastHandSeenAtRef.current = now

    const rightHand = hands.find((hand) => hand.summary.label === 'Right') ?? hands[0]
    const wrist = rightHand.landmarks[0]
    const indexTip = rightHand.landmarks[8]
    const palmScale = Math.max(dist(wrist, rightHand.landmarks[9]), 0.04)
    const displayedFingerX = 1 - indexTip.x
    const hoveredControl = controlFromFinger(displayedFingerX, indexTip.y)
    const hover = controlHoverRef.current
    if (hover.control !== hoveredControl) {
      controlHoverRef.current = { control: hoveredControl, since: now, toggled: false }
    }
    const hoverNow = controlHoverRef.current
    const tapProgress = hoveredControl === 'none' ? 0 : clamp((now - hoverNow.since) / 650)
    if (hoveredControl !== 'none' && tapProgress >= 1 && !hoverNow.toggled) {
      controlHoverRef.current = { ...hoverNow, toggled: true }
      selectDeckControl(hoveredControl)
      return
    }

    const selected = currentDj.selectedControl
    if (selected === 'none') {
      setDj((current) => ({ ...current, gesture: hoveredControl === 'none' ? 'No control selected' : `Tap target: ${CONTROL_LABELS[hoveredControl].title}`, activeControl: 'Values held', aiStatus: hoveredControl === 'none' ? 'Waiting for selection' : 'Hold fingertip on control to select', confidence: percent(tapProgress), gestureLocked: false, tapTarget: hoveredControl, tapProgress: percent(tapProgress), nextHint: hoveredControl === 'none' ? 'Use the on-screen controls or hover your fingertip over a control pad.' : `Selecting ${CONTROL_LABELS[hoveredControl].title}…` }))
      return
    }

    const calibration = calibrationRef.current
    if (!calibration.ready) {
      const nextSamples = calibration.samples + 1
      calibrationRef.current = {
        ready: nextSamples >= 16,
        samples: nextSamples,
        baselineY: ((calibration.baselineY * calibration.samples) + wrist.y) / nextSamples,
        handScale: ((calibration.handScale * calibration.samples) + palmScale) / nextSamples,
      }
      setDj((current) => ({ ...current, gesture: `${CONTROL_LABELS[selected].title} active`, activeControl: 'Calibrating hand position', aiStatus: 'Hold steady', confidence: Math.min(96, Math.round((nextSamples / 16) * 100)), gestureLocked: true, tapTarget: hoveredControl, tapProgress: percent(tapProgress), nextHint: 'Hold your hand naturally for a moment.' }))
      return
    }

    handMotionRef.current = [...handMotionRef.current.slice(-28), { x: wrist.x, y: wrist.y, t: now, indexX: indexTip.x, indexY: indexTip.y }]
    const recent = handMotionRef.current
    const older = recent.find((point) => now - point.t > 240) ?? recent[0]
    const dx = wrist.x - older.x
    const dy = older.y - wrist.y
    const wristAngle = Math.atan2(rightHand.landmarks[5].y - rightHand.landmarks[17].y, rightHand.landmarks[5].x - rightHand.landmarks[17].x)
    const knobAmount = clamp((wristAngle + 1.35) / 2.7)

    let gesture = `${CONTROL_LABELS[selected].title} active`
    let activeControl = CONTROL_LABELS[selected].action
    let aiStatus = 'Selected control is listening'
    let nextHint = CONTROL_LABELS[selected].hint
    let confidence = 0.86
    let cueIndex = currentDj.cueIndex
    let reverbAmount = smoothedReverbRef.current
    let filterAmount = smoothedFilterRef.current
    let delayAmount = currentDj.delayAmount / 100

    if (selected === 'volume') {
      const mapped = clamp(0.18 + clamp((0.86 - wrist.y) / 0.62) * 0.82, 0.18, 1)
      const volume = targetVolumeRef.current * 0.86 + mapped * 0.14
      setDeckVolume(volume, 0.38)
      gesture = 'Volume active — move hand up/down'
      activeControl = 'Vertical volume control'
      nextHint = 'Move up to raise, down to lower. Floor is 18%; mute is separate.'
    } else if (selected === 'filter') {
      smoothedFilterRef.current = smoothedFilterRef.current * 0.82 + knobAmount * 0.18
      filterAmount = smoothedFilterRef.current
      if (ctx) {
        filterRef.current?.frequency.setTargetAtTime(260 + filterAmount * 17740, ctx.currentTime, 0.24)
        filterRef.current?.Q.setTargetAtTime(0.85 + filterAmount * 5.5, ctx.currentTime, 0.26)
      }
      gesture = 'Filter active — rotate wrist'
      activeControl = filterAmount > 0.52 ? 'Opening filter' : 'Closing filter'
      nextHint = 'Turn wrist slowly. Filter holds its value when you switch away.'
    } else if (selected === 'reverb') {
      const next = clamp(smoothedReverbRef.current + dy * 1.9, 0, 1)
      smoothedReverbRef.current = smoothedReverbRef.current * 0.86 + next * 0.14
      reverbAmount = smoothedReverbRef.current
      delayAmount = reverbAmount * 0.35
      if (ctx) {
        wetRef.current?.gain.setTargetAtTime(0.04 + reverbAmount * 0.34, ctx.currentTime, 0.34)
        delayRef.current?.delayTime.setTargetAtTime(0.1 + delayAmount * 0.32, ctx.currentTime, 0.34)
        feedbackRef.current?.gain.setTargetAtTime(0.08 + reverbAmount * 0.28, ctx.currentTime, 0.34)
      }
      gesture = 'Reverb active — move hand up/down'
      activeControl = dy >= 0 ? 'Lifting atmosphere' : 'Lowering atmosphere'
      nextHint = 'Move up for more space, down for drier sound.'
    } else if (selected === 'cue') {
      confidence = Math.abs(dx) > 0.13 ? 0.9 : 0.54
      if (Math.abs(dx) > 0.18 && now - swipeAtRef.current > 900) {
        swipeAtRef.current = now
        cueIndex = clamp(cueIndex + (dx > 0 ? 1 : -1), 1, 8)
      }
      gesture = 'Cue active — swipe left/right'
      activeControl = `Cue ${cueIndex}`
      aiStatus = confidence > 0.7 ? 'Swipe detected' : 'Waiting for swipe'
      nextHint = 'Swipe horizontally to jump sections. Switch controls when done.'
    }

    setDj((current) => ({
      ...current,
      volume: current.muted ? 0 : percent(targetVolumeRef.current),
      filterAmount: percent(filterAmount),
      reverbAmount: percent(reverbAmount),
      delayAmount: percent(delayAmount),
      energy: Math.round((current.energy * 0.84) + (percent(targetVolumeRef.current) * 0.16)),
      gesture,
      activeControl,
      aiStatus,
      confidence: percent(confidence),
      gestureLocked: true,
      tapTarget: hoveredControl,
      tapProgress: percent(tapProgress),
      nextHint,
      dropMode: selected === 'volume' && targetVolumeRef.current > 0.82,
      loopBuild: selected === 'reverb' && reverbAmount > 0.72,
      cueIndex,
    }))
  }

  function updateAudioMeter() {
    const analyser = analyserRef.current
    const bins = audioBinsRef.current
    if (!analyser || !bins || modeRef.current !== 'music') return
    analyser.getByteFrequencyData(bins)
    const lowEnd = bins.slice(0, Math.min(10, bins.length))
    const avg = bins.reduce((sum, value) => sum + value, 0) / Math.max(bins.length, 1)
    const bass = lowEnd.reduce((sum, value) => sum + value, 0) / Math.max(lowEnd.length, 1)
    const audioLevel = percent(avg / 190)
    const beatPulse = percent(bass / 210)
    setDj((current) => current.isLoaded ? { ...current, audioLevel: Math.round((current.audioLevel * 0.78) + (audioLevel * 0.22)), beatPulse: Math.round((current.beatPulse * 0.72) + (beatPulse * 0.28)) } : current)
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
      updateAudioMeter()

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
    const activeTargetColor = targetColorRef.current
    if (!ctx) return emptyVisual(activeTargetColor)

    ctx.drawImage(video, 0, 0, sampler.width, sampler.height)
    const image = ctx.getImageData(0, 0, sampler.width, sampler.height)
    const data = image.data
    const pixels = data.length / 4
    const targetRgb = TARGET_COLORS[activeTargetColor].rgb
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
      if (matchesColor(pr, pg, pb, activeTargetColor)) targetHits += 1
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
    const currentMode = modeRef.current
    const summaries: HandSummary[] = hands.landmarks.map((landmarks, index) => {
      const handedness = hands.handedness[index]?.[0]?.categoryName ?? `Hand ${index + 1}`
      const result = countRaisedFingers(landmarks, handedness)
      const wrist = landmarks[0]
      const color = index === 0 ? '#58a6ff' : '#22c55e'
      if (currentMode === 'music') {
        drawDjHand(ctx, landmarks, canvas, index === 0 ? '#22d3ee' : '#f472b6')
      } else {
        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 3 })
        drawingUtils.drawLandmarks(landmarks, { color: '#ffffff', fillColor: '#0f172a', lineWidth: 2, radius: 4 })
      }
      if (currentMode !== 'music') drawPill(ctx, `${handedness}: ${result.count}`, wrist.x * canvas.width + 16, wrist.y * canvas.height - 18, color)
      return {
        id: `${handedness}-${index}`,
        label: handedness,
        count: result.count,
        raised: result.raised,
        x: wrist.x,
        y: wrist.y,
      }
    })

    const shouldDrawFace = currentMode === 'face' || currentMode === 'scan'
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

    if (currentMode === 'color' || currentMode === 'scan') {
      ctx.fillStyle = visual.targetHex
      ctx.globalAlpha = 0.22
      ctx.fillRect(0, canvas.height - 24, Math.max(3, (visual.targetCoverage / 100) * canvas.width), 24)
      ctx.globalAlpha = 1
      drawPill(ctx, `${targetColorRef.current}: ${visual.targetCoverage}%`, 16, canvas.height - 34, visual.targetHex)
    }

    if (currentMode === 'motion' || currentMode === 'scan') {
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
    updateDjFromHands(hands.landmarks, summaries)
    const face = classifySmile(faces)
    const handLabel = summaries.length ? summaries.map((hand) => `${hand.label} ${hand.count}`).join(' + ') : 'No hand'
    const aiStatement = makeStatement(totalFingers, summaries, visual, face)
    setAnalysis((current) => ({
      ...current,
      fingerCount: summaries.length ? totalFingers : null,
      handLabel,
      hands: summaries,
      dominantColor: visual.dominantColor,
      targetColor: targetColorRef.current,
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
    const activeMode = modeRef.current
    if (activeMode === 'fingers') return hands.length ? `${hands.length} hand(s): ${totalFingers} total fingers.` : 'No hand yet. Show one or both hands.'
    if (activeMode === 'color') return `${targetColor}: ${visual.targetCoverage}% match. Best visible color: ${visual.bestColorName} ${visual.bestColorPercent}%.`
    if (activeMode === 'motion') return `Motion ${visual.motionScore}/100 · ${visual.motionChangedPercent}% of frame changing · ${visual.motionDirection}.`
    if (activeMode === 'face') return face.count ? `${face.label}. Smile ${face.smileScore}%, eyes open ${face.eyeOpenScore}%.` : 'Face tracking is active, but no face is centered yet.'
    return `${hands.length} hand(s), ${totalFingers} fingers · face: ${face.label} · ${targetColor}: ${visual.targetCoverage}% · motion ${visual.motionScore}/100.`
  }

  const modes: { id: VisionMode; title: string }[] = [
    { id: 'lab', title: 'Vision Lab' },
    { id: 'music', title: 'Conductor' },
    { id: 'scan', title: 'Camera' },
  ]

  const graphPoints = analysis.motionHistory.map((value, index) => {
    const x = (index / Math.max(analysis.motionHistory.length - 1, 1)) * 100
    const y = 46 - (Math.min(value, 100) / 100) * 40
    return `${x},${y}`
  }).join(' ')


  const activeLab = LAB_MODULES.find((item) => item.id === labModule) ?? LAB_MODULES[0]
  const labNeedsCamera = labModule === 'hands' || labModule === 'music'
  const labIsHeavy = activeLab.status !== 'Live'

  async function imageUrlToCanvas(url: string) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    const maxSide = 960
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  function videoToCanvas() {
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) return null
    const canvas = document.createElement('canvas')
    const maxSide = 960
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  async function getLabSourceCanvas() {
    if (labUpload) return imageUrlToCanvas(labUpload)
    const canvas = videoToCanvas()
    if (canvas) return canvas
    throw new Error('Upload an image or start the camera first.')
  }

  function drawMaskOverlay(source: HTMLCanvasElement, maskTensor: any, maskIndex: number, score: number) {
    const output = document.createElement('canvas')
    output.width = source.width
    output.height = source.height
    const ctx = output.getContext('2d')
    if (!ctx) return source.toDataURL('image/png')
    ctx.drawImage(source, 0, 0)

    const dims: number[] = maskTensor.dims ?? []
    const data: Uint8Array | Int8Array | Float32Array = maskTensor.data
    const height = dims[dims.length - 2] ?? source.height
    const width = dims[dims.length - 1] ?? source.width
    const masks = dims.length >= 4 ? dims[dims.length - 3] : 1
    const offset = Math.min(maskIndex, masks - 1) * width * height
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = width
    maskCanvas.height = height
    const maskCtx = maskCanvas.getContext('2d')
    const imageData = maskCtx?.createImageData(width, height)
    if (maskCtx && imageData) {
      for (let index = 0; index < width * height; index += 1) {
        const active = Number(data[offset + index]) > 0
        imageData.data[index * 4] = 88
        imageData.data[index * 4 + 1] = 92
        imageData.data[index * 4 + 2] = 255
        imageData.data[index * 4 + 3] = active ? 118 : 0
      }
      maskCtx.putImageData(imageData, 0, 0)
      ctx.drawImage(maskCanvas, 0, 0, source.width, source.height)
    }

    if (labPoint) {
      const markerX = labPoint.displayX * source.width
      const markerY = labPoint.displayY * source.height
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#585cff'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.arc(markerX, markerY, 10, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)'
    ctx.fillRect(16, 16, 190, 38)
    ctx.fillStyle = '#fff'
    ctx.font = '700 15px system-ui'
    ctx.fillText(`SAM mask · ${Math.round(score * 100)}%`, 30, 41)
    return output.toDataURL('image/png')
  }

  function drawDepthMap(depthImage: any) {
    const canvas = document.createElement('canvas')
    canvas.width = depthImage.width
    canvas.height = depthImage.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const imageData = ctx.createImageData(canvas.width, canvas.height)
    const channels = depthImage.channels || 1
    for (let i = 0; i < canvas.width * canvas.height; i += 1) {
      const value = depthImage.data[i * channels] ?? depthImage.data[i] ?? 0
      imageData.data[i * 4] = Math.min(255, value * 0.72 + 24)
      imageData.data[i * 4 + 1] = Math.min(255, value * 0.9 + 32)
      imageData.data[i * 4 + 2] = Math.min(255, 255 - value * 0.38)
      imageData.data[i * 4 + 3] = 255
    }
    ctx.putImageData(imageData, 0, 0)
    return canvas.toDataURL('image/png')
  }

  function mapViewerPoint(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const source = labUpload
      ? labSourceSize
      : videoRef.current?.videoWidth && videoRef.current.videoHeight
        ? { width: videoRef.current.videoWidth, height: videoRef.current.videoHeight }
        : labSourceSize
    const aspect = source ? source.width / source.height : rect.width / rect.height
    let contentWidth = rect.width
    let contentHeight = rect.width / aspect
    if (contentHeight > rect.height) {
      contentHeight = rect.height
      contentWidth = rect.height * aspect
    }
    const left = (rect.width - contentWidth) / 2
    const top = (rect.height - contentHeight) / 2
    const displayX = clamp((event.clientX - rect.left - left) / contentWidth)
    const displayY = clamp((event.clientY - rect.top - top) / contentHeight)
    return { displayX, displayY }
  }

  function handleLabUpload(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setLabResult('Use a PNG or JPEG image for this module.')
      return
    }
    if (labUpload) URL.revokeObjectURL(labUpload)
    const url = URL.createObjectURL(file)
    setLabUpload(url)
    setLabArtifact(null)
    setLabPoint(null)
    setLabSourceSize(null)
    const image = new Image()
    image.onload = () => setLabSourceSize({ width: image.naturalWidth, height: image.naturalHeight })
    image.src = url
    setLabResult(labModule === 'segment' ? 'Image ready. Click the object you want to segment.' : 'Image ready. Run the model when you are ready.')
  }

  function handleLabViewerClick(event: MouseEvent<HTMLDivElement>) {
    if (labModule !== 'segment') return
    const { displayX, displayY } = mapViewerPoint(event)
    setLabArtifact(null)
    setLabPoint({ x: Math.round(displayX * 960), y: Math.round(displayY * 960), displayX, displayY })
    setLabResult('Point selected. Run Segment to create the mask.')
  }

  async function runLabModel() {
    if (labModule === 'music') {
      setMode('music')
      return
    }
    if (labModule === 'hands') {
      setLabResult(analysis.hands.length ? `${analysis.hands.length} hand(s) tracked · ${analysis.fingerCount ?? 0} fingers · ${analysis.fps || '—'} FPS.` : 'No hand yet. Start camera and improve lighting.')
      return
    }

    setLabBusy(true)
    setLabArtifact(null)
    try {
      const source = await getLabSourceCanvas()
      if (labModule === 'segment') {
        const point = labPoint ?? { x: Math.round(source.width / 2), y: Math.round(source.height / 2), displayX: 0.5, displayY: 0.5 }
        setLabResult('Loading SlimSAM. First run downloads the model; later runs use browser cache.')
        const { model, processor, RawImage } = await loadSam()
        const rawImage = RawImage.fromCanvas(source)
        const input_points = [[[Math.round(point.displayX * source.width), Math.round(point.displayY * source.height)]]]
        const inputs = await processor(rawImage, { input_points })
        const outputs = await model(inputs)
        const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes)
        const scores = Array.from(outputs.iou_scores.data as Float32Array | number[]).map(Number)
        const bestIndex = scores.reduce((best, value, index) => value > scores[best] ? index : best, 0)
        setLabArtifact(drawMaskOverlay(source, masks[0], bestIndex, scores[bestIndex] ?? 0))
        setLabResult(`Segmented with SlimSAM. Best mask confidence: ${Math.round((scores[bestIndex] ?? 0) * 100)}%.`)
      } else if (labModule === 'depth') {
        setLabResult('Loading Depth Anything V2 Small. First run may take a minute.')
        const { estimator, RawImage } = await loadDepth()
        const rawImage = RawImage.fromCanvas(source)
        const output = await estimator(rawImage)
        const depthUrl = drawDepthMap(output.depth)
        if (depthUrl) setLabArtifact(depthUrl)
        setLabResult(`Depth map generated locally: ${output.depth.width}×${output.depth.height}. Brighter/cooler areas are closer.`)
      }
    } catch (error) {
      setLabResult(error instanceof Error ? error.message : 'Model run failed. Try a smaller image or refresh.')
    } finally {
      setLabBusy(false)
    }
  }

  if (mode === 'lab') {
    return (
      <main className="vision-lab-shell">
        <aside className="lab-sidebar">
          <div className="lab-brand"><span>VL</span><div><b>Vision Lab</b><small>Vision is the interface.</small></div></div>
          <nav className="lab-nav" aria-label="Vision Lab modules">
            {LAB_MODULES.map((item) => (
              <button key={item.id} type="button" className={labModule === item.id ? 'active' : ''} onClick={() => { setLabModule(item.id); setLabArtifact(null); setLabPoint(null); setLabResult(item.status === 'Live' ? 'Camera-ready module selected.' : 'Real browser model selected. Upload/capture a frame, then run it.'); }}>
                <span>{item.title}</span><small>{item.model}</small>
              </button>
            ))}
          </nav>
          <button type="button" className="secondary" onClick={() => setMode('scan')}>Back to Vision</button>
        </aside>

        <section className="lab-main">
          <header className="lab-header">
            <div><span>{activeLab.status}</span><h1>{activeLab.title}</h1><p>{activeLab.description}</p></div>
            <div className="lab-status-pills"><b>{activeLab.model}</b><b>{status === 'running' ? 'Camera ready' : 'Camera idle'}</b><b>{labBusy ? 'Model loading' : 'Smooth'}</b></div>
          </header>

          <div className="lab-stage">
            <div className={`lab-viewer ${labModule === 'segment' ? 'clickable' : ''}`} onClick={handleLabViewerClick}>
              {labArtifact ? <img src={labArtifact} alt="Model output" /> : (labNeedsCamera || !labUpload) ? <><video ref={videoRef} className="camera" playsInline muted /><canvas ref={canvasRef} className="overlay" /></> : <img src={labUpload} alt="Uploaded preview" />}
              {status !== 'running' && labNeedsCamera && <div className="lab-empty">Start camera to run this module.</div>}
              {!labNeedsCamera && !labUpload && <div className="lab-empty">Upload an image or capture a frame.</div>}
              {labModule === 'segment' && labUpload && !labArtifact && labPoint && <span className="lab-point" style={{ left: `${labPoint.displayX * 100}%`, top: `${labPoint.displayY * 100}%` }} />}
              <div className="lab-overlay-metrics"><span>{analysis.fps || '—'} FPS</span><span>{analysis.hands.length} hands</span><span>{analysis.count} faces</span></div>
            </div>
            <aside className="lab-panel">
              <label className="lab-field">Target note<input value={labPrompt} onChange={(event) => setLabPrompt(event.target.value)} placeholder="Click object, room depth, desk depth…" /></label>
              <div className="lab-actions">
                {(labNeedsCamera || !labUpload) && <button type="button" onClick={startCamera} disabled={status === 'loading' || status === 'running'}>{status === 'loading' ? 'Loading…' : 'Start Camera'}</button>}
                <label className="lab-upload">Upload<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleLabUpload(event.target.files?.[0])} /></label>
                <button type="button" onClick={runLabModel} disabled={labBusy}>{labBusy ? 'Running…' : labModule === 'segment' ? 'Run Segment' : labModule === 'depth' ? 'Run Depth' : 'Run'}</button>
                <button type="button" className="secondary" onClick={() => { setLabResult('Cleared. Choose input and run again.'); if (labUpload) URL.revokeObjectURL(labUpload); setLabUpload(null); setLabArtifact(null); setLabPoint(null); setLabSourceSize(null); }}>Clear</button>
              </div>
              <div className="lab-result"><span>Output</span><strong>{labResult}</strong></div>
              <div className="lab-examples"><span>Examples</span>{activeLab.examples.map((example) => <button type="button" key={example} onClick={() => setLabPrompt(example)}>{example}</button>)}</div>
              <div className="lab-runtime"><div><span>Status</span><b>{labBusy ? 'Loading' : activeLab.status}</b></div><div><span>Runtime</span><b>{labIsHeavy ? 'WASM' : 'Live'}</b></div><div><span>Models</span><b>{labIsHeavy ? 'Lazy' : 'Ready'}</b></div></div>
            </aside>
          </div>
        </section>
      </main>
    )
  }

  if (mode === 'music') {
    return (
      <main className="conductor-app">
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/flac,.mp3,.wav,.flac"
          onChange={(event) => { void handleMusicUpload(event.target.files?.[0]); event.currentTarget.value = '' }}
        />

        <aside className="conductor-sidebar">
          <div className="conductor-logo">
            <span>TC</span>
            <div><b>The Conductor</b><small>Don’t touch the deck.</small></div>
          </div>
          <nav className="conductor-nav" aria-label="Conductor navigation">
            {['Perform', 'Tracks', 'Effects', 'Visuals', 'Settings'].map((item) => (
              <button key={item} type="button" className={item === 'Perform' ? 'active' : ''} disabled={item !== 'Perform'}>{item}</button>
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
          <button type="button" className="music-upload-main" onClick={() => fileInputRef.current?.click()}>Upload Track</button>
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

          <div className="deck-strip">
            <div className="deck-track">
              <span>Track</span>
              <strong>{dj.trackName}</strong>
              <button type="button" onClick={() => fileInputRef.current?.click()}>Upload</button>
              <button type="button" className="secondary" onClick={toggleMusicPlayback} disabled={!dj.isLoaded}>{dj.isPlaying ? 'Pause' : 'Play'}</button>
            </div>
            <div className="deck-selector" aria-label="Deck controls">
              {CONTROL_ORDER.map((control) => (
                <button key={control} type="button" className={dj.selectedControl === control ? 'active' : ''} onClick={() => selectDeckControl(control)} disabled={!dj.isLoaded}>
                  {CONTROL_LABELS[control].title}
                </button>
              ))}
            </div>
          </div>

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
                  <span>{dj.selectedControl === 'none' ? 'select a control' : `${CONTROL_LABELS[dj.selectedControl].title} selected`}</span>
                </div>
                <div className="conductor-orb">
                  <i />
                  <b>{dj.selectedControl === 'none' ? 'SELECT' : CONTROL_LABELS[dj.selectedControl].title.toUpperCase()}</b>
                </div>
                <div className="finger-control-pads">
                  {CONTROL_ORDER.map((control) => (
                    <span key={control} className={`${dj.selectedControl === control ? 'active' : ''} ${dj.tapTarget === control ? 'targeted' : ''}`}>
                      <b>{CONTROL_LABELS[control].title}</b>
                      <i style={{ width: `${dj.tapTarget === control ? dj.tapProgress : 0}%` }} />
                    </span>
                  ))}
                </div>
                {status !== 'running' && <div className="camera-prompt">Turn on camera to conduct the track</div>}
              </div>
            </div>
            <div className="gesture-shortcuts">
              {[
                ['1 Select', 'Tap / hover a control'],
                ['2 Control', 'Move only selected effect'],
                ['Volume', 'Hand up/down'],
                ['Filter', 'Rotate wrist'],
                ['Reverb', 'Hand up/down'],
                ['Cue', 'Swipe left/right'],
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
            <em>{dj.gestureLocked ? 'Gesture locked' : 'Unlocked'} · {dj.confidence}% confidence</em>
            <p>{dj.nextHint}</p>
          </div>
          <div className="control-card volume-card motion-volume-card">
            <span>Volume motion</span>
            <strong>{dj.selectedControl === 'volume' ? 'Live' : `${dj.volume}%`}</strong>
            <div className="vertical-volume"><i style={{ height: `${dj.volume}%` }} /></div>
          </div>
          <div className="control-card filter-knob-card">
            <span>Filter knob</span>
            <div className="dj-knob" style={{ transform: `rotate(${(-135 + (dj.filterAmount / 100) * 270)}deg)` }}><i /></div>
            <small>{dj.selectedControl === 'filter' ? 'Rotate wrist' : 'Select Filter to control'}</small>
          </div>
          <div className="control-card beat-card">
            <span>Beat / level</span>
            <strong>{dj.beatPulse > 58 ? 'Kick' : dj.audioLevel > 18 ? 'Playing' : 'Idle'}</strong>
            <div className="beat-bars">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ height: `${12 + ((index * 13 + dj.audioLevel + dj.beatPulse) % 58)}px`, opacity: index < Math.ceil(dj.audioLevel / 6) ? 1 : 0.28 }} />)}</div>
          </div>
          <div className="control-grid-premium control-selector">
            {CONTROL_ORDER.map((control) => {
              const value = control === 'volume' ? dj.volume : control === 'filter' ? dj.filterAmount : control === 'reverb' ? dj.reverbAmount : control === 'mute' ? (dj.muted ? 100 : 0) : Math.round((dj.cueIndex / 8) * 100)
              return (
                <button key={control} type="button" className={dj.selectedControl === control ? 'active' : ''} onClick={() => selectDeckControl(control)} disabled={!dj.isLoaded}>
                  <span>{CONTROL_LABELS[control].title}</span>
                  <strong>{control === 'mute' ? (dj.muted ? 'Muted' : 'Ready') : control === 'cue' ? `Cue ${dj.cueIndex}` : `${value}%`}</strong>
                  <small>{CONTROL_LABELS[control].action}</small>
                </button>
              )
            })}
          </div>
          <div className="transport-card">
            <button type="button" onClick={() => fileInputRef.current?.click()}>Upload Track</button>
            <button type="button" className="secondary" onClick={toggleMusicPlayback} disabled={!dj.isLoaded}>{dj.isPlaying ? 'Pause' : 'Play'}</button>
            <button type="button" className="panic" onClick={toggleMute} disabled={!dj.isLoaded}>{dj.muted ? 'Unmute' : 'Mute'}</button>
          </div>
          <div className="copy-card">
            <b>Motion is the mixer.</b>
            <p>Upload, press Play, choose one deck control, then move your hand. Volume uses simple up/down; Filter uses a visible DJ-style knob.</p>
          </div>
          <div className={`status ${status}`}>{status === 'idle' ? 'Start camera to unlock live hand, face, color, and motion interactions.' : message}</div>
          <div className="actions">
            <button type="button" onClick={startCamera} disabled={status === 'loading' || status === 'running'}>{status === 'loading' ? 'Loading…' : 'Start Camera'}</button>
            <button type="button" className="secondary" onClick={stopCamera} disabled={status !== 'running'}>Stop</button>
          </div>
        </aside>
      </main>
    )
  }

  return (
    <main className="app-shell vision-shell">
      <section className="hero-panel compact">
        <p className="eyebrow">Launch-ready local vision AI · zero cloud camera uploads</p>
        <h1>Vision Studio</h1>
        <p className="lede">Try hand tracking, face sensing, motion, color detection, gestures, and The Conductor music mode in one polished browser demo.</p>
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
