import { describe, expect, it, vi } from 'vitest'
import {
  AIR_MIX_REPLAY_FPS,
  AIR_MIX_REPLAY_HARD_MAX_BYTES,
  AIR_MIX_REPLAY_MAX_BYTES,
  AIR_MIX_REPLAY_MAX_DURATION_MS,
  AIR_MIX_REPLAY_TIMESLICE_MS,
  createReplayEngine,
  createReplayFilename,
  detectReplaySupport,
  replayExtensionForMime,
  selectReplayMimeType,
  type ReplayAudioCapture,
  type ReplayPlatform,
} from './airMixReplay'

type FakeTrack = MediaStreamTrack & {
  stop: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  emitEnded: () => void
}

class FakeStream {
  readonly tracks: MediaStreamTrack[]

  constructor(tracks: MediaStreamTrack[]) {
    this.tracks = tracks
  }

  getTracks() {
    return [...this.tracks]
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio')
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video')
  }
}

class FakeRecorder {
  readonly stream: MediaStream
  readonly mimeType: string
  state: RecordingState = 'inactive'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onstop: ((event: Event) => void) | null = null
  start = vi.fn((timeslice?: number) => {
    this.state = 'recording'
    return timeslice
  })
  stop = vi.fn(() => {
    this.state = 'inactive'
  })

  constructor(stream: MediaStream, mimeType: string) {
    this.stream = stream
    this.mimeType = mimeType
  }

  emitData(data: Blob) {
    this.ondataavailable?.({ data } as BlobEvent)
  }

  emitError() {
    this.onerror?.(new Event('error'))
  }

  emitStop() {
    this.onstop?.(new Event('stop'))
  }
}

function createTrack(kind: 'audio' | 'video') {
  const endedListeners = new Set<EventListenerOrEventListenerObject>()
  let readyState: MediaStreamTrackState = 'live'
  const track = {
    kind,
    get readyState() {
      return readyState
    },
    stop: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'ended') endedListeners.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'ended') endedListeners.delete(listener)
    }),
    emitEnded() {
      readyState = 'ended'
      const event = new Event('ended')
      for (const listener of endedListeners) {
        if (typeof listener === 'function') listener(event)
        else listener.handleEvent(event)
      }
    },
  }
  return track as unknown as FakeTrack
}

function createFixture(options: {
  supportedTypes?: string[]
  rejectedTypes?: string[]
  support?: Partial<Pick<ReplayPlatform, 'mediaRecorderSupported' | 'mediaStreamSupported' | 'canvasCaptureSupported' | 'audioCaptureSupported'>>
} = {}) {
  const audioTrack = createTrack('audio')
  const videoTrack = createTrack('video')
  const audioStream = new FakeStream([audioTrack]) as unknown as MediaStream
  const videoStream = new FakeStream([videoTrack]) as unknown as MediaStream
  const release = vi.fn()
  const recorders: FakeRecorder[] = []
  const revokedUrls: string[] = []
  const timers = new Map<number, () => void>()
  let timerId = 0
  let now = 1_000
  let urlId = 0
  const supportedTypes = options.supportedTypes ?? ['video/webm;codecs=vp9,opus']
  const rejectedTypes = new Set(options.rejectedTypes ?? [])

  const platform: ReplayPlatform = {
    mediaRecorderSupported: true,
    mediaStreamSupported: true,
    canvasCaptureSupported: true,
    audioCaptureSupported: true,
    ...options.support,
    createMediaStream: (tracks) => new FakeStream(tracks) as unknown as MediaStream,
    createMediaRecorder: (stream, recorderOptions) => {
      const mimeType = recorderOptions?.mimeType ?? 'video/webm'
      if (rejectedTypes.has(mimeType)) throw new Error('Codec rejected')
      const recorder = new FakeRecorder(stream, mimeType)
      recorders.push(recorder)
      return recorder as unknown as MediaRecorder
    },
    isTypeSupported: (mimeType) => supportedTypes.includes(mimeType),
    createObjectURL: vi.fn(() => `blob:air-mix-${++urlId}`),
    revokeObjectURL: vi.fn((url) => revokedUrls.push(url)),
    now: () => now,
    setTimer: vi.fn((callback) => {
      const id = ++timerId
      timers.set(id, callback)
      return id as unknown as ReturnType<typeof setTimeout>
    }),
    clearTimer: vi.fn((handle) => timers.delete(handle as unknown as number)),
  }
  const captureStream = vi.fn(() => videoStream)
  const canvas = { captureStream } as unknown as HTMLCanvasElement
  const createAudioCapture = vi.fn(
    async (): Promise<ReplayAudioCapture> => ({ stream: audioStream, release }),
  )

  return {
    platform,
    canvas,
    captureStream,
    createAudioCapture,
    release,
    audioTrack,
    videoTrack,
    recorders,
    revokedUrls,
    timers,
    setNow(value: number) {
      now = value
    },
    runNextTimer() {
      const entry = timers.entries().next().value as [number, () => void] | undefined
      if (!entry) throw new Error('No pending timer')
      timers.delete(entry[0])
      entry[1]()
    },
  }
}

describe('Air Mix Replay helpers', () => {
  it('reports every missing browser primitive', () => {
    const fixture = createFixture({
      support: {
        mediaRecorderSupported: false,
        mediaStreamSupported: false,
        canvasCaptureSupported: false,
        audioCaptureSupported: false,
      },
    })
    expect(detectReplaySupport(fixture.platform)).toEqual({
      supported: false,
      missing: ['MediaRecorder', 'MediaStream', 'canvas capture', 'Web Audio capture'],
    })
  })

  it('selects codecs by preference and derives private filenames from the output MIME', () => {
    expect(selectReplayMimeType((type) => type.includes('vp8'))).toBe(
      'video/webm;codecs=vp8,opus',
    )
    expect(selectReplayMimeType(() => false)).toBeNull()
    expect(replayExtensionForMime('video/mp4;codecs=h264')).toBe('mp4')
    expect(replayExtensionForMime('video/webm')).toBe('webm')
    expect(
      createReplayFilename('video/webm', new Date('2026-07-24T12:34:56.000Z')),
    ).toBe('ultra-vision-air-mix_2026-07-24_12-34-56-000.webm')
  })
})

describe('Air Mix Replay recorder', () => {
  it('records exactly one stage video track and one post-master audio track', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)

    await expect(
      engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture }),
    ).resolves.toBe(true)

    const recorder = fixture.recorders[0]
    const stream = recorder.stream as unknown as FakeStream
    expect(fixture.captureStream).toHaveBeenCalledWith(AIR_MIX_REPLAY_FPS)
    expect(stream.getTracks()).toEqual([fixture.videoTrack, fixture.audioTrack])
    expect(recorder.start).toHaveBeenCalledWith(AIR_MIX_REPLAY_TIMESLICE_MS)
    expect(engine.getSnapshot().phase).toBe('recording')

    recorder.emitData(new Blob(['mix'], { type: recorder.mimeType }))
    expect(engine.stop()).toBe(true)
    recorder.emitStop()

    expect(engine.getSnapshot().phase).toBe('ready')
    expect(fixture.videoTrack.stop).toHaveBeenCalledOnce()
    expect(fixture.audioTrack.stop).not.toHaveBeenCalled()
    expect(fixture.release).toHaveBeenCalledOnce()
  })

  it('falls through a falsely advertised codec and uses the next constructable option', async () => {
    const fixture = createFixture({
      supportedTypes: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'],
      rejectedTypes: ['video/webm;codecs=vp9,opus'],
    })
    const engine = createReplayEngine(fixture.platform)

    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })

    expect(fixture.recorders[0].mimeType).toBe('video/webm;codecs=vp8,opus')
  })

  it('preserves chunk order, ignores empty chunks, and finalizes only after stop', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    const recorder = fixture.recorders[0]

    recorder.emitData(new Blob([]))
    recorder.emitData(new Blob(['A']))
    expect(engine.stop()).toBe(true)
    recorder.emitData(new Blob(['B']))
    expect(engine.getSnapshot().artifact).toBeNull()
    recorder.emitStop()

    const artifact = engine.getSnapshot().artifact
    expect(await artifact?.blob.text()).toBe('AB')
    expect(artifact?.url).toBe('blob:air-mix-1')
  })

  it('auto-stops at the monotonic duration deadline with an exact reason', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    await engine.start({
      canvas: fixture.canvas,
      createAudioCapture: fixture.createAudioCapture,
      maxDurationMs: 60_000,
    })
    const recorder = fixture.recorders[0]
    recorder.emitData(new Blob(['mix']))
    fixture.setNow(61_000)

    fixture.runNextTimer()

    expect(recorder.stop).toHaveBeenCalledOnce()
    expect(engine.getSnapshot().phase).toBe('stopping')
    recorder.emitStop()
    expect(engine.getSnapshot().artifact).toMatchObject({
      durationMs: 60_000,
      stopReason: 'max-duration',
    })
  })

  it('coalesces stop races so the encoder is stopped once', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    const recorder = fixture.recorders[0]

    expect(engine.stop()).toBe(true)
    expect(engine.stop('max-duration')).toBe(false)
    expect(recorder.stop).toHaveBeenCalledOnce()
  })

  it('survives synchronous disposal from a stopping-state subscriber', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    const recorder = fixture.recorders[0]
    engine.subscribe(() => {
      if (engine.getSnapshot().phase === 'stopping') engine.dispose()
    })

    expect(engine.stop()).toBe(true)

    expect(engine.getSnapshot().phase).toBe('idle')
    expect(recorder.stop).toHaveBeenCalledOnce()
    expect(fixture.release).toHaveBeenCalledOnce()
  })

  it('does not acquire audio when a starting-state subscriber cancels synchronously', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    engine.subscribe(() => {
      if (engine.getSnapshot().phase === 'starting') engine.stop()
    })

    await expect(
      engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture }),
    ).resolves.toBe(false)

    expect(fixture.createAudioCapture).not.toHaveBeenCalled()
    expect(fixture.captureStream).not.toHaveBeenCalled()
  })

  it('cancels a start while the post-master audio tap is pending', async () => {
    const fixture = createFixture()
    let resolveCapture: ((capture: ReplayAudioCapture) => void) | undefined
    const pendingCapture = new Promise<ReplayAudioCapture>((resolve) => {
      resolveCapture = resolve
    })
    const engine = createReplayEngine(fixture.platform)
    const starting = engine.start({
      canvas: fixture.canvas,
      createAudioCapture: () => pendingCapture,
    })

    expect(engine.getSnapshot().phase).toBe('starting')
    expect(engine.stop()).toBe(true)
    resolveCapture?.({
      stream: new FakeStream([fixture.audioTrack]) as unknown as MediaStream,
      release: fixture.release,
    })

    await expect(starting).resolves.toBe(false)
    expect(fixture.release).toHaveBeenCalledOnce()
    expect(fixture.captureStream).not.toHaveBeenCalled()
    expect(fixture.recorders).toHaveLength(0)
  })

  it('releases the capture tap exactly once when no live audio track is available', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    const emptyCapture = async (): Promise<ReplayAudioCapture> => ({
      stream: new FakeStream([]) as unknown as MediaStream,
      release: fixture.release,
    })

    await expect(
      engine.start({ canvas: fixture.canvas, createAudioCapture: emptyCapture }),
    ).resolves.toBe(false)

    expect(engine.getSnapshot().error?.code).toBe('audio-unavailable')
    expect(fixture.release).toHaveBeenCalledOnce()
  })

  it('releases the capture tap exactly once when no live stage video track is available', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    const emptyCanvas = {
      captureStream: vi.fn(() => new FakeStream([]) as unknown as MediaStream),
    } as unknown as HTMLCanvasElement

    await expect(
      engine.start({ canvas: emptyCanvas, createAudioCapture: fixture.createAudioCapture }),
    ).resolves.toBe(false)

    expect(engine.getSnapshot().error?.code).toBe('canvas-unavailable')
    expect(fixture.release).toHaveBeenCalledOnce()
  })

  it('classifies a rejected post-master tap as an audio availability failure', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)

    await expect(
      engine.start({
        canvas: fixture.canvas,
        createAudioCapture: async () => {
          throw new Error('Audio graph unavailable')
        },
      }),
    ).resolves.toBe(false)

    expect(engine.getSnapshot()).toMatchObject({
      phase: 'error',
      error: { code: 'audio-unavailable', message: 'Audio graph unavailable' },
    })
  })

  it('stops an encoder that started before a later platform setup failure', async () => {
    const fixture = createFixture()
    fixture.platform.setTimer = () => {
      throw new Error('Timer unavailable')
    }
    const engine = createReplayEngine(fixture.platform)

    await expect(
      engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture }),
    ).resolves.toBe(false)

    expect(fixture.recorders[0].stop).toHaveBeenCalledOnce()
    expect(fixture.videoTrack.stop).toHaveBeenCalledOnce()
    expect(fixture.release).toHaveBeenCalledOnce()
    expect(engine.getSnapshot().error?.code).toBe('recorder-failed')
  })

  it('clamps caller overrides to the checked-in duration and memory ceilings', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    await engine.start({
      canvas: fixture.canvas,
      createAudioCapture: fixture.createAudioCapture,
      maxDurationMs: Number.POSITIVE_INFINITY,
      maxBytes: Number.POSITIVE_INFINITY,
      hardMaxBytes: Number.POSITIVE_INFINITY,
    })
    const recorder = fixture.recorders[0]

    expect(fixture.platform.setTimer).toHaveBeenCalledWith(
      expect.any(Function),
      AIR_MIX_REPLAY_MAX_DURATION_MS,
    )
    recorder.emitData({ size: AIR_MIX_REPLAY_MAX_BYTES, type: 'video/webm' } as Blob)
    expect(recorder.stop).toHaveBeenCalledOnce()
  })

  it('stops with a stream-ended reason when a selected media track ends', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    const recorder = fixture.recorders[0]
    recorder.emitData(new Blob(['partial']))

    fixture.audioTrack.emitEnded()
    recorder.emitStop()

    expect(engine.getSnapshot().artifact?.stopReason).toBe('stream-ended')
    expect(fixture.audioTrack.removeEventListener).toHaveBeenCalledWith(
      'ended',
      expect.any(Function),
    )
    expect(fixture.videoTrack.removeEventListener).toHaveBeenCalledWith(
      'ended',
      expect.any(Function),
    )
  })

  it('discards a delayed chunk beyond the absolute memory ceiling', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    const recorder = fixture.recorders[0]
    const oversizedChunk = {
      size: AIR_MIX_REPLAY_HARD_MAX_BYTES + 1,
      type: 'video/webm',
    } as Blob

    recorder.emitData(oversizedChunk)
    recorder.emitStop()

    expect(engine.getSnapshot()).toMatchObject({
      phase: 'error',
      artifact: null,
      error: { code: 'memory-limit' },
    })
    expect(fixture.release).toHaveBeenCalledOnce()
  })

  it('keeps the previous replay until a replacement succeeds, then revokes it once', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)

    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    fixture.recorders[0].emitData(new Blob(['first']))
    engine.stop()
    fixture.recorders[0].emitStop()
    const firstArtifact = engine.getSnapshot().artifact

    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    expect(engine.getSnapshot().artifact).toBe(firstArtifact)
    fixture.recorders[1].emitData(new Blob(['second']))
    engine.stop()
    fixture.recorders[1].emitStop()

    expect(engine.getSnapshot().artifact?.url).toBe('blob:air-mix-2')
    expect(fixture.revokedUrls).toEqual(['blob:air-mix-1'])
  })

  it('can discard an older preview during a new recording without changing recorder state', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    fixture.recorders[0].emitData(new Blob(['first']))
    engine.stop()
    fixture.recorders[0].emitStop()

    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    engine.clearArtifact()

    expect(engine.getSnapshot()).toEqual({ phase: 'recording', artifact: null, error: null })
    expect(fixture.revokedUrls).toEqual(['blob:air-mix-1'])
  })

  it('preserves a completed replay when a replacement encoder cannot be constructed', async () => {
    const fixture = createFixture({
      supportedTypes: ['video/webm;codecs=vp9,opus'],
    })
    const engine = createReplayEngine(fixture.platform)
    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    fixture.recorders[0].emitData(new Blob(['first']))
    engine.stop()
    fixture.recorders[0].emitStop()
    const firstArtifact = engine.getSnapshot().artifact

    const createRecorder = fixture.platform.createMediaRecorder
    fixture.platform.createMediaRecorder = () => {
      throw new Error('Encoder unavailable')
    }
    await expect(
      engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture }),
    ).resolves.toBe(false)
    fixture.platform.createMediaRecorder = createRecorder

    expect(engine.getSnapshot()).toMatchObject({
      phase: 'error',
      artifact: firstArtifact,
      error: { code: 'recorder-failed' },
    })
    expect(fixture.revokedUrls).toEqual([])
  })

  it('ignores late encoder events after a session has finalized', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    const recorder = fixture.recorders[0]
    recorder.emitData(new Blob(['mix']))
    engine.stop()
    recorder.emitStop()
    const readySnapshot = engine.getSnapshot()

    recorder.emitData(new Blob(['late']))
    recorder.emitError()
    recorder.emitStop()

    expect(engine.getSnapshot()).toBe(readySnapshot)
    expect(fixture.release).toHaveBeenCalledOnce()
  })

  it('settles an encoder error and stop race into one recoverable failure', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    const recorder = fixture.recorders[0]
    recorder.emitData(new Blob(['partial']))

    recorder.emitError()
    recorder.emitStop()
    recorder.emitStop()

    expect(engine.getSnapshot()).toMatchObject({
      phase: 'error',
      artifact: null,
      error: { code: 'recorder-failed' },
    })
    expect(fixture.release).toHaveBeenCalledOnce()
  })

  it('fails safely on empty output without stopping borrowed deck audio', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })
    engine.stop()
    fixture.recorders[0].emitStop()

    expect(engine.getSnapshot()).toMatchObject({
      phase: 'error',
      error: { code: 'empty-recording' },
    })
    expect(fixture.videoTrack.stop).toHaveBeenCalledOnce()
    expect(fixture.audioTrack.stop).not.toHaveBeenCalled()
  })

  it('disposes timers, tracks, capture taps, and object URLs idempotently', async () => {
    const fixture = createFixture()
    const engine = createReplayEngine(fixture.platform)
    await engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture })

    engine.dispose()
    engine.dispose()

    expect(fixture.recorders[0].stop).toHaveBeenCalledOnce()
    expect(fixture.videoTrack.stop).toHaveBeenCalledOnce()
    expect(fixture.release).toHaveBeenCalledOnce()
    expect(fixture.timers.size).toBe(0)
  })

  it('disposes safely while the post-master audio tap is still pending', async () => {
    const fixture = createFixture()
    let resolveCapture: ((capture: ReplayAudioCapture) => void) | undefined
    const pendingCapture = new Promise<ReplayAudioCapture>((resolve) => {
      resolveCapture = resolve
    })
    const engine = createReplayEngine(fixture.platform)
    const starting = engine.start({
      canvas: fixture.canvas,
      createAudioCapture: () => pendingCapture,
    })

    engine.dispose()
    resolveCapture?.({
      stream: new FakeStream([fixture.audioTrack]) as unknown as MediaStream,
      release: fixture.release,
    })

    await expect(starting).resolves.toBe(false)
    expect(fixture.release).toHaveBeenCalledOnce()
    expect(fixture.captureStream).not.toHaveBeenCalled()
    expect(fixture.recorders).toHaveLength(0)
  })

  it('rejects unsupported browsers before asking for audio or camera-adjacent resources', async () => {
    const fixture = createFixture({ support: { mediaRecorderSupported: false } })
    const engine = createReplayEngine(fixture.platform)

    await expect(
      engine.start({ canvas: fixture.canvas, createAudioCapture: fixture.createAudioCapture }),
    ).resolves.toBe(false)

    expect(engine.getSnapshot()).toMatchObject({
      phase: 'error',
      error: { code: 'unsupported' },
    })
    expect(fixture.createAudioCapture).not.toHaveBeenCalled()
    expect(fixture.captureStream).not.toHaveBeenCalled()
  })
})
