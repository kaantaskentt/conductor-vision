/** @vitest-environment jsdom */

import { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVisionRuntime } from './useVisionRuntime'

const mediaPipe = vi.hoisted(() => ({
  drawingContexts: [] as CanvasRenderingContext2D[],
  connectorContexts: [] as CanvasRenderingContext2D[],
  landmarkContexts: [] as CanvasRenderingContext2D[],
  closeHandLandmarker: vi.fn(),
  detectHand: vi.fn(),
}))

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

function Harness({ onUpdate }: { onUpdate: (runtime: Runtime) => void }) {
  const runtime = useVisionRuntime({
    enableFace: false,
    targetColor: 'purple',
    onGestureFrame: vi.fn(),
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
  const track = { stop: vi.fn() }
  return {
    stream: { getTracks: () => [track] } as unknown as MediaStream,
    track,
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

describe('vision runtime camera lifecycle integration', () => {
  let root: Root
  let runtime: Runtime
  let container: HTMLDivElement
  let animationFrames: Map<number, FrameRequestCallback>
  let nextAnimationId: number
  let streams: ReturnType<typeof createStream>[]

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
      root.render(<Harness onUpdate={(nextRuntime) => (runtime = nextRuntime)} />)
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
})
