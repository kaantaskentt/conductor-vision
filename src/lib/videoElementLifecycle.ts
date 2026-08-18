export type VideoElementLifecycle = {
  element: HTMLVideoElement | null
  generation: number
}

export function createVideoElementLifecycle(): VideoElementLifecycle {
  return { element: null, generation: 0 }
}

export type VideoPlaybackAttempt = {
  element: HTMLVideoElement
  stream: MediaStream
  generation: number
}

export function attachVideoElement(
  lifecycle: VideoElementLifecycle,
  element: HTMLVideoElement | null,
  stream: MediaStream | null,
  onPlaybackError: (error: unknown, attempt: VideoPlaybackAttempt) => void = () => undefined,
) {
  if (lifecycle.element === element) return false

  const previous = lifecycle.element
  if (previous) {
    previous.pause()
    previous.srcObject = null
  }

  lifecycle.element = element
  lifecycle.generation += 1
  if (!element) return true

  element.srcObject = stream
  if (stream) {
    const attempt = { element, stream, generation: lifecycle.generation }
    try {
      void element.play().catch((error: unknown) => onPlaybackError(error, attempt))
    } catch (error) {
      onPlaybackError(error, attempt)
    }
  }
  return true
}
