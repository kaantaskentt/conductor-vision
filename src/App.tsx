import { useEffect, useRef, useState } from 'react'
import {
  DrawingUtils,
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import './App.css'

const FINGER_TIPS = [8, 12, 16, 20]
const FINGER_PIPS = [6, 10, 14, 18]
const TARGET_COLORS = {
  red: [220, 56, 62],
  green: [64, 190, 120],
  blue: [64, 130, 255],
  yellow: [246, 204, 67],
  purple: [170, 96, 255],
} as const

type CameraStatus = 'idle' | 'loading' | 'running' | 'error'
type VisionMode = 'fingers' | 'color' | 'motion' | 'scan'
type TargetColor = keyof typeof TARGET_COLORS

type FingerState = ReturnType<typeof countRaisedFingers>['raised']

type AnalysisState = {
  fingerCount: number | null
  handLabel: string
  fps: number
  dominantColor: string
  targetColor: TargetColor
  targetCoverage: number
  motionScore: number
  motionDirection: string
  aiStatement: string
  framesProcessed: number
  estimatedTokens: number
  raised: FingerState | null
}

function countRaisedFingers(landmarks: NormalizedLandmark[], handedness: string) {
  const fingers: boolean[] = []

  for (let i = 0; i < FINGER_TIPS.length; i += 1) {
    const tip = landmarks[FINGER_TIPS[i]]
    const pip = landmarks[FINGER_PIPS[i]]
    fingers.push(tip.y < pip.y - 0.015)
  }

  const thumbTip = landmarks[4]
  const thumbIp = landmarks[3]
  const thumbMcp = landmarks[2]
  const thumbExtended = handedness === 'Left'
    ? thumbTip.x > thumbIp.x && thumbTip.x > thumbMcp.x
    : thumbTip.x < thumbIp.x && thumbTip.x < thumbMcp.x

  return {
    count: Number(thumbExtended) + fingers.filter(Boolean).length,
    raised: {
      thumb: thumbExtended,
      index: fingers[0],
      middle: fingers[1],
      ring: fingers[2],
      pinky: fingers[3],
    },
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

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const samplerRef = useRef<HTMLCanvasElement | null>(null)
  const landmarkerRef = useRef<HandLandmarker | null>(null)
  const animationRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const lastFrameAtRef = useRef(performance.now())
  const previousFrameRef = useRef<Uint8ClampedArray | null>(null)

  const [status, setStatus] = useState<CameraStatus>('idle')
  const [mode, setMode] = useState<VisionMode>('fingers')
  const [targetColor, setTargetColor] = useState<TargetColor>('red')
  const [message, setMessage] = useState('Press Start and choose what the camera should look for.')
  const [analysis, setAnalysis] = useState<AnalysisState>({
    fingerCount: null,
    handLabel: '—',
    fps: 0,
    dominantColor: '#000000',
    targetColor: 'red',
    targetCoverage: 0,
    motionScore: 0,
    motionDirection: 'still',
    aiStatement: 'Camera idle. Start the model and I’ll describe what I see locally.',
    framesProcessed: 0,
    estimatedTokens: 0,
    raised: null,
  })

  useEffect(() => {
    return () => stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadModel() {
    if (landmarkerRef.current) return landmarkerRef.current

    setMessage('Loading MediaPipe hand landmark model…')
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm',
    )

    landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    })

    return landmarkerRef.current
  }

  async function startCamera() {
    try {
      setStatus('loading')
      await loadModel()

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
      setMessage('Camera running. Select a mode and show the camera what to track.')
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
    const canvas = canvasRef.current
    const landmarker = landmarkerRef.current

    if (!video || !canvas || !landmarker) return

    if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime
      const result = landmarker.detectForVideo(video, performance.now())
      const visual = analyzePixels(video)
      drawResult(result, visual)

      const now = performance.now()
      const fps = Math.round(1000 / Math.max(now - lastFrameAtRef.current, 1))
      lastFrameAtRef.current = now
      setAnalysis((current) => ({
        ...current,
        fps,
        framesProcessed: current.framesProcessed + 1,
        estimatedTokens: 0,
      }))
    }

    animationRef.current = requestAnimationFrame(predictLoop)
  }

  function analyzePixels(video: HTMLVideoElement) {
    const sampler = samplerRef.current ?? document.createElement('canvas')
    samplerRef.current = sampler
    sampler.width = 96
    sampler.height = 54
    const ctx = sampler.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      return { dominantColor: '#000000', targetCoverage: 0, motionScore: 0, motionDirection: 'still' }
    }

    ctx.drawImage(video, 0, 0, sampler.width, sampler.height)
    const image = ctx.getImageData(0, 0, sampler.width, sampler.height)
    const data = image.data
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
      if (saturation > 28) {
        r += pixel[0]
        g += pixel[1]
        b += pixel[2]
        colorfulPixels += 1
      }
      if (colorDistance(pixel, target) < 88) targetHits += 1

      if (previous) {
        const delta = Math.abs(data[i] - previous[i]) + Math.abs(data[i + 1] - previous[i + 1]) + Math.abs(data[i + 2] - previous[i + 2])
        motionSum += delta
        const pixelIndex = i / 4
        const x = pixelIndex % sampler.width
        if (x < sampler.width / 2) leftMotion += delta
        else rightMotion += delta
      }
    }

    previousFrameRef.current = new Uint8ClampedArray(data)

    const pixels = data.length / 4
    const dominantColor = colorfulPixels
      ? rgbToHex(Math.round(r / colorfulPixels), Math.round(g / colorfulPixels), Math.round(b / colorfulPixels))
      : '#8ba4be'
    const motionScore = Math.min(100, Math.round(motionSum / pixels / 4))
    const motionDirection = motionScore < 8 ? 'still' : rightMotion > leftMotion * 1.12 ? 'moving left' : leftMotion > rightMotion * 1.12 ? 'moving right' : 'moving / shaking'

    return {
      dominantColor,
      targetCoverage: Math.round((targetHits / pixels) * 100),
      motionScore,
      motionDirection,
    }
  }

  function drawResult(
    result: HandLandmarkerResult,
    visual: { dominantColor: string; targetCoverage: number; motionScore: number; motionDirection: string },
  ) {
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

    result.landmarks.forEach((landmarks, index) => {
      const handedness = result.handedness[index]?.[0]?.categoryName ?? 'Right'
      const count = countRaisedFingers(landmarks, handedness)
      bestCount = Math.max(bestCount ?? 0, count.count)
      bestLabel = `${handedness} hand`
      raised = count.raised

      drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
        color: mode === 'motion' ? '#f6cc43' : '#66f2d5',
        lineWidth: 4,
      })
      drawingUtils.drawLandmarks(landmarks, {
        color: '#fff7a8',
        fillColor: '#111827',
        lineWidth: 2,
        radius: 5,
      })

      const wrist = landmarks[0]
      const x = wrist.x * canvas.width
      const y = wrist.y * canvas.height
      ctx.font = '700 28px Inter, system-ui, sans-serif'
      ctx.fillStyle = '#66f2d5'
      ctx.strokeStyle = '#07111f'
      ctx.lineWidth = 6
      ctx.strokeText(`${count.count} fingers`, x + 18, y - 18)
      ctx.fillText(`${count.count} fingers`, x + 18, y - 18)
    })

    if (mode === 'color' || mode === 'scan') {
      const barWidth = Math.max(18, (visual.targetCoverage / 100) * canvas.width)
      const [targetR, targetG, targetB] = TARGET_COLORS[targetColor]
      ctx.fillStyle = TARGET_COLORS[targetColor] ? rgbToHex(targetR, targetG, targetB) : visual.dominantColor
      ctx.globalAlpha = 0.3
      ctx.fillRect(0, canvas.height - 28, barWidth, 28)
      ctx.globalAlpha = 1
    }

    if (mode === 'motion' || mode === 'scan') {
      ctx.strokeStyle = visual.motionScore > 24 ? '#f6cc43' : '#66f2d5'
      ctx.lineWidth = 8
      ctx.strokeRect(18, 18, Math.max(30, visual.motionScore * 4), 28)
    }

    const aiStatement = makeStatement(bestCount, bestLabel, raised, visual)
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
    }))
  }

  function makeStatement(
    count: number | null,
    label: string,
    raised: FingerState | null,
    visual: { dominantColor: string; targetCoverage: number; motionScore: number; motionDirection: string },
  ) {
    if (mode === 'fingers') {
      return count === null
        ? 'I do not see a hand yet. Put one hand in frame.'
        : `I see a ${label.toLowerCase()} with ${count} raised finger${count === 1 ? '' : 's'}: ${describeRaised(raised)}.`
    }
    if (mode === 'color') {
      return `I am looking for ${targetColor}. It covers about ${visual.targetCoverage}% of the camera sample. Dominant visible color is ${visual.dominantColor}.`
    }
    if (mode === 'motion') {
      return `Motion is ${visual.motionScore}/100 and looks ${visual.motionDirection}. Move your hand faster to spike the meter.`
    }
    return `Scan mode: ${count ?? 0} fingers, ${visual.targetCoverage}% ${targetColor}, motion ${visual.motionScore}/100, dominant ${visual.dominantColor}.`
  }

  const modes: { id: VisionMode; title: string; subtitle: string }[] = [
    { id: 'fingers', title: 'Count fingers', subtitle: 'Hand landmarks + geometry' },
    { id: 'color', title: 'Find color', subtitle: 'Track target color coverage' },
    { id: 'motion', title: 'Speed / motion', subtitle: 'Frame-difference movement meter' },
    { id: 'scan', title: 'Everything scan', subtitle: 'Fingers + color + motion' },
  ]

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">Live browser vision · Vercel-ready · private by design</p>
        <h1>Vision Playground</h1>
        <p className="lede">
          Choose what the camera should look for, start the webcam, and watch the overlay explain what it sees.
          Finger counting runs on MediaPipe hand landmarks; color and speed run locally with canvas analysis.
        </p>
      </section>

      <section className="stage-card">
        <div className="video-wrap">
          <video ref={videoRef} className="camera" playsInline muted />
          <canvas ref={canvasRef} className="overlay" />
          <div className="hud top-left">
            <strong>{mode.toUpperCase()}</strong>
            <span>{analysis.aiStatement}</span>
          </div>
          <div className="hud top-right">
            <strong>Tokens</strong>
            <span>{analysis.estimatedTokens} cloud / local only</span>
          </div>
          {status !== 'running' && <div className="placeholder">Camera preview appears here</div>}
        </div>

        <aside className="control-panel">
          <div className="mode-grid" aria-label="Vision modes">
            {modes.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`mode-card ${mode === item.id ? 'active' : ''}`}
                onClick={() => setMode(item.id)}
              >
                <span>{item.title}</span>
                <small>{item.subtitle}</small>
              </button>
            ))}
          </div>

          <label className="select-label">
            Target color
            <select value={targetColor} onChange={(event) => setTargetColor(event.target.value as TargetColor)}>
              {Object.keys(TARGET_COLORS).map((color) => (
                <option key={color} value={color}>{color}</option>
              ))}
            </select>
          </label>

          <div className="metric-row">
            <div className="metric big">
              <span>Fingers</span>
              <strong>{analysis.fingerCount ?? '—'}</strong>
            </div>
            <div className="metric swatch-metric">
              <span>Color</span>
              <strong style={{ color: analysis.dominantColor }}>{analysis.dominantColor}</strong>
              <i style={{ background: analysis.dominantColor }} />
            </div>
          </div>

          <div className="metric-row">
            <div className="metric">
              <span>{targetColor} coverage</span>
              <strong>{analysis.targetCoverage}%</strong>
            </div>
            <div className="metric">
              <span>Motion</span>
              <strong>{analysis.motionScore}/100</strong>
            </div>
          </div>

          <div className="metric-row">
            <div className="metric">
              <span>Detected</span>
              <strong>{analysis.handLabel}</strong>
            </div>
            <div className="metric">
              <span>FPS</span>
              <strong>{analysis.fps || '—'}</strong>
            </div>
          </div>

          <div className={`status ${status}`}>{message}</div>
          <div className="actions">
            <button type="button" onClick={startCamera} disabled={status === 'loading' || status === 'running'}>
              {status === 'loading' ? 'Loading…' : 'Start camera'}
            </button>
            <button type="button" className="secondary" onClick={stopCamera} disabled={status !== 'running'}>
              Stop
            </button>
          </div>
        </aside>
      </section>

      <section className="notes-grid">
        <article>
          <h2>What ships now</h2>
          <p>
            A working browser app: hand/finger detection, target-color recognition, motion speed, live HUD, local frame counter,
            and camera overlays. No frame upload, no API key, no cloud tokens.
          </p>
        </article>
        <article>
          <h2>NVIDIA / Gemini path</h2>
          <p>
            NVIDIA LocateAnything is best as a future GPU backend for open-vocabulary grounding. Gemini can be added later for
            periodic descriptions, but this first deploy stays real-time and local so it works reliably on Vercel.
          </p>
        </article>
      </section>
    </main>
  )
}

export default App
