/** @vitest-environment jsdom */

import { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bipolarFilterFrequencies, DJ_NEUTRAL_VALUES, useDjMixer } from './useDjMixer'

type Mixer = ReturnType<typeof useDjMixer>

type FakeAudioParam = {
  value: number
  setTargetAtTime: ReturnType<typeof vi.fn>
}

type FakeFilter = {
  type: BiquadFilterType
  Q: FakeAudioParam
  frequency: FakeAudioParam
  connect: ReturnType<typeof vi.fn>
}

type FakeCompressor = {
  threshold: FakeAudioParam
  knee: FakeAudioParam
  ratio: FakeAudioParam
  attack: FakeAudioParam
  release: FakeAudioParam
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

type FakeMediaDestination = {
  stream: MediaStream
  track: MediaStreamTrack & { stop: ReturnType<typeof vi.fn> }
}

function createAudioParam(value = 0): FakeAudioParam {
  return { value, setTargetAtTime: vi.fn() }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []

  currentTime = 4
  state: AudioContextState = 'running'
  destination = {} as AudioDestinationNode
  filters: FakeFilter[] = []
  compressors: FakeCompressor[] = []
  mediaDestinations: FakeMediaDestination[] = []

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  createDynamicsCompressor() {
    const compressor: FakeCompressor = {
      threshold: createAudioParam(),
      knee: createAudioParam(),
      ratio: createAudioParam(),
      attack: createAudioParam(),
      release: createAudioParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    this.compressors.push(compressor)
    return compressor as unknown as DynamicsCompressorNode
  }

  createMediaStreamDestination() {
    const track = {
      kind: 'audio',
      readyState: 'live',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> }
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
      getVideoTracks: () => [],
    } as unknown as MediaStream
    const destination = { stream, track }
    this.mediaDestinations.push(destination)
    return destination as unknown as MediaStreamAudioDestinationNode
  }

  createMediaElementSource() {
    return { connect: vi.fn() } as unknown as MediaElementAudioSourceNode
  }

  createBiquadFilter() {
    const filter: FakeFilter = {
      type: 'lowpass',
      Q: createAudioParam(),
      frequency: createAudioParam(),
      connect: vi.fn(),
    }
    this.filters.push(filter)
    return filter as unknown as BiquadFilterNode
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
    return {
      gain: createAudioParam(),
      connect: vi.fn(),
    } as unknown as GainNode
  }

  resume = vi.fn(() => Promise.resolve())
  close = vi.fn(() => {
    this.state = 'closed'
    return Promise.resolve()
  })
}

function createAudioElement() {
  return {
    preservesPitch: true,
    paused: true,
    duration: 180,
    currentTime: 0,
    playbackRate: 1,
    src: '',
    pause: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
    load: vi.fn(),
  } as unknown as HTMLAudioElement
}

function Harness({ onUpdate }: { onUpdate: (mixer: Mixer) => void }) {
  const mixer = useDjMixer()
  useLayoutEffect(() => {
    onUpdate(mixer)
  })
  return null
}

function openHand(wristAngle: number) {
  return {
    detected: true,
    x: 0.5,
    y: 0.5,
    wristAngle,
    openFingers: 5,
  }
}

const noHand = {
  detected: false,
  x: 0.5,
  y: 0.5,
  wristAngle: 0,
  openFingers: 0,
}

describe('DJ mixer filter gesture integration', () => {
  let root: Root
  let container: HTMLDivElement
  let current: Mixer
  let mounted: boolean

  beforeEach(async () => {
    vi.useFakeTimers()
    FakeAudioContext.instances = []
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:test-track'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    root = createRoot(container)
    mounted = true
    await act(async () => {
      root.render(<Harness onUpdate={(mixer) => (current = mixer)} />)
    })
    await act(async () => {
      vi.advanceTimersByTime(1_000)
      current.setAudioElement('a', createAudioElement())
      await current.loadFile(
        'a',
        new File(['demo'], 'demo.wav', { type: 'audio/wav' }),
        { knownBpm: 120 },
      )
    })
    await act(async () => {
      current.setDeckFilter('a', 82)
    })
    await act(async () => {
      await current.togglePlayback('a')
    })
    await act(async () => {
      current.selectControl('filter', 'a')
    })
  })

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps a non-neutral knob still until calibrated, follows deliberate rotation, then resets audio and UI after release', async () => {
    await act(async () => current.handleGestureFrame(openHand(0)))
    expect(current.decks.a.filter).toBe(82)
    expect(current.gestureStatus).toContain('Hold steady')

    await act(async () => {
      vi.advanceTimersByTime(210)
      current.handleGestureFrame(openHand((2 * Math.PI) / 180))
    })
    expect(current.decks.a.filter).toBe(82)

    await act(async () => {
      vi.advanceTimersByTime(210)
      current.handleGestureFrame(openHand(0))
    })
    expect(current.decks.a.filter).toBe(82)
    expect(current.gesturePhase).toBe('armed')

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(openHand((3 * Math.PI) / 180))
    })
    expect(current.decks.a.filter).toBe(82)

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(openHand((-37 * Math.PI) / 180))
    })
    expect(current.decks.a.filter).toBe(75)
    expect(current.gestureStatus).toContain('follows wrist movement')

    const context = FakeAudioContext.instances[0]
    const moved = bipolarFilterFrequencies(75)
    expect(context.filters[0].frequency.setTargetAtTime).toHaveBeenLastCalledWith(
      moved.highpass,
      4,
      0.06,
    )
    expect(context.filters[1].frequency.setTargetAtTime).toHaveBeenLastCalledWith(
      moved.lowpass,
      4,
      0.06,
    )

    await act(async () => current.handleGestureFrame(noHand))
    await act(async () => vi.advanceTimersByTime(299))
    expect(current.decks.a.filter).toBe(75)

    await act(async () => vi.advanceTimersByTime(1))
    expect(current.decks.a.filter).toBe(DJ_NEUTRAL_VALUES.filter)
    expect(current.gestureStatus).toBe('Deck A filter returned to neutral')

    expect(context.filters).toHaveLength(2)
    expect(context.filters[0].frequency.setTargetAtTime).toHaveBeenLastCalledWith(20, 4, 0.06)
    expect(context.filters[1].frequency.setTargetAtTime).toHaveBeenLastCalledWith(
      20_000,
      4,
      0.06,
    )
  })

  it('cancels a pending neutral reset when the hand returns or the selected control changes', async () => {
    await act(async () => current.handleGestureFrame(openHand(0.4)))
    await act(async () => {
      vi.advanceTimersByTime(420)
      current.handleGestureFrame(openHand(0.4))
      current.handleGestureFrame(noHand)
    })

    await act(async () => {
      vi.advanceTimersByTime(299)
      current.handleGestureFrame(openHand(-0.7))
    })
    expect(current.decks.a.filter).toBe(82)
    expect(current.gesturePhase).toBe('calibrating')

    await act(async () => vi.advanceTimersByTime(400))
    expect(current.decks.a.filter).toBe(82)

    await act(async () => current.handleGestureFrame(noHand))
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => current.selectControl('crossfader'))
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => vi.advanceTimersByTime(400))
    expect(current.selectedControl).toBe('crossfader')
    expect(current.gestureStatus).not.toContain('returned to neutral')
  })

  it('creates an isolated post-master capture tap without disturbing speaker output', async () => {
    const context = FakeAudioContext.instances[0]
    const compressor = context.compressors[0]
    context.state = 'suspended'

    let capture: Awaited<ReturnType<Mixer['createMasterCapture']>>
    await act(async () => {
      capture = await current.createMasterCapture()
    })

    const destination = context.mediaDestinations[0]
    expect(context.resume).toHaveBeenCalledOnce()
    expect(compressor.connect).toHaveBeenNthCalledWith(1, context.destination)
    expect(compressor.connect).toHaveBeenNthCalledWith(2, destination)
    expect(capture!.stream).toBe(destination.stream)

    capture!.release()
    capture!.release()

    expect(compressor.disconnect).toHaveBeenCalledOnce()
    expect(compressor.disconnect).toHaveBeenCalledWith(destination)
    expect(destination.track.stop).toHaveBeenCalledOnce()
    expect(context.close).not.toHaveBeenCalled()
  })

  it('stops a capture destination when the post-master connection fails', async () => {
    const context = FakeAudioContext.instances[0]
    const compressor = context.compressors[0]
    compressor.connect.mockImplementationOnce(() => {
      throw new Error('Audio graph rejected')
    })

    await expect(current.createMasterCapture()).rejects.toThrow(
      'The browser could not connect the replay audio tap.',
    )

    const destination = context.mediaDestinations[0]
    expect(destination.track.stop).toHaveBeenCalledOnce()
    expect(compressor.disconnect).not.toHaveBeenCalled()
    expect(context.close).not.toHaveBeenCalled()
  })

  it('releases an active capture tap when the mixer unmounts', async () => {
    const context = FakeAudioContext.instances[0]
    const compressor = context.compressors[0]
    await current.createMasterCapture()
    const destination = context.mediaDestinations[0]

    await act(async () => root.unmount())
    mounted = false

    expect(compressor.disconnect).toHaveBeenCalledOnce()
    expect(compressor.disconnect).toHaveBeenCalledWith(destination)
    expect(destination.track.stop).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('does not create a capture destination after unmount wins a deferred resume race', async () => {
    const context = FakeAudioContext.instances[0]
    context.state = 'suspended'
    let resolveResume: (() => void) | undefined
    context.resume.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveResume = resolve
        }),
    )

    const pendingCapture = current.createMasterCapture()
    await act(async () => Promise.resolve())
    await act(async () => root.unmount())
    mounted = false
    resolveResume?.()

    await expect(pendingCapture).rejects.toThrow('The master mix is no longer available.')
    expect(context.mediaDestinations).toHaveLength(0)
    expect(context.close).toHaveBeenCalledOnce()
  })
})
