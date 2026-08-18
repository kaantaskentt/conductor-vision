import { useEffect, useMemo, useRef } from 'react'
import type { DeckId, DeckState } from '../hooks/useDjMixer'
import { effectiveDeckBpm, withDemoTempoGrid } from '../lib/performanceWaveform'

type PerformanceWaveformProps = {
  deckId: DeckId
  deck: DeckState
  onSeek: (time: number) => void
}

const COLORS: Record<DeckId, { primary: string; soft: string }> = {
  a: { primary: '#62ddff', soft: 'rgba(98, 221, 255, 0.24)' },
  b: { primary: '#a978ff', soft: 'rgba(169, 120, 255, 0.24)' },
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  deckId: DeckId,
  deck: DeckState,
) {
  const rect = canvas.getBoundingClientRect()
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(1, Math.floor(rect.width * ratio))
  const height = Math.max(1, Math.floor(rect.height * ratio))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  const context = canvas.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, width, height)
  if (
    typeof context.save !== 'function' ||
    typeof context.scale !== 'function' ||
    typeof context.beginPath !== 'function' ||
    typeof context.moveTo !== 'function' ||
    typeof context.lineTo !== 'function' ||
    typeof context.stroke !== 'function' ||
    typeof context.fillRect !== 'function' ||
    typeof context.restore !== 'function'
  ) return
  context.save()
  context.scale(ratio, ratio)

  const cssWidth = width / ratio
  const cssHeight = height / ratio
  const centerY = cssHeight / 2
  const colors = COLORS[deckId]
  const overview = deck.overview.length ? deck.overview : deck.waveform.map((value) => value / 100)

  context.strokeStyle = 'rgba(158, 179, 207, 0.12)'
  context.lineWidth = 1
  for (let line = 1; line < 4; line += 1) {
    const y = (cssHeight * line) / 4
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(cssWidth, y)
    context.stroke()
  }

  if (deck.duration > 0 && deck.beats.length) {
    for (const beat of deck.beats) {
      const x = (beat.timeSeconds / deck.duration) * cssWidth
      context.strokeStyle = beat.isEstimatedBarStart
        ? 'rgba(228, 238, 255, 0.34)'
        : 'rgba(228, 238, 255, 0.12)'
      context.lineWidth = beat.isEstimatedBarStart ? 1.2 : 0.7
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, cssHeight)
      context.stroke()
    }
  }

  const progress = deck.duration > 0 ? Math.min(1, deck.currentTime / deck.duration) : 0
  const barWidth = Math.max(1, cssWidth / Math.max(overview.length, 1))
  overview.forEach((amplitude, index) => {
    const x = (index / Math.max(overview.length, 1)) * cssWidth
    const heightValue = Math.max(2, amplitude * (centerY - 7))
    context.fillStyle = index / Math.max(overview.length - 1, 1) <= progress
      ? colors.primary
      : colors.soft
    context.fillRect(x, centerY - heightValue, Math.max(1, barWidth * 0.72), heightValue * 2)
  })

  const playheadX = progress * cssWidth
  context.strokeStyle = '#f7fbff'
  context.shadowColor = colors.primary
  context.shadowBlur = 9
  context.lineWidth = 1.5
  context.beginPath()
  context.moveTo(playheadX, 0)
  context.lineTo(playheadX, cssHeight)
  context.stroke()
  context.restore()
}

export function PerformanceWaveform({ deckId, deck, onSeek }: PerformanceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const displayDeck = useMemo(() => withDemoTempoGrid(deck), [deck])
  const displayBpm = effectiveDeckBpm(deck)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => drawWaveform(canvas, deckId, displayDeck)
    draw()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [deckId, displayDeck])

  return (
    <section className={`uv-waveform uv-waveform-${deckId}`} aria-label={`Deck ${deckId.toUpperCase()} waveform`}>
      <div className="uv-waveform-meta">
        <span className="uv-deck-id">{deckId.toUpperCase()}</span>
        <div>
          <strong>{deck.loaded ? deck.name : `Deck ${deckId.toUpperCase()} is empty`}</strong>
          <span>
            {displayBpm
              ? `${displayBpm.toFixed(1)} BPM${Math.abs(deck.tempo) >= 0.05 ? ' · MATCHED' : ''}`
              : deck.bpmStatus}
          </span>
        </div>
        <time>{formatTime(deck.currentTime)} / {formatTime(deck.duration)}</time>
      </div>
      <button
        type="button"
        className="uv-waveform-canvas"
        disabled={!deck.loaded || deck.duration <= 0}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          onSeek(((event.clientX - rect.left) / Math.max(rect.width, 1)) * deck.duration)
        }}
        aria-label={`Seek Deck ${deckId.toUpperCase()}`}
      >
        <canvas ref={canvasRef} aria-hidden="true" />
      </button>
      <div className="uv-waveform-grid-note">
        {displayDeck.beats.length
          ? deck.sourceKind === 'demo'
            ? `Authored demo tempo grid · ${displayDeck.bars.length} bars`
            : `Estimated beat grid · ${displayDeck.bars.length} bars`
          : deck.loaded
            ? 'Analyzing track shape and beat grid…'
            : 'Load a track to reveal its waveform'}
      </div>
    </section>
  )
}
