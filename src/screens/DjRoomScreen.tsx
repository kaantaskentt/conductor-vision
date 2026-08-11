import {
  Camera,
  Check,
  Disc3,
  Hand,
  Lock,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Volume2,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import airMixMotion from '../assets/air-mix-motion.jpg'
import { CameraStage } from '../components/AppShell'
import { PerformanceWaveform } from '../components/PerformanceWaveform'
import type { DeckId, DjControl, useDjMixer } from '../hooks/useDjMixer'
import type { useVisionRuntime } from '../hooks/useVisionRuntime'
import {
  airTargetAt,
  createAirDwellState,
  transitionAirDwell,
  visibleAirX,
  type AirDwellState,
  type AirTargetId,
} from '../lib/airTarget'

const ACCEPTED_AUDIO = 'audio/mpeg,audio/wav,audio/flac,audio/ogg,.mp3,.wav,.flac,.ogg'

type DjFlowStep = 'camera' | 'tracks' | 'perform'

const FLOW_STEPS: Array<{ id: DjFlowStep; label: string }> = [
  { id: 'camera', label: 'Camera' },
  { id: 'tracks', label: 'Load Tracks' },
  { id: 'perform', label: 'Perform' },
]

const AIR_TARGET_LABELS: Record<AirTargetId, string> = {
  'cue-a': 'Cue Deck A',
  'play-a': 'Play Deck A',
  'cue-b': 'Cue Deck B',
  'play-b': 'Play Deck B',
  volume: 'Volume',
  filter: 'Filter',
}

function deckLabel(id: DeckId) {
  return id === 'a' ? 'Deck A' : 'Deck B'
}

function visibleDeckControl(control: DjControl): 'volume' | 'filter' {
  return control === 'filter' ? 'filter' : 'volume'
}

function selectedControlValue(mixer: ReturnType<typeof useDjMixer>) {
  const deck = mixer.decks[mixer.activeDeck]
  if (mixer.selectedControl === 'filter') {
    if (deck.filter === 50) return '50% · Neutral'
    return deck.filter < 50 ? `${deck.filter}% · Low pass` : `${deck.filter}% · High pass`
  }
  return `${deck.volume}%`
}

function FlowProgress({
  step,
  canOpenTracks,
  canPerform,
  onStepChange,
}: {
  step: DjFlowStep
  canOpenTracks: boolean
  canPerform: boolean
  onStepChange: (step: DjFlowStep) => void
}) {
  const activeIndex = FLOW_STEPS.findIndex(({ id }) => id === step)

  return (
    <nav className="uv-flow-progress" aria-label="DJ Room setup">
      {FLOW_STEPS.map((item, index) => {
        const enabled = item.id === 'camera' || (item.id === 'tracks' ? canOpenTracks : canPerform)
        const complete = index < activeIndex
        return (
          <button
            key={item.id}
            type="button"
            className={item.id === step ? 'active' : complete ? 'complete' : ''}
            onClick={() => onStepChange(item.id)}
            disabled={!enabled}
            aria-current={item.id === step ? 'step' : undefined}
          >
            <b aria-hidden="true">{complete ? <Check /> : index + 1}</b>
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function TrackSlot({
  id,
  mixer,
  onChoose,
}: {
  id: DeckId
  mixer: ReturnType<typeof useDjMixer>
  onChoose: () => void
}) {
  const deck = mixer.decks[id]
  return (
    <article className={`uv-track-slot deck-${id} ${deck.loaded ? 'loaded' : ''}`}>
      <div className="uv-track-slot-heading">
        <span>{deckLabel(id)}{id === 'b' ? ' · optional' : ''}</span>
        {deck.loaded && <b>Ready</b>}
      </div>
      <div className="uv-track-pulse" aria-hidden="true">
        <Disc3 />
      </div>
      {deck.loaded ? (
        <>
          <strong title={deck.name}>{deck.name}</strong>
          <small>{deck.bpm ? `${deck.bpm.toFixed(1)} BPM` : deck.bpmStatus}</small>
          <div className="uv-track-preview" aria-hidden="true">
            {deck.waveform.map((amplitude, index) => (
              <i key={index} style={{ height: `${Math.max(10, amplitude)}%` }} />
            ))}
          </div>
        </>
      ) : (
        <>
          <strong>Choose audio</strong>
          <small>MP3, WAV, FLAC, or OGG</small>
        </>
      )}
      <button type="button" className="button secondary" onClick={onChoose}>
        <Upload aria-hidden="true" />
        {deck.loaded ? `Replace ${deckLabel(id)}` : `Choose ${deckLabel(id)}`}
      </button>
      {deck.error && <p className="inline-error" role="alert">{deck.error}</p>}
    </article>
  )
}

function PerformanceTarget({
  target,
  label,
  detail,
  deck,
  active,
  disabled,
  icon,
  airDwell,
  onClick,
}: {
  target: AirTargetId
  label: string
  detail: string
  deck?: DeckId
  active?: boolean
  disabled?: boolean
  icon: 'cue' | 'play' | 'pause' | 'volume' | 'filter'
  airDwell: AirDwellState
  onClick: () => void
}) {
  const progress = airDwell.target === target ? airDwell.progress : 0
  const Icon = icon === 'cue'
    ? RotateCcw
    : icon === 'play'
      ? Play
      : icon === 'pause'
        ? Pause
        : icon === 'volume'
          ? Volume2
          : SlidersHorizontal
  const style = { '--air-progress': `${Math.round(progress * 360)}deg` } as CSSProperties

  return (
    <button
      type="button"
      className={`uv-performance-target target-${target} ${active ? 'active' : ''} ${progress > 0 ? 'aiming' : ''}`}
      data-air-target={target}
      style={style}
      onClick={onClick}
      disabled={disabled}
      aria-label={`${AIR_TARGET_LABELS[target]}. ${detail}`}
      aria-pressed={active === undefined ? undefined : active}
    >
      <span className="uv-target-icon"><Icon aria-hidden="true" /></span>
      {deck && <small>{deckLabel(deck)}</small>}
      <strong>{label}</strong>
      <span>{detail}</span>
    </button>
  )
}

export function DjRoomScreen({
  vision,
  mixer,
}: {
  vision: ReturnType<typeof useVisionRuntime>
  mixer: ReturnType<typeof useDjMixer>
}) {
  const deckAInputRef = useRef<HTMLInputElement | null>(null)
  const deckBInputRef = useRef<HTMLInputElement | null>(null)
  const cameraAdvancePendingRef = useRef(false)
  const airDwellRef = useRef(createAirDwellState())
  const [step, setStep] = useState<DjFlowStep>(() => {
    if (vision.status !== 'running') return 'camera'
    return mixer.decks.a.loaded || mixer.decks.b.loaded ? 'perform' : 'tracks'
  })
  const [cameraBypassed, setCameraBypassed] = useState(false)
  const [airDwell, setAirDwell] = useState(createAirDwellState)
  const {
    activeDeck,
    cueDeck: cueMixerDeck,
    decks,
    selectControl,
    selectedControl,
    togglePlayback,
  } = mixer

  const anyTrackLoaded = decks.a.loaded || decks.b.loaded
  const bothTracksLoaded = decks.a.loaded && decks.b.loaded
  const canOpenTracks = vision.status === 'running' || cameraBypassed || anyTrackLoaded
  const canPerform = anyTrackLoaded
  const canSync = Boolean(
    bothTracksLoaded && decks.a.bpm && decks.b.bpm,
  )
  const primaryHand = vision.analysis.hands[0]
  const primaryHandVisibleX = primaryHand ? visibleAirX(primaryHand.x) : 0
  const pointing = Boolean(
    step === 'perform' &&
    vision.status === 'running' &&
    primaryHand?.count === 1 &&
    primaryHand.raised.index,
  )

  useEffect(() => {
    if (vision.status !== 'running' || !cameraAdvancePendingRef.current) return
    cameraAdvancePendingRef.current = false
    setStep('tracks')
  }, [vision.status])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [step])

  useEffect(() => {
    if (!anyTrackLoaded || decks[activeDeck].loaded) return
    const loadedDeck: DeckId = decks.a.loaded ? 'a' : 'b'
    selectControl(visibleDeckControl(selectedControl), loadedDeck)
  }, [
    activeDeck,
    anyTrackLoaded,
    decks,
    selectControl,
    selectedControl,
  ])

  const chooseDeck = useCallback((id: DeckId) => {
    selectControl(visibleDeckControl(selectedControl), id)
  }, [selectControl, selectedControl])

  const cueDeck = useCallback((id: DeckId) => {
    if (!decks[id].loaded) return
    if (selectedControl !== 'filter') chooseDeck(id)
    cueMixerDeck(id)
  }, [chooseDeck, cueMixerDeck, decks, selectedControl])

  const playDeck = useCallback((id: DeckId) => {
    if (!decks[id].loaded) return
    if (selectedControl !== 'filter') chooseDeck(id)
    void togglePlayback(id)
  }, [chooseDeck, decks, selectedControl, togglePlayback])

  const activateAirTarget = useCallback((target: AirTargetId) => {
    if (target === 'cue-a') cueDeck('a')
    else if (target === 'play-a') playDeck('a')
    else if (target === 'cue-b') cueDeck('b')
    else if (target === 'play-b') playDeck('b')
    else if (target === 'volume' && anyTrackLoaded) {
      selectControl('volume', activeDeck)
    } else if (target === 'filter' && anyTrackLoaded) {
      selectControl('filter', activeDeck)
    }
  }, [activeDeck, anyTrackLoaded, cueDeck, playDeck, selectControl])

  useEffect(() => {
    const target = pointing && primaryHand ? airTargetAt(primaryHandVisibleX, primaryHand.y) : null
    const transition = transitionAirDwell(airDwellRef.current, {
      enabled: pointing,
      target,
      now: performance.now(),
    })
    airDwellRef.current = transition.state
    setAirDwell((current) => (
      current.target === transition.state.target &&
      current.startedAt === transition.state.startedAt &&
      current.progress === transition.state.progress &&
      current.fired === transition.state.fired
        ? current
        : transition.state
    ))
    if (transition.activate) activateAirTarget(transition.activate)
  }, [activateAirTarget, pointing, primaryHand, primaryHandVisibleX])

  const loadFile = async (id: DeckId, file?: File) => {
    if (!file) return
    await mixer.loadFile(id, file)
  }

  const loadDemo = async (bypassCamera = false) => {
    if (bypassCamera) setCameraBypassed(true)
    const loaded = await mixer.loadDemoMix()
    if (loaded) setStep('tracks')
  }

  const startCamera = () => {
    if (vision.status === 'loading') {
      cameraAdvancePendingRef.current = false
      vision.stop()
      return
    }
    if (vision.status === 'running') {
      setStep('tracks')
      return
    }
    cameraAdvancePendingRef.current = true
    void vision.start()
  }

  const enterPerformance = () => {
    if (!anyTrackLoaded) return
    const loadedDeck: DeckId = mixer.decks.a.loaded ? 'a' : 'b'
    mixer.selectControl(visibleDeckControl(mixer.selectedControl), loadedDeck)
    setStep('perform')
  }

  const cameraButtonLabel = vision.status === 'loading'
    ? 'Cancel camera'
    : vision.status === 'running'
      ? 'Continue to tracks'
      : vision.status === 'error'
        ? 'Retry camera'
        : 'Allow camera'

  const cameraBackdrop = vision.status === 'running'
    ? undefined
    : <img className="uv-camera-preview-art" src={airMixMotion} alt="" />

  return (
    <div className={`uv-dj-flow flow-${step}`}>
      <input
        ref={deckAInputRef}
        hidden
        type="file"
        accept={ACCEPTED_AUDIO}
        onChange={(event) => {
          void loadFile('a', event.target.files?.[0])
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={deckBInputRef}
        hidden
        type="file"
        accept={ACCEPTED_AUDIO}
        onChange={(event) => {
          void loadFile('b', event.target.files?.[0])
          event.currentTarget.value = ''
        }}
      />

      <FlowProgress
        step={step}
        canOpenTracks={canOpenTracks}
        canPerform={canPerform}
        onStepChange={(nextStep) => {
          cameraAdvancePendingRef.current = false
          if (nextStep === 'perform') enterPerformance()
          else setStep(nextStep)
        }}
      />

      <section className="uv-flow-camera-section" aria-labelledby="uv-flow-title">
        <header className="uv-flow-heading">
          <span>{step === 'camera' ? 'Camera setup' : step === 'tracks' ? 'Your music' : 'Open hand · live'}</span>
          <h1 id="uv-flow-title">
            {step === 'camera'
              ? 'Start with your camera'
              : step === 'tracks'
                ? 'Load your tracks'
                : 'Perform with your hands'}
          </h1>
          <p>
            {step === 'camera'
              ? 'Sit back. Raise one open hand and keep it inside the frame.'
              : step === 'tracks'
                ? 'Add one track or two. Deck B is optional.'
                : 'Point and hold to choose. Open your palm to shape the selected control.'}
          </p>
        </header>

        <div className="uv-camera-shell" aria-hidden={step === 'tracks' ? 'true' : undefined}>
          <CameraStage
            status={vision.status}
            message={vision.message}
            setVideoElement={vision.setVideoElement}
            setCanvasElement={vision.setCanvasElement}
            backdrop={cameraBackdrop}
            overlay={step === 'perform' && vision.status === 'running' ? (
              <div className="uv-live-readout">
                <span><Hand aria-hidden="true" /> {pointing ? 'Aim and hold' : mixer.gestureStatus}</span>
                <strong>{deckLabel(mixer.activeDeck)} · {visibleDeckControl(mixer.selectedControl)} · {selectedControlValue(mixer)}</strong>
              </div>
            ) : undefined}
          />

          {step === 'perform' && (
            <>
              <div className="uv-target-rail rail-a">
                <PerformanceTarget
                  target="cue-a"
                  label="CUE"
                  detail="Restart"
                  deck="a"
                  icon="cue"
                  airDwell={airDwell}
                  disabled={!mixer.decks.a.loaded}
                  onClick={() => cueDeck('a')}
                />
                <PerformanceTarget
                  target="play-a"
                  label={mixer.decks.a.playing ? 'PAUSE' : 'PLAY'}
                  detail={mixer.decks.a.playing ? 'Hold' : 'Start'}
                  deck="a"
                  icon={mixer.decks.a.playing ? 'pause' : 'play'}
                  airDwell={airDwell}
                  disabled={!mixer.decks.a.loaded}
                  onClick={() => playDeck('a')}
                />
              </div>
              <div className="uv-target-rail rail-b">
                <PerformanceTarget
                  target="cue-b"
                  label="CUE"
                  detail="Restart"
                  deck="b"
                  icon="cue"
                  airDwell={airDwell}
                  disabled={!mixer.decks.b.loaded}
                  onClick={() => cueDeck('b')}
                />
                <PerformanceTarget
                  target="play-b"
                  label={mixer.decks.b.playing ? 'PAUSE' : 'PLAY'}
                  detail={mixer.decks.b.playing ? 'Hold' : 'Start'}
                  deck="b"
                  icon={mixer.decks.b.playing ? 'pause' : 'play'}
                  airDwell={airDwell}
                  disabled={!mixer.decks.b.loaded}
                  onClick={() => playDeck('b')}
                />
              </div>
              <div className="uv-control-targets">
                <span>Control {deckLabel(mixer.activeDeck)}</span>
                <PerformanceTarget
                  target="volume"
                  label="VOLUME"
                  detail={`${mixer.decks[mixer.activeDeck].volume}%`}
                  icon="volume"
                  airDwell={airDwell}
                  active={mixer.selectedControl === 'volume'}
                  onClick={() => mixer.selectControl('volume', mixer.activeDeck)}
                />
                <PerformanceTarget
                  target="filter"
                  label="FILTER"
                  detail={mixer.decks[mixer.activeDeck].filter === 50 ? 'Neutral' : `${mixer.decks[mixer.activeDeck].filter}%`}
                  icon="filter"
                  airDwell={airDwell}
                  active={mixer.selectedControl === 'filter'}
                  onClick={() => mixer.selectControl('filter', mixer.activeDeck)}
                />
              </div>
              {primaryHand && vision.status === 'running' && (
                <span
                  className={`uv-air-cursor ${pointing ? 'pointing' : ''}`}
                  style={{ left: `${primaryHandVisibleX * 100}%`, top: `${primaryHand.y * 100}%` }}
                  aria-hidden="true"
                />
              )}
            </>
          )}
        </div>

        {step === 'camera' && (
          <div className="uv-camera-actions">
            <button type="button" className="button primary" onClick={startCamera}>
              <Camera aria-hidden="true" />
              {cameraButtonLabel}
            </button>
            <button
              type="button"
              className="button text"
              onClick={() => void loadDemo(true)}
              disabled={mixer.demoLoading}
            >
              <Sparkles aria-hidden="true" />
              {mixer.demoLoading ? 'Building demo…' : 'Use demo instead'}
            </button>
            <span><Lock aria-hidden="true" /> Processed locally · No video leaves your browser.</span>
          </div>
        )}
      </section>

      {step === 'tracks' && (
        <section className="uv-track-loader" aria-label="Load tracks">
          <div className="uv-camera-ready">
            <span className={vision.status === 'running' ? 'ready' : ''} />
            {vision.status === 'running' ? 'Camera ready' : 'Manual demo mode'}
          </div>
          <div className="uv-track-grid">
            <TrackSlot
              id="a"
              mixer={mixer}
              onChoose={() => deckAInputRef.current?.click()}
            />
            <TrackSlot
              id="b"
              mixer={mixer}
              onChoose={() => deckBInputRef.current?.click()}
            />
          </div>
          <div className="uv-track-actions">
            <button type="button" className="button primary" onClick={enterPerformance} disabled={!anyTrackLoaded}>
              <Play aria-hidden="true" /> Continue to Perform
            </button>
            <button
              type="button"
              className="button text"
              onClick={() => void loadDemo()}
              disabled={mixer.demoLoading}
            >
              <Sparkles aria-hidden="true" />
              {mixer.demoLoading ? 'Building demo tracks…' : 'Try demo tracks'}
            </button>
            {!anyTrackLoaded && <small>Add Deck A to continue. Deck B is optional.</small>}
          </div>
        </section>
      )}

      {step === 'perform' && (
        <section className="uv-performance-workspace" aria-labelledby="uv-performance-title">
          <div className="uv-performance-toolbar">
            <button
              type="button"
              className={`uv-bpm-sync ${mixer.bpmSyncActive ? 'active' : ''}`}
              onClick={mixer.toggleBpmSync}
              disabled={!canSync}
              aria-pressed={mixer.bpmSyncActive}
              aria-label={canSync ? 'Toggle BPM Sync' : 'Load Deck B and wait for both BPMs to use BPM Sync'}
              title={canSync ? mixer.bpmSyncMessage : 'Load Deck B and wait for both BPMs to use BPM Sync'}
            >
              {mixer.bpmSyncActive ? <Lock aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              <span>BPM SYNC</span>
              <b>{mixer.bpmSyncActive ? 'LOCKED' : canSync ? 'READY' : 'NEEDS 2 DECKS'}</b>
            </button>
            <div className="uv-performance-status">
              <strong id="uv-performance-title">{deckLabel(mixer.activeDeck)} control</strong>
              <span>{selectedControlValue(mixer)}</span>
              {vision.status === 'error' && (
                <span className="uv-performance-camera-error" role="alert">
                  {vision.message}
                </span>
              )}
            </div>
            <div className="uv-performance-actions">
              {vision.status === 'running' ? (
                <button type="button" onClick={vision.stop}><Camera aria-hidden="true" /> Stop camera</button>
              ) : (
                <button type="button" onClick={() => void vision.start()}>
                  <Camera aria-hidden="true" /> {vision.status === 'error' ? 'Retry camera' : 'Start camera'}
                </button>
              )}
              <button type="button" onClick={() => setStep('tracks')}><Upload aria-hidden="true" /> Change tracks</button>
            </div>
          </div>

          <div className="uv-waveform-stack">
            <PerformanceWaveform
              deckId="a"
              deck={mixer.decks.a}
              onSeek={(time) => {
                chooseDeck('a')
                mixer.seek('a', time)
              }}
            />
            <PerformanceWaveform
              deckId="b"
              deck={mixer.decks.b}
              onSeek={(time) => {
                chooseDeck('b')
                mixer.seek('b', time)
              }}
            />
          </div>
          <p className="uv-beat-note">
            <ShieldCheck aria-hidden="true" /> Beat and phrase markers are estimates. Audio and camera stay in this browser tab.
          </p>
        </section>
      )}
    </div>
  )
}
