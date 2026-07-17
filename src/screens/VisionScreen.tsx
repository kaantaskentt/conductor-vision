import {
  Activity,
  CircleUserRound,
  Hand,
  Move,
  ScanFace,
} from 'lucide-react'
import { CameraActions, CameraStage, PageIntro } from '../components/AppShell'
import type { useVisionRuntime } from '../hooks/useVisionRuntime'
import {
  TARGET_COLORS,
  describeRaised,
  type TargetColor,
  type VisionAnalysis,
} from '../lib/vision'

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
    </>
  )
}
