/** @vitest-environment jsdom */

import { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bipolarFilterFrequencies,
  bipolarFilterResonance,
  channelGainFromPercent,
  DJ_NEUTRAL_VALUES,
  useDjMixer,
} from './useDjMixer'
import {
  FILTER_GESTURE_RELEASE_MS,
  GESTURE_CLUTCH_FIST_RELEASE_MS,
  GESTURE_CLUTCH_LOST_RELEASE_MS,
} from '../lib/gestureController'

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

type FakeGain = {
  gain: FakeAudioParam
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
  gains: FakeGain[] = []
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
    const gain: FakeGain = {
      gain: createAudioParam(),
      connect: vi.fn(),
    }
    this.gains.push(gain)
    return gain as unknown as GainNode
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

function openHand(
  wristAngle: number,
  options: { fingers?: number; x?: number; y?: number } = {},
) {
  return {
    detected: true,
    x: options.x ?? 0.5,
    y: options.y ?? 0.5,
    wristAngle,
    openFingers: options.fingers ?? 5,
  }
}

function closedHand(wristAngle = 0) {
  return { ...openHand(wristAngle), openFingers: 0 }
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

  it('grabs a non-neutral filter without jumping, survives finger-count flicker, and resets after a deliberate fist release', async () => {
    await act(async () => current.handleGestureFrame(openHand(0)))
    expect(current.decks.a.filter).toBe(82)
    expect(current.gestureStatus).toContain('grabbed at 82%')
    expect(current.gesturePhase).toBe('armed')

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(openHand((3 * Math.PI) / 180))
    })
    expect(current.decks.a.filter).toBe(82)

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(openHand((-25 * Math.PI) / 180, { fingers: 2 }))
    })
    expect(current.decks.a.filter).toBe(70)
    expect(current.gestureStatus).toContain('close fist to return to 50%')

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(closedHand((-25 * Math.PI) / 180))
    })
    expect(current.decks.a.filter).toBe(70)
    expect(current.gestureStatus).toBe('Keep your fist closed to release')

    const context = FakeAudioContext.instances[0]
    const moved = bipolarFilterFrequencies(70)
    const movedQ = bipolarFilterResonance(70)
    expect(context.filters[0].frequency.setTargetAtTime).toHaveBeenLastCalledWith(
      moved.highpass,
      4,
      0.045,
    )
    expect(context.filters[1].frequency.setTargetAtTime).toHaveBeenLastCalledWith(
      moved.lowpass,
      4,
      0.045,
    )
    expect(context.filters[0].Q.setTargetAtTime).toHaveBeenLastCalledWith(movedQ, 4, 0.045)

    await act(async () => {
      vi.advanceTimersByTime(GESTURE_CLUTCH_FIST_RELEASE_MS)
      current.handleGestureFrame(closedHand((-25 * Math.PI) / 180))
    })
    expect(current.decks.a.filter).toBe(DJ_NEUTRAL_VALUES.filter)
    expect(current.gestureStatus).toBe('Deck A filter returned to neutral')
    expect(vi.getTimerCount()).toBe(0)

    expect(context.filters).toHaveLength(2)
    expect(context.filters[0].frequency.setTargetAtTime).toHaveBeenLastCalledWith(20, 4, 0.12)
    expect(context.filters[1].frequency.setTargetAtTime).toHaveBeenLastCalledWith(
      20_000,
      4,
      0.12,
    )

    await act(async () => {
      vi.advanceTimersByTime(1)
      current.handleGestureFrame(openHand((-25 * Math.PI) / 180))
    })
    expect(current.decks.a.filter).toBe(DJ_NEUTRAL_VALUES.filter)
    expect(current.gestureStatus).toContain('grabbed at 50%')
    expect(current.gesturePhase).toBe('armed')
  })

  it('recovers from brief tracking loss and cancels a pending neutral reset when the hand returns', async () => {
    await act(async () => current.handleGestureFrame(openHand(0.4)))
    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(openHand(0.1))
    })
    const movedValue = current.decks.a.filter

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(noHand)
    })
    expect(current.decks.a.filter).toBe(movedValue)
    expect(current.gestureStatus).toContain('Tracking paused')

    await act(async () => {
      vi.advanceTimersByTime(GESTURE_CLUTCH_LOST_RELEASE_MS - 1)
      current.handleGestureFrame(openHand(0.1))
    })
    expect(current.decks.a.filter).not.toBe(DJ_NEUTRAL_VALUES.filter)
    expect(current.gesturePhase).toBe('armed')

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(noHand)
      vi.advanceTimersByTime(GESTURE_CLUTCH_LOST_RELEASE_MS)
      current.handleGestureFrame(noHand)
    })
    expect(current.gestureStatus).toContain('returning to 50%')

    expect(vi.getTimerCount()).toBe(1)
    const valueBeforeRegrab = current.decks.a.filter
    await act(async () => {
      vi.advanceTimersByTime(FILTER_GESTURE_RELEASE_MS - 1)
      current.handleGestureFrame(openHand(-0.7))
    })
    expect(vi.getTimerCount()).toBe(0)
    expect(current.decks.a.filter).toBe(valueBeforeRegrab)
    expect(current.gestureStatus).toContain(`grabbed at ${valueBeforeRegrab}%`)
  })

  it('immediately releases a stale session when gesture input disappears', async () => {
    await act(async () => {
      current.setCrossfader(34)
      current.setDeckVolume('a', 64)
      current.handleGestureFrame(openHand(0.4))
    })
    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(openHand(0.1))
    })
    expect(current.decks.a.filter).not.toBe(DJ_NEUTRAL_VALUES.filter)

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(noHand)
      vi.advanceTimersByTime(GESTURE_CLUTCH_LOST_RELEASE_MS)
      current.handleGestureFrame(noHand)
    })
    expect(vi.getTimerCount()).toBe(1)

    await act(async () => {
      current.releaseGestureSession('camera-stopped')
    })

    expect(vi.getTimerCount()).toBe(0)
    expect(current.gesturePhase).toBe('locked')
    expect(current.gestureEngaged).toBe(false)
    expect(current.gestureStatus).toBe('Camera stopped · Air Controls released')
    expect(current.decks.a.filter).toBe(DJ_NEUTRAL_VALUES.filter)
    expect(current.decks.a.volume).toBe(64)
    expect(current.crossfader).toBe(34)

    await act(async () => current.handleGestureFrame(openHand(-0.7)))
    expect(current.gestureStatus).toContain('grabbed at 50%')
    expect(current.gesturePhase).toBe('armed')
  })

  it('keeps a manual crossfader reset centered until a fresh hand clutch', async () => {
    await act(async () => current.selectControl('crossfader'))
    await act(async () => current.handleGestureFrame(openHand(0, { x: 0.5 })))
    await act(async () => {
      vi.advanceTimersByTime(421)
      current.handleGestureFrame(openHand(0, { x: 0.5 }))
    })
    expect(current.gesturePhase).toBe('armed')

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(openHand(0, { x: 0.8 }))
    })
    expect(current.crossfader).toBeGreaterThan(0)

    await act(async () => current.resetControl('crossfader'))
    expect(current.crossfader).toBe(DJ_NEUTRAL_VALUES.crossfader)
    expect(current.gesturePhase).toBe('locked')

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(openHand(0, { x: 0.1 }))
    })
    expect(current.crossfader).toBe(DJ_NEUTRAL_VALUES.crossfader)
    expect(current.gestureStatus).toBe('Close your fist once, then open your palm to grab')

    await act(async () => current.handleGestureFrame(closedHand()))
    expect(current.gestureStatus).toBe('Released · open your palm to grab the selected control')

    await act(async () => current.handleGestureFrame(openHand(0, { x: 0.1 })))
    expect(current.crossfader).toBe(DJ_NEUTRAL_VALUES.crossfader)
    expect(current.gesturePhase).toBe('calibrating')

    await act(async () => {
      vi.advanceTimersByTime(421)
      current.handleGestureFrame(openHand(0, { x: 0.1 }))
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(openHand(0, { x: 0.4 }))
    })
    expect(current.crossfader).toBeGreaterThan(0)
  })

  it('lets a manual deck move take ownership from an armed gesture', async () => {
    await act(async () => current.selectControl('volume', 'a'))
    await act(async () => current.handleGestureFrame(openHand(0, { y: 0.5 })))
    expect(current.gesturePhase).toBe('armed')

    await act(async () => {
      current.claimManualControl('volume', 'a')
      current.setDeckVolume('a', 66)
    })
    expect(current.decks.a.volume).toBe(66)
    expect(current.gesturePhase).toBe('locked')

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(openHand(0, { y: 0.1 }))
    })
    expect(current.decks.a.volume).toBe(66)
    expect(current.gestureStatus).toBe('Close your fist once, then open your palm to grab')
  })

  it('grabs volume without jumping, responds to hand height, then locks its value on release', async () => {
    await act(async () => current.selectControl('volume', 'a'))
    await act(async () => current.handleGestureFrame(openHand(0, { y: 0.5 })))
    expect(current.decks.a.volume).toBe(82)
    expect(current.gestureStatus).toContain('grabbed at 82%')

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(openHand(0, { fingers: 2, y: 0.35 }))
    })
    expect(current.decks.a.volume).toBe(92)

    await act(async () => {
      vi.advanceTimersByTime(80)
      current.handleGestureFrame(closedHand())
      vi.advanceTimersByTime(GESTURE_CLUTCH_FIST_RELEASE_MS)
      current.handleGestureFrame(closedHand())
    })
    expect(current.decks.a.volume).toBe(92)
    expect(current.gestureStatus).toBe('Deck A level locked at 92%')

    const context = FakeAudioContext.instances[0]
    expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(
      channelGainFromPercent(92),
      4,
      0.045,
    )
  })

  it('restores the exact neutral gain and filter curve when a loaded track is replaced', async () => {
    const context = FakeAudioContext.instances[0]
    await act(async () => {
      current.setDeckVolume('a', 25)
      current.setDeckFilter('a', 100)
    })

    await act(async () => {
      await current.loadFile(
        'a',
        new File(['replacement'], 'replacement.wav', { type: 'audio/wav' }),
        { knownBpm: 126 },
      )
    })

    const neutralFrequencies = bipolarFilterFrequencies(DJ_NEUTRAL_VALUES.filter)
    const neutralResonance = bipolarFilterResonance(DJ_NEUTRAL_VALUES.filter)
    expect(current.decks.a.volume).toBe(DJ_NEUTRAL_VALUES.volume)
    expect(current.decks.a.filter).toBe(DJ_NEUTRAL_VALUES.filter)
    expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(
      channelGainFromPercent(DJ_NEUTRAL_VALUES.volume),
      4,
      0.035,
    )
    expect(context.filters[0].frequency.setTargetAtTime).toHaveBeenLastCalledWith(
      neutralFrequencies.highpass,
      4,
      0.035,
    )
    expect(context.filters[1].frequency.setTargetAtTime).toHaveBeenLastCalledWith(
      neutralFrequencies.lowpass,
      4,
      0.035,
    )
    expect(context.filters[0].Q.setTargetAtTime).toHaveBeenLastCalledWith(
      neutralResonance,
      4,
      0.035,
    )
    expect(context.filters[1].Q.setTargetAtTime).toHaveBeenLastCalledWith(
      neutralResonance,
      4,
      0.035,
    )
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
