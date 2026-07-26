/** @vitest-environment jsdom */

import { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDjMixer } from './useDjMixer'

const demoAudio = vi.hoisted(() => ({
  createDemoTracksCooperatively: vi.fn(),
}))

vi.mock('../lib/demoAudio', () => ({
  createDemoTracksCooperatively: demoAudio.createDemoTracksCooperatively,
}))

type Mixer = ReturnType<typeof useDjMixer>

function Harness({ onUpdate }: { onUpdate: (mixer: Mixer) => void }) {
  const mixer = useDjMixer()
  useLayoutEffect(() => {
    onUpdate(mixer)
  })
  return null
}

function demoTracks() {
  return [
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
  ] as const
}

function createAudioElement() {
  return Object.assign(new EventTarget(), {
    currentTime: 0,
    duration: 180,
    load: vi.fn(),
    loop: false,
    pause: vi.fn(),
    paused: true,
    playbackRate: 1,
    play: vi.fn(() => Promise.resolve()),
    preservesPitch: true,
    src: '',
  }) as unknown as HTMLAudioElement
}

describe('DJ mixer demo generation lifecycle', () => {
  let container: HTMLDivElement
  let current: Mixer
  let mounted: boolean
  let root: Root

  beforeEach(async () => {
    demoAudio.createDemoTracksCooperatively.mockReset()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        queueMicrotask(() => callback(performance.now()))
        return 1
      }),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    root = createRoot(container)
    mounted = true
    await act(async () => {
      root.render(<Harness onUpdate={(mixer) => (current = mixer)} />)
    })
  })

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('reports generation failure and clears the in-flight guard for retry', async () => {
    demoAudio.createDemoTracksCooperatively
      .mockRejectedValueOnce(new Error('Synthesis failed'))
      .mockRejectedValueOnce(new Error('Retry failed'))

    let firstResult = true
    await act(async () => {
      firstResult = await current.loadDemoMix()
    })
    expect(firstResult).toBe(false)
    expect(current.demoLoading).toBe(false)
    expect(current.gestureStatus).toBe('The demo set could not be built · try again')

    let retryResult = true
    await act(async () => {
      retryResult = await current.loadDemoMix()
    })
    expect(retryResult).toBe(false)
    expect(demoAudio.createDemoTracksCooperatively).toHaveBeenCalledTimes(2)
  })

  it('keeps generated-track loading failure distinct from synthesis failure', async () => {
    demoAudio.createDemoTracksCooperatively.mockResolvedValueOnce(demoTracks())

    let result = true
    await act(async () => {
      result = await current.loadDemoMix()
    })

    expect(result).toBe(false)
    expect(current.demoLoading).toBe(false)
    expect(current.gestureStatus).toBe('The demo set could not load · try again')
  })

  it('loads the same named looping demo tracks after cooperative generation', async () => {
    const audioA = createAudioElement()
    const audioB = createAudioElement()
    current.setAudioElement('a', audioA)
    current.setAudioElement('b', audioB)
    demoAudio.createDemoTracksCooperatively.mockResolvedValueOnce(demoTracks())

    expect(demoAudio.createDemoTracksCooperatively).not.toHaveBeenCalled()
    let result = false
    await act(async () => {
      result = await current.loadDemoMix()
    })

    expect(result).toBe(true)
    expect(current.demoLoading).toBe(false)
    expect(current.decks.a).toMatchObject({
      bpm: 120,
      loaded: true,
      name: 'Neon Pulse',
    })
    expect(current.decks.b).toMatchObject({
      bpm: 126,
      loaded: true,
      name: 'Midnight Circuit',
    })
    expect(audioA.loop).toBe(true)
    expect(audioB.loop).toBe(true)
    expect(current.gestureStatus).toBe(
      'Demo set loaded · press Start both, then open your hand',
    )
  })

  it('rejects a duplicate request and aborts cooperative work on unmount', async () => {
    let generationSignal: AbortSignal | undefined
    demoAudio.createDemoTracksCooperatively.mockImplementationOnce(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          generationSignal = signal
          if (signal?.aborted) {
            reject(signal.reason)
            return
          }
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )

    let pendingResult!: Promise<boolean>
    let duplicateResult!: boolean
    await act(async () => {
      pendingResult = current.loadDemoMix()
      duplicateResult = await current.loadDemoMix()
      for (let index = 0; index < 6; index += 1) await Promise.resolve()
    })

    expect(duplicateResult).toBe(false)
    expect(demoAudio.createDemoTracksCooperatively).toHaveBeenCalledOnce()
    expect(generationSignal?.aborted).toBe(false)

    let result = true
    await act(async () => {
      root.unmount()
      mounted = false
      result = await pendingResult
    })

    expect(result).toBe(false)
    expect(generationSignal?.aborted).toBe(true)
  })

  it('lets a newer manual track choice supersede pending demo generation', async () => {
    const audioA = createAudioElement()
    current.setAudioElement('a', audioA)
    let generationSignal: AbortSignal | undefined
    demoAudio.createDemoTracksCooperatively.mockImplementationOnce(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          generationSignal = signal
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )

    let pendingDemo!: Promise<boolean>
    await act(async () => {
      pendingDemo = current.loadDemoMix()
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
    expect(generationSignal?.aborted).toBe(false)

    let manualResult = false
    let demoResult = true
    await act(async () => {
      manualResult = await current.loadFile(
        'a',
        new File(['mine'], 'my-track.wav', { type: 'audio/wav' }),
        { knownBpm: 128, title: 'My Track' },
      )
      demoResult = await pendingDemo
    })

    expect(manualResult).toBe(true)
    expect(demoResult).toBe(false)
    expect(generationSignal?.aborted).toBe(true)
    expect(current.demoLoading).toBe(false)
    expect(current.decks.a).toMatchObject({
      bpm: 128,
      loaded: true,
      name: 'My Track',
    })
    expect(audioA.src).toBe('blob:my-track.wav')
  })
})
