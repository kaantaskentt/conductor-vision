import {
  Check,
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
import { useId, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { CameraActions, CameraStage, PageIntro } from '../components/AppShell'
import type { DeckId, DjControl, useDjMixer } from '../hooks/useDjMixer'
import type { useVisionRuntime } from '../hooks/useVisionRuntime'
import { deriveFirstMixReadiness } from '../lib/firstMixReadiness'
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

function RotaryControl({
  label,
  value,
  formattedValue,
  icon: Icon,
  ariaLabel,
  onChange,
  onReset,
  markers,
}: {
  label: string
  value: number
  formattedValue: string
  icon: typeof Volume2
  ariaLabel: string
  onChange: (value: number) => void
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
          onChange={(event) => onChange(Number(event.target.value))}
          onKeyDown={(event) => {
            const amount = event.shiftKey ? 1 : 5
            if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
              event.preventDefault()
              onChange(Math.min(100, value + amount))
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
              event.preventDefault()
              onChange(Math.max(0, value - amount))
            } else if (event.key === 'Home') {
              event.preventDefault()
              onChange(0)
            } else if (event.key === 'End') {
              event.preventDefault()
              onChange(100)
            }
          }}
          onPointerDown={(event) => {
            event.preventDefault()
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
        <div className="mini-level" aria-label={`${deckLabel(id)} audio level ${deck.audioLevel}%`}>
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
            <div>
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

      <button
        type="button"
        className={`bpm-sync-toggle ${mixer.bpmSyncActive ? 'active' : ''}`}
        onClick={mixer.toggleBpmSync}
        disabled={!bothLoaded}
        aria-pressed={mixer.bpmSyncActive}
      >
        <RefreshCw aria-hidden="true" />
        <span>
          <strong>BPM Sync</strong>
          <small>
            {mixer.bpmSyncActive
              ? `${mixer.bpmSyncMessage} · click to restore`
              : mixer.bpmSyncMessage}
          </small>
        </span>
        <b>{mixer.bpmSyncActive ? 'ON' : 'OFF'}</b>
      </button>

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
          onChange={(event) => mixer.setCrossfader(Number(event.target.value))}
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
        <button type="button" onClick={() => mixer.setCrossfader(0)}>
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
          <span className={`gesture-state-pill ${mixer.gesturePhase}`}>
            {mixer.gesturePhase === 'calibrating'
              ? 'Calibrating'
              : mixer.gesturePhase === 'armed'
                ? 'Armed'
                : 'Locked'}
          </span>
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

      <div className="gesture-status">
        <Hand aria-hidden="true" />
        <div>
          <span>{vision.analysis.hands.length ? 'Live instruction' : 'How to move'}</span>
          <strong>{visibleGestureStatus}</strong>
          <small>{selectedMode?.detail}</small>
        </div>
      </div>
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
  const firstMixSteps = deriveFirstMixReadiness({
    bothTracksLoaded: mixer.decks.a.loaded && mixer.decks.b.loaded,
    cameraStatus: vision.status,
    cameraMessage: vision.message,
    handDetected: vision.analysis.hands.length > 0,
    gesturePhase: mixer.gesturePhase,
  })
  const currentFirstMixStep = firstMixSteps.find(({ state }) => state === 'active')
  const firstMixAnnouncement =
    vision.status === 'loading'
      ? `Camera preparation: ${vision.message}`
      : vision.status === 'error'
        ? `Camera needs attention. ${vision.message}`
        : currentFirstMixStep
          ? `First mix step: ${currentFirstMixStep.label}. ${currentFirstMixStep.detail}`
          : 'First mix ready. The selected control is armed.'

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

      <PageIntro
        className="dj-room-intro"
        eyebrow="DJ Room"
        title="Mix with your hands."
        description="Load two tracks, start the camera, then shape the mix with one open hand. Everything stays in this tab."
        actions={
          <>
            <button
              type="button"
              className="button primary demo-set-button"
              onClick={() => void mixer.loadDemoMix()}
              disabled={mixer.demoLoading}
            >
              <Sparkles aria-hidden="true" />
              {mixer.demoLoading ? 'Building demo…' : 'Try demo set'}
            </button>
            <CameraActions
              status={vision.status}
              start={vision.start}
              stop={vision.stop}
              variant="secondary"
            />
          </>
        }
      />

      <section className="dj-quick-start" aria-labelledby="dj-quick-start-title">
        <div className="dj-quick-start-title">
          <Sparkles aria-hidden="true" />
          <span>
            <strong id="dj-quick-start-title">Your first mix</strong>
            <small>{currentFirstMixStep ? 'Follow the live readiness steps' : 'Ready to perform'}</small>
          </span>
        </div>
        <ol>
          {firstMixSteps.map((step, index) => (
            <li
              key={step.id}
              className={step.state}
              aria-current={step.state === 'active' ? 'step' : undefined}
            >
              <b aria-hidden="true">
                {step.state === 'complete' ? <Check /> : index + 1}
              </b>
              <span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
              <span className="sr-only">{step.state}.</span>
            </li>
          ))}
        </ol>
        <output className="sr-only" aria-live="polite" aria-atomic="true">
          {firstMixAnnouncement}
        </output>
      </section>

      <section className="dj-vision-layout">
        <CameraStage
          status={vision.status}
          message={vision.message}
          setVideoElement={vision.setVideoElement}
          setCanvasElement={vision.setCanvasElement}
          overlay={
            <div className="dj-room-overlay">
              <span>
                <Hand aria-hidden="true" />
                {vision.analysis.hands.length ? 'Mixer connected' : 'Find a hand'}
              </span>
              <span>
                {mixer.selectedControl === 'crossfader'
                  ? 'Crossfader'
                  : `${deckLabel(mixer.activeDeck)} ${mixer.selectedControl}`}
              </span>
            </div>
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
