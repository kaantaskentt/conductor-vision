import {
  Activity,
  Camera,
  CircleUserRound,
  Hand,
  Image as ImageIcon,
  Layers3,
  LockKeyhole,
  Move,
  ScanFace,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { CameraActions, CameraStage, PageIntro } from '../components/AppShell'
import type { useVisionRuntime } from '../hooks/useVisionRuntime'
import {
  createColorMaskPreview,
  createDepthStudyPreview,
  drawPixelStudioPreview,
  validatePixelStudioImage,
} from '../lib/pixelStudio'
import {
  TARGET_COLORS,
  describeRaised,
  type TargetColor,
  type VisionAnalysis,
} from '../lib/vision'

type PixelStudy = 'mask' | 'depth'

function PixelPreview({ source, label }: { source: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    void drawPixelStudioPreview(source, canvas)
  }, [source])

  return (
    <figure className="pixel-preview">
      <canvas ref={canvasRef}>{label}</canvas>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  )
}

function PixelStudio({ vision }: { vision: ReturnType<typeof useVisionRuntime> }) {
  const [study, setStudy] = useState<PixelStudy>('mask')
  const [source, setSource] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [sourceName, setSourceName] = useState('No image selected')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(
    'Transparent local pixel studies—not segmentation or depth models.',
  )
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  function clearSource() {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    setSource(null)
    setResult(null)
    setSourceName('No image selected')
    setMessage('Upload an image or capture the live camera frame.')
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      validatePixelStudioImage(file)
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      const url = URL.createObjectURL(file)
      objectUrlRef.current = url
      setSource(url)
      setResult(null)
      setSourceName('Uploaded image')
      setMessage('Image ready. Choose a study and run it locally.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The image could not be loaded.')
    }
  }

  function capture() {
    try {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
      const dataUrl = vision.captureFrame()
      setSource(dataUrl)
      setResult(null)
      setSourceName('Camera capture')
      setMessage('Frame captured locally. Choose a study and run it.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The frame could not be captured.')
    }
  }

  async function runStudy() {
    if (!source) {
      setMessage('Upload an image or capture a camera frame first.')
      return
    }
    setBusy(true)
    setMessage(study === 'mask' ? 'Building a color similarity mask…' : 'Building a luminance study…')
    try {
      const preview =
        study === 'mask'
          ? await createColorMaskPreview(source)
          : await createDepthStudyPreview(source)
      setResult(preview)
      setMessage(
        study === 'mask'
          ? 'Purple marks pixels similar to the center sample.'
          : 'Color maps luminance—not physical distance.',
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The preview could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="pixel-studio">
      <div className="pixel-studio-header">
        <div>
          <p className="eyebrow">Pixel Studio</p>
          <h2>Take a closer look.</h2>
          <p>Upload a still or capture the live camera, then inspect color similarity or luminance.</p>
        </div>
        <div>
          <label className="button secondary file-button">
            <Upload aria-hidden="true" />
            Upload image
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} />
          </label>
          <button
            type="button"
            className="button secondary"
            onClick={capture}
            disabled={vision.status !== 'running'}
          >
            <Camera aria-hidden="true" />
            Capture frame
          </button>
        </div>
      </div>

      <div className="pixel-layout">
        <aside className="pixel-study-list" aria-label="Pixel studies">
          <button
            type="button"
            className={study === 'mask' ? 'active' : ''}
            onClick={() => {
              setStudy('mask')
              setResult(null)
            }}
          >
            <span>
              <Layers3 aria-hidden="true" />
            </span>
            <strong>Color similarity</strong>
            <small>Threshold pixels around the center sample.</small>
          </button>
          <button
            type="button"
            className={study === 'depth' ? 'active' : ''}
            onClick={() => {
              setStudy('depth')
              setResult(null)
            }}
          >
            <span>
              <ImageIcon aria-hidden="true" />
            </span>
            <strong>Luminance map</strong>
            <small>Map brightness into a near/far-style palette.</small>
          </button>
          <div className="honesty-card">
            <LockKeyhole aria-hidden="true" />
            <strong>Honest runtime</strong>
            <p>No cloud upload and no neural-model claim. Every preview runs in this tab.</p>
          </div>
        </aside>

        <div className="pixel-workspace">
          <div className="pixel-canvas">
            {result || source ? (
              <PixelPreview
                source={result ?? source ?? ''}
                label={result ? `${study} preview` : sourceName}
              />
            ) : (
              <div className="pixel-empty">
                <ImageIcon aria-hidden="true" />
                <strong>Bring a frame into focus</strong>
                <p>Upload an image or start the camera and capture the live view above.</p>
              </div>
            )}
            {(source || result) && (
              <span className="pixel-source-chip">{result ? 'Processed locally' : sourceName}</span>
            )}
          </div>
          <div className="pixel-toolbar">
            <div aria-live="polite">
              <span>{study === 'mask' ? 'Color similarity' : 'Luminance map'}</span>
              <strong>{message}</strong>
            </div>
            <div>
              {(source || result) && (
                <button type="button" className="button text" onClick={clearSource}>
                  Clear
                </button>
              )}
              <button
                type="button"
                className="button primary"
                onClick={() => void runStudy()}
                disabled={!source || busy}
              >
                {busy ? 'Processing…' : 'Run study'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function DetectionInspector({ analysis }: { analysis: VisionAnalysis }) {
  const metrics = [
    {
      label: 'Hands',
      value: analysis.hands.length.toString(),
      detail: analysis.hands.length ? analysis.hands.map((hand) => hand.label).join(' + ') : 'None',
      icon: Hand,
    },
    {
      label: 'Fingers',
      value: analysis.fingerCount?.toString() ?? '—',
      detail: analysis.hands[0] ? describeRaised(analysis.hands[0].raised) : 'Waiting for hand',
      icon: Move,
    },
    {
      label: 'Faces',
      value: analysis.faceCount.toString(),
      detail: analysis.faceLabel,
      icon: ScanFace,
    },
    {
      label: 'Motion',
      value: `${analysis.motionScore}`,
      detail: analysis.motionDirection,
      icon: Activity,
    },
  ]

  return (
    <aside className="inspector-card">
      <div className="panel-heading">
        <div>
          <span>Live detections</span>
          <strong>What the camera sees</strong>
        </div>
        <span className="fps-chip">{analysis.fps ? `${analysis.fps} FPS` : 'Idle'}</span>
      </div>
      <div className="metric-stack">
        {metrics.map(({ label, value, detail, icon: Icon }) => (
          <div className="metric-row" key={label}>
            <span className="metric-icon">
              <Icon aria-hidden="true" />
            </span>
            <div>
              <span>{label}</span>
              <small>{detail}</small>
            </div>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="face-signals">
        <div>
          <span>Smile</span>
          <strong>{analysis.smileScore}%</strong>
        </div>
        <div>
          <span>Eyes open</span>
          <strong>{analysis.faceCount ? `${analysis.eyeOpenScore}%` : '—'}</strong>
        </div>
      </div>
    </aside>
  )
}

function MotionCard({ analysis }: { analysis: VisionAnalysis }) {
  const points = analysis.motionHistory
    .map((value, index) => {
      const x = (index / Math.max(analysis.motionHistory.length - 1, 1)) * 100
      const y = 45 - (value / 100) * 38
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <article className="detail-card motion-card">
      <div className="panel-heading">
        <div>
          <span>Motion history</span>
          <strong>{analysis.motionDirection}</strong>
        </div>
        <b>{analysis.motionChangedPercent}% changing</b>
      </div>
      <svg viewBox="0 0 100 48" preserveAspectRatio="none" aria-label="Recent motion level">
        <defs>
          <linearGradient id="motion-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c4dff" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#7c4dff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,48 ${points} 100,48`} fill="url(#motion-fill)" />
        <polyline points={points} />
      </svg>
    </article>
  )
}

function ColorCard({
  analysis,
  targetColor,
  onTargetColorChange,
}: {
  analysis: VisionAnalysis
  targetColor: TargetColor
  onTargetColorChange: (color: TargetColor) => void
}) {
  return (
    <article className="detail-card color-card">
      <div className="panel-heading">
        <div>
          <span>Color target</span>
          <strong>Pixel sampling</strong>
        </div>
        <label>
          <span className="sr-only">Target color</span>
          <select
            value={targetColor}
            onChange={(event) => onTargetColorChange(event.target.value as TargetColor)}
          >
            {(Object.keys(TARGET_COLORS) as TargetColor[]).map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="color-reading">
        <span className="color-swatch" style={{ background: analysis.targetHex }} />
        <div>
          <strong>{analysis.targetCoverage}%</strong>
          <span>{targetColor} coverage</span>
        </div>
        <div>
          <strong>{analysis.bestColorPercent}%</strong>
          <span>best match: {analysis.bestColorName}</span>
        </div>
        <span className="dominant-color" style={{ background: analysis.dominantColor }}>
          <span className="sr-only">Dominant frame color {analysis.dominantColor}</span>
        </span>
      </div>
    </article>
  )
}

export function VisionScreen({
  vision,
  targetColor,
  onTargetColorChange,
}: {
  vision: ReturnType<typeof useVisionRuntime>
  targetColor: TargetColor
  onTargetColorChange: (color: TargetColor) => void
}) {
  return (
    <>
      <PageIntro
        eyebrow="Vision"
        title="See what the camera understands."
        description="Real-time hand landmarks, face signals, motion, and color sampling—processed locally in your browser."
        actions={<CameraActions status={vision.status} start={vision.start} stop={vision.stop} />}
      />
      <section className="vision-layout">
        <CameraStage
          status={vision.status}
          message={vision.message}
          setVideoElement={vision.setVideoElement}
          setCanvasElement={vision.setCanvasElement}
          overlay={
            <div className="stage-summary">
              <span>
                <Hand aria-hidden="true" />
                {vision.analysis.hands.length
                  ? `${vision.analysis.hands.length} hand${vision.analysis.hands.length > 1 ? 's' : ''}`
                  : 'Find a hand'}
              </span>
              <span>
                <CircleUserRound aria-hidden="true" />
                {vision.analysis.faceCount ? vision.analysis.faceLabel : 'Find a face'}
              </span>
            </div>
          }
        />
        <DetectionInspector analysis={vision.analysis} />
      </section>
      <section className="detail-grid">
        <MotionCard analysis={vision.analysis} />
        <ColorCard
          analysis={vision.analysis}
          targetColor={targetColor}
          onTargetColorChange={onTargetColorChange}
        />
      </section>
      <PixelStudio vision={vision} />
    </>
  )
}
