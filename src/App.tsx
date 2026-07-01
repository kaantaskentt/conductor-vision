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
  red: [220, 56, 62],
  green: [64, 190, 120],
  blue: [64, 130, 255],
  yellow: [246, 204, 67],
  purple: [170, 96, 255],
} as const

const FINGER_JOINTS = {
  thumb: { tip: 4, pip: 3, mcp: 2 },
  index: { tip: 8, pip: 6, mcp: 5 },
  middle: { tip: 12, pip: 10, mcp: 9 },
  ring: { tip: 16, pip: 14, mcp: 13 },
  pinky: { tip: 20, pip: 18, mcp: 17 },
} as const

type CameraStatus = 'idle' | 'loading' | 'running' | 'error'
type VisionMode = 'fingers' | 'color' | 'motion' | 'face' | 'scan'
type TargetColor = keyof typeof TARGET_COLORS
type FingerName = keyof typeof FINGER_JOINTS
type FingerState = Record<FingerName, boolean>

type VisualState = {
  dominantColor: string
  targetCoverage: number
  motionScore: number
  motionDirection: string
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
  fps: number
  targetColor: TargetColor
  aiStatement: string
  framesProcessed: number
  estimatedTokens: number
  raised: FingerState | null
  motionHistory: number[]
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0) * 0.35)
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
    const radialOpen = dist(wrist, tip) > dist(wrist, pip) + palmScale * 0.18
    const jointStraight = angle(mcp, pip, tip) > 142
    const classicOpen = tip.y < pip.y - 0.01
    // The radial + angle test fixes palm-forward cases where the y-axis heuristic gets stuck.
    raised[name] = (radialOpen && jointStraight) || (classicOpen && radialOpen)
  })

  const thumb = FINGER_JOINTS.thumb
  const thumbTip = landmarks[thumb.tip]
  const thumbIp = landmarks[thumb.pip]
  const thumbMcp = landmarks[thumb.mcp]
  const thumbRadial = dist(wrist, thumbTip) > dist(wrist, thumbIp) + palmScale * 0.12
  const thumbStraight = angle(thumbMcp, thumbIp, thumbTip) > 132
  const thumbSide = handedness === 'Left'
    ? thumbTip.x > thumbIp.x + palmScale * 0.08
    : thumbTip.x < thumbIp.x - palmScale * 0.08
  raised.thumb = (thumbRadial && thumbStraight) || (thumbRadial && thumbSide)

  return {
    count: Object.values(raised).filter(Boolean).length,
    raised,
  }
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function colorDistance(a: number[], b: readonly number[]) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
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
  const eyeOpenScore = Math.round((((byName.eyeBlinkLeft ?? 0) + (byName.eyeBlinkRight ?? 0)) / 2) * 100)
  const count = face.faceLandmarks.length
  const label = count === 0 ? 'No face' : smileScore > 35 ? 'Smile detected' : 'Face tracking'
  return { count, smileScore, eyeOpenScore: Math.max(0, 100 - eyeOpenScore), label }
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const samplerRef = useRef<HTMLCanvasElement | null>(null)
  const handRef = useRef<HandLandmarker | null>(null)
  const faceRef = useRef<FaceLandmarker | null>(null)
  const animationRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const lastFrameAtRef = useRef(performance.now())
  const previousFrameRef = useRef<Uint8ClampedArray | null>(null)

  const [status, setStatus] = useState<CameraStatus>('idle')
  const [mode, setMode] = useState<VisionMode>('fingers')
  const [targetColor, setTargetColor] = useState<TargetColor>('red')
  const [message, setMessage] = useState('Start camera, then choose a mode.')
  const [analysis, setAnalysis] = useState<AnalysisState>({
    fingerCount: null,
    handLabel: '—',
    fps: 0,
    dominantColor: '#000000',
    targetColor: 'red',
    targetCoverage: 0,
    motionScore: 0,
    motionDirection: 'still',
    count: 0,
    smileScore: 0,
    eyeOpenScore: 0,
    label: 'Face off',
    aiStatement: 'Camera idle. Everything runs locally in the browser.',
    framesProcessed: 0,
    estimatedTokens: 0,
    raised: null,
    motionHistory: Array.from({ length: 28 }, () => 0),
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
        minHandDetectionConfidence: 0.38,
        minHandPresenceConfidence: 0.38,
        minTrackingConfidence: 0.38,
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
        outputFaceBlendshapes: true,
      })
    }
  }

  async function startCamera() {
    try {
      setStatus('loading')
      setMessage('Loading local vision models…')
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
      setMessage('Camera running. Try palm-forward for five fingers, or switch modes.')
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
    previousFrameRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStatus('idle')
    setAnalysis((current) => ({
      ...current,
      fingerCount: null,
      handLabel: '—',
      fps: 0,
      motionScore: 0,
      targetCoverage: 0,
      raised: null,
      aiStatement: 'Stopped. Press Start to run local vision again.',
    }))
    setMessage('Stopped. Press Start to run it again.')
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
    sampler.width = 96
    sampler.height = 54
    const ctx = sampler.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { dominantColor: '#000000', targetCoverage: 0, motionScore: 0, motionDirection: 'still' }

    ctx.drawImage(video, 0, 0, sampler.width, sampler.height)
    const data = ctx.getImageData(0, 0, sampler.width, sampler.height).data
    let r = 0
    let g = 0
    let b = 0
    let colorfulPixels = 0
    let targetHits = 0
    let motionSum = 0
    let leftMotion = 0
    let rightMotion = 0
    const target = TARGET_COLORS[targetColor]
    const previous = previousFrameRef.current

    for (let i = 0; i < data.length; i += 4) {
      const pixel = [data[i], data[i + 1], data[i + 2]]
      const saturation = Math.max(...pixel) - Math.min(...pixel)
      if (saturation > 38 && !(pixel[0] > 80 && pixel[1] > 55 && pixel[2] > 35 && pixel[0] > pixel[2] * 1.2)) {
        r += pixel[0]
        g += pixel[1]
        b += pixel[2]
        colorfulPixels += 1
      }
      if (colorDistance(pixel, target) < 82) targetHits += 1

      if (previous) {
        const delta = Math.abs(data[i] - previous[i]) + Math.abs(data[i + 1] - previous[i + 1]) + Math.abs(data[i + 2] - previous[i + 2])
        motionSum += delta
        const x = (i / 4) % sampler.width
        if (x < sampler.width / 2) leftMotion += delta
        else rightMotion += delta
      }
    }

    previousFrameRef.current = new Uint8ClampedArray(data)
    const pixels = data.length / 4
    const dominantColor = colorfulPixels > 12
      ? rgbToHex(Math.round(r / colorfulPixels), Math.round(g / colorfulPixels), Math.round(b / colorfulPixels))
      : '#9aa7b5'
    const motionScore = Math.min(100, Math.round((motionSum / pixels - 7) / 1.7))
    const motionDirection = motionScore < 6 ? 'still' : rightMotion > leftMotion * 1.12 ? 'leftward' : leftMotion > rightMotion * 1.12 ? 'rightward' : 'active'

    return { dominantColor, targetCoverage: Math.round((targetHits / pixels) * 100), motionScore: Math.max(0, motionScore), motionDirection }
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
    let bestCount: number | null = null
    let bestLabel = 'No hand'
    let raised: FingerState | null = null

    hands.landmarks.forEach((landmarks, index) => {
      const handedness = hands.handedness[index]?.[0]?.categoryName ?? 'Right'
      const count = countRaisedFingers(landmarks, handedness)
      if (bestCount === null || count.count > bestCount) {
        bestCount = count.count
        bestLabel = `${handedness} hand`
        raised = count.raised
      }

      drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: '#58a6ff', lineWidth: 3 })
      drawingUtils.drawLandmarks(landmarks, { color: '#ffffff', fillColor: '#0f172a', lineWidth: 2, radius: 4 })
      const wrist = landmarks[0]
      drawPill(ctx, `${count.count} fingers`, wrist.x * canvas.width + 16, wrist.y * canvas.height - 18)
    })

    if (mode === 'face' || mode === 'scan') {
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
        drawPill(ctx, 'face', minX, minY - 12, '#8b5cf6')
      })
    }

    if (mode === 'color' || mode === 'scan') {
      const [targetR, targetG, targetB] = TARGET_COLORS[targetColor]
      ctx.fillStyle = rgbToHex(targetR, targetG, targetB)
      ctx.globalAlpha = 0.22
      ctx.fillRect(0, canvas.height - 22, Math.max(4, (visual.targetCoverage / 100) * canvas.width), 22)
      ctx.globalAlpha = 1
    }

    const face = classifySmile(faces)
    const aiStatement = makeStatement(bestCount, bestLabel, raised, visual, face)
    setAnalysis((current) => ({
      ...current,
      fingerCount: bestCount,
      handLabel: bestLabel,
      dominantColor: visual.dominantColor,
      targetColor,
      targetCoverage: visual.targetCoverage,
      motionScore: visual.motionScore,
      motionDirection: visual.motionDirection,
      aiStatement,
      raised,
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
    ctx.roundRect(x, y - 28, width, 36, 18)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, x + 12, y - 5)
  }

  function makeStatement(count: number | null, label: string, raised: FingerState | null, visual: VisualState, face: FaceState) {
    if (mode === 'fingers') return count === null ? 'No hand yet. Try palm open and slightly angled.' : `${label}: ${count} fingers — ${describeRaised(raised)}.`
    if (mode === 'color') return `Looking for ${targetColor}: ${visual.targetCoverage}% match. Color readout only appears in this mode.`
    if (mode === 'motion') return `Motion is ${visual.motionScore}/100 and trending ${visual.motionDirection}.`
    if (mode === 'face') return face.count ? `${face.label}. Smile ${face.smileScore}%, eyes open ${face.eyeOpenScore}%.` : 'No face detected yet.'
    return `${count ?? 0} fingers · ${visual.targetCoverage}% ${targetColor} · motion ${visual.motionScore}/100 · ${face.label}.`
  }

  const modes: { id: VisionMode; title: string }[] = [
    { id: 'fingers', title: 'Fingers' },
    { id: 'motion', title: 'Motion' },
    { id: 'color', title: 'Color' },
    { id: 'face', title: 'Face' },
    { id: 'scan', title: 'Scan' },
  ]

  const graphPoints = analysis.motionHistory.map((value, index) => {
    const x = (index / Math.max(analysis.motionHistory.length - 1, 1)) * 100
    const y = 46 - (Math.min(value, 100) / 100) * 40
    return `${x},${y}`
  }).join(' ')

  return (
    <main className="app-shell">
      <section className="hero-panel compact">
        <p className="eyebrow">Local camera vision · zero cloud tokens</p>
        <h1>Vision Playground</h1>
        <p className="lede">A simpler live demo for hands, motion, color, and face tracking. Everything runs in-browser.</p>
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

          <div className="hero-number">
            <span>{mode === 'face' ? 'Faces' : 'Fingers'}</span>
            <strong>{mode === 'face' ? analysis.count : analysis.fingerCount ?? '—'}</strong>
          </div>

          {(mode === 'motion' || mode === 'scan') && (
            <div className="graph-card">
              <div className="graph-head"><span>Motion curve</span><strong>{analysis.motionScore}/100</strong></div>
              <svg viewBox="0 0 100 50" preserveAspectRatio="none" aria-label="Motion graph">
                <path d="M0 46 C20 46 22 16 50 16 C78 16 80 46 100 46" className="bell" />
                <polyline points={graphPoints} className="motion-line" />
              </svg>
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
              <p>{analysis.targetCoverage}% of sampled frame matches <b>{targetColor}</b>. Dominant color hidden unless color mode is active.</p>
            </div>
          )}

          {(mode === 'face' || mode === 'scan') && (
            <div className="mini-grid">
              <div><span>Smile</span><strong>{analysis.smileScore}%</strong></div>
              <div><span>Eyes open</span><strong>{analysis.eyeOpenScore}%</strong></div>
            </div>
          )}

          <div className="mini-grid">
            <div><span>Hand</span><strong>{analysis.handLabel}</strong></div>
            <div><span>FPS</span><strong>{analysis.fps || '—'}</strong></div>
          </div>

          <div className={`status ${status}`}>{message}</div>
          <div className="actions">
            <button type="button" onClick={startCamera} disabled={status === 'loading' || status === 'running'}>{status === 'loading' ? 'Loading…' : 'Start'}</button>
            <button type="button" className="secondary" onClick={stopCamera} disabled={status !== 'running'}>Stop</button>
          </div>
        </aside>
      </section>
    </main>
  )
}

export default App
