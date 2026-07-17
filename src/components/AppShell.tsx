import {
  AudioLines,
  Camera,
  Eye,
  FlaskConical,
  Hand,
  ShieldCheck,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { CameraStatus } from '../hooks/useVisionRuntime'

export type Screen = 'vision' | 'lab' | 'conductor'

const SCREEN_LABELS: Record<Screen, string> = {
  vision: 'Vision',
  lab: 'Lab',
  conductor: 'Conductor',
}

function ScreenIcon({ screen }: { screen: Screen }) {
  if (screen === 'vision') return <Eye aria-hidden="true" />
  if (screen === 'lab') return <FlaskConical aria-hidden="true" />
  return <AudioLines aria-hidden="true" />
}

export function AppHeader({
  screen,
  onScreenChange,
}: {
  screen: Screen
  onScreenChange: (screen: Screen) => void
}) {
  return (
    <header className="app-header">
      <a className="brand" href="#main-content" aria-label="Ultra Vision home">
        <img className="brand-mark" src="/ultra-vision-icon.png" alt="" />
        <span>
          <strong>Ultra Vision</strong>
          <small>Local vision instruments</small>
        </span>
      </a>

      <nav className="mode-nav" aria-label="Primary">
        {(Object.keys(SCREEN_LABELS) as Screen[]).map((item) => (
          <button
            key={item}
            type="button"
            className={screen === item ? 'active' : ''}
            aria-current={screen === item ? 'page' : undefined}
            onClick={() => onScreenChange(item)}
          >
            <ScreenIcon screen={item} />
            {SCREEN_LABELS[item]}
          </button>
        ))}
      </nav>

      <div className="privacy-note">
        <ShieldCheck aria-hidden="true" />
        <span>Camera stays on this device</span>
      </div>
    </header>
  )
}

export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description: string
  actions: ReactNode
}) {
  return (
    <section className="page-intro">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      <div className="page-actions">{actions}</div>
    </section>
  )
}

export function CameraStage({
  status,
  message,
  setVideoElement,
  setCanvasElement,
  compact = false,
  overlay,
}: {
  status: CameraStatus
  message: string
  setVideoElement: (element: HTMLVideoElement | null) => void
  setCanvasElement: (element: HTMLCanvasElement | null) => void
  compact?: boolean
  overlay?: ReactNode
}) {
  const isRunning = status === 'running'

  return (
    <div className={`camera-stage ${compact ? 'compact' : ''}`}>
      <video ref={setVideoElement} className="camera-feed" playsInline muted />
      <canvas ref={setCanvasElement} className="camera-overlay" />
      <div className="stage-corners" aria-hidden="true" />
      <div className={`live-pill ${isRunning ? 'running' : ''}`}>
        <span />
        {isRunning ? 'Live on device' : status === 'loading' ? 'Loading models' : 'Camera off'}
      </div>
      {!isRunning && (
        <div className="camera-empty">
          <Camera aria-hidden="true" />
          <strong>{status === 'loading' ? 'Preparing local vision' : 'Camera off'}</strong>
          <p>{message}</p>
          <span>
            <Hand aria-hidden="true" />
            Hand tracking inactive
          </span>
        </div>
      )}
      {isRunning && overlay}
    </div>
  )
}

export function CameraActions({
  status,
  start,
  stop,
}: {
  status: CameraStatus
  start: () => void
  stop: () => void
}) {
  const running = status === 'running'
  return (
    <button
      type="button"
      className="button primary"
      onClick={running ? stop : start}
      disabled={status === 'loading'}
    >
      <Camera aria-hidden="true" />
      {status === 'loading' ? 'Loading…' : running ? 'Stop camera' : 'Start camera'}
    </button>
  )
}

export function PrivacyFooter() {
  return (
    <footer className="app-footer">
      <span>
        <ShieldCheck aria-hidden="true" />
        Local first. Camera frames and media stay in this browser tab.
      </span>
      <a href="https://github.com/kaantaskentt/ultra-vision">View source</a>
    </footer>
  )
}
