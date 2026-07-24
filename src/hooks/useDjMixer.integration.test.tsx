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

function createAudioParam(value = 0): FakeAudioParam {
  return { value, setTargetAtTime: vi.fn() }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []

  currentTime = 4
  state: AudioContextState = 'running'
  destination = {} as AudioDestinationNode
  filters: FakeFilter[] = []

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  createDynamicsCompressor() {
    return {
      threshold: createAudioParam(),
      knee: createAudioParam(),
      ratio: createAudioParam(),
      attack: createAudioParam(),
      release: createAudioParam(),
      connect: vi.fn(),
    } as unknown as DynamicsCompressorNode
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
    await act(async () => root.unmount())
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
})
