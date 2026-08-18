import { describe, expect, it, vi } from 'vitest'
import {
  AIR_MIX_REPLAY_MAX_BYTES,
  AIR_MIX_REPLAY_MAX_DURATION_MS,
  AIR_MIX_REPLAY_TIMESLICE_MS,
} from './airMixReplay'
import {
  createLocalReplayEngine,
  createLocalReplayFilename,
  LOCAL_REPLAY_LABEL,
  type LocalReplayPlatform,
} from './localReplay'

type FakeTrack = MediaStreamTrack & {
  emitEnded: () => void
  stop: ReturnType<typeof vi.fn>
}

class FakeRecorder {
  readonly stream: MediaStream
  readonly mimeType: string
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

function createTrack() {
  const eventTarget = new EventTarget()
  let readyState: MediaStreamTrackState = 'live'
  const track = Object.assign(eventTarget, {
    kind: 'audio',
    stop: vi.fn(),
    emitEnded() {
      readyState = 'ended'
      eventTarget.dispatchEvent(new Event('ended'))
    },
  }) as unknown as FakeTrack
  Object.defineProperty(track, 'readyState', { get: () => readyState })
  return track
}

function createFixture(options: { supported?: boolean } = {}) {
  const track = createTrack()
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream
  const release = vi.fn()
  const createMasterCapture = vi.fn(async () => ({ stream, release }))
  const recorders: FakeRecorder[] = []
  const revokedUrls: string[] = []
  const timers = new Map<number, () => void>()
  let timerId = 0
  let now = 1_000
  let urlId = 0
  const platform: LocalReplayPlatform = {
    mediaRecorderSupported: options.supported ?? true,
    createMediaRecorder: (nextStream, recorderOptions) => {
      const recorder = new FakeRecorder(nextStream, recorderOptions?.mimeType ?? 'audio/webm')
      recorders.push(recorder)
      return recorder as unknown as MediaRecorder
    },
    isTypeSupported: (mimeType) => mimeType === 'audio/webm;codecs=opus',
    createObjectURL: () => `blob:local-replay-${++urlId}`,
    revokeObjectURL: (url) => revokedUrls.push(url),
    now: () => now,
    date: () => new Date('2026-08-17T10:30:45.000Z'),
    setTimer: vi.fn((callback) => {
      const id = ++timerId
      timers.set(id, callback)
      return id as unknown as ReturnType<typeof setTimeout>
    }),
    clearTimer: (handle) => timers.delete(handle as unknown as number),
  }
  return {
    platform,
    track,
    release,
    createMasterCapture,
    recorders,
    revokedUrls,
    timers,
    setNow(value: number) {
      now = value
    },
    runTimer() {
      const entry = timers.entries().next().value as [number, () => void] | undefined
      if (!entry) throw new Error('No timer is pending')
      timers.delete(entry[0])
      entry[1]()
    },
  }
}

describe('local replay controller', () => {
  it('names the feature and download as an honest audio-only local artifact', () => {
    expect(LOCAL_REPLAY_LABEL).toBe('Audio-only master mix · stays on this device.')
    expect(
      createLocalReplayFilename('audio/webm', new Date('2026-08-17T10:30:45.000Z')),
    ).toBe('ultra-vision-master-mix_2026-08-17_10-30-45-000.webm')
    expect(createLocalReplayFilename('audio/mp4', new Date('2026-08-17T10:30:45.000Z')))
      .toBe('ultra-vision-master-mix_2026-08-17_10-30-45-000.m4a')
  })

  it('records only the post-master audio stream and produces a downloadable preview', async () => {
    const fixture = createFixture()
    const engine = createLocalReplayEngine(fixture.platform)

    await expect(engine.start({ createMasterCapture: fixture.createMasterCapture })).resolves.toBe(true)
    expect(engine.getSnapshot()).toMatchObject({ status: 'recording', busy: false })
    expect(fixture.recorders[0].stream.getAudioTracks()).toEqual([fixture.track])
    expect(fixture.recorders[0].stream.getVideoTracks()).toEqual([])
    expect(fixture.recorders[0].start).toHaveBeenCalledWith(AIR_MIX_REPLAY_TIMESLICE_MS)

    fixture.recorders[0].emitData(new Blob(['mix'], { type: 'audio/webm' }))
    fixture.setNow(6_000)
    expect(engine.stop()).toBe(true)
    fixture.recorders[0].emitStop()

    expect(engine.getSnapshot()).toMatchObject({
      status: 'preview',
      busy: false,
      artifact: {
        url: 'blob:local-replay-1',
        mimeType: 'audio/webm;codecs=opus',
        durationMs: 5_000,
        stopReason: 'manual',
        filename: 'ultra-vision-master-mix_2026-08-17_10-30-45-000.webm',
      },
    })
    expect(fixture.release).toHaveBeenCalledOnce()
  })

  it('prevents double-start and coalesces stop races', async () => {
    const fixture = createFixture()
    const engine = createLocalReplayEngine(fixture.platform)
    await engine.start({ createMasterCapture: fixture.createMasterCapture })

    await expect(engine.start({ createMasterCapture: fixture.createMasterCapture })).resolves.toBe(false)
    expect(fixture.createMasterCapture).toHaveBeenCalledOnce()
    expect(engine.stop()).toBe(true)
    expect(engine.stop()).toBe(false)
    expect(fixture.recorders[0].stop).toHaveBeenCalledOnce()
  })

  it('auto-stops at the three-minute ceiling and preserves the stop reason', async () => {
    const fixture = createFixture()
    const engine = createLocalReplayEngine(fixture.platform)
    await engine.start({
      createMasterCapture: fixture.createMasterCapture,
      maxDurationMs: Number.POSITIVE_INFINITY,
    })
    expect(fixture.platform.setTimer).toHaveBeenCalledWith(
      expect.any(Function),
      AIR_MIX_REPLAY_MAX_DURATION_MS,
    )
    fixture.recorders[0].emitData(new Blob(['mix']))
    fixture.setNow(AIR_MIX_REPLAY_MAX_DURATION_MS + 1_000)
    fixture.runTimer()
    fixture.recorders[0].emitStop()

    expect(engine.getSnapshot().artifact?.stopReason).toBe('max-duration')
  })

  it('stops at the normal byte ceiling without accepting an unsafe override', async () => {
    const fixture = createFixture()
    const engine = createLocalReplayEngine(fixture.platform)
    await engine.start({
      createMasterCapture: fixture.createMasterCapture,
      maxBytes: Number.POSITIVE_INFINITY,
    })

    fixture.recorders[0].emitData({ size: AIR_MIX_REPLAY_MAX_BYTES, type: 'audio/webm' } as Blob)
    expect(fixture.recorders[0].stop).toHaveBeenCalledOnce()
  })

  it('stops safely when the captured master track ends', async () => {
    const fixture = createFixture()
    const engine = createLocalReplayEngine(fixture.platform)
    await engine.start({ createMasterCapture: fixture.createMasterCapture })
    fixture.recorders[0].emitData(new Blob(['mix']))

    fixture.track.emitEnded()
    fixture.recorders[0].emitStop()

    expect(engine.getSnapshot().artifact?.stopReason).toBe('stream-ended')
    expect(fixture.release).toHaveBeenCalledOnce()
  })

  it('returns actionable capability and encoder errors without acquiring twice', async () => {
    const unsupported = createFixture({ supported: false })
    const unsupportedEngine = createLocalReplayEngine(unsupported.platform)
    await expect(
      unsupportedEngine.start({ createMasterCapture: unsupported.createMasterCapture }),
    ).resolves.toBe(false)
    expect(unsupported.createMasterCapture).not.toHaveBeenCalled()
    expect(unsupportedEngine.getSnapshot()).toMatchObject({
      status: 'error',
      error: { code: 'unsupported', message: expect.stringContaining('latest Chrome or Edge') },
    })

    const failed = createFixture()
    const failedEngine = createLocalReplayEngine(failed.platform)
    await failedEngine.start({ createMasterCapture: failed.createMasterCapture })
    failed.recorders[0].emitData(new Blob(['partial']))
    failed.recorders[0].emitError()
    failed.recorders[0].emitStop()
    expect(failedEngine.getSnapshot()).toMatchObject({
      status: 'error',
      error: { code: 'recorder-failed', message: expect.stringContaining('tracks are still safe') },
    })
    expect(failed.release).toHaveBeenCalledOnce()
  })

  it('cancels a pending start, ignores its stale completion, and releases the capture', async () => {
    const fixture = createFixture()
    let resolveCapture: ((value: Awaited<ReturnType<typeof fixture.createMasterCapture>>) => void) | undefined
    const pending = new Promise<Awaited<ReturnType<typeof fixture.createMasterCapture>>>((resolve) => {
      resolveCapture = resolve
    })
    const engine = createLocalReplayEngine(fixture.platform)
    const starting = engine.start({ createMasterCapture: () => pending })

    expect(engine.stop()).toBe(true)
    resolveCapture?.(await fixture.createMasterCapture())
    await expect(starting).resolves.toBe(false)

    expect(fixture.release).toHaveBeenCalledOnce()
    expect(fixture.recorders).toHaveLength(0)
    expect(engine.getSnapshot().status).toBe('idle')
  })

  it('revokes replaced, discarded, and disposed object URLs exactly once', async () => {
    const fixture = createFixture()
    const engine = createLocalReplayEngine(fixture.platform)
    await engine.start({ createMasterCapture: fixture.createMasterCapture })
    fixture.recorders[0].emitData(new Blob(['first']))
    engine.stop()
    fixture.recorders[0].emitStop()

    await engine.start({ createMasterCapture: fixture.createMasterCapture })
    fixture.recorders[1].emitData(new Blob(['second']))
    engine.stop()
    fixture.recorders[1].emitStop()
    expect(fixture.revokedUrls).toEqual(['blob:local-replay-1'])

    engine.discard()
    engine.dispose()
    expect(fixture.revokedUrls).toEqual(['blob:local-replay-1', 'blob:local-replay-2'])
  })
})
