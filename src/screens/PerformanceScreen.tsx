import {
  Camera,
  Check,
  ChevronLeft,
  Hand,
  Lock,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Volume2,
  Waves,
} from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { PerformanceWaveform } from '../components/PerformanceWaveform'
import type { DeckId, useDjMixer } from '../hooks/useDjMixer'
import type { useVisionRuntime } from '../hooks/useVisionRuntime'
import {
  createAirTargetControllerState,
  updateAirTargetController,
  type AirTarget,
} from '../lib/airTargetController'

const ACCEPTED_AUDIO = 'audio/mpeg,audio/wav,audio/flac,audio/ogg,.mp3,.wav,.flac,.ogg'
type Step = 'camera' | 'tracks' | 'live'

function trackLabel(id: DeckId) {
  return id === 'a' ? 'Deck A' : 'Deck B'
}

function filterReadout(value: number) {
  if (value === 50) return 'Neutral'
  return value < 50 ? `${value}% LP` : `${value}% HP`
}

function AirButton({
  target,
  label,
  value,
  icon: Icon,
  active = false,
  disabled = false,
  progress = 0,
  onClick,
}: {
  target: string
  label: string
  value?: string
  icon: typeof Play
  active?: boolean
  disabled?: boolean
  progress?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`uv-air-button ${active ? 'is-active' : ''}`}
      data-air-target={target}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
      {value ? <strong>{value}</strong> : null}
      <i aria-hidden="true" style={{ width: `${Math.round(progress * 100)}%` }} />
    </button>
  )
}

function TrackDrop({
  id,
  loaded,
  name,
  bpm,
  error,
  onFile,
}: {
  id: DeckId
  loaded: boolean
  name: string
  bpm: number | null
  error: string | null
  onFile: (file?: File) => void
}) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    onFile(event.dataTransfer.files[0])
  }

  return (
    <div
      className={`uv-track-drop uv-track-drop-${id} ${dragging ? 'is-dragging' : ''} ${loaded ? 'is-loaded' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <span className="uv-track-orbit" aria-hidden="true">{id.toUpperCase()}</span>
      <div>
        <span className="uv-eyebrow">{trackLabel(id)}</span>
        <h2>{loaded ? name : id === 'a' ? 'Choose your first track' : 'Add a second track'}</h2>
        <p>{loaded ? (bpm ? `${bpm.toFixed(1)} BPM · ready` : 'Analyzing BPM and waveform…') : 'MP3, WAV, FLAC, or OGG · processed locally'}</p>
        <button type="button" className="uv-button uv-button-secondary" onClick={() => inputRef.current?.click()}>
          <Upload aria-hidden="true" /> {loaded ? 'Replace track' : 'Choose track'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_AUDIO}
          onChange={(event) => onFile(event.target.files?.[0])}
          className="sr-only"
          aria-label={`Choose audio for ${trackLabel(id)}`}
        />
        {error ? <p className="uv-error" role="alert">{error}</p> : null}
      </div>
    </div>
  )
}

export function PerformanceScreen({
  vision,
  mixer,
}: {
  vision: ReturnType<typeof useVisionRuntime>
  mixer: ReturnType<typeof useDjMixer>
}) {
  const [step, setStep] = useState<Step>('camera')
  const [manualOpen, setManualOpen] = useState(false)
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null)
  const [hoverProgress, setHoverProgress] = useState(0)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const airStateRef = useRef(createAirTargetControllerState())
  const actionsRef = useRef<Record<string, () => void>>({})
  const loadedCount = Number(mixer.decks.a.loaded) + Number(mixer.decks.b.loaded)
  const displayTrackCount = loadedCount || 1
  const primaryHand = vision.analysis.hands[0]
  const releaseGestureSession = mixer.releaseGestureSession

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    const settleScroll = window.setTimeout(
      () => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }),
      0,
    )
    return () => window.clearTimeout(settleScroll)
  }, [step])

  actionsRef.current = {
    'play:a': () => void mixer.togglePlayback('a'),
    'play:b': () => void mixer.togglePlayback('b'),
    'volume:a': () => mixer.selectControl('volume', 'a'),
    'volume:b': () => mixer.selectControl('volume', 'b'),
    'filter:a': () => mixer.selectControl('filter', 'a'),
    'filter:b': () => mixer.selectControl('filter', 'b'),
    sync: mixer.toggleBpmSync,
  }

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const targets: AirTarget[] = [...stage.querySelectorAll<HTMLElement>('[data-air-target]')]
      .map((element) => {
        const bounds = element.getBoundingClientRect()
        return {
          id: element.dataset.airTarget ?? '',
          left: (bounds.left - rect.left) / Math.max(rect.width, 1),
          top: (bounds.top - rect.top) / Math.max(rect.height, 1),
          right: (bounds.right - rect.left) / Math.max(rect.width, 1),
          bottom: (bounds.bottom - rect.top) / Math.max(rect.height, 1),
          disabled: element.matches(':disabled'),
        }
      })
      .filter((target) => target.id)
    const transition = updateAirTargetController(
      airStateRef.current,
      {
        detected: Boolean(primaryHand),
        pointing: primaryHand?.pointing ?? false,
        x: primaryHand?.pointerX ?? 0.5,
        y: primaryHand?.pointerY ?? 0.5,
        now: performance.now(),
      },
      targets,
    )
    airStateRef.current = transition.state
    setHoveredTarget(transition.hoveredTargetId)
    setHoverProgress(transition.dwellProgress)
    if (transition.activatedTargetId) actionsRef.current[transition.activatedTargetId]?.()
  }, [primaryHand])

  useEffect(() => {
    if (vision.status === 'idle' || vision.status === 'error') releaseGestureSession('camera-stopped')
  }, [releaseGestureSession, vision.status])

  const progressFor = (target: string) => hoveredTarget === target ? hoverProgress : 0
  const cameraReady = vision.status === 'running'
  const activeDeck = mixer.decks[mixer.activeDeck]

  return (
    <main className="uv-shell">
      <header className="uv-header">
        <button type="button" className="uv-brand" onClick={() => setStep('camera')} aria-label="Ultra Vision home">
          <Waves aria-hidden="true" />
          <span>Ultra Vision</span>
        </button>
        <div className="uv-stepper" aria-label="Setup progress">
          <span className={step === 'camera' ? 'is-current' : ''}>1 Camera</span>
          <span className={step === 'tracks' ? 'is-current' : ''}>2 Tracks</span>
          <span className={step === 'live' ? 'is-current' : ''}>3 Play</span>
        </div>
        <span className="uv-private"><Lock aria-hidden="true" /> Local + private</span>
      </header>

      {step === 'camera' ? (
        <section className="uv-setup uv-camera-setup">
          <div className="uv-setup-copy">
            <span className="uv-eyebrow">Step 1 · Camera</span>
            <h1>Put the music<br />under your hands.</h1>
            <p>Ultra Vision tracks your hand on this device. Frames are never uploaded or stored.</p>
            <div className="uv-setup-actions">
              <button type="button" className="uv-button uv-button-primary" onClick={cameraReady ? () => setStep('tracks') : vision.start} disabled={vision.status === 'loading'}>
                {cameraReady ? <Check aria-hidden="true" /> : <Camera aria-hidden="true" />}
                {cameraReady ? 'Camera ready · continue' : vision.status === 'loading' ? 'Starting private camera…' : 'Allow private camera'}
              </button>
              {vision.status === 'running' ? (
                <button type="button" className="uv-button uv-button-secondary" onClick={vision.stop}>Stop camera</button>
              ) : (
                <button type="button" className="uv-link-button" onClick={() => setStep('tracks')}>Use mouse controls instead</button>
              )}
            </div>
            <output className="uv-inline-status">{vision.message}</output>
          </div>
          <div className="uv-camera-preview" data-camera-status={vision.status}>
            <video ref={vision.setVideoElement} playsInline muted aria-hidden="true" />
            <canvas ref={vision.setCanvasElement} aria-hidden="true" />
            <div className="uv-camera-guide" aria-hidden="true"><Hand /></div>
            <span className="uv-live-status"><i /> {cameraReady ? 'Hand tracking live' : 'Camera preview'}</span>
            <div className="uv-position-note">
              <strong>{vision.analysis.hands.length ? 'Hand found' : 'Raise one hand'}</strong>
              <span>Keep your upper body and hand inside the frame.</span>
            </div>
          </div>
        </section>
      ) : null}

      {step === 'tracks' ? (
        <section className="uv-track-setup">
          <button type="button" className="uv-back" onClick={() => setStep('camera')}><ChevronLeft aria-hidden="true" /> Camera</button>
          <div className="uv-centered-heading">
            <span className="uv-eyebrow">Step 2 · Tracks</span>
            <h1>Load one track.<br />Add another when you want.</h1>
            <p>You only need one track to enter. A second deck unlocks BPM matching.</p>
          </div>
          <div className="uv-track-grid">
            <TrackDrop id="a" {...mixer.decks.a} onFile={(file) => void mixer.loadFile('a', file)} />
            <TrackDrop id="b" {...mixer.decks.b} onFile={(file) => void mixer.loadFile('b', file)} />
          </div>
          <div className="uv-track-actions">
            <button type="button" className="uv-button uv-button-secondary" disabled={mixer.demoLoading} onClick={() => void mixer.loadDemoMix()}>
              <Sparkles aria-hidden="true" /> {mixer.demoLoading ? 'Building local demo…' : 'Try generated demo tracks'}
            </button>
            <button type="button" className="uv-button uv-button-primary" disabled={!loadedCount} onClick={() => setStep('live')}>
              Open performance · {displayTrackCount} {displayTrackCount === 1 ? 'track' : 'tracks'}
            </button>
          </div>
          <p className="uv-privacy-line"><Lock aria-hidden="true" /> Audio is decoded in this tab and never uploaded.</p>
        </section>
      ) : null}

      {step === 'live' ? (
        <section className="uv-live">
          <div className="uv-live-topline">
            <button type="button" className="uv-back" onClick={() => setStep('tracks')}><ChevronLeft aria-hidden="true" /> Tracks</button>
            <div><i className={cameraReady ? 'is-live' : ''} /> {cameraReady ? 'Open hand live' : 'Manual mode'}</div>
            <button type="button" className="uv-link-button" onClick={cameraReady ? vision.stop : vision.start}>{cameraReady ? 'Stop camera' : 'Start camera'}</button>
          </div>

          <div className="uv-performance-stage" ref={stageRef}>
            <video ref={vision.setVideoElement} playsInline muted aria-hidden="true" />
            <canvas ref={vision.setCanvasElement} aria-hidden="true" />
            {!cameraReady ? (
              <div className="uv-stage-empty">
                <Hand aria-hidden="true" />
                <strong>Manual mode</strong>
                <span>Start the camera to control these buttons in the air.</span>
              </div>
            ) : null}

            <div className="uv-air-rail uv-air-rail-a" aria-label="Deck A air targets">
              <span>Deck A</span>
              <AirButton target="play:a" label={mixer.decks.a.playing ? 'Pause' : 'Start'} icon={mixer.decks.a.playing ? Pause : Play} disabled={!mixer.decks.a.loaded} progress={progressFor('play:a')} onClick={() => void mixer.togglePlayback('a')} />
              <AirButton target="volume:a" label="Volume" value={`${mixer.decks.a.volume}%`} icon={Volume2} active={mixer.activeDeck === 'a' && mixer.selectedControl === 'volume'} disabled={!mixer.decks.a.loaded} progress={progressFor('volume:a')} onClick={() => mixer.selectControl('volume', 'a')} />
              <AirButton target="filter:a" label="Filter" value={filterReadout(mixer.decks.a.filter)} icon={SlidersHorizontal} active={mixer.activeDeck === 'a' && mixer.selectedControl === 'filter'} disabled={!mixer.decks.a.loaded} progress={progressFor('filter:a')} onClick={() => mixer.selectControl('filter', 'a')} />
            </div>

            <div className="uv-air-rail uv-air-rail-b" aria-label="Deck B air targets">
              <span>Deck B</span>
              <AirButton target="play:b" label={mixer.decks.b.playing ? 'Pause' : 'Start'} icon={mixer.decks.b.playing ? Pause : Play} disabled={!mixer.decks.b.loaded} progress={progressFor('play:b')} onClick={() => void mixer.togglePlayback('b')} />
              <AirButton target="volume:b" label="Volume" value={`${mixer.decks.b.volume}%`} icon={Volume2} active={mixer.activeDeck === 'b' && mixer.selectedControl === 'volume'} disabled={!mixer.decks.b.loaded} progress={progressFor('volume:b')} onClick={() => mixer.selectControl('volume', 'b')} />
              <AirButton target="filter:b" label="Filter" value={filterReadout(mixer.decks.b.filter)} icon={SlidersHorizontal} active={mixer.activeDeck === 'b' && mixer.selectedControl === 'filter'} disabled={!mixer.decks.b.loaded} progress={progressFor('filter:b')} onClick={() => mixer.selectControl('filter', 'b')} />
            </div>

            <AirButton target="sync" label={mixer.bpmSyncActive ? 'BPM matched' : 'Match BPM'} icon={mixer.bpmSyncActive ? Check : Waves} active={mixer.bpmSyncActive} disabled={!mixer.decks.a.bpm || !mixer.decks.b.bpm} progress={progressFor('sync')} onClick={mixer.toggleBpmSync} />

            {primaryHand && cameraReady ? (
              <div className={`uv-hand-pointer ${primaryHand.pointing ? 'is-pointing' : ''}`} style={{ left: `${primaryHand.pointerX * 100}%`, top: `${primaryHand.pointerY * 100}%` }} aria-hidden="true">
                <span />
              </div>
            ) : null}

            <div className="uv-control-readout" aria-live="polite">
              <span>{mixer.selectedControl === 'filter' ? 'Filter' : mixer.selectedControl === 'volume' ? 'Volume' : 'Ready'}</span>
              <strong>{mixer.selectedControl === 'filter' ? filterReadout(activeDeck.filter) : mixer.selectedControl === 'volume' ? `${activeDeck.volume}%` : 'Point + hold'}</strong>
              <small>{cameraReady ? mixer.gestureStatus : 'Click a control or start the camera'}</small>
            </div>
          </div>

          <div className="uv-waveform-workspace">
            <div className="uv-sync-line">
              <span>Track overview</span>
              <strong>{mixer.bpmSyncActive ? 'BPM matched · align the downbeat manually' : 'BPM matching changes playback rate only'}</strong>
            </div>
            <PerformanceWaveform deckId="a" deck={mixer.decks.a} onSeek={(time) => mixer.seek('a', time)} />
            <PerformanceWaveform deckId="b" deck={mixer.decks.b} onSeek={(time) => mixer.seek('b', time)} />
          </div>

          <div className="uv-performance-footer">
            <p><Hand aria-hidden="true" /> Point and hold to select · open your palm to move · make a fist to release</p>
            <button type="button" className="uv-button uv-button-secondary" onClick={() => setManualOpen((value) => !value)}>{manualOpen ? 'Hide manual controls' : 'Manual controls'}</button>
          </div>

          {manualOpen ? (
            <section className="uv-manual" aria-label="Manual mixer controls">
              {(['a', 'b'] as DeckId[]).map((id) => (
                <fieldset key={id} disabled={!mixer.decks[id].loaded}>
                  <legend>{trackLabel(id)}</legend>
                  <label>Volume <output>{mixer.decks[id].volume}%</output><input type="range" min="0" max="100" value={mixer.decks[id].volume} onChange={(event) => mixer.setDeckVolume(id, Number(event.target.value))} /></label>
                  <label>Filter <output>{filterReadout(mixer.decks[id].filter)}</output><input type="range" min="0" max="100" value={mixer.decks[id].filter} onChange={(event) => mixer.setDeckFilter(id, Number(event.target.value))} /></label>
                  <button type="button" className="uv-link-button" onClick={() => { mixer.resetControl('volume', id); mixer.resetControl('filter', id) }}><RotateCcw aria-hidden="true" /> Reset</button>
                </fieldset>
              ))}
            </section>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}
