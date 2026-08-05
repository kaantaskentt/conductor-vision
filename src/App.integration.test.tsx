/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const mediaPipe = vi.hoisted(() => ({
  createHand: vi.fn(),
  resolveFileset: vi.fn(),
}))
const demoAudio = vi.hoisted(() => ({ createDemoTracksCooperatively: vi.fn() }))
const HAND_MODEL_BYTES = 7_819_105
const HAND_MODEL_SHA256 = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1'

function hexBuffer(hex: string) {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16)).buffer
}

vi.mock('@mediapipe/tasks-vision', () => ({
  DrawingUtils: class {},
  FilesetResolver: { forVisionTasks: mediaPipe.resolveFileset },
  HandLandmarker: { HAND_CONNECTIONS: [], createFromOptions: mediaPipe.createHand },
  FaceLandmarker: { FACE_LANDMARKS_TESSELATION: [], createFromOptions: vi.fn() },
}))

vi.mock('./lib/demoAudio', () => ({
  createDemoTracksCooperatively: demoAudio.createDemoTracksCooperatively,
}))

type FakeAudioParam = { value: number; setTargetAtTime: ReturnType<typeof vi.fn> }
const audioParam = (value = 0): FakeAudioParam => ({ value, setTargetAtTime: vi.fn() })

class FakeAudioContext {
  currentTime = 1
  state: AudioContextState = 'running'
  destination = {} as AudioDestinationNode
  createDynamicsCompressor() {
    return {
      threshold: audioParam(), knee: audioParam(), ratio: audioParam(), attack: audioParam(),
      release: audioParam(), connect: vi.fn(), disconnect: vi.fn(),
    } as unknown as DynamicsCompressorNode
  }
  createMediaElementSource() { return { connect: vi.fn() } as unknown as MediaElementAudioSourceNode }
  createBiquadFilter() {
    return { type: 'lowpass', Q: audioParam(), frequency: audioParam(), connect: vi.fn() } as unknown as BiquadFilterNode
  }
  createAnalyser() {
    return {
      fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 32,
      getByteFrequencyData: vi.fn(), connect: vi.fn(),
    } as unknown as AnalyserNode
  }
  createGain() { return { gain: audioParam(), connect: vi.fn() } as unknown as GainNode }
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => { this.state = 'closed' })
}

function createTrack() {
  const listeners = new Map<string, Set<EventListener>>()
  return {
    kind: 'video',
    readyState: 'live',
    stop: vi.fn(),
    addEventListener: vi.fn((name: string, listener: EventListener) => {
      const group = listeners.get(name) ?? new Set<EventListener>()
      group.add(listener)
      listeners.set(name, group)
    }),
    removeEventListener: vi.fn((name: string, listener: EventListener) => listeners.get(name)?.delete(listener)),
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

describe('Ultra Vision camera-first performance flow', () => {
  let root: Root
  let container: HTMLDivElement
  let animationQueue: FrameRequestCallback[]
  let mediaPaused: WeakMap<HTMLMediaElement, boolean>
  let getUserMedia: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    animationQueue = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationQueue.push(callback)
      return animationQueue.length
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('scrollTo', vi.fn())
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(HAND_MODEL_BYTES),
    })))
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn(async () => hexBuffer(HAND_MODEL_SHA256)),
      },
    })
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    mediaPaused = new WeakMap()
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      mediaPaused.set(this, false)
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      mediaPaused.set(this, true)
      this.dispatchEvent(new Event('pause'))
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() { return mediaPaused.get(this) ?? true },
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({
        clearRect: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
        save: vi.fn(), restore: vi.fn(), scale: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
        lineTo: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(),
      })),
    })
    getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    mediaPipe.resolveFileset.mockResolvedValue({})
    mediaPipe.createHand.mockResolvedValue({
      detectForVideo: vi.fn(() => ({ landmarks: [], handedness: [] })),
      close: vi.fn(),
    })
    demoAudio.createDemoTracksCooperatively.mockResolvedValue([
      { bpm: 120, file: new File(['a'], 'neon.wav', { type: 'audio/wav' }), title: 'Neon Pulse' },
      { bpm: 126, file: new File(['b'], 'midnight.wav', { type: 'audio/wav' }), title: 'Midnight Circuit' },
    ])

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(<App />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function moveToTracks() {
    await act(async () => click(buttonByName(container, 'Use mouse controls instead')))
  }

  async function loadDemoSet() {
    await moveToTracks()
    await act(async () => {
      click(buttonByName(container, 'Try generated demo tracks'))
      animationQueue.shift()?.(16)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
  }

  async function openPerformance() {
    await act(async () => click(buttonByName(container, 'Open performance · 2 tracks')))
  }

  it('starts with private camera setup and offers a manual fallback', async () => {
    expect(container.textContent).toContain('Put the music')
    expect(container.textContent).toContain('Frames are never uploaded or stored.')
    expect(buttonByName(container, 'Allow private camera')).toBeTruthy()
    await moveToTracks()
    expect(container.textContent).toContain('You only need one track to enter.')
    expect((buttonByName(container, 'Open performance · 1 track') as HTMLButtonElement).disabled).toBe(true)
  })

  it('allows a single local track to enter performance', async () => {
    await moveToTracks()
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Choose audio for Deck A"]')
    if (!input) throw new Error('Deck A input missing')
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['audio'], 'solo.wav', { type: 'audio/wav' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    expect(container.textContent).toContain('solo')
    const open = buttonByName(container, 'Open performance · 1 track') as HTMLButtonElement
    expect(open.disabled).toBe(false)
    await act(async () => click(open))
    expect(container.querySelector('.uv-performance-stage')).toBeTruthy()
    expect((container.querySelector('[data-air-target="play:b"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('loads generated demo tracks and exposes only play, volume, filter, and sync', async () => {
    await loadDemoSet()
    expect(container.textContent).toContain('Neon Pulse')
    expect(container.textContent).toContain('Midnight Circuit')
    await openPerformance()
    expect(container.querySelectorAll('[data-air-target]')).toHaveLength(7)
    expect(container.querySelector('[data-air-target="play:a"]')).toBeTruthy()
    expect(container.querySelector('[data-air-target="volume:a"]')).toBeTruthy()
    expect(container.querySelector('[data-air-target="filter:a"]')).toBeTruthy()
    expect(container.querySelector('[data-air-target="sync"]')).toBeTruthy()
    expect(container.textContent).not.toContain('Crossfader')
    expect(container.textContent).not.toContain('Tempo')
  })

  it('starts decks independently and keeps BPM matching reversible', async () => {
    await loadDemoSet()
    await openPerformance()
    const playA = container.querySelector<HTMLButtonElement>('[data-air-target="play:a"]')!
    const playB = container.querySelector<HTMLButtonElement>('[data-air-target="play:b"]')!
    const sync = container.querySelector<HTMLButtonElement>('[data-air-target="sync"]')!
    await act(async () => click(playA))
    expect(playA.textContent).toContain('Pause')
    expect(playB.textContent).toContain('Start')
    await act(async () => click(playB))
    await act(async () => click(sync))
    expect(sync.textContent).toContain('BPM matched')
    await act(async () => click(sync))
    expect(sync.textContent).toContain('Match BPM')
  })

  it('progressively reveals accessible manual controls and filter reset', async () => {
    await loadDemoSet()
    await openPerformance()
    expect(container.querySelector('.uv-manual')).toBeNull()
    await act(async () => click(buttonByName(container, 'Manual controls')))
    const sliders = [...container.querySelectorAll<HTMLInputElement>('.uv-manual input[type="range"]')]
    expect(sliders).toHaveLength(4)
    await act(async () => setRangeValue(sliders[1], '80'))
    expect(container.querySelector('.uv-manual')?.textContent).toContain('80% HP')
    await act(async () => click(container.querySelector<HTMLButtonElement>('.uv-manual button')!))
    expect(container.querySelector('.uv-manual')?.textContent).toContain('Neutral')
  })

  it('explains denied camera access without leaving setup', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    await act(async () => {
      click(buttonByName(container, 'Allow private camera'))
      for (let index = 0; index < 5; index += 1) await Promise.resolve()
    })
    expect(container.textContent).toContain('Camera permission was blocked.')
    expect(buttonByName(container, 'Allow private camera')).toBeTruthy()
  })

  it('stops a granted camera explicitly', async () => {
    const { stream, track } = createStream()
    getUserMedia.mockResolvedValueOnce(stream)
    await act(async () => {
      click(buttonByName(container, 'Allow private camera'))
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
    expect(buttonByName(container, 'Camera ready · continue')).toBeTruthy()
    await act(async () => click(buttonByName(container, 'Stop camera')))
    expect(track.stop).toHaveBeenCalledOnce()
  })
})
