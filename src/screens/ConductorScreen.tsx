import {
  ChevronLeft,
  ChevronRight,
  Hand,
  Move,
  Music2,
  Pause,
  Play,
  SlidersHorizontal,
  Upload,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react'
import { useRef, type CSSProperties } from 'react'
import { CameraActions, CameraStage, PageIntro } from '../components/AppShell'
import type {
  ConductorControl,
  useConductorAudio,
} from '../hooks/useConductorAudio'
import type { CameraStatus, useVisionRuntime } from '../hooks/useVisionRuntime'
import type { VisionAnalysis } from '../lib/vision'

const CONTROL_COPY: Record<
  ConductorControl,
  { label: string; description: string; instruction: string }
> = {
  volume: {
    label: 'Volume',
    description: 'Control loudness',
    instruction: 'Move your hand up or down',
  },
  filter: {
    label: 'Filter',
    description: 'Shape the sound',
    instruction: 'Rotate your wrist',
  },
  atmosphere: {
    label: 'Atmosphere',
    description: 'Add delay and space',
    instruction: 'Move your hand up or down',
  },
  cue: {
    label: 'Cue',
    description: 'Jump through the track',
    instruction: 'Swipe left or right',
  },
}

const CONTROL_ICONS: Record<ConductorControl, typeof Volume2> = {
  volume: Volume2,
  filter: SlidersHorizontal,
  atmosphere: Waves,
  cue: Move,
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

function TransportBar({
  audio,
  onUpload,
}: {
  audio: ReturnType<typeof useConductorAudio>
  onUpload: () => void
}) {
  const { track } = audio
  return (
    <div className="transport-bar">
      <div className="track-summary">
        <span className="track-art">
          <Music2 aria-hidden="true" />
        </span>
        <div>
          <strong>{track.name}</strong>
          <span>{track.loaded ? 'Local audio file' : 'Upload a track to begin'}</span>
        </div>
      </div>
      <button
        type="button"
        className="transport-button"
        onClick={() => void audio.togglePlayback()}
        disabled={!track.loaded}
        aria-label={track.playing ? 'Pause track' : 'Play track'}
      >
        {track.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
      <div className="timeline">
        <span>{formatTime(track.currentTime)}</span>
        <input
          type="range"
          min="0"
          max={Math.max(track.duration, 1)}
          step="0.05"
          value={Math.min(track.currentTime, Math.max(track.duration, 1))}
          onChange={(event) => audio.seek(Number(event.target.value))}
          disabled={!track.loaded}
          aria-label="Track position"
        />
        <span>{formatTime(track.duration)}</span>
      </div>
      <button
        type="button"
        className="icon-button"
        onClick={audio.toggleMute}
        disabled={!track.loaded}
        aria-label={track.muted ? 'Unmute track' : 'Mute track'}
      >
        {track.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      </button>
      <button type="button" className="button text transport-upload" onClick={onUpload}>
        <Upload aria-hidden="true" />
        Upload
      </button>
    </div>
  )
}

function ControlCard({
  control,
  audio,
}: {
  control: ConductorControl
  audio: ReturnType<typeof useConductorAudio>
}) {
  const { track } = audio
  const copy = CONTROL_COPY[control]
  const Icon = CONTROL_ICONS[control]
  const active = track.selectedControl === control
  const value =
    control === 'volume'
      ? track.volume
      : control === 'filter'
        ? track.filter
        : control === 'atmosphere'
          ? track.atmosphere
          : Math.round(((track.cueIndex - 1) / 7) * 100)

  return (
    <article className={`control-card ${active ? 'active' : ''}`}>
      <button
        type="button"
        className="control-select"
        onClick={() => audio.selectControl(control)}
        disabled={!track.loaded}
        aria-pressed={active}
      >
        <span className="control-icon">
          <Icon aria-hidden="true" />
        </span>
        <span>
          <strong>{copy.label}</strong>
          <small>{copy.description}</small>
        </span>
      </button>

      {control === 'filter' || control === 'atmosphere' ? (
        <div
          className="control-dial"
          style={
            {
              '--control-value': `${value}%`,
              '--control-angle': `${-135 + value * 2.7}deg`,
            } as CSSProperties
          }
          aria-label={`${copy.label} ${value} percent`}
        >
          <span />
          <strong>{value}%</strong>
        </div>
      ) : control === 'cue' ? (
        <div className="cue-control">
          <button
            type="button"
            onClick={() => audio.jumpToCue(track.cueIndex - 1)}
            disabled={!track.loaded || track.cueIndex === 1}
            aria-label="Previous cue"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <strong>{track.cueIndex}</strong>
          <span>/ 8</span>
          <button
            type="button"
            onClick={() => audio.jumpToCue(track.cueIndex + 1)}
            disabled={!track.loaded || track.cueIndex === 8}
            aria-label="Next cue"
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="control-meter" aria-label={`Volume ${value} percent`}>
          <span>
            <i style={{ width: `${value}%` }} />
          </span>
          <strong>{value}%</strong>
        </div>
      )}
      <p>{active ? copy.instruction : 'Select to control'}</p>
    </article>
  )
}

function ConductorInspector({
  audio,
  analysis,
  cameraStatus,
  onUpload,
}: {
  audio: ReturnType<typeof useConductorAudio>
  analysis: VisionAnalysis
  cameraStatus: CameraStatus
  onUpload: () => void
}) {
  const { track } = audio
  const selected = CONTROL_COPY[track.selectedControl]
  return (
    <aside className="conductor-inspector">
      <div className="hand-status">
        <div className="panel-heading">
          <div>
            <span>Hand tracking</span>
            <strong>{analysis.hands.length ? 'Active' : 'Waiting'}</strong>
          </div>
          <span className={`status-dot ${analysis.hands.length ? 'active' : ''}`} />
        </div>
        <p>
          {cameraStatus !== 'running'
            ? 'Start the camera to connect movement.'
            : analysis.hands.length
              ? `${analysis.hands[0].label} hand detected with ${analysis.hands[0].count} open fingers.`
              : 'Move one hand into the camera frame.'}
        </p>
      </div>

      <div className="selected-control">
        <span>Selected control</span>
        <strong>{selected.label}</strong>
        <p>{track.gestureStatus}</p>
      </div>

      <div className="level-card">
        <div>
          <span>Audio level</span>
          <strong>{track.playing ? `${track.audioLevel}%` : 'Idle'}</strong>
        </div>
        <div className="level-bars" aria-label={`Audio level ${track.audioLevel} percent`}>
          {Array.from({ length: 16 }, (_, index) => (
            <i
              key={index}
              className={index < Math.ceil((track.audioLevel / 100) * 16) ? 'lit' : ''}
            />
          ))}
        </div>
      </div>

      <div className="upload-card">
        <Music2 aria-hidden="true" />
        <div>
          <strong>{track.loaded ? track.name : 'No track loaded'}</strong>
          <span>{track.loaded ? 'Ready in this tab' : 'MP3, WAV, FLAC, or OGG · 100 MB max'}</span>
        </div>
        <button type="button" className="button secondary" onClick={onUpload}>
          <Upload aria-hidden="true" />
          {track.loaded ? 'Replace' : 'Upload track'}
        </button>
      </div>
      {track.error && (
        <div className="inline-error" role="alert">
          {track.error}
        </div>
      )}
    </aside>
  )
}

export function ConductorScreen({
  vision,
  audio,
}: {
  vision: ReturnType<typeof useVisionRuntime>
  audio: ReturnType<typeof useConductorAudio>
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const openUpload = () => fileInputRef.current?.click()

  return (
    <>
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="audio/mpeg,audio/wav,audio/flac,audio/ogg,.mp3,.wav,.flac,.ogg"
        onChange={(event) => {
          audio.loadFile(event.target.files?.[0])
          event.currentTarget.value = ''
        }}
      />
      <PageIntro
        eyebrow="Conductor"
        title="Control sound with movement."
        description="Upload a track, choose one control, and use your hand as a focused musical instrument."
        actions={
          <>
            <button type="button" className="button secondary" onClick={openUpload}>
              <Upload aria-hidden="true" />
              Upload track
            </button>
            <CameraActions status={vision.status} start={vision.start} stop={vision.stop} />
          </>
        }
      />

      <section className="conductor-layout">
        <div className="conductor-performance">
          <CameraStage
            status={vision.status}
            message={vision.message}
            setVideoElement={vision.setVideoElement}
            setCanvasElement={vision.setCanvasElement}
            overlay={
              <div className="conductor-overlay">
                <span>
                  <Hand aria-hidden="true" />
                  {vision.analysis.hands.length ? 'Hand connected' : 'Find a hand'}
                </span>
                <span>{CONTROL_COPY[audio.track.selectedControl].label} selected</span>
              </div>
            }
          />
          <TransportBar audio={audio} onUpload={openUpload} />
          <div className="control-grid">
            {(Object.keys(CONTROL_COPY) as ConductorControl[]).map((control) => (
              <ControlCard key={control} control={control} audio={audio} />
            ))}
          </div>
        </div>
        <ConductorInspector
          audio={audio}
          analysis={vision.analysis}
          cameraStatus={vision.status}
          onUpload={openUpload}
        />
      </section>
    </>
  )
}
