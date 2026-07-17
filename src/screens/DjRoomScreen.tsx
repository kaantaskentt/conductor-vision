import {
  Disc3,
  Gauge,
  Hand,
  Music2,
  Pause,
  Play,
  SlidersHorizontal,
  Upload,
  Volume2,
  Waves,
} from 'lucide-react'
import { useRef } from 'react'
import { CameraActions, CameraStage, PageIntro } from '../components/AppShell'
import type { DeckId, DjControl, useDjMixer } from '../hooks/useDjMixer'
import type { useVisionRuntime } from '../hooks/useVisionRuntime'

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
    detail: 'Move left or right',
    icon: Waves,
  },
  {
    control: 'volume',
    label: 'Channel',
    detail: 'Move up or down',
    icon: Volume2,
  },
  {
    control: 'filter',
    label: 'Filter',
    detail: 'Rotate your wrist',
    icon: SlidersHorizontal,
  },
  {
    control: 'tempo',
    label: 'Tempo',
    detail: 'Move left or right',
    icon: Gauge,
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
  const otherId: DeckId = id === 'a' ? 'b' : 'a'
  const effectiveBpm = deck.bpm ? deck.bpm * (1 + deck.tempo / 100) : null

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

      <div className="phrase-pads" aria-label={`${deckLabel(id)} phrase jumps`}>
        <span>Phrase jump</span>
        <div>
          {[1, 2, 3, 4].map((index) => (
            <button
              key={index}
              type="button"
              onClick={() => mixer.jumpToPhrase(id, index)}
              disabled={!deck.loaded}
              aria-label={`${deckLabel(id)} phrase ${index}`}
            >
              {index}
            </button>
          ))}
        </div>
      </div>

      <div className="deck-controls">
        <label>
          <span>
            <Volume2 aria-hidden="true" />
            Channel
          </span>
          <strong>{deck.volume}%</strong>
          <input
            type="range"
            min="0"
            max="100"
            value={deck.volume}
            onChange={(event) => mixer.setDeckVolume(id, Number(event.target.value))}
            aria-label={`${deckLabel(id)} volume`}
          />
        </label>
        <label>
          <span>
            <SlidersHorizontal aria-hidden="true" />
            Filter
          </span>
          <strong>{deck.filter}%</strong>
          <input
            type="range"
            min="0"
            max="100"
            value={deck.filter}
            onChange={(event) => mixer.setDeckFilter(id, Number(event.target.value))}
            aria-label={`${deckLabel(id)} filter`}
          />
        </label>
        <label>
          <span>
            <Gauge aria-hidden="true" />
            Tempo
          </span>
          <strong>{deck.tempo > 0 ? '+' : ''}{deck.tempo.toFixed(1)}%</strong>
          <input
            type="range"
            min="-20"
            max="20"
            step="0.1"
            value={deck.tempo}
            onChange={(event) => mixer.setDeckTempo(id, Number(event.target.value))}
            aria-label={`${deckLabel(id)} tempo`}
          />
        </label>
      </div>

      <div className="deck-actions">
        <button type="button" className="button secondary" onClick={onUpload}>
          <Upload aria-hidden="true" />
          {deck.loaded ? 'Replace' : 'Load track'}
        </button>
        <button
          type="button"
          className="button text"
          onClick={() => mixer.tapTempo(id)}
          disabled={!deck.loaded}
        >
          Tap BPM
        </button>
        <button
          type="button"
          className="button text"
          onClick={() => mixer.syncDeck(id, otherId)}
          disabled={!deck.loaded || !mixer.decks[otherId].loaded}
        >
          Sync to {otherId.toUpperCase()}
        </button>
      </div>

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
          aria-label="Master crossfader"
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

      <button
        type="button"
        className="button primary start-mix"
        onClick={() => void mixer.toggleBoth()}
        disabled={!bothLoaded}
      >
        {anyPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        {anyPlaying ? 'Pause both' : 'Start both'}
      </button>

      <div className="sync-note">
        <strong>BPM Sync</strong>
        <p>Sync matches tempo and preserves pitch. Use the phrase pads to align the downbeat.</p>
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
  return (
    <aside className="gesture-console">
      <div className="panel-heading">
        <div>
          <span>Gesture routing</span>
          <strong>{vision.analysis.hands.length ? 'Hand connected' : 'Waiting for a hand'}</strong>
        </div>
        <span className={`status-dot ${vision.analysis.hands.length ? 'active' : ''}`} />
      </div>

      <div className="deck-target" aria-label="Gesture deck target">
        {(['a', 'b'] as DeckId[]).map((id) => (
          <button
            key={id}
            type="button"
            className={mixer.activeDeck === id ? 'active' : ''}
            onClick={() => mixer.selectControl(mixer.selectedControl, id)}
            aria-pressed={mixer.activeDeck === id}
          >
            {deckLabel(id)}
          </button>
        ))}
      </div>

      <div className="gesture-modes">
        {GESTURE_MODES.map(({ control, label, detail, icon: Icon }) => (
          <button
            key={control}
            type="button"
            className={mixer.selectedControl === control ? 'active' : ''}
            onClick={() => mixer.selectControl(control, mixer.activeDeck)}
            aria-pressed={mixer.selectedControl === control}
          >
            <Icon aria-hidden="true" />
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="gesture-status">
        <Hand aria-hidden="true" />
        <div>
          <span>Live instruction</span>
          <strong>{mixer.gestureStatus}</strong>
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

  return (
    <>
      <input
        ref={deckAInputRef}
        className="sr-only"
        type="file"
        accept={ACCEPTED_AUDIO}
        onChange={(event) => {
          void mixer.loadFile('a', event.target.files?.[0])
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={deckBInputRef}
        className="sr-only"
        type="file"
        accept={ACCEPTED_AUDIO}
        onChange={(event) => {
          void mixer.loadFile('b', event.target.files?.[0])
          event.currentTarget.value = ''
        }}
      />

      <PageIntro
        eyebrow="DJ Room"
        title="Mix two tracks with movement."
        description="Two local decks, automatic BPM analysis, tempo sync, phrase jumps, and a camera-controlled mixer."
        actions={
          <>
            <button
              type="button"
              className="button secondary"
              onClick={() => deckAInputRef.current?.click()}
            >
              <Music2 aria-hidden="true" />
              Load deck A
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => deckBInputRef.current?.click()}
            >
              <Disc3 aria-hidden="true" />
              Load deck B
            </button>
            <CameraActions status={vision.status} start={vision.start} stop={vision.stop} />
          </>
        }
      />

      <section className="dj-console">
        <DeckPanel id="a" mixer={mixer} onUpload={() => deckAInputRef.current?.click()} />
        <MixerConsole mixer={mixer} />
        <DeckPanel id="b" mixer={mixer} onUpload={() => deckBInputRef.current?.click()} />
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
    </>
  )
}
