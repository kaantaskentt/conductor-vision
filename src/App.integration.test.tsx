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
    return {
      gain: audioParam(),
      connect: vi.fn(),
    } as unknown as GainNode
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

function click(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function setRangeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Range value setter is unavailable.')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Ultra Vision app golden path', () => {
  let root: Root
  let container: HTMLDivElement
  let scrollIntoView: ReturnType<typeof vi.fn>
  let scrollTo: ReturnType<typeof vi.fn>
  let animationQueue: FrameRequestCallback[]
  let mediaPaused: WeakMap<HTMLMediaElement, boolean>
  let getUserMedia: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    animationQueue = []
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
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
      })),
    })
    scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    scrollTo = vi.fn()
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: scrollTo,
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
      click(buttonByName(container, 'Try demo set'))
      animationQueue.shift()?.(16)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('loads the instant demo, keeps controls usable, and preserves the mix across tabs', async () => {
    expect(container.querySelector('h1')?.textContent).toBe('Mix with your hands.')
    expect((buttonByName(container, 'Start both') as HTMLButtonElement).disabled).toBe(true)

    await loadDemoSet()

    expect(container.textContent).toContain('Neon Pulse')
    expect(container.textContent).toContain('Midnight Circuit')
    expect(container.textContent).toContain('Two decks ready')
    expect((buttonByName(container, 'Start both') as HTMLButtonElement).disabled).toBe(false)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })

    const filter = container.querySelector<HTMLInputElement>(
      'input[aria-label="Deck A bipolar filter"]',
    )
    if (!filter) throw new Error('Deck A filter was not rendered.')
    await act(async () => setRangeValue(filter, '84'))
    expect(filter.value).toBe('84')
    expect(container.textContent).toContain('84% · HP')

    const resetFilter = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reset Deck A bipolar filter"]',
    )
    if (!resetFilter) throw new Error('Deck A filter reset was not rendered.')
    await act(async () => click(resetFilter))
    expect(filter.value).toBe('50')

    await act(async () => click(buttonByName(container, 'Vision')))
    expect(container.querySelector('h1')?.textContent).toBe('See what the camera understands.')
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'auto' })

    const targetColor = container.querySelector<HTMLSelectElement>('select')
    if (!targetColor) throw new Error('Target color picker was not rendered.')
    await act(async () => {
      targetColor.value = 'red'
      targetColor.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.textContent).toContain('red coverage')

    await act(async () => click(buttonByName(container, 'DJ Room')))
    expect(container.textContent).toContain('Neon Pulse')
    expect(container.querySelector<HTMLInputElement>(
      'input[aria-label="Deck A bipolar filter"]',
    )?.value).toBe('50')
  })

  it('keeps the first-mix path visible while tucking away secondary deck tools', () => {
    expect(container.textContent).toContain('Your first mix')
    expect(container.textContent).toContain('Demo set or local tracks')
    expect(container.textContent).toContain('Move to mix · fist to lock')

    const waveforms = [...container.querySelectorAll('.deck-waveform')]
    expect(waveforms).toHaveLength(2)
    expect(waveforms.every((waveform) => waveform.children.length === 44)).toBe(true)

    const trackTools = [...container.querySelectorAll<HTMLDetailsElement>('.deck-tools')]
    expect(trackTools).toHaveLength(2)
    expect(trackTools.every((details) => !details.open)).toBe(true)

    expect(container.querySelectorAll('.gesture-modes button')).toHaveLength(3)
    expect(container.querySelector<HTMLButtonElement>('.gesture-modes button.active')?.textContent)
      .toBe('Crossfader')
  })

  it('toggles BPM Sync reversibly from the user-facing control', async () => {
    await loadDemoSet()
    const sync = container.querySelector<HTMLButtonElement>('.bpm-sync-toggle')
    if (!sync) throw new Error('BPM Sync was not rendered.')

    await act(async () => click(sync))
    expect(sync.getAttribute('aria-pressed')).toBe('true')
    expect(sync.textContent).toContain('ON')
    expect(container.textContent).toContain('Deck B follows Deck A at 120.0 BPM')

    await act(async () => click(sync))
    expect(sync.getAttribute('aria-pressed')).toBe('false')
    expect(sync.textContent).toContain('OFF')
    expect(container.textContent).toContain('Original BPMs restored')
  })

  it('starts both demo decks and pauses them again through the master control', async () => {
    await loadDemoSet()

    await act(async () => {
      click(buttonByName(container, 'Start both'))
      await Promise.resolve()
    })
    expect(buttonByName(container, 'Pause both')).toBeTruthy()
    expect([...container.querySelectorAll('audio')].every((audio) => !audio.paused)).toBe(true)

    await act(async () => click(buttonByName(container, 'Pause both')))
    expect(buttonByName(container, 'Start both')).toBeTruthy()
    expect([...container.querySelectorAll('audio')].every((audio) => audio.paused)).toBe(true)
  })

  it('keeps one local camera stream alive across both rooms and stops it explicitly', async () => {
    const { stream, track } = createStream()
    getUserMedia.mockResolvedValue(stream)

    await act(async () => {
      click(buttonByName(container, 'Start camera'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(buttonByName(container, 'Stop camera')).toBeTruthy()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia).toHaveBeenCalledWith({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    })
    expect(animationQueue).toHaveLength(1)

    await act(async () => {
      click(buttonByName(container, 'Vision'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(buttonByName(container, 'Stop camera')).toBeTruthy()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Live on device')

    await act(async () => click(buttonByName(container, 'Stop camera')))
    expect(buttonByName(container, 'Start camera')).toBeTruthy()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Camera is off')
  })

  it('explains denied camera access and succeeds after permission is restored', async () => {
    const { stream, track } = createStream()
    getUserMedia
      .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      .mockResolvedValueOnce(stream)

    await act(async () => {
      click(buttonByName(container, 'Start camera'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain(
      'Camera permission was blocked. Allow access in your browser, then try again.',
    )
    expect(buttonByName(container, 'Start camera')).toBeTruthy()

    await act(async () => {
      click(buttonByName(container, 'Start camera'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(buttonByName(container, 'Stop camera')).toBeTruthy()
    expect(getUserMedia).toHaveBeenCalledTimes(2)

    await act(async () => click(buttonByName(container, 'Stop camera')))
    expect(track.stop).toHaveBeenCalledTimes(1)
  })
})
