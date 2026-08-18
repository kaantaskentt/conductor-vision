import {
  AudioLines,
  Camera,
  Eye,
  Hand,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import type { CameraStatus } from '../hooks/useVisionRuntime'
import type { CameraCoverGeometry } from '../lib/cameraGeometry'

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
  navigationLocked = false,
}: {
  screen: Screen
  onScreenChange: (screen: Screen) => void
  navigationLocked?: boolean
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
            disabled={navigationLocked && screen !== item}
            title={navigationLocked && screen !== item
              ? 'Stop the local recording before leaving DJ Room'
              : undefined}
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
  className,
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <section className={`page-intro ${className ?? ''}`.trim()}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </section>
  )
}

export function CameraStage({
  status,
  message,
  setVideoElement,
  setCanvasElement,
  compact = false,
  backdrop,
  overlay,
  objectPosition = { x: 0.5, y: 0.5 },
  onGeometryChange,
}: {
  status: CameraStatus
  message: string
  setVideoElement: (element: HTMLVideoElement | null) => void
  setCanvasElement: (element: HTMLCanvasElement | null) => void
  compact?: boolean
  backdrop?: ReactNode
  overlay?: ReactNode
  objectPosition?: Readonly<{ x: number; y: number }>
  onGeometryChange?: (geometry: CameraCoverGeometry) => void
}) {
  const isRunning = status === 'running'
  const isLoading = status === 'loading'
  const stageRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const objectPositionX = objectPosition.x
  const objectPositionY = objectPosition.y
  const mediaObjectPosition = `${objectPositionX * 100}% ${objectPositionY * 100}%`

  const handleVideoElement = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element
    setVideoElement(element)
  }, [setVideoElement])

  useEffect(() => {
    const stage = stageRef.current
    const video = videoRef.current
    if (!stage || !video || !onGeometryChange) return

    const updateGeometry = () => {
      const bounds = stage.getBoundingClientRect()
      const stageWidth = stage.clientWidth || bounds.width
      const stageHeight = stage.clientHeight || bounds.height
      if (!video.videoWidth || !video.videoHeight || !stageWidth || !stageHeight) return
      onGeometryChange({
        sourceWidth: video.videoWidth,
        sourceHeight: video.videoHeight,
        stageWidth,
        stageHeight,
        objectPositionX,
        objectPositionY,
      })
    }

    updateGeometry()
    video.addEventListener('loadedmetadata', updateGeometry)
    video.addEventListener('resize', updateGeometry)
    window.addEventListener('resize', updateGeometry)
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateGeometry)
    resizeObserver?.observe(stage)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateGeometry)
      video.removeEventListener('resize', updateGeometry)
      video.removeEventListener('loadedmetadata', updateGeometry)
    }
  }, [objectPositionX, objectPositionY, onGeometryChange])

  return (
    <div
      ref={stageRef}
      className={`camera-stage status-${status} ${compact ? 'compact' : ''}`.trim()}
      data-camera-status={status}
    >
      {backdrop ? (
        <div className="camera-stage-backdrop" aria-hidden="true">
          {backdrop}
        </div>
      ) : null}
      <video
        ref={handleVideoElement}
        className="camera-feed"
        style={{ objectPosition: mediaObjectPosition }}
        playsInline
        muted
        aria-hidden="true"
        tabIndex={-1}
      />
      <canvas
        ref={setCanvasElement}
        className="camera-overlay"
        style={{ objectPosition: mediaObjectPosition }}
        aria-hidden="true"
      />
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
        <div className="camera-loading">
          <strong>Preparing local vision</strong>
          <span>{message}</span>
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
      {loading
        ? 'Cancel camera'
        : running
          ? 'Stop camera'
          : status === 'error'
            ? 'Retry camera'
            : 'Start camera'}
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
