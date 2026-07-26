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
const demoAudio = vi.hoisted(() => ({
  createDemoTracksCooperatively: vi.fn(),
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

vi.mock('./lib/demoAudio', () => ({
  createDemoTracksCooperatively: demoAudio.createDemoTracksCooperatively,
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
    demoAudio.createDemoTracksCooperatively.mockReset()
    demoAudio.createDemoTracksCooperatively.mockResolvedValue([
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
      click(buttonByName(container, 'Load instant demo'))
      animationQueue.shift()?.(16)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
  }

  async function openAirControls() {
    const details = container.querySelector<HTMLDetailsElement>('.gesture-control-disclosure')
    const summary = details?.querySelector('summary')
    if (!details || !summary) throw new Error('Air Controls disclosure was not rendered.')
    await act(async () => click(summary))
    expect(details.open).toBe(true)
  }

  it('loads the instant demo, keeps controls usable, and preserves the mix across tabs', async () => {
    expect(container.querySelector('h1')?.textContent).toBe('Mix with your hands.')
    expect(container.querySelector('.air-mix-backdrop')).toBeNull()
    expect((buttonByName(container, 'Start both') as HTMLButtonElement).disabled).toBe(true)

    await loadDemoSet()

    expect(container.querySelector('#air-mix-title')?.textContent).toContain('Neon Pulse')
    expect(container.querySelector('#air-mix-title')?.textContent).toContain('mixed with')
    expect(container.querySelector('#air-mix-title')?.textContent).toContain('Midnight Circuit')
    expect(container.querySelector('.air-mix-meta')?.textContent).toContain(
      'Playheads A 00:00 · B 00:00',
    )
    expect(container.querySelector('.air-mix-backdrop img')?.getAttribute('alt')).toBe('')
    expect(container.querySelector('.air-mix-backdrop img')?.getAttribute('draggable')).toBe('false')
    expect(container.querySelectorAll('.air-mix-stage-waveform > div')).toHaveLength(2)
    expect(container.querySelectorAll('button[aria-label="Toggle BPM Sync"]')).toHaveLength(1)
    expect(container.textContent).toContain('Neon Pulse')
    expect(container.textContent).toContain('Midnight Circuit')
    expect(container.textContent).toContain('Two decks ready')
    expect((buttonByName(container, 'Start both') as HTMLButtonElement).disabled).toBe(false)
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(
      [...container.querySelectorAll('.first-mix-progress li')].map((step) => step.className),
    ).toEqual(['complete', 'active', 'pending'])
    expect(container.textContent).toContain('Tracks ready. Start the performance.')
    expect(buttonByName(container, 'Start performance')).toBeTruthy()
    expect(container.querySelector('.performance-bar')).toBeTruthy()
    const deckAMeter = container.querySelector('meter[aria-label="Deck A audio level"]')
    const masterAMeter = container.querySelector(
      'meter[aria-label="Deck A master audio level"]',
    )
    expect(deckAMeter?.getAttribute('min')).toBe('0')
    expect(deckAMeter?.getAttribute('max')).toBe('100')
    expect(deckAMeter?.getAttribute('value')).toBe('0')
    expect(masterAMeter?.getAttribute('value')).toBe('0')

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
    expect(container.textContent).toContain('Start with the instant demo')
    expect(container.textContent).toContain('Load tracks')
    expect(buttonByName(container, 'Load instant demo')).toBeTruthy()
    expect(
      [...container.querySelectorAll('.first-mix-progress li')].map((step) => step.className),
    ).toEqual(['active', 'pending', 'pending'])

    const waveforms = [...container.querySelectorAll('.deck-waveform')]
    expect(waveforms).toHaveLength(2)
    expect(waveforms.every((waveform) => waveform.children.length === 44)).toBe(true)

    const trackTools = [...container.querySelectorAll<HTMLDetailsElement>('.deck-tools')]
    expect(trackTools).toHaveLength(2)
    expect(trackTools.every((details) => !details.open)).toBe(true)

    const airControls = container.querySelector<HTMLDetailsElement>('.gesture-control-disclosure')
    expect(airControls?.open).toBe(false)

    expect(container.querySelectorAll('.gesture-modes button')).toHaveLength(3)
    expect(container.querySelector<HTMLButtonElement>('.gesture-modes button.active')?.textContent)
      .toBe('Crossfader')
    expect(container.querySelector('.panel-heading strong')?.textContent).toContain(
      'Master · Crossfader',
    )
    expect(container.querySelector('[aria-label="Gesture deck target"]')).toBeNull()
    expect(container.querySelector('.gesture-route-note')?.textContent).toContain(
      'master mix between both decks',
    )
    expect(container.querySelector('.gesture-status')?.hasAttribute('aria-live')).toBe(false)
    expect(container.querySelector('.gesture-status strong')?.textContent).toBe(
      'Start the camera to use Air Controls',
    )
    expect(container.querySelectorAll('output[aria-live="polite"]')).toHaveLength(1)
    expect(container.querySelector('output[aria-live="polite"]')?.textContent).toContain(
      'First mix: Start with the instant demo',
    )
  })

  it('launches music and camera together from the two-step first-mix path', async () => {
    const { stream, track } = createStream()
    getUserMedia.mockResolvedValue(stream)
    await loadDemoSet()

    await act(async () => {
      click(buttonByName(container, 'Start performance'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect([...container.querySelectorAll('audio')].every((audio) => !audio.paused)).toBe(true)
    expect(buttonByName(container, 'Stop camera')).toBeTruthy()
    expect(container.textContent).toContain('Raise one open palm')

    const pauseMix = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Pause both decks from performance bar"]',
    )
    if (!pauseMix) throw new Error('Quick Pause mix was not rendered.')
    await act(async () => click(pauseMix))
    expect(buttonByName(container, 'Start music')).toBeTruthy()

    await act(async () => {
      click(buttonByName(container, 'Start music'))
      await Promise.resolve()
    })
    expect([...container.querySelectorAll('audio')].every((audio) => !audio.paused)).toBe(true)

    await act(async () => click(buttonByName(container, 'Stop camera')))
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('keeps camera controls honest when the browser blocks audio autoplay', async () => {
    const { stream, track } = createStream()
    getUserMedia.mockResolvedValue(stream)
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new DOMException('Autoplay blocked', 'NotAllowedError'),
    )
    await loadDemoSet()

    await act(async () => {
      click(buttonByName(container, 'Start performance'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(buttonByName(container, 'Stop camera')).toBeTruthy()
    expect(buttonByName(container, 'Start music')).toBeTruthy()
    expect(container.textContent).toContain('Hand controls ready. Start the music.')
    expect([...container.querySelectorAll('audio')].every((audio) => audio.paused)).toBe(true)

    await act(async () => click(buttonByName(container, 'Stop camera')))
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('reveals deck routing only for deck controls and keeps Shift as keyboard fine control', async () => {
    await openAirControls()
    await act(async () => click(buttonByName(container, 'Volume')))

    expect(container.querySelector('[aria-label="Gesture deck target"]')).toBeTruthy()
    expect(container.querySelector('.panel-heading strong')?.textContent).toContain(
      'Deck A · Volume',
    )

    const level = container.querySelector<HTMLInputElement>(
      'input[aria-label="Deck A channel level"]',
    )
    if (!level) throw new Error('Deck A level was not rendered.')

    await act(async () => {
      level.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    })
    expect(level.value).toBe('87')

    await act(async () => {
      level.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        shiftKey: true,
        bubbles: true,
      }))
    })
    expect(level.value).toBe('86')
  })

  it('toggles BPM Sync reversibly from the user-facing control', async () => {
    await loadDemoSet()
    const sync = container.querySelector<HTMLButtonElement>('.performance-sync')
    if (!sync) throw new Error('BPM Sync was not rendered.')
    expect(container.querySelectorAll('button[aria-label="Toggle BPM Sync"]')).toHaveLength(1)
    const status = container.querySelector<HTMLElement>('.bpm-sync-status')
    if (!status) throw new Error('BPM Sync status was not rendered.')
    expect(status.textContent).toContain('OFF')

    await act(async () => click(sync))
    expect(sync.getAttribute('aria-pressed')).toBe('true')
    expect(sync.textContent).toContain('BPM matched')
    expect(status.textContent).toContain('ON')
    expect(status.textContent).toContain('BPM matched')
    expect(container.querySelector('.air-mix-meta')?.textContent).toContain(
      '120 BPM · TEMPO MATCH',
    )
    expect(container.textContent).toContain(
      'Tempo matched to 120.0 BPM · align the downbeat manually',
    )
    expect(container.textContent).toContain('Deck B follows Deck A at 120.0 BPM')

    await act(async () => click(sync))
    expect(sync.getAttribute('aria-pressed')).toBe('false')
    expect(status.textContent).toContain('OFF')
    expect(container.textContent).toContain('Original BPMs restored')
  })

  it('starts both demo decks and pauses them again through the master control', async () => {
    await loadDemoSet()
    expect([...container.querySelectorAll('audio')].every((audio) => audio.loop)).toBe(true)

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

  it('cancels pending demo generation when the performer leaves DJ Room', async () => {
    let generationSignal: AbortSignal | undefined
    demoAudio.createDemoTracksCooperatively.mockImplementationOnce(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          generationSignal = signal
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )

    await act(async () => {
      click(buttonByName(container, 'Load instant demo'))
      animationQueue.shift()?.(16)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
    expect(generationSignal?.aborted).toBe(false)

    await act(async () => {
      click(buttonByName(container, 'Vision'))
      for (let index = 0; index < 4; index += 1) await Promise.resolve()
    })

    expect(generationSignal?.aborted).toBe(true)
    expect(container.querySelector('h1')?.textContent).toBe(
      'See what the camera understands.',
    )
  })

  it('keeps the essential manual mix controls together in the performance bar', async () => {
    await loadDemoSet()

    await act(async () => {
      click(buttonByName(container, 'Play without camera'))
      await Promise.resolve()
    })
    expect(getUserMedia).not.toHaveBeenCalled()
    expect([...container.querySelectorAll('audio')].every((audio) => !audio.paused)).toBe(true)

    const bar = container.querySelector<HTMLElement>('.performance-bar')
    const quickFader = bar?.querySelector<HTMLInputElement>(
      'input[aria-label="Quick master crossfader"]',
    )
    const mainFader = container.querySelector<HTMLInputElement>(
      'input[aria-label="Master crossfader"]',
    )
    if (!bar || !quickFader || !mainFader) throw new Error('Performance controls were not rendered.')

    const quickSync = bar.querySelector<HTMLButtonElement>('.performance-sync')
    if (!quickSync) throw new Error('Quick BPM Sync was not rendered.')
    await act(async () => click(quickSync))
    expect(quickSync.getAttribute('aria-pressed')).toBe('true')

    await act(async () => setRangeValue(quickFader, '64'))
    expect(quickFader.value).toBe('64')
    expect(mainFader.value).toBe('64')

    const center = [...bar.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Center',
    )
    if (!center) throw new Error('Quick crossfader Center was not rendered.')
    await act(async () => click(center))
    expect(quickFader.value).toBe('0')
    expect(mainFader.value).toBe('0')

    const pauseMix = bar.querySelector<HTMLButtonElement>(
      'button[aria-label="Pause both decks from performance bar"]',
    )
    if (!pauseMix) throw new Error('Quick Pause mix was not rendered.')
    await act(async () => click(pauseMix))
    expect([...container.querySelectorAll('audio')].every((audio) => audio.paused)).toBe(true)
  })

  it('keeps one local camera stream alive across both rooms and stops it explicitly', async () => {
    const { stream, track } = createStream()
    getUserMedia.mockResolvedValue(stream)
    await loadDemoSet()

    await act(async () => {
      click(buttonByName(container, 'Start performance'))
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
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    })
    expect(animationQueue.length).toBeGreaterThanOrEqual(1)

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

  it('starts hand tracking without waiting for optional face analysis', async () => {
    const { stream, track } = createStream()
    getUserMedia.mockResolvedValue(stream)
    let resolveFace!: (landmarker: {
      detectForVideo: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    }) => void
    const faceLandmarker = new Promise<{
      detectForVideo: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    }>((resolve) => {
      resolveFace = resolve
    })
    mediaPipe.createFace.mockReset().mockReturnValueOnce(faceLandmarker)

    await act(async () => click(buttonByName(container, 'Vision')))
    await act(async () => {
      click(buttonByName(container, 'Start camera'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(buttonByName(container, 'Stop camera')).toBeTruthy()
    expect(container.textContent).toContain('Hand tracking live · loading face tracking…')
    expect(mediaPipe.createFace).toHaveBeenCalledTimes(1)
    expect(mediaPipe.createFace.mock.results[0]?.value).toBe(faceLandmarker)

    const detectFace = vi.fn(() => {
      throw new Error('Optional face analysis failed.')
    })
    await act(async () => {
      resolveFace({
        detectForVideo: detectFace,
        close: vi.fn(),
      })
      await faceLandmarker
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Live. Camera frames stay in this browser tab.')
    const video = container.querySelector('video')
    if (!video) throw new Error('Vision camera view was not rendered.')
    Object.defineProperties(video, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_ENOUGH_DATA },
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 360 },
    })
    for (let frame = 1; frame <= 3 && detectFace.mock.calls.length === 0; frame += 1) {
      Object.defineProperty(video, 'currentTime', {
        configurable: true,
        value: frame / 30,
      })
      await act(async () => {
        animationQueue.shift()?.(performance.now() + frame * 34)
        await Promise.resolve()
      })
    }
    expect(detectFace).toHaveBeenCalledOnce()
    expect(buttonByName(container, 'Stop camera')).toBeTruthy()
    expect(container.textContent).toContain(
      'Hand tracking is live. Face analysis paused; restart the camera to retry it.',
    )

    await act(async () => click(buttonByName(container, 'Stop camera')))
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('preserves a manually adjusted filter when camera input was never engaged', async () => {
    const firstCamera = createStream()
    const secondCamera = createStream()
    const thirdCamera = createStream()
    getUserMedia
      .mockResolvedValueOnce(firstCamera.stream)
      .mockResolvedValueOnce(secondCamera.stream)
      .mockResolvedValueOnce(thirdCamera.stream)
    await loadDemoSet()
    await openAirControls()
    await act(async () => click(buttonByName(container, 'Filter')))

    const filter = container.querySelector<HTMLInputElement>(
      'input[aria-label="Deck A bipolar filter"]',
    )
    if (!filter) throw new Error('Deck A filter was not rendered.')

    await act(async () => {
      click(buttonByName(container, 'Start performance'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => setRangeValue(filter, '84'))
    expect(filter.value).toBe('84')

    await act(async () => click(buttonByName(container, 'Stop camera')))
    expect(filter.value).toBe('84')

    await act(async () => {
      click(buttonByName(container, 'Turn on hand controls'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => setRangeValue(filter, '76'))
    expect(filter.value).toBe('76')

    await act(async () => secondCamera.track.dispatch('ended'))
    expect(filter.value).toBe('76')
    expect(container.textContent).toContain('The camera stopped unexpectedly')

    await act(async () => {
      click(buttonByName(container, 'Retry camera'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => setRangeValue(filter, '68'))
    expect(filter.value).toBe('68')

    await act(async () => click(buttonByName(container, 'Vision')))
    await act(async () => click(buttonByName(container, 'DJ Room')))
    expect(container.querySelector<HTMLInputElement>(
      'input[aria-label="Deck A bipolar filter"]',
    )?.value).toBe('68')
  })

  it('announces camera preparation while model loading is still in progress', async () => {
    const { stream, track } = createStream()
    let resolveHandModel: ((value: unknown) => void) | undefined
    mediaPipe.createHand.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveHandModel = resolve
      }),
    )
    getUserMedia.mockResolvedValue(stream)
    await loadDemoSet()

    await act(async () => {
      click(buttonByName(container, 'Start performance'))
      await Promise.resolve()
    })

    const loadingAnnouncements = [...container.querySelectorAll('[aria-live="polite"]')]
      .map((region) => region.textContent ?? '')
    expect(loadingAnnouncements).toHaveLength(2)
    expect(loadingAnnouncements.filter((text) =>
      text.includes('Loading hand tracking before the camera opens'),
    )).toHaveLength(1)
    expect(loadingAnnouncements.join(' ')).not.toContain('Camera is off')

    await act(async () => {
      resolveHandModel?.({
        detectForVideo: vi.fn(() => ({ landmarks: [], handedness: [] })),
        close: vi.fn(),
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(buttonByName(container, 'Stop camera')).toBeTruthy()
    await act(async () => click(buttonByName(container, 'Stop camera')))
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('explains denied camera access and succeeds after permission is restored', async () => {
    const { stream, track } = createStream()
    getUserMedia
      .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      .mockResolvedValueOnce(stream)
    await loadDemoSet()

    await act(async () => {
      click(buttonByName(container, 'Start performance'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain(
      'Camera permission was blocked. Allow access in your browser, then try again.',
    )
    const errorAnnouncements = [...container.querySelectorAll('[aria-live="polite"]')]
      .map((region) => region.textContent ?? '')
    expect(errorAnnouncements).toHaveLength(2)
    expect(errorAnnouncements.filter((text) => text.includes(
      'Camera permission was blocked. Allow access in your browser, then try again.',
    ))).toHaveLength(1)
    expect(errorAnnouncements.join(' ')).not.toContain('Camera is off')
    expect(buttonByName(container, 'Retry camera')).toBeTruthy()

    await act(async () => {
      click(buttonByName(container, 'Vision'))
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Camera needs attention')
    expect(buttonByName(container, 'Retry camera')).toBeTruthy()

    await act(async () => {
      click(buttonByName(container, 'Retry camera'))
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
