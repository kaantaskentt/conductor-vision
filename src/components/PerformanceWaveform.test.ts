import { describe, expect, it } from 'vitest'
import type { DeckState } from '../hooks/useDjMixer'
import { effectiveDeckBpm, withDemoTempoGrid } from '../lib/performanceWaveform'

function deck(overrides: Partial<DeckState> = {}): DeckState {
  return {
    analysisStatus: 'Bundled demo overview · authored tempo grid',
    audioLevel: 0,
    authoredBarOffsetSeconds: 0.25,
    authoredBeatsPerBar: 4,
    bars: [],
    beatGridConfidence: 0,
    beats: [],
    bpm: 120,
    bpmStatus: '120 BPM demo',
    currentTime: 0,
    duration: 8,
    error: null,
    filter: 50,
    loaded: true,
    name: 'Neon Pulse',
    overview: [0.5],
    playing: false,
    sourceKind: 'demo',
    tempo: 0,
    volume: 82,
    waveform: [0],
    ...overrides,
  }
}

describe('performance demo tempo grid', () => {
  it('derives beat and bar markers from bundled authored tempo metadata', () => {
    const resolved = withDemoTempoGrid(deck())

    expect(resolved.beats.length).toBeGreaterThan(0)
    expect(resolved.bars.length).toBeGreaterThan(0)
    expect(resolved.beats[0]?.timeSeconds).toBeCloseTo(0.25)
  })

  it('does not invent an authored grid for local uploads', () => {
    const local = deck({ sourceKind: 'local' })

    expect(withDemoTempoGrid(local)).toBe(local)
  })

  it('shows the BPM that the performer actually hears after tempo matching', () => {
    expect(effectiveDeckBpm(deck({ bpm: 126, tempo: -4.8 }))).toBeCloseTo(120, 1)
    expect(effectiveDeckBpm(deck({ bpm: null }))).toBeNull()
  })
})
