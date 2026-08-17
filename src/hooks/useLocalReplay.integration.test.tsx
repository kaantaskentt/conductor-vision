/** @vitest-environment jsdom */

import { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocalReplay } from './useLocalReplay'

type ReplayHook = ReturnType<typeof useLocalReplay>

class FakeRecorder {
  static instances: FakeRecorder[] = []
  readonly mimeType = 'audio/webm;codecs=opus'
  state: RecordingState = 'inactive'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onstop: ((event: Event) => void) | null = null
  start = vi.fn(() => {
    this.state = 'recording'
  })
  stop = vi.fn(() => {
    this.state = 'inactive'
  })

  constructor() {
    FakeRecorder.instances.push(this)
  }

  static isTypeSupported(type: string) {
    return type === 'audio/webm;codecs=opus'
  }

  emitData(data: Blob) {
    this.ondataavailable?.({ data } as BlobEvent)
  }

  emitStop() {
    this.onstop?.(new Event('stop'))
  }
}

function createCapture() {
  const track = Object.assign(new EventTarget(), {
    kind: 'audio',
    readyState: 'live' as MediaStreamTrackState,
  }) as unknown as MediaStreamTrack
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream
  return { stream, release: vi.fn() }
}

function Harness({
  createMasterCapture,
  onUpdate,
}: {
  createMasterCapture: () => Promise<ReturnType<typeof createCapture>>
  onUpdate: (value: ReplayHook) => void
}) {
  const replay = useLocalReplay({ createMasterCapture })
  useLayoutEffect(() => onUpdate(replay))
  return null
}

describe('useLocalReplay', () => {
  let container: HTMLDivElement
  let root: Root
  let current: ReplayHook
  const revoked: string[] = []

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    FakeRecorder.instances = []
    revoked.length = 0
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:hook-recording'),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('stops a local recording when the tab hides and exposes preview/download state', async () => {
    const capture = createCapture()
    await act(async () => {
      root.render(
        <Harness
          createMasterCapture={async () => capture}
          onUpdate={(value) => { current = value }}
        />,
      )
    })

    await act(async () => {
      expect(await current.start()).toBe(true)
    })
    expect(current.status).toBe('recording')
    expect(current.label).toContain('Audio-only master mix')
    FakeRecorder.instances[0].emitData(new Blob(['mix'], { type: 'audio/webm' }))

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(FakeRecorder.instances[0].stop).toHaveBeenCalledOnce()
    act(() => FakeRecorder.instances[0].emitStop())

    expect(current.status).toBe('preview')
    expect(current.artifact?.stopReason).toBe('tab-hidden')
    expect(current.download).toEqual({
      url: 'blob:hook-recording',
      filename: expect.stringMatching(/^ultra-vision-master-mix_.*\.webm$/),
    })
  })

  it('releases an active master tap on unmount without producing a stale preview', async () => {
    const capture = createCapture()
    await act(async () => {
      root.render(
        <Harness
          createMasterCapture={async () => capture}
          onUpdate={(value) => { current = value }}
        />,
      )
    })
    await act(async () => {
      await current.start()
    })

    act(() => root.unmount())
    expect(FakeRecorder.instances[0].stop).toHaveBeenCalledOnce()
    expect(capture.release).toHaveBeenCalledOnce()
    expect(revoked).toEqual([])
  })
})
