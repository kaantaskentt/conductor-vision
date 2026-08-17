import type { DeckState } from '../hooks/useDjMixer'
import { buildBeatGrid } from './trackAnalysis'

export function effectiveDeckBpm(deck: DeckState) {
  if (!deck.bpm) return null
  return deck.bpm * (1 + deck.tempo / 100)
}

export function withDemoTempoGrid(deck: DeckState): DeckState {
  if (
    deck.beats.length ||
    deck.sourceKind !== 'demo' ||
    !deck.bpm ||
    deck.duration <= 0
  ) return deck
  const grid = buildBeatGrid(
    deck.duration,
    deck.bpm,
    deck.authoredBarOffsetSeconds ?? 0,
  )
  return { ...deck, beats: grid.beats, bars: grid.bars }
}
