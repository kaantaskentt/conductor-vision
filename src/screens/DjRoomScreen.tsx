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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import airMixMotion from '../assets/air-mix-motion.jpg'
import { CameraStage } from '../components/AppShell'
import { PerformanceWaveform } from '../components/PerformanceWaveform'
import type { DeckId, useDjMixer } from '../hooks/useDjMixer'
import type { useVisionRuntime } from '../hooks/useVisionRuntime'
import {
  airTargetAtBounds,
  createAirDwellState,
  transitionAirDwell,
  type AirHandSlot,
  type AirDwellState,
  type AirTargetBounds,
  type AirTargetId,
} from '../lib/airTarget'
import {
  mapCameraPointToStage,
  type CameraCoverGeometry,
} from '../lib/cameraGeometry'
import {
  assignHandsToStableSlots,
  createHandAssignmentState,
  type HandAssignmentState,
} from '../lib/handAssignment'
import type { HandSummary } from '../lib/vision'

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
  'volume-a': 'Deck A volume',
  'filter-a': 'Deck A filter',
  'volume-b': 'Deck B volume',
  'filter-b': 'Deck B filter',
}

const AIR_HAND_SLOTS: AirHandSlot[] = ['left', 'right']
const DJ_CAMERA_OBJECT_POSITION = { x: 0.5, y: 0.42 } as const
const AIR_TARGET_IDS = Object.keys(AIR_TARGET_LABELS) as AirTargetId[]

function airTargetBoundsMatch(
  current: AirTargetBounds | null,
  next: AirTargetBounds,
) {
  if (!current) return false
  return AIR_TARGET_IDS.every((target) => {
    const currentRect = current[target]
    const nextRect = next[target]
    if (!currentRect || !nextRect) return currentRect === nextRect
    return currentRect.left === nextRect.left &&
      currentRect.top === nextRect.top &&
      currentRect.right === nextRect.right &&
      currentRect.bottom === nextRect.bottom
  })
}

function isPointingHand(hand: HandSummary | null) {
  return Boolean(
    hand && hand.count >= 1 && hand.count <= 2 && hand.raised.index,
  )
}

function deckLabel(id: DeckId) {
  return id === 'a' ? 'Deck A' : 'Deck B'
}

function FlowProgress({
  step,
  canOpenTracks,
  canPerform,
  locked,
  onStepChange,
}: {
  step: DjFlowStep
  canOpenTracks: boolean
  canPerform: boolean
  locked: boolean
  onStepChange: (step: DjFlowStep) => void
}) {
  const activeIndex = FLOW_STEPS.findIndex(({ id }) => id === step)

  return (
    <nav className="uv-flow-progress" aria-label="DJ Room setup">
      {FLOW_STEPS.map((item, index) => {
        const enabled = !locked && (
          item.id === 'camera' || (item.id === 'tracks' ? canOpenTracks : canPerform)
        )
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
  disabled,
}: {
  id: DeckId
  mixer: ReturnType<typeof useDjMixer>
  onChoose: () => void
  disabled: boolean
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
      <button type="button" className="button secondary" onClick={onChoose} disabled={disabled}>
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
  const cameraShellRef = useRef<HTMLDivElement | null>(null)
  const cameraAdvancePendingRef = useRef(false)
  const handAssignmentRef = useRef<HandAssignmentState>(createHandAssignmentState())
  const airDwellRef = useRef<Record<AirHandSlot, AirDwellState>>({
    left: createAirDwellState(),
    right: createAirDwellState(),
  })
  const [step, setStep] = useState<DjFlowStep>(() => {
    if (vision.status !== 'running') return 'camera'
    return mixer.performanceAudioReady && (mixer.decks.a.loaded || mixer.decks.b.loaded)
      ? 'perform'
      : 'tracks'
  })
  const [cameraBypassed, setCameraBypassed] = useState(false)
  const [performanceStarting, setPerformanceStarting] = useState(false)
  const [cameraGeometry, setCameraGeometry] = useState<CameraCoverGeometry | null>(null)
  const [airTargetBounds, setAirTargetBounds] = useState<AirTargetBounds | null>(null)
  const [stableHands, setStableHands] = useState<
    Record<AirHandSlot, HandSummary | null>
  >({ left: null, right: null })
  const [airDwells, setAirDwells] = useState<Record<AirHandSlot, AirDwellState>>({
    left: createAirDwellState(),
    right: createAirDwellState(),
  })
  const {
    cueDeck: cueMixerDeck,
    decks,
    selectPerformanceControl,
    setPerformanceGestureInputEnabled,
    togglePlayback,
  } = mixer

  const anyTrackLoaded = decks.a.loaded || decks.b.loaded
  const bothTracksLoaded = decks.a.loaded && decks.b.loaded
  const interactionLocked = performanceStarting || mixer.demoLoading
  const canOpenTracks = vision.status === 'running' || cameraBypassed || anyTrackLoaded
  const canPerform = anyTrackLoaded
  const canSync = Boolean(
    bothTracksLoaded && decks.a.bpm && decks.b.bpm,
  )
  const anyPointing = AIR_HAND_SLOTS.some((slot) => isPointingHand(stableHands[slot]))
  const airPointers = useMemo(() => ({
    left: stableHands.left && cameraGeometry
      ? mapCameraPointToStage(
          stableHands.left.pointerX ?? stableHands.left.x,
          stableHands.left.pointerY ?? stableHands.left.y,
          cameraGeometry,
        )
      : null,
    right: stableHands.right && cameraGeometry
      ? mapCameraPointToStage(
          stableHands.right.pointerX ?? stableHands.right.x,
          stableHands.right.pointerY ?? stableHands.right.y,
          cameraGeometry,
        )
      : null,
  }), [cameraGeometry, stableHands])

  const handleCameraGeometryChange = useCallback((next: CameraCoverGeometry) => {
    setCameraGeometry((current) => (
      current &&
      current.sourceWidth === next.sourceWidth &&
      current.sourceHeight === next.sourceHeight &&
      current.stageWidth === next.stageWidth &&
      current.stageHeight === next.stageHeight &&
      current.objectPositionX === next.objectPositionX &&
      current.objectPositionY === next.objectPositionY
        ? current
        : next
    ))
  }, [])

  useEffect(() => {
    if (vision.status !== 'running' || !cameraAdvancePendingRef.current) return
    cameraAdvancePendingRef.current = false
    setStep('tracks')
  }, [vision.status])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [step])

  useLayoutEffect(() => {
    setPerformanceGestureInputEnabled(step === 'perform')
    return () => {
      if (step === 'perform') setPerformanceGestureInputEnabled(false)
    }
  }, [setPerformanceGestureInputEnabled, step])

  useLayoutEffect(() => {
    const shell = cameraShellRef.current
    if (step !== 'perform' || !shell) {
      setAirTargetBounds(null)
      return
    }

    const targetElements = Array.from(
      shell.querySelectorAll<HTMLElement>('[data-air-target]'),
    )
    // Cache layout-normalized rectangles here so hand-frame updates only run
    // pure hit math and never call getBoundingClientRect themselves.
    const updateBounds = () => {
      const shellRect = shell.getBoundingClientRect()
      if (!shellRect.width || !shellRect.height) return

      const next: Partial<Record<AirTargetId, {
        left: number
        top: number
        right: number
        bottom: number
      }>> = {}
      for (const element of targetElements) {
        const target = element.dataset.airTarget as AirTargetId | undefined
        if (!target || !Object.prototype.hasOwnProperty.call(AIR_TARGET_LABELS, target)) {
          continue
        }
        const rect = element.getBoundingClientRect()
        next[target] = {
          left: (rect.left - shellRect.left) / shellRect.width,
          top: (rect.top - shellRect.top) / shellRect.height,
          right: (rect.right - shellRect.left) / shellRect.width,
          bottom: (rect.bottom - shellRect.top) / shellRect.height,
        }
      }
      setAirTargetBounds((current) => (
        airTargetBoundsMatch(current, next) ? current : next
      ))
    }

    updateBounds()
    window.addEventListener('resize', updateBounds)
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateBounds)
    resizeObserver?.observe(shell)
    targetElements.forEach((element) => resizeObserver?.observe(element))

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [step])

  const cueDeck = useCallback((id: DeckId) => {
    if (!decks[id].loaded) return
    cueMixerDeck(id)
  }, [cueMixerDeck, decks])

  const playDeck = useCallback((id: DeckId) => {
    if (!decks[id].loaded) return
    void togglePlayback(id)
  }, [decks, togglePlayback])

  const activateAirTarget = useCallback((target: AirTargetId) => {
    if (target === 'cue-a') cueDeck('a')
    else if (target === 'play-a') playDeck('a')
    else if (target === 'cue-b') cueDeck('b')
    else if (target === 'play-b') playDeck('b')
    else if (target === 'volume-a') selectPerformanceControl('a', 'volume')
    else if (target === 'filter-a') selectPerformanceControl('a', 'filter')
    else if (target === 'volume-b') selectPerformanceControl('b', 'volume')
    else if (target === 'filter-b') selectPerformanceControl('b', 'filter')
  }, [
    cueDeck,
    playDeck,
    selectPerformanceControl,
  ])

  useEffect(() => {
    if (step !== 'perform' || vision.status !== 'running') {
      handAssignmentRef.current = createHandAssignmentState()
      setStableHands((current) => (
        current.left === null && current.right === null
          ? current
          : { left: null, right: null }
      ))
      return
    }
    const assignment = assignHandsToStableSlots(
      handAssignmentRef.current,
      vision.analysis.hands,
      performance.now(),
    )
    handAssignmentRef.current = assignment.state
    setStableHands((current) => (
      current.left === assignment.left && current.right === assignment.right
        ? current
        : { left: assignment.left, right: assignment.right }
    ))
  }, [step, vision.analysis.hands, vision.status])

  useEffect(() => {
    const next = { ...airDwellRef.current }
    const activations: AirTargetId[] = []
    const now = performance.now()

    for (const slot of AIR_HAND_SLOTS) {
      const hand = stableHands[slot]
      const pointer = airPointers[slot]
      const pointing =
        step === 'perform' && vision.status === 'running' && isPointingHand(hand)
      const enabled = pointing && Boolean(pointer?.visible) && Boolean(airTargetBounds)
      const x = pointer?.x ?? 0
      const y = pointer?.y ?? 0
      const target = enabled && airTargetBounds
        ? airTargetAtBounds(x, y, airTargetBounds, slot)
        : null
      const transition = transitionAirDwell(airDwellRef.current[slot], {
        enabled,
        target,
        now,
        x,
        y,
      })
      next[slot] = transition.state
      if (transition.activate) activations.push(transition.activate)
    }

    airDwellRef.current = next
    setAirDwells((current) => (
      AIR_HAND_SLOTS.every((slot) => (
        current[slot].target === next[slot].target &&
        current[slot].startedAt === next[slot].startedAt &&
        current[slot].progress === next[slot].progress &&
        current[slot].fired === next[slot].fired
      ))
        ? current
        : next
    ))
    for (const target of activations) activateAirTarget(target)
  }, [activateAirTarget, airPointers, airTargetBounds, stableHands, step, vision.status])

  const loadFile = async (id: DeckId, file?: File) => {
    if (!file || interactionLocked) return
    await mixer.loadFile(id, file)
  }

  const loadDemo = async (bypassCamera = false) => {
    if (interactionLocked) return
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

  const enterPerformance = async () => {
    if (!anyTrackLoaded || interactionLocked) return
    setPerformanceStarting(true)
    const started = await mixer.startPerformance()
    setPerformanceStarting(false)
    if (started) setStep('perform')
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
        disabled={interactionLocked}
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
        disabled={interactionLocked}
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
        locked={interactionLocked}
        onStepChange={(nextStep) => {
          cameraAdvancePendingRef.current = false
          if (interactionLocked) return
          if (nextStep === 'perform') void enterPerformance()
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
                : 'Left hand owns Deck A. Right hand owns Deck B. Point to choose; open your palm to move.'}
          </p>
        </header>

        <div
          ref={cameraShellRef}
          className="uv-camera-shell"
          aria-hidden={step === 'tracks' ? 'true' : undefined}
        >
          <CameraStage
            status={vision.status}
            message={vision.message}
            setVideoElement={vision.setVideoElement}
            setCanvasElement={vision.setCanvasElement}
            backdrop={cameraBackdrop}
            objectPosition={DJ_CAMERA_OBJECT_POSITION}
            onGeometryChange={handleCameraGeometryChange}
            overlay={step === 'perform' && vision.status === 'running' ? (
              <div className="uv-live-readout">
                <span><Hand aria-hidden="true" /> {anyPointing ? 'Aim and hold' : mixer.gestureStatus}</span>
                <strong>Left · Deck A · Right · Deck B</strong>
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
                  airDwell={airDwells.left}
                  disabled={!mixer.decks.a.loaded}
                  onClick={() => cueDeck('a')}
                />
                <PerformanceTarget
                  target="play-a"
                  label={mixer.decks.a.playing ? 'PAUSE' : 'PLAY'}
                  detail={mixer.decks.a.playing ? 'Hold' : 'Start'}
                  deck="a"
                  icon={mixer.decks.a.playing ? 'pause' : 'play'}
                  airDwell={airDwells.left}
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
                  airDwell={airDwells.right}
                  disabled={!mixer.decks.b.loaded}
                  onClick={() => cueDeck('b')}
                />
                <PerformanceTarget
                  target="play-b"
                  label={mixer.decks.b.playing ? 'PAUSE' : 'PLAY'}
                  detail={mixer.decks.b.playing ? 'Hold' : 'Start'}
                  deck="b"
                  icon={mixer.decks.b.playing ? 'pause' : 'play'}
                  airDwell={airDwells.right}
                  disabled={!mixer.decks.b.loaded}
                  onClick={() => playDeck('b')}
                />
              </div>
              <div className="uv-control-targets">
                <div className="uv-deck-control-pair deck-a" aria-label="Deck A hand control">
                  <span>LEFT HAND · DECK A</span>
                  <PerformanceTarget
                    target="volume-a"
                    label="VOLUME"
                    detail={`${mixer.decks.a.volume}%`}
                    icon="volume"
                    airDwell={airDwells.left}
                    disabled={!mixer.decks.a.loaded}
                    active={mixer.performanceControls.a === 'volume'}
                    onClick={() => mixer.selectPerformanceControl('a', 'volume')}
                  />
                  <PerformanceTarget
                    target="filter-a"
                    label="FILTER"
                    detail={mixer.decks.a.filter === 50 ? 'Neutral' : `${mixer.decks.a.filter}%`}
                    icon="filter"
                    airDwell={airDwells.left}
                    disabled={!mixer.decks.a.loaded}
                    active={mixer.performanceControls.a === 'filter'}
                    onClick={() => mixer.selectPerformanceControl('a', 'filter')}
                  />
                </div>
                <div className="uv-deck-control-pair deck-b" aria-label="Deck B hand control">
                  <span>RIGHT HAND · DECK B</span>
                  <PerformanceTarget
                    target="volume-b"
                    label="VOLUME"
                    detail={`${mixer.decks.b.volume}%`}
                    icon="volume"
                    airDwell={airDwells.right}
                    disabled={!mixer.decks.b.loaded}
                    active={mixer.performanceControls.b === 'volume'}
                    onClick={() => mixer.selectPerformanceControl('b', 'volume')}
                  />
                  <PerformanceTarget
                    target="filter-b"
                    label="FILTER"
                    detail={mixer.decks.b.filter === 50 ? 'Neutral' : `${mixer.decks.b.filter}%`}
                    icon="filter"
                    airDwell={airDwells.right}
                    disabled={!mixer.decks.b.loaded}
                    active={mixer.performanceControls.b === 'filter'}
                    onClick={() => mixer.selectPerformanceControl('b', 'filter')}
                  />
                </div>
              </div>
              {AIR_HAND_SLOTS.map((slot) => {
                const hand = stableHands[slot]
                const pointer = airPointers[slot]
                if (!hand || !pointer?.visible || vision.status !== 'running') return null
                return (
                  <span
                    key={slot}
                    className={`uv-air-cursor cursor-${slot} ${isPointingHand(hand) ? 'pointing' : ''}`}
                    style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }}
                    aria-hidden="true"
                  />
                )
              })}
            </>
          )}
        </div>

        {step === 'camera' && (
          <div className="uv-camera-actions">
            <button
              type="button"
              className="button primary"
              onClick={startCamera}
              disabled={interactionLocked}
            >
              <Camera aria-hidden="true" />
              {cameraButtonLabel}
            </button>
            <button
              type="button"
              className="button text"
              onClick={() => void loadDemo(true)}
              disabled={interactionLocked}
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
              disabled={interactionLocked}
              onChoose={() => deckAInputRef.current?.click()}
            />
            <TrackSlot
              id="b"
              mixer={mixer}
              disabled={interactionLocked}
              onChoose={() => deckBInputRef.current?.click()}
            />
          </div>
          <div className="uv-track-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => void enterPerformance()}
              disabled={!anyTrackLoaded || interactionLocked}
            >
              <Play aria-hidden="true" />
              {performanceStarting ? 'Enabling sound…' : 'Start performance'}
            </button>
            <button
              type="button"
              className="button text"
              onClick={() => void loadDemo()}
              disabled={interactionLocked}
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
              <strong id="uv-performance-title">Dual hand control</strong>
              <span>
                Left/A · {mixer.performanceControls.a} · Right/B · {mixer.performanceControls.b}
              </span>
              {vision.status === 'error' && (
                <span className="uv-performance-camera-error" role="alert">
                  {vision.message}
                </span>
              )}
              {(mixer.decks.a.error || mixer.decks.b.error) && (
                <span className="uv-performance-audio-error" role="alert">
                  {mixer.decks.a.error ?? mixer.decks.b.error}
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
              onSeek={(time) => mixer.seek('a', time)}
            />
            <PerformanceWaveform
              deckId="b"
              deck={mixer.decks.b}
              onSeek={(time) => mixer.seek('b', time)}
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
