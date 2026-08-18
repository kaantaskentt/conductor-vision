/** @vitest-environment jsdom */

import { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDjMixer } from './useDjMixer'

type Mixer = ReturnType<typeof useDjMixer>

function audioParam(value = 0) {
  return { value, setTargetAtTime: vi.fn() }
}

class FakeAudioContext {
  currentTime = 0
  state: AudioContextState = 'running'
  destination = {} as AudioDestinationNode

  createDynamicsCompressor() {
    return {
      threshold: audioParam(),
      knee: audioParam(),
      ratio: audioParam(),
      attack: audioParam(),
      release: audioParam(),
      connect: vi.fn(),
    } as unknown as DynamicsCompressorNode
  }

  createMediaElementSource() {
    return { connect: vi.fn() } as unknown as MediaElementAudioSourceNode
  }

  createBiquadFilter() {
    return {
      type: 'lowpass',
      Q: audioParam(),
      frequency: audioParam(),
      connect: vi.fn(),
    } as unknown as BiquadFilterNode
  }

  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      getByteFrequencyData: vi.fn(),
      connect: vi.fn(),
    } as unknown as AnalyserNode
  }

  createGain() {
    return { gain: audioParam(), connect: vi.fn() } as unknown as GainNode
  }

  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => {
    this.state = 'closed'
  })
}

function createAudioElement() {
  const audio = new EventTarget() as EventTarget & HTMLAudioElement
  let paused = true
  Object.assign(audio, {
    currentTime: 0,
    duration: 180,
    load: vi.fn(),
    loop: false,
    muted: false,
    playbackRate: 1,
    preservesPitch: true,
    src: '',
  })
  Object.defineProperty(audio, 'paused', {
    configurable: true,
    get: () => paused,
  })
  audio.play = vi.fn(async () => {
    if (!paused) return
    paused = false
    audio.dispatchEvent(new Event('play'))
  })
  audio.pause = vi.fn(() => {
    if (paused) return
    paused = true
    audio.dispatchEvent(new Event('pause'))
  })
  return audio
}

function Harness({
  audioA,
  audioB,
  onUpdate,
}: {
  audioA: HTMLAudioElement
  audioB: HTMLAudioElement
  onUpdate: (mixer: Mixer) => void
}) {
  const mixer = useDjMixer()
  const { setAudioElement } = mixer
  useLayoutEffect(() => {
    setAudioElement('a', audioA)
    setAudioElement('b', audioB)
    return () => {
      setAudioElement('a', null)
      setAudioElement('b', null)
    }
  }, [audioA, audioB, setAudioElement])
  useLayoutEffect(() => {
    onUpdate(mixer)
  })
  return null
}

describe('DJ mixer Air Mix lifecycle', () => {
  let root: Root
  let current: Mixer
  let mounted: boolean
  let audioA: HTMLAudioElement
  let audioB: HTMLAudioElement
  let renderUpdates: number

  beforeEach(async () => {
    vi.useFakeTimers()
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    ))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => clearTimeout(id)))
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    audioA = createAudioElement()
    audioB = createAudioElement()
    renderUpdates = 0
    const container = document.createElement('div')
    root = createRoot(container)
    mounted = true
    await act(async () => {
      root.render(
        <Harness
          audioA={audioA}
          audioB={audioB}
          onUpdate={(mixer) => {
            current = mixer
            renderUpdates += 1
          }}
        />,
      )
    })
    await act(async () => {
      await Promise.all([
        current.loadFile('a', new File(['a'], 'a.wav', { type: 'audio/wav' }), {
          knownBpm: 120,
        }),
        current.loadFile('b', new File(['b'], 'b.wav', { type: 'audio/wav' }), {
          knownBpm: 126,
        }),
      ])
    })
  })

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('requires one trusted Start performance click', async () => {
    let started = true
    await act(async () => {
      started = await current.startAirMix()
    })

    expect(started).toBe(false)
    expect(current.airMix).toEqual(expect.objectContaining({
      copy: 'Press Start performance once before using Air Mix.',
      phase: 'error',
    }))
    expect(audioB.play).not.toHaveBeenCalled()
  })

  it('starts on Deck A at full gain, fades to Deck B, then pauses Deck A', async () => {
    await act(async () => {
      await current.startPerformance()
    })
    expect(current.crossfader).toBe(-100)
    expect(current.decks.a.playing).toBe(true)

    let started = false
    await act(async () => {
      started = await current.startAirMix()
    })
    expect(started).toBe(true)
    expect(current.airMix.phase).toBe('fading')
    expect(current.airMix.copy).toContain('Assisted Fade')
    const updatesBeforeFade = renderUpdates

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(current.airMix).toEqual(expect.objectContaining({
      direction: 'a-to-b',
      phase: 'complete',
      progress: 1,
    }))
    expect(current.crossfader).toBe(100)
    expect(audioA.paused).toBe(true)
    expect(audioB.paused).toBe(false)
    expect(renderUpdates - updatesBeforeFade).toBeLessThan(100)
  })

  it('restores the paused target to its exact pre-run position when cancelled', async () => {
    await act(async () => {
      await current.startPerformance()
    })
    audioB.currentTime = 37.25

    await act(async () => {
      await current.startAirMix()
    })
    expect(current.airMix.phase).toBe('fading')
    expect(audioB.paused).toBe(false)

    await act(async () => current.cancelAirMix())

    expect(audioB.paused).toBe(true)
    expect(audioB.currentTime).toBe(37.25)
    expect(current.decks.b).toEqual(expect.objectContaining({
      currentTime: 37.25,
      playing: false,
    }))
  })

  it('uses the live media clock, then cancels a scheduled demo transition cleanly', async () => {
    await act(async () => {
      await current.loadFile('a', new File(['a'], 'a.wav', { type: 'audio/wav' }), {
        knownBpm: 120,
        authoredBarOffsetSeconds: 0,
        authoredBeatsPerBar: 4,
        sourceKind: 'demo',
      })
      await current.loadFile('b', new File(['b'], 'b.wav', { type: 'audio/wav' }), {
        knownBpm: 126,
        authoredBarOffsetSeconds: 0,
        authoredBeatsPerBar: 4,
        sourceKind: 'demo',
      })
      await current.startPerformance()
    })
    audioA.currentTime = 1.25
    expect(current.decks.a.currentTime).toBe(0)

    await act(async () => {
      await current.startAirMix()
    })
    expect(current.airMix).toEqual(expect.objectContaining({
      phase: 'scheduled',
      scheduledAt: expect.any(Number),
      startDelayMs: 750,
    }))
    expect(audioB.playbackRate).toBeCloseTo(0.952, 3)

    await act(async () => current.cancelAirMix())
    expect(current.airMix.phase).toBe('idle')
    expect(current.crossfader).toBe(-100)
    expect(audioB.playbackRate).toBe(1)
    expect(audioB.currentTime).toBe(0)

    const targetPlayCalls = vi.mocked(audioB.play).mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(audioB.play).toHaveBeenCalledTimes(targetPlayCalls)
  })

  it('rechecks a late demo callback and waits for the following authored bar', async () => {
    await act(async () => {
      await current.loadFile('a', new File(['a'], 'a.wav', { type: 'audio/wav' }), {
        knownBpm: 120,
        authoredBarOffsetSeconds: 0,
        authoredBeatsPerBar: 4,
        sourceKind: 'demo',
      })
      await current.loadFile('b', new File(['b'], 'b.wav', { type: 'audio/wav' }), {
        knownBpm: 126,
        authoredBarOffsetSeconds: 0,
        authoredBeatsPerBar: 4,
        sourceKind: 'demo',
      })
      await current.startPerformance()
    })
    let browserNow = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => browserNow)
    audioA.currentTime = 1.25
    const targetPlayCallsBeforeAirMix = vi.mocked(audioB.play).mock.calls.length

    await act(async () => {
      await current.startAirMix()
    })
    expect(current.airMix).toEqual(expect.objectContaining({
      phase: 'scheduled',
      scheduledAt: 1_750,
      startDelayMs: 750,
    }))

    // Simulate a blocked main thread delivering the callback 250 ms late.
    browserNow = 2_000
    audioA.currentTime = 2.25
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(audioB.play).toHaveBeenCalledTimes(targetPlayCallsBeforeAirMix)
    expect(current.airMix).toEqual(expect.objectContaining({
      copy: expect.stringContaining('browser timing adjusted'),
      phase: 'scheduled',
      scheduledAt: 3_750,
      startDelayMs: 1_750,
    }))

    browserNow = 3_750
    audioA.currentTime = 4
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_750)
    })
    expect(audioB.play).toHaveBeenCalledTimes(targetPlayCallsBeforeAirMix + 1)
    expect(current.airMix.phase).toBe('fading')
  })

  it('can transition back from the tempo-matched demo deck on its authored media bar', async () => {
    await act(async () => {
      await current.loadFile('a', new File(['a'], 'a.wav', { type: 'audio/wav' }), {
        knownBpm: 120,
        authoredBarOffsetSeconds: 0,
        authoredBeatsPerBar: 4,
        sourceKind: 'demo',
      })
      await current.loadFile('b', new File(['b'], 'b.wav', { type: 'audio/wav' }), {
        knownBpm: 126,
        authoredBarOffsetSeconds: 0,
        authoredBeatsPerBar: 4,
        sourceKind: 'demo',
      })
      await current.startPerformance()
    })
    await act(async () => {
      audioA.currentTime = 1.25
      await current.startAirMix()
    })
    expect(current.airMix).toEqual(expect.objectContaining({ phase: 'scheduled' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(current.airMix.phase).toBe('complete')
    expect(current.airMix.direction).toBe('a-to-b')
    expect(audioB.playbackRate).toBeCloseTo(0.952, 3)

    audioB.currentTime = 1.25
    await act(async () => {
      await current.startAirMix()
    })
    expect(current.airMix).toEqual(expect.objectContaining({
      direction: 'b-to-a',
      phase: 'scheduled',
      startDelayMs: 688,
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(current.airMix).toEqual(expect.objectContaining({
      direction: 'b-to-a',
      phase: 'complete',
      progress: 1,
    }))
    expect(current.crossfader).toBe(-100)
    expect(audioA.paused).toBe(false)
    expect(audioB.paused).toBe(true)
  })

  it('keeps the source stable and reports a recoverable error when the target cannot play', async () => {
    await act(async () => {
      await current.startPerformance()
    })
    vi.mocked(audioB.play).mockRejectedValueOnce(new Error('Target playback blocked'))

    let started = true
    await act(async () => {
      started = await current.startAirMix()
    })
    expect(started).toBe(false)
    expect(current.airMix).toEqual(expect.objectContaining({
      copy: 'Target playback blocked',
      phase: 'error',
    }))
    expect(current.crossfader).toBe(-100)
    expect(audioA.paused).toBe(false)
    expect(audioB.paused).toBe(true)
  })

  it('generation-guards a scheduled callback after unmount', async () => {
    await act(async () => {
      await current.loadFile('a', new File(['a'], 'a.wav', { type: 'audio/wav' }), {
        knownBpm: 120,
        authoredBarOffsetSeconds: 0,
        authoredBeatsPerBar: 4,
        sourceKind: 'demo',
      })
      await current.loadFile('b', new File(['b'], 'b.wav', { type: 'audio/wav' }), {
        knownBpm: 126,
        authoredBarOffsetSeconds: 0,
        authoredBeatsPerBar: 4,
        sourceKind: 'demo',
      })
      await current.startPerformance()
    })
    await act(async () => {
      await current.startAirMix()
    })
    expect(current.airMix).toEqual(expect.objectContaining({ phase: 'scheduled' }))
    const targetPlayCalls = vi.mocked(audioB.play).mock.calls.length

    await act(async () => root.unmount())
    mounted = false
    await vi.advanceTimersByTimeAsync(3_000)

    expect(audioB.play).toHaveBeenCalledTimes(targetPlayCalls)
  })
})
