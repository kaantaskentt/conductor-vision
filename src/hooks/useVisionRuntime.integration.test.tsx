/** @vitest-environment jsdom */

import { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cameraErrorMessage, HAND_MODEL, useVisionRuntime } from './useVisionRuntime'

const mediaPipe = vi.hoisted(() => ({
  drawingContexts: [] as CanvasRenderingContext2D[],
  connectorContexts: [] as CanvasRenderingContext2D[],
  landmarkContexts: [] as CanvasRenderingContext2D[],
  closeHandLandmarker: vi.fn(),
  detectHand: vi.fn(),
}))

function hexBuffer(hex: string) {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16)).buffer
}

vi.mock('@mediapipe/tasks-vision', () => {
  class DrawingUtils {
    private readonly context: CanvasRenderingContext2D

    constructor(context: CanvasRenderingContext2D) {
      this.context = context
      mediaPipe.drawingContexts.push(context)
    }

    drawConnectors() {
      mediaPipe.connectorContexts.push(this.context)
    }

    drawLandmarks() {
      mediaPipe.landmarkContexts.push(this.context)
    }
  }

  return {
    DrawingUtils,
    FilesetResolver: {
      forVisionTasks: vi.fn(() => Promise.resolve({})),
    },
    HandLandmarker: {
      HAND_CONNECTIONS: [],
      createFromOptions: vi.fn(() =>
        Promise.resolve({
          close: mediaPipe.closeHandLandmarker,
          detectForVideo: mediaPipe.detectHand,
        }),
      ),
    },
    FaceLandmarker: {
      FACE_LANDMARKS_TESSELATION: [],
      createFromOptions: vi.fn(() => Promise.reject(new Error('Face tracking is disabled.'))),
    },
  }
})

type Runtime = ReturnType<typeof useVisionRuntime>

function Harness({
  onUpdate,
  onGestureFrame,
}: {
  onUpdate: (runtime: Runtime) => void
  onGestureFrame: Parameters<typeof useVisionRuntime>[0]['onGestureFrame']
}) {
  const runtime = useVisionRuntime({
    enableFace: false,
    targetColor: 'purple',
    onGestureFrame,
  })
  useLayoutEffect(() => {
    onUpdate(runtime)
  })
  return null
}

function createVideo(currentTime = 12.5) {
  return {
    srcObject: null,
    currentTime,
    readyState: HTMLMediaElement.HAVE_ENOUGH_DATA,
    videoWidth: 640,
    videoHeight: 360,
    pause: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
  } as unknown as HTMLVideoElement
}

function createCanvas() {
  const context = {
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement
  return { canvas, context }
}

function createStream() {
  let readyState: MediaStreamTrackState = 'live'
  const track = Object.assign(new EventTarget(), {
    kind: 'video',
    stop: vi.fn(() => {
      readyState = 'ended'
    }),
  }) as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> }
  Object.defineProperty(track, 'readyState', {
    configurable: true,
    get: () => readyState,
  })
  return {
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
    } as unknown as MediaStream,
    track,
    end: () => {
      readyState = 'ended'
      track.dispatchEvent(new Event('ended'))
    },
  }
}

function createDeferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe('camera error recovery messages', () => {
  it.each([
    [
      'NotAllowedError',
      'Camera permission was blocked. Allow access in your browser, then try again.',
    ],
    ['NotFoundError', 'No camera was found on this device.'],
    ['NotReadableError', 'Another app is currently using the camera.'],
    [
      'AbortError',
      'Camera startup was interrupted. Check the connection, then try again.',
    ],
    [
      'OverconstrainedError',
      'This camera cannot provide the requested video settings. Try another camera or refresh.',
    ],
    [
      'SecurityError',
      "Browser security settings blocked the camera. Check this site's permission, then try again.",
    ],
    ['NotSupportedError', 'Camera access is not supported in this browser.'],
  ])('maps %s to an actionable recovery message', (name, message) => {
    expect(cameraErrorMessage(new DOMException('Camera failed.', name), true)).toBe(message)
  })

  it('prioritizes the secure-context requirement and preserves model-load guidance', () => {
    expect(cameraErrorMessage(new DOMException('Blocked.', 'SecurityError'), false)).toBe(
      'Camera access needs HTTPS or localhost.',
    )
    expect(cameraErrorMessage(new Error('WASM network fetch failed'), true)).toBe(
      'The local vision runtime could not load. Check your connection and retry.',
    )
  })

  it('uses a safe generic recovery for an unknown failure', () => {
    expect(cameraErrorMessage({ name: 'UnknownError' }, true)).toBe(
      'The camera could not start. Refresh the page and try again.',
    )
  })
})

describe('vision runtime camera lifecycle integration', () => {
  let root: Root
  let runtime: Runtime
  let container: HTMLDivElement
  let animationFrames: Map<number, FrameRequestCallback>
  let nextAnimationId: number
  let streams: ReturnType<typeof createStream>[]
  let onGestureFrame: Parameters<typeof useVisionRuntime>[0]['onGestureFrame']
  let modelFetch: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.useFakeTimers()
    mediaPipe.drawingContexts.length = 0
    mediaPipe.connectorContexts.length = 0
    mediaPipe.landmarkContexts.length = 0
    mediaPipe.closeHandLandmarker.mockClear()
    mediaPipe.detectHand.mockReset()
    const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
    mediaPipe.detectHand.mockReturnValue({
      landmarks: [landmarks],
      worldLandmarks: [landmarks],
      handedness: [[{ categoryName: 'Right' }]],
      handednesses: [[{ categoryName: 'Right' }]],
    })

    streams = [createStream(), createStream()]
    onGestureFrame = vi.fn()
    modelFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url !== HAND_MODEL.url) {
        throw new Error(`Unexpected fetch in vision runtime integration test: ${url}`)
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(HAND_MODEL.bytes),
      }
    })
    vi.stubGlobal('fetch', modelFetch)
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn(async (_algorithm: AlgorithmIdentifier, data: BufferSource) => {
          const bytes = ArrayBuffer.isView(data) ? data.byteLength : data.byteLength
          if (bytes !== HAND_MODEL.bytes) {
            throw new Error(`Unexpected model digest length: ${bytes}`)
          }
          return hexBuffer(HAND_MODEL.sha256)
        }),
      },
    })
    let streamIndex = 0
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => Promise.resolve(streams[streamIndex++].stream)),
      },
    })

    animationFrames = new Map()
    nextAnimationId = 1
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextAnimationId++
        animationFrames.set(id, callback)
        return id
      }),
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => animationFrames.delete(id)),
    )
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root.render(
        <Harness
          onUpdate={(nextRuntime) => (runtime = nextRuntime)}
          onGestureFrame={onGestureFrame}
        />,
      )
      vi.advanceTimersByTime(1_000)
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rebinds the live stream and overlay across screen remounts and camera restarts', async () => {
    const videoA = createVideo()
    const videoB = createVideo()
    const canvasA = createCanvas()
    const canvasB = createCanvas()

    await act(async () => {
      runtime.setVideoElement(videoA)
      runtime.setCanvasElement(canvasA.canvas)
      await runtime.start()
    })

    expect(runtime.status).toBe('running')
    expect(modelFetch).toHaveBeenCalledOnce()
    expect(modelFetch).toHaveBeenCalledWith(HAND_MODEL.url, {
      cache: 'force-cache',
      credentials: 'omit',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
    })
    expect(mediaPipe.drawingContexts).toEqual([canvasA.context])
    expect(mediaPipe.connectorContexts).toEqual([canvasA.context])
    expect(mediaPipe.landmarkContexts).toEqual([canvasA.context])
    expect(videoA.srcObject).toBe(streams[0].stream)

    await act(async () => {
      runtime.setVideoElement(null)
      runtime.setCanvasElement(null)
      runtime.setVideoElement(videoB)
      runtime.setCanvasElement(canvasB.canvas)
      const nextFrame = animationFrames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined
      if (!nextFrame) throw new Error('The running camera should request another frame.')
      animationFrames.delete(nextFrame[0])
      nextFrame[1](performance.now())
    })

    expect(videoA.pause).toHaveBeenCalledTimes(1)
    expect(videoA.srcObject).toBeNull()
    expect(videoB.srcObject).toBe(streams[0].stream)
    expect(mediaPipe.drawingContexts).toEqual([canvasA.context, canvasB.context])
    expect(mediaPipe.connectorContexts).toEqual([canvasA.context, canvasB.context])

    await act(async () => runtime.stop())
    expect(streams[0].track.stop).toHaveBeenCalledTimes(1)
    expect(videoB.srcObject).toBeNull()

    await act(async () => runtime.start())
    expect(runtime.status).toBe('running')
    expect(videoB.srcObject).toBe(streams[1].stream)
    expect(mediaPipe.drawingContexts).toEqual([
      canvasA.context,
      canvasB.context,
      canvasB.context,
    ])
    expect(mediaPipe.connectorContexts).toEqual([
      canvasA.context,
      canvasB.context,
      canvasB.context,
    ])
  })

  it('keeps tracking when a fresh video timestamp arrives after a slow frame', async () => {
    const video = createVideo()
    const { canvas } = createCanvas()

    await act(async () => {
      runtime.setVideoElement(video)
      runtime.setCanvasElement(canvas)
      await runtime.start()
    })
    const gestureCallsAfterStart = vi.mocked(onGestureFrame).mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(500)
      const duplicateFrame = animationFrames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined
      if (!duplicateFrame) throw new Error('The running camera should request another frame.')
      animationFrames.delete(duplicateFrame[0])
      duplicateFrame[1](performance.now())
    })
    expect(runtime.status).toBe('running')
    expect(onGestureFrame).toHaveBeenCalledTimes(gestureCallsAfterStart)

    video.currentTime += 1 / 30
    await act(async () => {
      vi.advanceTimersByTime(700)
      const freshFrame = animationFrames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined
      if (!freshFrame) throw new Error('The running camera should request another frame.')
      animationFrames.delete(freshFrame[0])
      freshFrame[1](performance.now())
    })

    expect(runtime.status).toBe('running')
    expect(streams[0].track.stop).not.toHaveBeenCalled()
    expect(onGestureFrame).toHaveBeenCalledTimes(gestureCallsAfterStart + 1)
    expect(onGestureFrame).toHaveBeenLastCalledWith(expect.objectContaining({ detected: true }))
  })

  it('releases gesture control once and exposes a recoverable error when video frames freeze', async () => {
    const video = createVideo()
    const { canvas } = createCanvas()

    await act(async () => {
      runtime.setVideoElement(video)
      runtime.setCanvasElement(canvas)
      await runtime.start()
    })
    expect(onGestureFrame).toHaveBeenLastCalledWith(expect.objectContaining({ detected: true }))
    const gestureCallsAfterStart = vi.mocked(onGestureFrame).mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(2_000)
      const frozenFrame = animationFrames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined
      if (!frozenFrame) throw new Error('The running camera should request another frame.')
      animationFrames.delete(frozenFrame[0])
      frozenFrame[1](performance.now())
    })

    expect(runtime.status).toBe('error')
    expect(runtime.message).toBe(
      'Camera frames stopped updating. Gesture controls were released; start the camera to reconnect.',
    )
    expect(streams[0].track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
    expect(animationFrames.size).toBe(0)
    expect(onGestureFrame).toHaveBeenCalledTimes(gestureCallsAfterStart + 1)
    expect(onGestureFrame).toHaveBeenLastCalledWith({
      detected: false,
      x: 0.5,
      y: 0.5,
      wristAngle: 0,
      openFingers: 0,
    })

    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })
    expect(onGestureFrame).toHaveBeenCalledTimes(gestureCallsAfterStart + 1)

    await act(async () => runtime.start())
    expect(runtime.status).toBe('running')
    expect(video.srcObject).toBe(streams[1].stream)
    expect(onGestureFrame).toHaveBeenLastCalledWith(expect.objectContaining({ detected: true }))
  })

  it('recovers onto the newly mounted camera view when the old play request aborts during startup', async () => {
    const pendingPlay = createDeferred()
    const videoA = createVideo()
    const videoB = createVideo()
    const canvasA = createCanvas()
    const canvasB = createCanvas()
    videoA.play = vi.fn(() => pendingPlay.promise)

    let startPromise!: Promise<void>
    await act(async () => {
      runtime.setVideoElement(videoA)
      runtime.setCanvasElement(canvasA.canvas)
      startPromise = runtime.start()
      for (let index = 0; index < 6; index += 1) await Promise.resolve()
    })
    expect(videoA.play).toHaveBeenCalledTimes(1)

    await act(async () => {
      runtime.setVideoElement(null)
      runtime.setCanvasElement(null)
      runtime.setVideoElement(videoB)
      runtime.setCanvasElement(canvasB.canvas)
      pendingPlay.reject(new DOMException('Playback was interrupted.', 'AbortError'))
      await startPromise
    })

    expect(runtime.status).toBe('running')
    expect(streams[0].track.stop).not.toHaveBeenCalled()
    expect(videoA.pause).toHaveBeenCalledTimes(1)
    expect(videoA.srcObject).toBeNull()
    expect(videoB.srcObject).toBe(streams[0].stream)
    expect(videoB.play).toHaveBeenCalled()
    expect(mediaPipe.drawingContexts).toEqual([canvasB.context])
  })

  it('stops the owned stream when playback fails on the current running view', async () => {
    const videoA = createVideo()
    const videoB = createVideo()
    const canvasA = createCanvas()
    const canvasB = createCanvas()

    await act(async () => {
      runtime.setVideoElement(videoA)
      runtime.setCanvasElement(canvasA.canvas)
      await runtime.start()
    })

    videoB.play = vi.fn(() =>
      Promise.reject(new DOMException('Playback was interrupted.', 'AbortError')),
    )
    await act(async () => {
      runtime.setVideoElement(null)
      runtime.setCanvasElement(null)
      runtime.setVideoElement(videoB)
      runtime.setCanvasElement(canvasB.canvas)
      await Promise.resolve()
    })

    expect(runtime.status).toBe('error')
    expect(runtime.message).toBe(
      'The camera view was interrupted. Start the camera to try again.',
    )
    expect(streams[0].track.stop).toHaveBeenCalledTimes(1)
    expect(videoB.srcObject).toBeNull()
  })

  it('ignores an aborted StrictMode attachment after the same video element is reattached', async () => {
    const stalePlay = createDeferred()
    const videoA = createVideo()
    const videoB = createVideo()
    const canvasA = createCanvas()
    const canvasB = createCanvas()

    await act(async () => {
      runtime.setVideoElement(videoA)
      runtime.setCanvasElement(canvasA.canvas)
      await runtime.start()
    })

    videoB.play = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => stalePlay.promise)
      .mockResolvedValue(undefined)

    await act(async () => {
      runtime.setVideoElement(null)
      runtime.setCanvasElement(null)
      runtime.setVideoElement(videoB)
      runtime.setCanvasElement(canvasB.canvas)
      runtime.setVideoElement(null)
      runtime.setVideoElement(videoB)
    })
    expect(videoB.play).toHaveBeenCalledTimes(2)

    await act(async () => {
      stalePlay.reject(new DOMException('Playback was interrupted.', 'AbortError'))
      await Promise.resolve()
    })

    expect(runtime.status).toBe('running')
    expect(streams[0].track.stop).not.toHaveBeenCalled()
    expect(videoB.srcObject).toBe(streams[0].stream)
  })

  it('moves to a recoverable error when the active camera track ends, then starts a fresh stream', async () => {
    const video = createVideo()
    const { canvas } = createCanvas()

    await act(async () => {
      runtime.setVideoElement(video)
      runtime.setCanvasElement(canvas)
      await runtime.start()
    })
    expect(runtime.status).toBe('running')

    await act(async () => {
      streams[0].end()
    })

    expect(runtime.status).toBe('error')
    expect(runtime.message).toBe(
      'The camera stopped unexpectedly. Reconnect or re-enable it, then start the camera again.',
    )
    expect(video.srcObject).toBeNull()
    expect(streams[0].track.stop).toHaveBeenCalledTimes(1)
    expect(animationFrames.size).toBe(0)
    expect(onGestureFrame).toHaveBeenLastCalledWith({
      detected: false,
      x: 0.5,
      y: 0.5,
      wristAngle: 0,
      openFingers: 0,
    })

    await act(async () => runtime.start())

    expect(runtime.status).toBe('running')
    expect(video.srcObject).toBe(streams[1].stream)
    expect(streams[0].track.stop).toHaveBeenCalledTimes(1)
    expect(streams[1].track.stop).not.toHaveBeenCalled()
  })

  it('rejects a stream whose camera track already ended before it could attach', async () => {
    const video = createVideo()
    const { canvas } = createCanvas()
    streams[0].end()

    await act(async () => {
      runtime.setVideoElement(video)
      runtime.setCanvasElement(canvas)
      await runtime.start()
    })

    expect(runtime.status).toBe('error')
    expect(runtime.message).toContain('camera stopped unexpectedly')
    expect(video.play).not.toHaveBeenCalled()
    expect(video.srcObject).toBeNull()
    expect(streams[0].track.stop).toHaveBeenCalledTimes(1)
  })

  it('ignores a stale ended event after stop and restart', async () => {
    const video = createVideo()
    const { canvas } = createCanvas()

    await act(async () => {
      runtime.setVideoElement(video)
      runtime.setCanvasElement(canvas)
      await runtime.start()
      runtime.stop()
      await runtime.start()
    })
    expect(runtime.status).toBe('running')

    await act(async () => {
      streams[0].end()
    })

    expect(runtime.status).toBe('running')
    expect(video.srcObject).toBe(streams[1].stream)
    expect(streams[0].track.stop).toHaveBeenCalledTimes(1)
    expect(streams[1].track.stop).not.toHaveBeenCalled()
  })

  it('keeps the ended-track error when a pending play request settles later', async () => {
    const pendingPlay = createDeferred()
    const video = createVideo()
    const { canvas } = createCanvas()
    video.play = vi.fn(() => pendingPlay.promise)

    let startPromise!: Promise<void>
    await act(async () => {
      runtime.setVideoElement(video)
      runtime.setCanvasElement(canvas)
      startPromise = runtime.start()
      for (let index = 0; index < 6; index += 1) await Promise.resolve()
    })

    await act(async () => {
      streams[0].end()
    })
    expect(runtime.status).toBe('error')

    await act(async () => {
      pendingPlay.resolve()
      await startPromise
    })

    expect(runtime.status).toBe('error')
    expect(runtime.message).toContain('camera stopped unexpectedly')
    expect(video.srcObject).toBeNull()
    expect(streams[0].track.stop).toHaveBeenCalledTimes(1)
  })

  it('reports unsupported camera APIs without attempting model or device startup', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    })

    await act(async () => runtime.start())

    expect(runtime.status).toBe('error')
    expect(runtime.message).toBe('Camera access is not supported in this browser.')
  })
})
