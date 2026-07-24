export const AIR_MIX_REPLAY_WIDTH = 1_280
export const AIR_MIX_REPLAY_HEIGHT = 720
export const AIR_MIX_REPLAY_FPS = 24
export const AIR_MIX_REPLAY_TIMESLICE_MS = 1_000
export const AIR_MIX_REPLAY_MAX_DURATION_MS = 3 * 60 * 1_000
export const AIR_MIX_REPLAY_MAX_BYTES = 64 * 1024 * 1024
export const AIR_MIX_REPLAY_HARD_MAX_BYTES = 80 * 1024 * 1024

export const AIR_MIX_REPLAY_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm',
] as const

export type ReplayPhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'ready' | 'error'
export type ReplayStopReason =
  | 'manual'
  | 'max-duration'
  | 'max-size'
  | 'tab-hidden'
  | 'stream-ended'

export type ReplayFailureCode =
  | 'unsupported'
  | 'audio-unavailable'
  | 'canvas-unavailable'
  | 'recorder-failed'
  | 'empty-recording'
  | 'memory-limit'
  | 'preview-failed'

export type ReplayFailure = {
  code: ReplayFailureCode
  message: string
}

export type ReplayArtifact = {
  blob: Blob
  url: string
  mimeType: string
  durationMs: number
  stopReason: ReplayStopReason
}

export type ReplaySnapshot = {
  phase: ReplayPhase
  artifact: ReplayArtifact | null
  error: ReplayFailure | null
}

export type ReplayAudioCapture = {
  stream: MediaStream
  release: () => void
}

export type ReplayStartInput = {
  canvas: HTMLCanvasElement
  createAudioCapture: () => Promise<ReplayAudioCapture>
  maxDurationMs?: number
  maxBytes?: number
  hardMaxBytes?: number
}

type TimerHandle = ReturnType<typeof setTimeout>

export type ReplayPlatform = {
  mediaRecorderSupported: boolean
  mediaStreamSupported: boolean
  canvasCaptureSupported: boolean
  audioCaptureSupported: boolean
  createMediaStream: (tracks: MediaStreamTrack[]) => MediaStream
  createMediaRecorder: (stream: MediaStream, options?: MediaRecorderOptions) => MediaRecorder
  isTypeSupported: (mimeType: string) => boolean
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
  now: () => number
  setTimer: (callback: () => void, delayMs: number) => TimerHandle
  clearTimer: (handle: TimerHandle) => void
}

export type ReplaySupport = {
  supported: boolean
  missing: Array<'MediaRecorder' | 'MediaStream' | 'canvas capture' | 'Web Audio capture'>
}

export type ReplayEngine = {
  getSnapshot: () => ReplaySnapshot
  subscribe: (listener: () => void) => () => void
  start: (input: ReplayStartInput) => Promise<boolean>
  stop: (reason?: ReplayStopReason) => boolean
  clearArtifact: () => void
  dispose: () => void
}

function replayFailure(code: ReplayFailureCode, message: string): ReplayFailure {
  return { code, message }
}

function boundedOverride(value: number | undefined, fallback: number, ceiling: number) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(value, ceiling)
}

function browserReplayPlatform(): ReplayPlatform {
  const scope = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }
  const Canvas = scope.HTMLCanvasElement
  const Context = scope.AudioContext ?? scope.webkitAudioContext
  return {
    mediaRecorderSupported: typeof scope.MediaRecorder === 'function',
    mediaStreamSupported: typeof scope.MediaStream === 'function',
    canvasCaptureSupported: typeof Canvas?.prototype.captureStream === 'function',
    audioCaptureSupported: typeof Context?.prototype.createMediaStreamDestination === 'function',
    createMediaStream: (tracks) => new MediaStream(tracks),
    createMediaRecorder: (stream, options) => new MediaRecorder(stream, options),
    isTypeSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    now: () => performance.now(),
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (handle) => clearTimeout(handle),
  }
}

export function detectReplaySupport(
  platform: ReplayPlatform = browserReplayPlatform(),
): ReplaySupport {
  const missing: ReplaySupport['missing'] = []
  if (!platform.mediaRecorderSupported) missing.push('MediaRecorder')
  if (!platform.mediaStreamSupported) missing.push('MediaStream')
  if (!platform.canvasCaptureSupported) missing.push('canvas capture')
  if (!platform.audioCaptureSupported) missing.push('Web Audio capture')
  return { supported: missing.length === 0, missing }
}

export function selectReplayMimeType(isTypeSupported: (mimeType: string) => boolean) {
  return AIR_MIX_REPLAY_MIME_TYPES.find((mimeType) => {
    try {
      return isTypeSupported(mimeType)
    } catch {
      return false
    }
  }) ?? null
}

export function replayExtensionForMime(mimeType: string) {
  return mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm'
}

export function createReplayFilename(mimeType: string, date = new Date()) {
  const timestamp = date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return `ultra-vision-air-mix_${timestamp}.${replayExtensionForMime(mimeType)}`
}

function recorderOptions(mimeType?: string): MediaRecorderOptions {
  return {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 2_200_000,
    audioBitsPerSecond: 128_000,
  }
}

function constructRecorder(platform: ReplayPlatform, stream: MediaStream) {
  for (const mimeType of AIR_MIX_REPLAY_MIME_TYPES) {
    let supported = false
    try {
      supported = platform.isTypeSupported(mimeType)
    } catch {
      supported = false
    }
    if (!supported) continue
    try {
      return platform.createMediaRecorder(stream, recorderOptions(mimeType))
    } catch {
      // Some browsers claim codec support but reject the exact combination.
    }
  }

  try {
    return platform.createMediaRecorder(stream, recorderOptions())
  } catch {
    return platform.createMediaRecorder(stream)
  }
}

export function createReplayEngine(
  platform: ReplayPlatform = browserReplayPlatform(),
): ReplayEngine {
  let snapshot: ReplaySnapshot = { phase: 'idle', artifact: null, error: null }
  let disposed = false
  let sessionId = 0
  let recorder: MediaRecorder | null = null
  let audioCapture: ReplayAudioCapture | null = null
  let captureAudioTrack: MediaStreamTrack | null = null
  let videoTrack: MediaStreamTrack | null = null
  let trackEndedHandler: (() => void) | null = null
  let deadline: TimerHandle | null = null
  let chunks: Blob[] = []
  let chunkBytes = 0
  let startedAt = 0
  let stoppedAt = 0
  let stopReason: ReplayStopReason = 'manual'
  let terminalFailure: ReplayFailure | null = null
  const listeners = new Set<() => void>()

  const publish = (next: ReplaySnapshot) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const clearDeadline = () => {
    if (deadline === null) return
    platform.clearTimer(deadline)
    deadline = null
  }

  const releaseSessionResources = () => {
    clearDeadline()
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onerror = null
      recorder.onstop = null
    }
    if (trackEndedHandler) {
      captureAudioTrack?.removeEventListener('ended', trackEndedHandler)
      videoTrack?.removeEventListener('ended', trackEndedHandler)
      trackEndedHandler = null
    }
    videoTrack?.stop()
    videoTrack = null
    captureAudioTrack = null
    audioCapture?.release()
    audioCapture = null
    recorder = null
    chunks = []
    chunkBytes = 0
  }

  const failSession = (failure: ReplayFailure) => {
    const activeRecorder = recorder
    if (activeRecorder) {
      activeRecorder.ondataavailable = null
      activeRecorder.onerror = null
      activeRecorder.onstop = null
      try {
        if (activeRecorder.state !== 'inactive') activeRecorder.stop()
      } catch {
        // Resource release below remains authoritative if encoder shutdown fails.
      }
    }
    releaseSessionResources()
    publish({ ...snapshot, phase: 'error', error: failure })
  }

  const requestStop = (reason: ReplayStopReason = 'manual') => {
    if (snapshot.phase === 'starting') {
      sessionId += 1
      publish({
        ...snapshot,
        phase: snapshot.artifact ? 'ready' : 'idle',
        error: null,
      })
      return true
    }
    if (snapshot.phase !== 'recording' || !recorder) return false
    const activeRecorder = recorder
    const stoppingSession = sessionId
    stopReason = reason
    stoppedAt = platform.now()
    clearDeadline()
    publish({ ...snapshot, phase: 'stopping', error: null })
    if (disposed || stoppingSession !== sessionId || recorder !== activeRecorder) return true
    try {
      if (activeRecorder.state !== 'inactive') activeRecorder.stop()
      else failSession(replayFailure('recorder-failed', 'The replay recorder stopped unexpectedly.'))
    } catch {
      if (disposed || stoppingSession !== sessionId) return true
      failSession(replayFailure('recorder-failed', 'The replay recorder could not stop cleanly.'))
    }
    return true
  }

  const start = async (input: ReplayStartInput) => {
    if (disposed || snapshot.phase === 'starting' || snapshot.phase === 'recording' || snapshot.phase === 'stopping') {
      return false
    }

    const support = detectReplaySupport(platform)
    if (!support.supported) {
      publish({
        ...snapshot,
        phase: 'error',
        error: replayFailure(
          'unsupported',
          `Local replay recording is unavailable: ${support.missing.join(', ')} missing.`,
        ),
      })
      return false
    }
    if (typeof input.canvas.captureStream !== 'function') {
      publish({
        ...snapshot,
        phase: 'error',
        error: replayFailure('canvas-unavailable', 'The replay stage cannot be captured in this browser.'),
      })
      return false
    }

    const currentSession = sessionId + 1
    sessionId = currentSession
    terminalFailure = null
    publish({ ...snapshot, phase: 'starting', error: null })
    if (disposed || currentSession !== sessionId) return false

    let pendingAudioCapture: ReplayAudioCapture | null = null
    let pendingVideoTrack: MediaStreamTrack | null = null
    try {
      try {
        pendingAudioCapture = await input.createAudioCapture()
      } catch (error) {
        throw replayFailure(
          'audio-unavailable',
          error instanceof Error ? error.message : 'The master mix audio tap could not start.',
        )
      }
      if (disposed || currentSession !== sessionId) {
        pendingAudioCapture.release()
        return false
      }
      const audioTrack = pendingAudioCapture.stream.getAudioTracks().find(
        (track) => track.readyState !== 'ended',
      )
      if (!audioTrack) {
        throw replayFailure('audio-unavailable', 'The master mix did not provide a live audio track.')
      }

      const canvasStream = input.canvas.captureStream(AIR_MIX_REPLAY_FPS)
      pendingVideoTrack = canvasStream.getVideoTracks().find((track) => track.readyState !== 'ended') ?? null
      if (!pendingVideoTrack) {
        throw replayFailure('canvas-unavailable', 'The replay stage did not provide a live video track.')
      }
      if (disposed || currentSession !== sessionId) {
        pendingVideoTrack.stop()
        pendingAudioCapture.release()
        return false
      }

      const combinedStream = platform.createMediaStream([pendingVideoTrack, audioTrack])
      const nextRecorder = constructRecorder(platform, combinedStream)
      audioCapture = pendingAudioCapture
      pendingAudioCapture = null
      captureAudioTrack = audioTrack
      videoTrack = pendingVideoTrack
      pendingVideoTrack = null
      recorder = nextRecorder
      chunks = []
      chunkBytes = 0
      startedAt = platform.now()
      stoppedAt = 0
      stopReason = 'manual'

      const maxBytes = boundedOverride(
        input.maxBytes,
        AIR_MIX_REPLAY_MAX_BYTES,
        AIR_MIX_REPLAY_MAX_BYTES,
      )
      const hardMaxBytes = Math.max(
        maxBytes,
        boundedOverride(
          input.hardMaxBytes,
          AIR_MIX_REPLAY_HARD_MAX_BYTES,
          AIR_MIX_REPLAY_HARD_MAX_BYTES,
        ),
      )
      nextRecorder.ondataavailable = (event) => {
        if (disposed || currentSession !== sessionId || event.data.size === 0) return
        chunkBytes += event.data.size
        if (chunkBytes > hardMaxBytes) {
          chunks = []
          terminalFailure = replayFailure(
            'memory-limit',
            'The replay exceeded its safe in-memory limit and was discarded.',
          )
          if (snapshot.phase === 'recording') requestStop('max-size')
          return
        }
        chunks.push(event.data)
        if (chunkBytes >= maxBytes && snapshot.phase === 'recording') requestStop('max-size')
      }
      nextRecorder.onerror = () => {
        if (disposed || currentSession !== sessionId) return
        terminalFailure = replayFailure('recorder-failed', 'The browser encoder stopped the replay.')
        if (snapshot.phase === 'recording') requestStop('stream-ended')
      }
      nextRecorder.onstop = () => {
        if (disposed || currentSession !== sessionId) return
        if (terminalFailure) {
          const failure = terminalFailure
          terminalFailure = null
          failSession(failure)
          return
        }
        if (!chunks.length) {
          failSession(replayFailure('empty-recording', 'No replay data was recorded. Try again.'))
          return
        }

        const mimeType = nextRecorder.mimeType || chunks.find((chunk) => chunk.type)?.type || 'video/webm'
        const blob = new Blob(chunks, { type: mimeType })
        let url: string
        try {
          url = platform.createObjectURL(blob)
        } catch {
          failSession(replayFailure('preview-failed', 'The replay was recorded but could not be previewed.'))
          return
        }
        const previousUrl = snapshot.artifact?.url
        const durationMs = Math.max(0, (stoppedAt || platform.now()) - startedAt)
        const artifact: ReplayArtifact = { blob, url, mimeType, durationMs, stopReason }
        releaseSessionResources()
        if (previousUrl && previousUrl !== url) platform.revokeObjectURL(previousUrl)
        publish({ phase: 'ready', artifact, error: null })
      }

      nextRecorder.start(AIR_MIX_REPLAY_TIMESLICE_MS)
      const maxDurationMs = boundedOverride(
        input.maxDurationMs,
        AIR_MIX_REPLAY_MAX_DURATION_MS,
        AIR_MIX_REPLAY_MAX_DURATION_MS,
      )
      deadline = platform.setTimer(() => requestStop('max-duration'), maxDurationMs)
      trackEndedHandler = () => {
        if (disposed || currentSession !== sessionId || snapshot.phase !== 'recording') return
        requestStop('stream-ended')
      }
      audioTrack.addEventListener('ended', trackEndedHandler)
      videoTrack.addEventListener('ended', trackEndedHandler)
      publish({ ...snapshot, phase: 'recording', error: null })
      if (audioTrack.readyState === 'ended' || videoTrack.readyState === 'ended') {
        requestStop('stream-ended')
      }
      return true
    } catch (error) {
      pendingVideoTrack?.stop()
      pendingAudioCapture?.release()
      if (disposed || currentSession !== sessionId) return false
      const failure =
        typeof error === 'object' && error !== null && 'code' in error && 'message' in error
          ? (error as ReplayFailure)
          : replayFailure(
              'recorder-failed',
              error instanceof Error ? error.message : 'The local replay could not start.',
            )
      failSession(failure)
      return false
    }
  }

  const clearArtifact = () => {
    const url = snapshot.artifact?.url
    if (!url) return
    platform.revokeObjectURL(url)
    const active =
      snapshot.phase === 'starting' || snapshot.phase === 'recording' || snapshot.phase === 'stopping'
    publish({
      phase: active ? snapshot.phase : 'idle',
      artifact: null,
      error: active ? snapshot.error : null,
    })
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    sessionId += 1
    const activeRecorder = recorder
    if (activeRecorder) {
      activeRecorder.ondataavailable = null
      activeRecorder.onerror = null
      activeRecorder.onstop = null
      try {
        if (activeRecorder.state !== 'inactive') activeRecorder.stop()
      } catch {
        // Cleanup continues even if the browser encoder is already gone.
      }
    }
    releaseSessionResources()
    if (snapshot.artifact?.url) platform.revokeObjectURL(snapshot.artifact.url)
    snapshot = { phase: 'idle', artifact: null, error: null }
    listeners.clear()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start,
    stop: requestStop,
    clearArtifact,
    dispose,
  }
}
