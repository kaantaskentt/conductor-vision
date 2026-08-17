import { describe, expect, it } from 'vitest'
import {
  AIR_MIX_MIN_GRID_CONFIDENCE,
  nextAuthoredBarDelayMs,
  planAirMix,
  safeTempoMatchPercent,
  sourceOnlyCrossfader,
  type AirMixDeckInput,
} from './airMixTransition'

function deck(overrides: Partial<AirMixDeckInput> = {}): AirMixDeckInput {
  return {
    authoredBarOffsetSeconds: null,
    authoredBeatsPerBar: null,
    beatGridConfidence: 0,
    bpm: 120,
    currentTime: 0,
    loaded: true,
    playing: false,
    sourceKind: 'local',
    tempo: 0,
    ...overrides,
  }
}

describe('Air Mix transition planner', () => {
  it('uses the playing deck as source and keeps local files in honest Assisted Fade mode', () => {
    const result = planAirMix({
      crossfader: 75,
      decks: { a: deck({ playing: true }), b: deck({ bpm: 126 }) },
    })

    expect(result).toEqual({
      ok: true,
      plan: expect.objectContaining({
        copy: 'Assisted Fade · no automatic beat-grid lock',
        mode: 'assisted-fade',
        sourceId: 'a',
        startDelayMs: 0,
        targetId: 'b',
        targetTempoPercent: null,
      }),
    })
  })

  it('uses crossfader dominance only when both decks are already playing', () => {
    const result = planAirMix({
      crossfader: 1,
      decks: { a: deck({ playing: true }), b: deck({ playing: true }) },
    })
    expect(result.ok && result.plan.sourceId).toBe('b')
    expect(sourceOnlyCrossfader('a')).toBe(-100)
    expect(sourceOnlyCrossfader('b')).toBe(100)
  })

  it('tempo-matches local tracks only when both estimated grids are sufficiently reliable', () => {
    const result = planAirMix({
      crossfader: -100,
      decks: {
        a: deck({ beatGridConfidence: AIR_MIX_MIN_GRID_CONFIDENCE, playing: true }),
        b: deck({ beatGridConfidence: AIR_MIX_MIN_GRID_CONFIDENCE, bpm: 126 }),
      },
    })
    expect(result.ok && result.plan.copy).toBe('Assisted Fade · estimated tempo match')
    expect(result.ok && result.plan.targetTempoPercent).toBeCloseTo(-4.8, 1)
  })

  it('schedules the all-demo transition on the next authored four-beat boundary', () => {
    const result = planAirMix({
      crossfader: -100,
      decks: {
        a: deck({
          authoredBarOffsetSeconds: 0,
          authoredBeatsPerBar: 4,
          currentTime: 1.25,
          playing: true,
          sourceKind: 'demo',
        }),
        b: deck({
          authoredBarOffsetSeconds: 0,
          authoredBeatsPerBar: 4,
          bpm: 126,
          sourceKind: 'demo',
        }),
      },
    })
    expect(result.ok && result.plan).toEqual(expect.objectContaining({
      copy: 'Demo Air Mix · starts on the next authored bar',
      mode: 'demo-air-mix',
      startDelayMs: 750,
      targetTempoPercent: -4.8,
    }))
    expect(nextAuthoredBarDelayMs(0, 120)).toBe(2_000)
  })

  it('keeps reverse demo transitions on authored media bars after tempo matching', () => {
    const result = planAirMix({
      crossfader: 100,
      decks: {
        a: deck({
          authoredBarOffsetSeconds: 0,
          authoredBeatsPerBar: 4,
          sourceKind: 'demo',
        }),
        b: deck({
          authoredBarOffsetSeconds: 0,
          authoredBeatsPerBar: 4,
          bpm: 126,
          currentTime: 1.25,
          playing: true,
          sourceKind: 'demo',
          tempo: -4.8,
        }),
      },
    })

    expect(result.ok && result.plan).toEqual(expect.objectContaining({
      sourceId: 'b',
      startDelayMs: 688,
      targetId: 'a',
    }))
    expect(nextAuthoredBarDelayMs(1.25, 126, 0, 4, 0.952)).toBe(688)
  })

  it('never calls a mixed-source set an authored demo transition', () => {
    const result = planAirMix({
      crossfader: -100,
      decks: {
        a: deck({ playing: true, sourceKind: 'demo' }),
        b: deck({ sourceKind: 'local' }),
      },
    })
    expect(result.ok && result.plan.mode).toBe('assisted-fade')
    expect(result.ok && result.plan.copy).not.toContain('authored')
  })

  it('rejects missing decks, stopped decks, and unsafe demo tempo gaps', () => {
    expect(planAirMix({
      crossfader: 0,
      decks: { a: deck({ loaded: false }), b: deck() },
    })).toEqual({ ok: false, reason: 'Load both decks before starting Air Mix.' })
    expect(planAirMix({
      crossfader: 0,
      decks: { a: deck(), b: deck() },
    })).toEqual({ ok: false, reason: 'Start one deck before starting Air Mix.' })
    expect(planAirMix({
      crossfader: 0,
      decks: {
        a: deck({
          authoredBarOffsetSeconds: 0,
          authoredBeatsPerBar: 4,
          bpm: 80,
          playing: true,
          sourceKind: 'demo',
        }),
        b: deck({
          authoredBarOffsetSeconds: 0,
          authoredBeatsPerBar: 4,
          bpm: 120,
          sourceKind: 'demo',
        }),
      },
    })).toEqual({
      ok: false,
      reason: 'These demo tracks are outside the safe tempo range.',
    })
    expect(safeTempoMatchPercent(120, 126)).toBe(-4.8)
  })
})
