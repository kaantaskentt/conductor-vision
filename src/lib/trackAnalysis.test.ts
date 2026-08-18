import { describe, expect, it } from 'vitest'
import {
  analyzeTrackPcm,
  buildBeatGrid,
  buildTrackOverview,
  DEFAULT_TRACK_OVERVIEW_BUCKETS,
  estimateTrackTempo,
} from './trackAnalysis'

function impulseTrain(bpm: number, seconds: number, sampleRate: number, offset = 0) {
  const samples = new Float32Array(seconds * sampleRate)
  const period = 60 / bpm
  for (let time = offset; time < seconds; time += period) {
    const start = Math.round(time * sampleRate)
    for (let index = 0; index < 512 && start + index < samples.length; index += 1) {
      samples[start + index] = 1 - index / 512
    }
  }
  return samples
}

describe('track analysis', () => {
  it('detects a 120 BPM impulse train and estimates its beat phase', () => {
    const sampleRate = 44_100
    const samples = impulseTrain(120, 12, sampleRate, 0.125)
    const tempo = estimateTrackTempo(samples, sampleRate)

    expect(tempo.source).toBe('detected')
    expect(tempo.bpm).toBe(120)
    expect(tempo.bpmConfidence).toBeGreaterThan(0.4)
    expect(tempo.beatGridConfidence).toBeGreaterThan(0.4)
    expect(tempo.beatOffsetSeconds).toBeCloseTo(0.125, 1)
  })

  it('places a full-track peak in its corresponding normalized bucket', () => {
    const samples = new Float32Array(1_024)
    samples[512] = -0.75
    samples[900] = 0.375

    const overview = buildTrackOverview(samples, 512)
    expect(overview).toHaveLength(512)
    expect(overview[256]).toBe(1)
    expect(overview[450]).toBe(0.5)
    expect(overview.filter((value) => value > 0)).toHaveLength(2)
  })

  it('handles silence and invalid analysis inputs without inventing timing data', () => {
    const silent = analyzeTrackPcm(new Float32Array(44_100), 44_100)
    expect(silent.overview).toHaveLength(DEFAULT_TRACK_OVERVIEW_BUCKETS)
    expect(silent.overview.every((value) => value === 0)).toBe(true)
    expect(silent.bpm).toBeNull()
    expect(silent.beatOffsetSeconds).toBeNull()
    expect(silent.beats).toEqual([])
    expect(silent.bars).toEqual([])

    const invalid = analyzeTrackPcm(new Float32Array(), Number.NaN, {
      overviewBuckets: -1,
    })
    expect(invalid.durationSeconds).toBe(0)
    expect(invalid.overview).toEqual([])
    expect(invalid.bpmConfidence).toBe(0)
    expect(invalid.beatGridConfidence).toBe(0)
  })

  it('groups an estimated beat grid into four-beat bars', () => {
    const grid = buildBeatGrid(4, 120, 0.25, 4)
    expect(grid.beats.map(({ timeSeconds }) => timeSeconds)).toEqual([
      0.25,
      0.75,
      1.25,
      1.75,
      2.25,
      2.75,
      3.25,
      3.75,
    ])
    expect(grid.beats.map(({ beatInBar }) => beatInBar)).toEqual([1, 2, 3, 4, 1, 2, 3, 4])
    expect(grid.beats.map(({ bar }) => bar)).toEqual([1, 1, 1, 1, 2, 2, 2, 2])
    expect(grid.bars).toEqual([0.25, 2.25])
  })

  it('uses an optional known BPM while keeping beat confidence evidence-bound', () => {
    const silent = estimateTrackTempo(new Float32Array(44_100), 44_100, 128)
    expect(silent).toEqual({
      bpm: 128,
      source: 'known',
      bpmConfidence: 1,
      beatOffsetSeconds: null,
      beatGridConfidence: 0,
    })
  })
})
