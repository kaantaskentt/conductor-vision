/** @vitest-environment jsdom */

import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const mediaPipe = vi.hoisted(() => ({
  createFace: vi.fn(),
  createHand: vi.fn(),
  resolveFileset: vi.fn(),
}))
const bundledDemo = vi.hoisted(() => ({
  loadBundledDemoTracks: vi.fn(),
}))

const HAND_MODEL_BYTES = 7_819_105
const FACE_MODEL_BYTES = 3_758_596
const HAND_MODEL_SHA256 = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1'
const FACE_MODEL_SHA256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'

function hexBuffer(hex: string) {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16)).buffer
}

vi.mock('@mediapipe/tasks-vision', () => ({
  DrawingUtils: class {},
  FilesetResolver: { forVisionTasks: mediaPipe.resolveFileset },
  HandLandmarker: { HAND_CONNECTIONS: [], createFromOptions: mediaPipe.createHand },
  FaceLandmarker: { FACE_LANDMARKS_TESSELATION: [], createFromOptions: mediaPipe.createFace },
}))

vi.mock('./lib/bundledDemo', () => ({
  loadBundledDemoTracks: bundledDemo.loadBundledDemoTracks,
}))

type FakeAudioParam = {
  value: number
  setTargetAtTime: ReturnType<typeof vi.fn>
}

function audioParam(value = 0): FakeAudioParam {
  return { value, setTargetAtTime: vi.fn() }
}

class FakeAudioContext {
  currentTime = 1
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
      disconnect: vi.fn(),
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

  resume = vi.fn(() => Promise.resolve())
  close = vi.fn(() => {
    this.state = 'closed'
    return Promise.resolve()
  })
}

function createTrack() {
  const listeners = new Map<string, Set<EventListener>>()
  return {
    kind: 'video',
    readyState: 'live',
    stop: vi.fn(),
    addEventListener: vi.fn((name: string, listener: EventListener) => {
      const callbacks = listeners.get(name) ?? new Set<EventListener>()
      callbacks.add(listener)
      listeners.set(name, callbacks)
    }),
    removeEventListener: vi.fn((name: string, listener: EventListener) => {
      listeners.get(name)?.delete(listener)
    }),
    dispatch(name: string) {
      for (const listener of listeners.get(name) ?? []) listener(new Event(name))
    },
  }
}

function createStream(track = createTrack()) {
  return {
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
    } as unknown as MediaStream,
    track,
  }
}

function buttonByName(container: HTMLElement, name: string) {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  )
  if (!button) throw new Error(`Button not found: ${name}`)
  return button
}

function flowStepButton(container: HTMLElement, name: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('.uv-flow-progress button')]
    .find((candidate) => candidate.textContent?.includes(name))
  if (!button) throw new Error(`Flow step not found: ${name}`)
  return button
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

async function flushPromises(count = 8) {
  for (let index = 0; index < count; index += 1) await Promise.resolve()
}

describe('Ultra Vision camera-first DJ flow', () => {
  let root: Root
  let container: HTMLDivElement
  let animationQueue: FrameRequestCallback[]
  let mediaPaused: WeakMap<HTMLMediaElement, boolean>
  let getUserMedia: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    animationQueue = []
    bundledDemo.loadBundledDemoTracks.mockReset()
    bundledDemo.loadBundledDemoTracks.mockResolvedValue([
      {
        bpm: 120,
        file: new File(['deck-a'], 'neon-pulse.wav', { type: 'audio/wav' }),
        title: 'Neon Pulse',
      },
      {
        bpm: 126,
        file: new File(['deck-b'], 'midnight-circuit.wav', { type: 'audio/wav' }),
        title: 'Midnight Circuit',
      },
    ])
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationQueue.push(callback)
      return animationQueue.length
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const bytes = url.includes('/hand_landmarker/')
        ? HAND_MODEL_BYTES
        : url.includes('/face_landmarker/')
          ? FACE_MODEL_BYTES
          : null
      if (bytes === null) throw new Error(`Unexpected fetch in integration test: ${url}`)
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(bytes),
      }
    }))
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn(async (_algorithm: AlgorithmIdentifier, data: BufferSource) => {
          const bytes = ArrayBuffer.isView(data) ? data.byteLength : data.byteLength
          if (bytes === HAND_MODEL_BYTES) return hexBuffer(HAND_MODEL_SHA256)
          if (bytes === FACE_MODEL_BYTES) return hexBuffer(FACE_MODEL_SHA256)
          throw new Error(`Unexpected digest length in integration test: ${bytes}`)
        }),
      },
    })
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    })
    mediaPipe.resolveFileset.mockResolvedValue({})
    mediaPipe.createHand.mockResolvedValue({
      detectForVideo: vi.fn(() => ({ landmarks: [], handedness: [] })),
      close: vi.fn(),
    })
    mediaPipe.createFace.mockResolvedValue({
      detectForVideo: vi.fn(() => ({ faceLandmarks: [], faceBlendshapes: [] })),
      close: vi.fn(),
    })
    getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    mediaPaused = new WeakMap()
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      mediaPaused.set(this, false)
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      mediaPaused.set(this, true)
      this.dispatchEvent(new Event('pause'))
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() {
        return mediaPaused.get(this) ?? true
      },
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        return 4
      },
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
      })),
    })
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(<StrictMode><App /></StrictMode>))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function loadDemoSet() {
    await act(async () => {
      click(buttonByName(container, 'Use demo instead'))
      animationQueue.shift()?.(16)
      await flushPromises()
    })
    expect(container.querySelector('h1')?.textContent).toBe('Load your tracks')
  }

  async function enterPerformance() {
    const play = vi.mocked(HTMLMediaElement.prototype.play)
    const playCallsBefore = play.mock.calls.length
    await act(async () => {
      click(buttonByName(container, 'Start performance'))
      await flushPromises()
    })
    expect(container.querySelector('h1')?.textContent).toBe('Perform with your hands')
    expect(play.mock.calls.length).toBeGreaterThan(playCallsBefore)
    return play.mock.calls.length - playCallsBefore
  }

  it('starts with a centered, privacy-clear camera step', () => {
    expect(container.querySelector('h1')?.textContent).toBe('Start with your camera')
    expect(container.querySelector('.uv-flow-progress button.active')?.textContent).toContain('Camera')
    expect(buttonByName(container, 'Allow camera')).toBeTruthy()
    expect(buttonByName(container, 'Use demo instead')).toBeTruthy()
    expect(container.textContent).toContain('No video leaves your browser')
    expect(container.querySelectorAll('video')).toHaveLength(1)
    expect(container.querySelector('.uv-track-loader')).toBeNull()
    expect(container.querySelector('.uv-performance-workspace')).toBeNull()
  })

  it('opens the camera first, advances to tracks, and preserves the same camera element', async () => {
    const { stream } = createStream()
    getUserMedia.mockResolvedValue(stream)
    const originalVideo = container.querySelector('video')

    await act(async () => {
      click(buttonByName(container, 'Allow camera'))
      await flushPromises()
    })

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(container.querySelector('h1')?.textContent).toBe('Load your tracks')
    expect(container.querySelector('video')).toBe(originalVideo)
    expect(container.textContent).toContain('Camera ready')
    expect(container.textContent).toContain('Deck B is optional')
  })

  it('uses the trusted Start performance click to unlock sound and syncs reversibly', async () => {
    await loadDemoSet()
    expect(container.textContent).toContain('Neon Pulse')
    expect(container.textContent).toContain('Midnight Circuit')
    expect(container.querySelectorAll('.uv-track-slot.loaded')).toHaveLength(2)
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()

    expect(await enterPerformance()).toBe(2)

    expect(container.querySelectorAll('.uv-waveform')).toHaveLength(2)
    expect(container.querySelectorAll('.uv-performance-target')).toHaveLength(8)
    expect(container.querySelector('[aria-label="Deck A hand control"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Deck B hand control"]')).toBeTruthy()
    expect(container.querySelectorAll('button[aria-label="Toggle BPM Sync"]')).toHaveLength(1)
    expect(container.textContent).not.toContain('Crossfader')
    expect(container.textContent).not.toContain('Full mixer')

    const sync = container.querySelector<HTMLButtonElement>('button[aria-label="Toggle BPM Sync"]')
    if (!sync) throw new Error('BPM Sync was not rendered.')
    await act(async () => click(sync))
    expect(sync.getAttribute('aria-pressed')).toBe('true')
    expect(sync.textContent).toContain('LOCKED')
    expect(sync.getAttribute('title')).toContain('Deck B follows Deck A at 120.0 BPM')
    await act(async () => click(sync))
    expect(sync.getAttribute('aria-pressed')).toBe('false')
    expect(sync.textContent).toContain('READY')
    expect(sync.getAttribute('title')).toBe('Original BPMs restored')
  })

  it('locks navigation and track replacement while performance audio is starting', async () => {
    await loadDemoSet()
    let releasePlayback!: () => void
    const playbackGate = new Promise<void>((resolve) => {
      releasePlayback = resolve
    })
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      mediaPaused.set(this, false)
      this.dispatchEvent(new Event('play'))
      return playbackGate
    })

    await act(async () => {
      click(buttonByName(container, 'Start performance'))
      await flushPromises(2)
    })

    expect(buttonByName(container, 'Enabling sound…')).toHaveProperty('disabled', true)
    expect(buttonByName(container, 'Try demo tracks')).toHaveProperty('disabled', true)
    expect(buttonByName(container, 'Replace Deck A')).toHaveProperty('disabled', true)
    expect(buttonByName(container, 'Replace Deck B')).toHaveProperty('disabled', true)
    expect(flowStepButton(container, 'Camera').disabled).toBe(true)
    expect(flowStepButton(container, 'Load Tracks').disabled).toBe(true)
    expect(flowStepButton(container, 'Perform').disabled).toBe(true)

    await act(async () => {
      releasePlayback()
      await flushPromises()
    })
    expect(container.querySelector('h1')?.textContent).toBe('Perform with your hands')
  })

  it('allows one local track to continue while keeping Deck B and BPM Sync optional', async () => {
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!fileInput) throw new Error('Deck A file input was not rendered.')
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['single'], 'single-track.mp3', { type: 'audio/mpeg' })],
    })
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await flushPromises()
    })
    await act(async () => click(flowStepButton(container, 'Load Tracks')))
    expect(container.textContent).toContain('Deck B · optional')
    expect((buttonByName(container, 'Start performance') as HTMLButtonElement).disabled).toBe(false)
    expect(await enterPerformance()).toBe(1)
    const [deckA] = [...container.querySelectorAll('audio')]
    expect(deckA.paused).toBe(false)
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="Play Deck A"]')?.disabled)
      .toBe(false)
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="Play Deck B"]')?.disabled)
      .toBe(true)
  })

  it('keeps CUE separate from PLAY and returns only the selected deck to the start', async () => {
    await loadDemoSet()
    await enterPerformance()
    const [deckA, deckB] = [...container.querySelectorAll('audio')]
    Object.defineProperty(deckA, 'currentTime', { configurable: true, writable: true, value: 42 })
    Object.defineProperty(deckB, 'currentTime', { configurable: true, writable: true, value: 17 })

    const playA = container.querySelector<HTMLButtonElement>('button[aria-label^="Play Deck A"]')
    const cueA = container.querySelector<HTMLButtonElement>('button[aria-label^="Cue Deck A"]')
    if (!playA || !cueA) throw new Error('Deck A transport targets were not rendered.')

    expect(deckA.paused).toBe(false)
    await act(async () => click(playA))
    expect(deckA.paused).toBe(true)
    await act(async () => {
      click(playA)
      await Promise.resolve()
    })
    expect(deckA.paused).toBe(false)
    await act(async () => click(cueA))
    expect(deckA.paused).toBe(true)
    expect(deckA.currentTime).toBe(0)
    expect(deckB.currentTime).toBe(17)
    expect(container.textContent).toContain('VOLUME')
    expect(container.textContent).toContain('FILTER')
  })

  it('keeps Deck A and Deck B hand controls independent from each other and transport', async () => {
    await loadDemoSet()
    await enterPerformance()

    const volumeA = container.querySelector<HTMLButtonElement>('[data-air-target="volume-a"]')
    const filterA = container.querySelector<HTMLButtonElement>('[data-air-target="filter-a"]')
    const volumeB = container.querySelector<HTMLButtonElement>('[data-air-target="volume-b"]')
    const filterB = container.querySelector<HTMLButtonElement>('[data-air-target="filter-b"]')
    const cueB = container.querySelector<HTMLButtonElement>('button[aria-label^="Cue Deck B"]')
    if (!volumeA || !filterA || !volumeB || !filterB || !cueB) {
      throw new Error('Independent performance controls were not rendered.')
    }

    expect(volumeA.getAttribute('aria-pressed')).toBe('true')
    expect(filterA.getAttribute('aria-pressed')).toBe('false')
    expect(volumeB.getAttribute('aria-pressed')).toBe('false')
    expect(filterB.getAttribute('aria-pressed')).toBe('true')

    await act(async () => click(filterA))
    expect(volumeA.getAttribute('aria-pressed')).toBe('false')
    expect(filterA.getAttribute('aria-pressed')).toBe('true')
    expect(filterB.getAttribute('aria-pressed')).toBe('true')

    await act(async () => click(volumeB))
    expect(filterA.getAttribute('aria-pressed')).toBe('true')
    expect(volumeB.getAttribute('aria-pressed')).toBe('true')
    expect(filterB.getAttribute('aria-pressed')).toBe('false')

    await act(async () => click(cueB))
    expect(filterA.getAttribute('aria-pressed')).toBe('true')
    expect(volumeB.getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps BPM Sync honest when only one deck is available', async () => {
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!fileInput) throw new Error('Deck A file input was not rendered.')
    const file = new File(['single'], 'single-track.mp3', { type: 'audio/mpeg' })
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] })

    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await flushPromises()
    })
    await act(async () => click(flowStepButton(container, 'Load Tracks')))
    await enterPerformance()

    const sync = container.querySelector<HTMLButtonElement>('.uv-bpm-sync')
    expect(sync?.disabled).toBe(true)
    expect(sync?.getAttribute('aria-label')).toContain('Load Deck B')
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="Play Deck B"]')?.disabled)
      .toBe(true)
  })

  it('shows a recoverable camera error and retries without losing the flow', async () => {
    const { stream, track } = createStream()
    getUserMedia
      .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      .mockResolvedValueOnce(stream)

    await act(async () => {
      click(buttonByName(container, 'Allow camera'))
      await flushPromises()
    })
    expect(container.textContent).toContain('Camera permission was blocked')
    expect(buttonByName(container, 'Retry camera')).toBeTruthy()

    await act(async () => {
      click(buttonByName(container, 'Retry camera'))
      await flushPromises()
    })
    expect(container.querySelector('h1')?.textContent).toBe('Load your tracks')
    expect(getUserMedia).toHaveBeenCalledTimes(2)

    await act(async () => click(flowStepButton(container, 'Camera')))
    await act(async () => click(buttonByName(container, 'Continue to tracks')))
    expect(container.querySelector('h1')?.textContent).toBe('Load your tracks')
    await act(async () => click(buttonByName(container, 'Vision')))
    await act(async () => click(buttonByName(container, 'Stop camera')))
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('keeps one camera stream alive when moving between DJ Room and Vision', async () => {
    const { stream, track } = createStream()
    getUserMedia.mockResolvedValue(stream)
    await act(async () => click(buttonByName(container, 'Vision')))
    await act(async () => {
      click(buttonByName(container, 'Start camera'))
      await flushPromises()
    })
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    await act(async () => click(buttonByName(container, 'DJ Room')))
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Camera ready')

    await act(async () => click(buttonByName(container, 'Vision')))
    await act(async () => click(buttonByName(container, 'Stop camera')))
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('cancels pending demo generation when the performer leaves DJ Room', async () => {
    let generationSignal: AbortSignal | undefined
    bundledDemo.loadBundledDemoTracks.mockImplementationOnce(
      ({ signal }: { signal?: AbortSignal }) => new Promise((_, reject) => {
        generationSignal = signal
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    )

    await act(async () => {
      click(buttonByName(container, 'Use demo instead'))
      animationQueue.shift()?.(16)
      await flushPromises()
    })
    expect(generationSignal?.aborted).toBe(false)
    await act(async () => {
      click(buttonByName(container, 'Vision'))
      await flushPromises(4)
    })
    expect(generationSignal?.aborted).toBe(true)
  })
})
