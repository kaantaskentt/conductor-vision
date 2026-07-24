import {
  AudioLines,
  Camera,
  Eye,
  Hand,
  ShieldCheck,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { CameraStatus } from '../hooks/useVisionRuntime'

export type Screen = 'vision' | 'dj-room'

const SCREEN_LABELS: Record<Screen, string> = {
  vision: 'Vision',
  'dj-room': 'DJ Room',
}

function ScreenIcon({ screen }: { screen: Screen }) {
  if (screen === 'vision') return <Eye aria-hidden="true" />
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
  const isLoading = status === 'loading'

  return (
    <div className={`camera-stage ${compact ? 'compact' : ''}`}>
      <video
        ref={setVideoElement}
        className="camera-feed"
        playsInline
        muted
        aria-hidden="true"
        tabIndex={-1}
      />
      <canvas ref={setCanvasElement} className="camera-overlay" aria-hidden="true" />
      <div className="stage-corners" aria-hidden="true" />
      <div className={`live-pill ${isRunning ? 'running' : isLoading ? 'loading' : ''}`}>
        <span />
        {isRunning
          ? 'Live on device'
          : isLoading
            ? 'Preparing on device'
            : status === 'error'
              ? 'Camera error'
              : 'Camera off'}
      </div>
      {status === 'idle' || status === 'error' ? (
        <div className="camera-empty">
          <Camera aria-hidden="true" />
          <strong>{status === 'error' ? 'Camera needs attention' : 'Camera off'}</strong>
          <p>{message}</p>
          <span>
            <Hand aria-hidden="true" />
            Hand tracking inactive
          </span>
        </div>
      ) : null}
      {isLoading && (
        <output className="camera-loading" aria-live="polite">
          <strong>Preparing local vision</strong>
          <span>{message}</span>
        </output>
      )}
      {isRunning && overlay}
    </div>
  )
}

export function CameraActions({
  status,
  start,
  stop,
  variant = 'primary',
}: {
  status: CameraStatus
  start: () => void
  stop: () => void
  variant?: 'primary' | 'secondary'
}) {
  const running = status === 'running'
  const loading = status === 'loading'
  const active = running || loading
  return (
    <button
      type="button"
      className={`button ${variant}`}
      onClick={active ? stop : start}
    >
      <Camera aria-hidden="true" />
      {loading ? 'Cancel camera' : running ? 'Stop camera' : 'Start camera'}
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
