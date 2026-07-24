import { describe, expect, it, vi } from 'vitest'
import {
  attachVideoElement,
  createVideoElementLifecycle,
} from './videoElementLifecycle'

function createVideoElement() {
  return {
    srcObject: null,
    pause: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
  } as unknown as HTMLVideoElement
}

describe('video element lifecycle', () => {
  it('detaches the prior video before attaching and playing a shared stream on its replacement', () => {
    const lifecycle = createVideoElementLifecycle()
    const stream = {} as MediaStream
    const videoA = createVideoElement()
    const videoB = createVideoElement()

    expect(attachVideoElement(lifecycle, videoA, stream)).toBe(true)
    expect(videoA.srcObject).toBe(stream)
    expect(videoA.play).toHaveBeenCalledTimes(1)

    expect(attachVideoElement(lifecycle, videoB, stream)).toBe(true)
    expect(videoA.pause).toHaveBeenCalledTimes(1)
    expect(videoA.srcObject).toBeNull()
    expect(videoB.srcObject).toBe(stream)
    expect(videoB.play).toHaveBeenCalledTimes(1)
    expect(lifecycle.element).toBe(videoB)
    expect(lifecycle.generation).toBe(2)
  })

  it('preserves playback when React repeats the same callback-ref identity', () => {
    const lifecycle = createVideoElementLifecycle()
    const stream = {} as MediaStream
    const video = createVideoElement()

    expect(attachVideoElement(lifecycle, video, stream)).toBe(true)
    expect(attachVideoElement(lifecycle, video, stream)).toBe(false)

    expect(video.pause).not.toHaveBeenCalled()
    expect(video.play).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBe(stream)
  })

  it('pauses and clears the current video when its callback ref detaches', () => {
    const lifecycle = createVideoElementLifecycle()
    const stream = {} as MediaStream
    const video = createVideoElement()

    attachVideoElement(lifecycle, video, stream)

    expect(attachVideoElement(lifecycle, null, stream)).toBe(true)
    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
    expect(lifecycle.element).toBeNull()
  })

  it('clears an existing source and does not play when no stream is available', () => {
    const lifecycle = createVideoElementLifecycle()
    const video = createVideoElement()
    video.srcObject = {} as MediaStream

    expect(attachVideoElement(lifecycle, video, null)).toBe(true)
    expect(video.srcObject).toBeNull()
    expect(video.play).not.toHaveBeenCalled()
  })

  it('reports replacement playback failures to its current owner', async () => {
    const lifecycle = createVideoElementLifecycle()
    const stream = {} as MediaStream
    const video = createVideoElement()
    const error = new DOMException('Playback was interrupted.', 'AbortError')
    const onPlaybackError = vi.fn()
    vi.mocked(video.play).mockRejectedValue(error)

    attachVideoElement(lifecycle, video, stream, onPlaybackError)
    await Promise.resolve()

    expect(onPlaybackError).toHaveBeenCalledWith(error, {
      element: video,
      stream,
      generation: 1,
    })
  })
})
