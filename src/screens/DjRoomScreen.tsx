import {
  Check,
  Camera,
  ChevronDown,
  Disc3,
  Hand,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Volume2,
  Waves,
} from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { CameraStage, PageIntro } from '../components/AppShell'
import airMixMotion from '../assets/air-mix-motion.jpg'
import type { DeckId, DjControl, useDjMixer } from '../hooks/useDjMixer'
import type { useVisionRuntime } from '../hooks/useVisionRuntime'
import {
  deriveFirstMixExperience,
  deriveFirstMixReadiness,
  type FirstMixExperience,
  type FirstMixExperienceAction,
  type FirstMixReadinessStep,
} from '../lib/firstMixReadiness'
import { airMixWaveformOpacities } from '../lib/airMixVisuals'
import { rotaryValueFromVerticalDrag } from '../lib/gestureController'

const ACCEPTED_AUDIO = 'audio/mpeg,audio/wav,audio/flac,audio/ogg,.mp3,.wav,.flac,.ogg'
const GESTURE_MODES: Array<{
  control: DjControl
  label: string
  detail: string
  icon: typeof Waves
}> = [
  {
    control: 'crossfader',
    label: 'Crossfader',
    detail: 'Open hand · move left or right',
    icon: Waves,
  },
  {
    control: 'volume',
    label: 'Volume',
    detail: 'Open palm grabs · move vertically · fist locks',
    icon: Volume2,
  },
  {
    control: 'filter',
    label: 'Filter',
    detail: 'Open palm grabs · rotate · fist resets',
    icon: SlidersHorizontal,
  },
]

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

function deckLabel(id: DeckId) {
  return id === 'a' ? 'Deck A' : 'Deck B'
}

function crossfaderReadout(value: number) {
  if (value === 0) return '50 / 50'
  return value < 0 ? `A +${Math.abs(Math.round(value))}` : `B +${Math.round(value)}`
}

function isRangeAdjustmentKey(key: string) {
  return [
    'ArrowUp',
    'ArrowRight',
    'ArrowDown',
    'ArrowLeft',
    'Home',
    'End',
    'PageUp',
    'PageDown',
  ].includes(key)
}

function selectedControlReadout(mixer: ReturnType<typeof useDjMixer>) {
  if (mixer.selectedControl === 'crossfader') return crossfaderReadout(mixer.crossfader)
  const deck = mixer.decks[mixer.activeDeck]
  if (mixer.selectedControl === 'volume') return `${deck.volume}%`
  if (deck.filter === 50) return '50% · Neutral'
  return deck.filter < 50 ? `${deck.filter}% · LP` : `${deck.filter}% · HP`
}

function airMixTempoReadout(mixer: ReturnType<typeof useDjMixer>) {
  const effective = (id: DeckId) => {
    const deck = mixer.decks[id]
    return deck.bpm ? deck.bpm * (1 + deck.tempo / 100) : null
  }
  const deckA = effective('a')
  const deckB = effective('b')
  if (!deckA || !deckB) return 'BPM pending'
  if (mixer.bpmSyncActive && Math.abs(deckA - deckB) < 0.1) {
    return `${deckA.toFixed(0)} BPM · TEMPO MATCH`
  }
  return `${deckA.toFixed(0)} / ${deckB.toFixed(0)} BPM`
}

function formatAirMixTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = Math.floor(safeSeconds % 60)
  return `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
}

function AirMixHeader({ mixer }: { mixer: ReturnType<typeof useDjMixer> }) {
  return (
    <section className="air-mix-header" aria-labelledby="air-mix-title">
      <div className="air-mix-brandline">
        <span>Ultra Vision</span>
        <span>DJ Room · local performance</span>
      </div>
      <h1 id="air-mix-title">
        <span className="air-mix-deck-a" title={mixer.decks.a.name}>
          {mixer.decks.a.name}
        </span>
        <span className="air-mix-cross" aria-hidden="true">×</span>
        <span className="sr-only">mixed with</span>
        <span className="air-mix-deck-b" title={mixer.decks.b.name}>
          {mixer.decks.b.name}
        </span>
      </h1>
      <div className="air-mix-meta">
        <span>
          Playheads <b>A {formatAirMixTime(mixer.decks.a.currentTime)} · B {formatAirMixTime(mixer.decks.b.currentTime)}</b>
        </span>
        <span>{airMixTempoReadout(mixer)}</span>
      </div>
    </section>
  )
}

function AirMixBackdrop({ mixer }: { mixer: ReturnType<typeof useDjMixer> }) {
  const opacity = airMixWaveformOpacities(mixer.crossfader)

  return (
    <div className="air-mix-backdrop">
      <img className="air-mix-artwork" src={airMixMotion} alt="" draggable={false} />
      <span className="air-mix-backdrop-label">Gesture visualizer</span>
      <div className="air-mix-stage-waveform">
        <div className="air-mix-stage-waveform-a" style={{ opacity: opacity.a }}>
          {mixer.decks.a.waveform.map((amplitude, index) => (
            <i key={index} style={{ height: `${Math.max(8, amplitude)}%` }} />
          ))}
        </div>
        <span />
        <div className="air-mix-stage-waveform-b" style={{ opacity: opacity.b }}>
          {mixer.decks.b.waveform.map((amplitude, index) => (
            <i key={index} style={{ height: `${Math.max(8, amplitude)}%` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

function RotaryControl({
  label,
  value,
  formattedValue,
  icon: Icon,
  ariaLabel,
  onChange,
  onManualStart,
  onReset,
  markers,
}: {
  label: string
  value: number
  formattedValue: string
  icon: typeof Volume2
  ariaLabel: string
  onChange: (value: number) => void
  onManualStart: () => void
  onReset: () => void
  markers: [string, string, string]
}) {
  const outputId = useId()
  const dragRef = useRef<{
    pointerId: number
    startY: number
    startValue: number
  } | null>(null)
  const angle = -135 + (value / 100) * 270
  const style = { '--knob-angle': `${angle}deg` } as CSSProperties
  const finishPointerDrag = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }

  return (
    <fieldset className="rotary-control">
      <legend className="sr-only">{ariaLabel}</legend>
      <div className="rotary-heading">
        <span>
          <Icon aria-hidden="true" />
          {label}
        </span>
        <button type="button" onClick={onReset} aria-label={`Reset ${ariaLabel}`} title="Reset">
          <RotateCcw aria-hidden="true" />
        </button>
      </div>
      <div className="rotary-dial" style={style}>
        <div className="rotary-scale" aria-hidden="true" />
        <div className="rotary-knob" aria-hidden="true">
          <i />
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(event) => {
            onManualStart()
            onChange(Number(event.target.value))
          }}
          onKeyDown={(event) => {
            const amount = event.shiftKey ? 1 : 5
            if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
              event.preventDefault()
              onManualStart()
              onChange(Math.min(100, value + amount))
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
              event.preventDefault()
              onManualStart()
              onChange(Math.max(0, value - amount))
            } else if (event.key === 'Home') {
              event.preventDefault()
              onManualStart()
              onChange(0)
            } else if (event.key === 'End') {
              event.preventDefault()
              onManualStart()
              onChange(100)
            }
          }}
          onPointerDown={(event) => {
            event.preventDefault()
            onManualStart()
            event.currentTarget.setPointerCapture(event.pointerId)
            dragRef.current = {
              pointerId: event.pointerId,
              startY: event.clientY,
              startValue: value,
            }
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (!drag || drag.pointerId !== event.pointerId) return
            event.preventDefault()
            onManualStart()
            onChange(
              rotaryValueFromVerticalDrag(
                drag.startValue,
                drag.startY,
                event.clientY,
                event.shiftKey,
              ),
            )
          }}
          onPointerUp={finishPointerDrag}
          onPointerCancel={finishPointerDrag}
          onLostPointerCapture={() => {
            dragRef.current = null
          }}
          onDoubleClick={onReset}
          aria-label={ariaLabel}
          aria-valuetext={formattedValue}
          aria-describedby={outputId}
          title="Drag up or down · Shift for fine control · double-click to reset"
        />
      </div>
      <output id={outputId}>{formattedValue}</output>
      <div className="rotary-markers" aria-hidden="true">
        {markers.map((marker) => <span key={marker}>{marker}</span>)}
      </div>
    </fieldset>
  )
}

function DeckPanel({
  id,
  mixer,
  onUpload,
}: {
  id: DeckId
  mixer: ReturnType<typeof useDjMixer>
  onUpload: () => void
}) {
  const deck = mixer.decks[id]
  const effectiveBpm = deck.bpm ? deck.bpm * (1 + deck.tempo / 100) : null
  const playedRatio = deck.duration > 0 ? deck.currentTime / deck.duration : 0

  return (
    <article className={`deck-panel deck-${id}`}>
      <div className="deck-heading">
        <div>
          <span className="deck-id">{deckLabel(id)}</span>
          <strong>{deck.name}</strong>
          <small>{deck.loaded ? 'Local audio · ready to mix' : 'Load a track to begin'}</small>
        </div>
        <div className="bpm-readout">
          <strong>{effectiveBpm ? effectiveBpm.toFixed(1) : '—'}</strong>
          <span>BPM</span>
        </div>
      </div>

      <div className="deck-transport">
        <div className={`deck-platter ${deck.playing ? 'playing' : ''}`}>
          <Disc3 aria-hidden="true" />
          <span>{id.toUpperCase()}</span>
        </div>
        <button
          type="button"
          className="deck-play"
          onClick={() => void mixer.togglePlayback(id)}
          disabled={!deck.loaded}
          aria-label={deck.playing ? `Pause ${deckLabel(id)}` : `Play ${deckLabel(id)}`}
        >
          {deck.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <div className="deck-timeline">
          <div>
            <span>{formatTime(deck.currentTime)}</span>
            <span>{formatTime(deck.duration)}</span>
          </div>
          <div className={`waveform-scrub ${deck.loaded ? 'loaded' : ''}`}>
            <div className="deck-waveform" aria-hidden="true">
              {deck.waveform.map((amplitude, index) => (
                <i
                  key={index}
                  className={(index + 1) / deck.waveform.length <= playedRatio ? 'played' : ''}
                  style={{ height: `${Math.max(8, amplitude)}%` }}
                />
              ))}
            </div>
            <input
              type="range"
              min="0"
              max={Math.max(deck.duration, 1)}
              step="0.05"
              value={Math.min(deck.currentTime, Math.max(deck.duration, 1))}
              onChange={(event) => mixer.seek(id, Number(event.target.value))}
              disabled={!deck.loaded}
              aria-label={`${deckLabel(id)} track position`}
            />
          </div>
        </div>
      </div>

      <div className="deck-controls">
        <RotaryControl
          label="Level"
          value={deck.volume}
          formattedValue={`${deck.volume}%`}
          icon={Volume2}
          ariaLabel={`${deckLabel(id)} channel level`}
          onChange={(value) => mixer.setDeckVolume(id, value)}
          onManualStart={() => mixer.claimManualControl('volume', id)}
          onReset={() => mixer.resetControl('volume', id)}
          markers={['0', '50', '100']}
        />
        <RotaryControl
          label="Filter"
          value={deck.filter}
          formattedValue={
            deck.filter === 50
              ? '50% · Neutral'
              : deck.filter < 50
                ? `${deck.filter}% · LP`
                : `${deck.filter}% · HP`
          }
          icon={SlidersHorizontal}
          ariaLabel={`${deckLabel(id)} bipolar filter`}
          onChange={(value) => mixer.setDeckFilter(id, value)}
          onManualStart={() => mixer.claimManualControl('filter', id)}
          onReset={() => mixer.resetControl('filter', id)}
          markers={['LP', '50', 'HP']}
        />
      </div>

      <div className="deck-actions">
        <button type="button" className="button secondary" onClick={onUpload}>
          <Upload aria-hidden="true" />
          {deck.loaded ? 'Replace' : 'Load track'}
        </button>
      </div>

      <details className="deck-tools">
        <summary>
          <span>
            <strong>Track tools</strong>
            <small>Quarter jumps and manual BPM</small>
          </span>
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="deck-tools-body">
          <div className="phrase-pads" aria-label={`${deckLabel(id)} track quarters`}>
            <span>Track quarter</span>
            <div>
              {[1, 2, 3, 4].map((index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => mixer.jumpToPhrase(id, index)}
                  disabled={!deck.loaded}
                  aria-label={`${deckLabel(id)} track quarter ${index}`}
                >
                  {index}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="button text tap-bpm-button"
            onClick={() => mixer.tapTempo(id)}
            disabled={!deck.loaded}
          >
            Tap BPM
          </button>
        </div>
      </details>

      <div className="deck-footer">
        <meter
          className="sr-only"
          aria-label={`${deckLabel(id)} audio level`}
          min={0}
          max={100}
          value={deck.audioLevel}
        >
          {deck.audioLevel}%
        </meter>
        <div
          className="mini-level"
          aria-hidden="true"
        >
          <i style={{ width: `${deck.audioLevel}%` }} />
        </div>
        <span>{deck.bpmStatus}</span>
      </div>
      {deck.error && (
        <div className="inline-error" role="alert">
          {deck.error}
        </div>
      )}
    </article>
  )
}

function MixerConsole({ mixer }: { mixer: ReturnType<typeof useDjMixer> }) {
  const bothLoaded = mixer.decks.a.loaded && mixer.decks.b.loaded
  const anyPlaying = mixer.decks.a.playing || mixer.decks.b.playing

  return (
    <aside className="mixer-console">
      <div className="mixer-heading">
        <span>Master mixer</span>
        <strong>{bothLoaded ? 'Two decks ready' : 'Load both decks'}</strong>
      </div>

      <div className="master-levels">
        {(['a', 'b'] as DeckId[]).map((id) => (
          <div key={id}>
            <span>{id.toUpperCase()}</span>
            <meter
              className="sr-only"
              aria-label={`${deckLabel(id)} master audio level`}
              min={0}
              max={100}
              value={mixer.decks[id].audioLevel}
            >
              {mixer.decks[id].audioLevel}%
            </meter>
            <div aria-hidden="true">
              {Array.from({ length: 12 }, (_, index) => (
                <i
                  key={index}
                  className={
                    index < Math.ceil((mixer.decks[id].audioLevel / 100) * 12) ? 'lit' : ''
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        className={`bpm-sync-status ${mixer.bpmSyncActive ? 'active' : ''}`}
        aria-label="BPM Sync status"
      >
        <RefreshCw aria-hidden="true" />
        <span>
          <strong>{mixer.bpmSyncActive ? 'BPM matched' : 'Sync status'}</strong>
          <small>
            {mixer.bpmSyncActive
              ? `${mixer.bpmSyncMessage} · use the middle button to restore`
              : mixer.bpmSyncMessage}
          </small>
        </span>
        <b>{mixer.bpmSyncActive ? 'ON' : 'OFF'}</b>
      </div>

      <div className="crossfader-control">
        <div>
          <span>A</span>
          <strong>Equal-power crossfader</strong>
          <span>B</span>
        </div>
        <input
          type="range"
          min="-100"
          max="100"
          value={mixer.crossfader}
          onPointerDown={() => mixer.claimManualControl('crossfader')}
          onKeyDown={(event) => {
            if (isRangeAdjustmentKey(event.key)) mixer.claimManualControl('crossfader')
          }}
          onChange={(event) => {
            mixer.claimManualControl('crossfader')
            mixer.setCrossfader(Number(event.target.value))
          }}
          onDoubleClick={() => mixer.resetControl('crossfader')}
          aria-label="Master crossfader"
          title="Double-click to center"
        />
        <output>
          {mixer.crossfader === 0
            ? 'Centered'
            : mixer.crossfader < 0
              ? `Deck A +${Math.abs(mixer.crossfader)}`
              : `Deck B +${mixer.crossfader}`}
        </output>
        <button type="button" onClick={() => mixer.resetControl('crossfader')}>
          Center
        </button>
      </div>

      <div className="master-actions">
        <button
          type="button"
          className="button primary start-mix"
          onClick={() => void mixer.toggleBoth()}
          disabled={!bothLoaded}
        >
          {anyPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {anyPlaying ? 'Pause both' : 'Start both'}
        </button>
        <button type="button" className="button secondary" onClick={mixer.resetMix}>
          <RotateCcw aria-hidden="true" />
          Reset mix
        </button>
      </div>
    </aside>
  )
}

function FirstMixCockpit({
  mixer,
  vision,
  steps,
  experience,
  announcement,
  onChooseTracks,
}: {
  mixer: ReturnType<typeof useDjMixer>
  vision: ReturnType<typeof useVisionRuntime>
  steps: FirstMixReadinessStep[]
  experience: FirstMixExperience
  announcement: string
  onChooseTracks: () => void
}) {
  const [liveAnnouncement, setLiveAnnouncement] = useState(announcement)

  useEffect(() => {
    if (vision.status === 'loading' || vision.status === 'error') return
    const gestureDriven =
      experience.stage === 'hand' ||
      experience.stage === 'calibrating' ||
      experience.stage === 'ready'
    if (!gestureDriven) {
      setLiveAnnouncement(announcement)
      return
    }
    const timeout = window.setTimeout(() => setLiveAnnouncement(announcement), 500)
    return () => window.clearTimeout(timeout)
  }, [announcement, experience.stage, vision.status])

  const runAction = (action: FirstMixExperienceAction) => {
    if (action === 'load-demo') {
      void mixer.loadDemoMix()
      return
    }
    if (action === 'show-tracks') {
      onChooseTracks()
      return
    }
    if (action === 'start-performance') {
      void mixer.toggleBoth()
      void vision.start()
      return
    }
    if (action === 'play-manual') {
      void mixer.toggleBoth()
      return
    }
    if (action === 'cancel-camera') {
      vision.stop()
      return
    }
    void vision.start()
  }

  const actionLabel = (action: FirstMixExperienceAction) => {
    if (action === 'load-demo') return mixer.demoLoading ? 'Building demo…' : 'Load instant demo'
    if (action === 'show-tracks') {
      if (mixer.decks.a.loaded && !mixer.decks.b.loaded) return 'Load Deck B'
      if (!mixer.decks.a.loaded && mixer.decks.b.loaded) return 'Load Deck A'
      return 'Load my tracks'
    }
    if (action === 'start-performance') return 'Start performance'
    if (action === 'play-manual') {
      return vision.status === 'running' ? 'Start music' : 'Play without camera'
    }
    if (action === 'start-camera') return 'Turn on hand controls'
    if (action === 'cancel-camera') return 'Cancel camera'
    return 'Retry camera'
  }

  const actionIcon = (action: FirstMixExperienceAction) => {
    if (action === 'load-demo') return <Sparkles aria-hidden="true" />
    if (action === 'show-tracks') return <Upload aria-hidden="true" />
    if (action === 'start-performance') return <Play aria-hidden="true" />
    if (action === 'play-manual') return <Play aria-hidden="true" />
    return <Camera aria-hidden="true" />
  }

  return (
    <section
      className={`first-mix-cockpit stage-${experience.stage}`}
      aria-labelledby="first-mix-title"
    >
      <ol className="first-mix-progress" aria-label="First mix progress">
        {steps.map((step, index) => (
          <li key={step.id} className={step.state} aria-current={step.state === 'active' ? 'step' : undefined}>
            <b aria-hidden="true">{step.state === 'complete' ? <Check /> : index + 1}</b>
            <span>{step.label}</span>
            <span className="sr-only">{step.state}.</span>
          </li>
        ))}
      </ol>

      <div className="first-mix-director">
        <div>
          <span>{experience.progress}</span>
          <h2 id="first-mix-title">{experience.title}</h2>
          <small>{experience.detail}</small>
        </div>
        {(experience.primaryAction || experience.secondaryAction) && (
          <div className="first-mix-actions">
            {experience.primaryAction && (
              <button
                type="button"
                className="button primary"
                onClick={() => runAction(experience.primaryAction!)}
                disabled={experience.primaryAction === 'load-demo' && mixer.demoLoading}
              >
                {actionIcon(experience.primaryAction)}
                {actionLabel(experience.primaryAction)}
              </button>
            )}
            {experience.secondaryAction && (
              <button
                type="button"
                className="button text"
                onClick={() => runAction(experience.secondaryAction!)}
              >
                {actionIcon(experience.secondaryAction)}
                {actionLabel(experience.secondaryAction)}
              </button>
            )}
          </div>
        )}
      </div>

      <output
        className="sr-only first-mix-announcement"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveAnnouncement}
      </output>
    </section>
  )
}

function PerformanceBar({ mixer }: { mixer: ReturnType<typeof useDjMixer> }) {
  const bothLoaded = mixer.decks.a.loaded && mixer.decks.b.loaded
  if (!bothLoaded) return null

  const anyPlaying = mixer.decks.a.playing || mixer.decks.b.playing
  const canSync = Boolean(mixer.decks.a.bpm && mixer.decks.b.bpm)
  const deckButton = (id: DeckId) => {
    const deck = mixer.decks[id]
    const effectiveBpm = deck.bpm ? deck.bpm * (1 + deck.tempo / 100) : null
    const bpmLabel = effectiveBpm ? `${effectiveBpm.toFixed(1)} BPM` : 'BPM pending'
    const playedRatio = deck.duration > 0 ? deck.currentTime / deck.duration : 0
    return (
      <button
        type="button"
        className={`performance-deck performance-deck-${id} ${deck.playing ? 'playing' : ''}`}
        onClick={() => void mixer.togglePlayback(id)}
        aria-label={`${deck.playing ? 'Pause' : 'Play'} ${deckLabel(id)}, ${deck.name}, ${bpmLabel}, from performance bar`}
      >
        <b>{id.toUpperCase()}</b>
        <span>
          <strong>{deck.name}</strong>
          <small>{bpmLabel}</small>
        </span>
        {deck.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        <div className="performance-deck-waveform" aria-hidden="true">
          {deck.waveform.map((amplitude, index) => (
            <i
              key={index}
              className={(index + 1) / deck.waveform.length <= playedRatio ? 'played' : ''}
              style={{ height: `${Math.max(12, amplitude)}%` }}
            />
          ))}
        </div>
      </button>
    )
  }

  return (
    <aside className="performance-bar" aria-label="Quick performance controls">
      {deckButton('a')}
      <button
        type="button"
        className="performance-master"
        onClick={() => void mixer.toggleBoth()}
        aria-label={anyPlaying ? 'Pause both decks from performance bar' : 'Start both decks from performance bar'}
      >
        {anyPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        <span>{anyPlaying ? 'Pause mix' : 'Start mix'}</span>
      </button>
      <button
        type="button"
        className={`performance-sync ${mixer.bpmSyncActive ? 'active' : ''}`}
        onClick={mixer.toggleBpmSync}
        disabled={!canSync}
        aria-pressed={mixer.bpmSyncActive}
        aria-label={canSync ? 'Toggle BPM Sync' : 'BPM Sync unavailable until both BPMs are ready'}
      >
        <RefreshCw aria-hidden="true" />
        <span>{mixer.bpmSyncActive ? 'BPM matched' : 'BPM Sync'}</span>
      </button>
      {deckButton('b')}
      <div className="performance-crossfader">
        <span>A</span>
        <input
          type="range"
          min="-100"
          max="100"
          value={mixer.crossfader}
          onPointerDown={() => mixer.claimManualControl('crossfader')}
          onKeyDown={(event) => {
            if (isRangeAdjustmentKey(event.key)) mixer.claimManualControl('crossfader')
          }}
          onChange={(event) => {
            mixer.claimManualControl('crossfader')
            mixer.setCrossfader(Number(event.target.value))
          }}
          onDoubleClick={() => mixer.resetControl('crossfader')}
          aria-label="Quick master crossfader"
          aria-valuetext={crossfaderReadout(mixer.crossfader)}
        />
        <span>B</span>
        <output>{crossfaderReadout(mixer.crossfader)}</output>
        <button type="button" onClick={() => mixer.resetControl('crossfader')}>
          Center
        </button>
      </div>
    </aside>
  )
}

function GestureConsole({
  mixer,
  vision,
}: {
  mixer: ReturnType<typeof useDjMixer>
  vision: ReturnType<typeof useVisionRuntime>
}) {
  const selectedMode = GESTURE_MODES.find(({ control }) => control === mixer.selectedControl)
  const isMasterControl = mixer.selectedControl === 'crossfader'
  const visibleGestureStatus =
    vision.status === 'running'
      ? mixer.gestureStatus
      : vision.status === 'loading'
        ? 'Preparing local hand tracking'
        : vision.status === 'error'
          ? 'Camera needs attention before Air Controls can connect'
          : 'Start the camera to use Air Controls'

  return (
    <aside className="gesture-console">
      <div className="panel-heading">
        <div>
          <span>Air controls</span>
          <strong>
            {isMasterControl ? 'Master' : deckLabel(mixer.activeDeck)} · {selectedMode?.label}
          </strong>
        </div>
        <div className="gesture-heading-actions">
          <span
            className={`gesture-state-pill ${mixer.gestureReleaseRequired ? 'release-required' : mixer.gesturePhase}`}
          >
            {mixer.gestureReleaseRequired
              ? 'Release hand'
              : mixer.gesturePhase === 'calibrating'
              ? 'Calibrating'
              : mixer.gesturePhase === 'armed'
                ? 'Armed'
                : 'Locked'}
          </span>
          {vision.status === 'running' && (
            <button type="button" onClick={vision.stop} aria-label="Stop camera">
              <Camera aria-hidden="true" />
              Stop camera
            </button>
          )}
          <button
            type="button"
            onClick={() => mixer.resetControl()}
            aria-label="Reset selected gesture control"
            title="Reset selected control"
          >
            <RotateCcw aria-hidden="true" />
            Reset
          </button>
        </div>
      </div>

      <div className="gesture-status">
        <Hand aria-hidden="true" />
        <div>
          <span>{vision.analysis.hands.length ? 'Live instruction' : 'How to move'}</span>
          <strong>{visibleGestureStatus}</strong>
          <small>{selectedMode?.detail}</small>
        </div>
      </div>

      <details className="gesture-control-disclosure">
        <summary>
          <span>
            <SlidersHorizontal aria-hidden="true" />
            <span>
              <strong>Choose Air Control</strong>
              <small>Crossfader, Volume, or Filter</small>
            </span>
          </span>
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="gesture-control-options">
          {isMasterControl ? (
            <div className="gesture-route-note">
              Crossfader controls the master mix between both decks.
            </div>
          ) : (
            <div className="gesture-route-group">
              <span>Choose deck</span>
              <div className="deck-target" aria-label="Gesture deck target">
                {(['a', 'b'] as DeckId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={mixer.activeDeck === id ? 'active' : ''}
                    onClick={() => mixer.selectControl(mixer.selectedControl, id)}
                    aria-pressed={mixer.activeDeck === id}
                  >
                    {id.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="gesture-route-group">
            <span>Choose control</span>
            <div className="gesture-modes">
              {GESTURE_MODES.map(({ control, label, detail, icon: Icon }) => (
                <button
                  key={control}
                  type="button"
                  className={mixer.selectedControl === control ? 'active' : ''}
                  onClick={() => mixer.selectControl(control, mixer.activeDeck)}
                  onDoubleClick={() => mixer.resetControl(control, mixer.activeDeck)}
                  aria-pressed={mixer.selectedControl === control}
                  aria-label={`${label}. ${detail}`}
                  title={`${detail} · double-click to reset`}
                >
                  <Icon aria-hidden="true" />
                  <strong>{label}</strong>
                </button>
              ))}
            </div>
          </div>
        </div>
      </details>
    </aside>
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
  const bothTracksLoaded = mixer.decks.a.loaded && mixer.decks.b.loaded
  const anyPlaying = mixer.decks.a.playing || mixer.decks.b.playing
  const firstMixSteps = deriveFirstMixReadiness({
    bothTracksLoaded,
    cameraStatus: vision.status,
    cameraMessage: vision.message,
    handDetected: vision.analysis.hands.length > 0,
    gesturePhase: mixer.gesturePhase,
    gestureReleaseRequired: mixer.gestureReleaseRequired,
  })
  const firstMixExperience = deriveFirstMixExperience({
    bothTracksLoaded,
    cameraStatus: vision.status,
    cameraMessage: vision.message,
    handDetected: vision.analysis.hands.length > 0,
    gesturePhase: mixer.gesturePhase,
    gestureReleaseRequired: mixer.gestureReleaseRequired,
    anyPlaying,
    deckALoaded: mixer.decks.a.loaded,
    deckBLoaded: mixer.decks.b.loaded,
    selectedControl: mixer.selectedControl,
  })
  const selectedMode = GESTURE_MODES.find(({ control }) => control === mixer.selectedControl)
  const firstMixAnnouncement = `First mix: ${firstMixExperience.title} ${firstMixExperience.detail}`

  return (
    <>
      <input
        ref={deckAInputRef}
        hidden
        type="file"
        accept={ACCEPTED_AUDIO}
        onChange={(event) => {
          void mixer.loadFile('a', event.target.files?.[0])
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={deckBInputRef}
        hidden
        type="file"
        accept={ACCEPTED_AUDIO}
        onChange={(event) => {
          void mixer.loadFile('b', event.target.files?.[0])
          event.currentTarget.value = ''
        }}
      />

      {bothTracksLoaded ? (
        <AirMixHeader mixer={mixer} />
      ) : (
        <PageIntro
          className="dj-room-intro"
          eyebrow="DJ Room"
          title="Mix with your hands."
          description="Load two tracks, start the camera, then shape the mix with one open hand. Everything stays in this tab."
        />
      )}

      <FirstMixCockpit
        mixer={mixer}
        vision={vision}
        steps={firstMixSteps}
        experience={firstMixExperience}
        announcement={firstMixAnnouncement}
        onChooseTracks={() => {
          if (!mixer.decks.a.loaded) deckAInputRef.current?.click()
          else deckBInputRef.current?.click()
        }}
      />

      <PerformanceBar mixer={mixer} />

      <section className={`dj-vision-layout ${bothTracksLoaded ? 'activated' : ''}`}>
        <CameraStage
          status={vision.status}
          message={vision.message}
          setVideoElement={vision.setVideoElement}
          setCanvasElement={vision.setCanvasElement}
          backdrop={bothTracksLoaded ? <AirMixBackdrop mixer={mixer} /> : undefined}
          overlay={
            vision.status === 'running' ? (
              <div className={`dj-room-overlay phase-${mixer.gesturePhase}`}>
                <span className="gesture-director-readout">
                  <Hand aria-hidden="true" />
                  <b>{firstMixExperience.title}</b>
                </span>
                <span className="gesture-value-readout">
                  <strong>
                    {mixer.selectedControl === 'crossfader'
                      ? 'Master'
                      : deckLabel(mixer.activeDeck)} · {selectedMode?.label}
                  </strong>
                  <b>{selectedControlReadout(mixer)}</b>
                </span>
              </div>
            ) : undefined
          }
        />
        <GestureConsole mixer={mixer} vision={vision} />
      </section>

      <section id="mixer-decks" className="dj-console" aria-label="Two-deck mixer">
        <DeckPanel id="a" mixer={mixer} onUpload={() => deckAInputRef.current?.click()} />
        <MixerConsole mixer={mixer} />
        <DeckPanel id="b" mixer={mixer} onUpload={() => deckBInputRef.current?.click()} />
      </section>
    </>
  )
}
