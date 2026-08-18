import {
  AIR_MIX_REPLAY_HARD_MAX_BYTES,
  AIR_MIX_REPLAY_MAX_BYTES,
  AIR_MIX_REPLAY_MAX_DURATION_MS,
  AIR_MIX_REPLAY_TIMESLICE_MS,
  type ReplayAudioCapture,
  type ReplayStopReason,
} from './airMixReplay'

export const LOCAL_REPLAY_LABEL = 'Audio-only master mix · stays on this device.'

export const LOCAL_REPLAY_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm',
] as const

export type LocalReplayStatus = 'idle' | 'recording' | 'preview' | 'error'
export type LocalReplayStopReason = ReplayStopReason

export type LocalReplayFailure = {
  code:
    | 'unsupported'
    | 'audio-unavailable'
    | 'recorder-failed'
    | 'empty-recording'
    | 'memory-limit'
    | 'preview-failed'
  message: string
}

export type LocalReplayArtifact = {
  blob: Blob
  url: string
  mimeType: string
  filename: string
  durationMs: number
  stopReason: LocalReplayStopReason
}

export type LocalReplaySnapshot = {
  status: LocalReplayStatus
  busy: boolean
  artifact: LocalReplayArtifact | null
  error: LocalReplayFailure | null
}

export type LocalReplayStartInput = {
  createMasterCapture: () => Promise<ReplayAudioCapture>
  maxDurationMs?: number
  maxBytes?: number
  hardMaxBytes?: number
}

type TimerHandle = ReturnType<typeof setTimeout>

export type LocalReplayPlatform = {
  mediaRecorderSupported: boolean
  createMediaRecorder: (stream: MediaStream, options?: MediaRecorderOptions) => MediaRecorder
  isTypeSupported: (mimeType: string) => boolean
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
  now: () => number
  date: () => Date
  setTimer: (callback: () => void, delayMs: number) => TimerHandle
  clearTimer: (handle: TimerHandle) => void
}

export type LocalReplayEngine = {
  getSnapshot: () => LocalReplaySnapshot
  subscribe: (listener: () => void) => () => void
  start: (input: LocalReplayStartInput) => Promise<boolean>
  stop: (reason?: LocalReplayStopReason) => boolean
  discard: () => void
  dispose: () => void
}

const INITIAL_SNAPSHOT: LocalReplaySnapshot = {
  status: 'idle',
  busy: false,
  artifact: null,
  error: null,
}

function browserPlatform(): LocalReplayPlatform {
  return {
    mediaRecorderSupported: typeof globalThis.MediaRecorder === 'function',
    createMediaRecorder: (stream, options) => new MediaRecorder(stream, options),
    isTypeSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    now: () => performance.now(),
    date: () => new Date(),
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (handle) => clearTimeout(handle),
  }
}

function boundedOverride(value: number | undefined, fallback: number, ceiling: number) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(value, ceiling)
}

function replayFailure(
  code: LocalReplayFailure['code'],
  message: string,
): LocalReplayFailure {
  return { code, message }
}

function recorderOptions(mimeType?: string): MediaRecorderOptions {
  return {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 128_000,
  }
}

function createRecorder(platform: LocalReplayPlatform, stream: MediaStream) {
  for (const mimeType of LOCAL_REPLAY_MIME_TYPES) {
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
      // Browsers can advertise a codec combination that the encoder still rejects.
    }
  }

  try {
    return platform.createMediaRecorder(stream, recorderOptions())
  } catch {
    return platform.createMediaRecorder(stream)
  }
}

function extensionForAudioMime(mimeType: string) {
  return mimeType.toLowerCase().includes('mp4') ? 'm4a' : 'webm'
}

export function createLocalReplayFilename(mimeType: string, date = new Date()) {
  const timestamp = date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return `ultra-vision-master-mix_${timestamp}.${extensionForAudioMime(mimeType)}`
}

export function createLocalReplayEngine(
  platform: LocalReplayPlatform = browserPlatform(),
): LocalReplayEngine {
  let snapshot = INITIAL_SNAPSHOT
  let disposed = false
  let sessionId = 0
  let recorder: MediaRecorder | null = null
  let capture: ReplayAudioCapture | null = null
  let audioTrack: MediaStreamTrack | null = null
  let trackEndedHandler: (() => void) | null = null
  let deadline: TimerHandle | null = null
  let chunks: Blob[] = []
  let chunkBytes = 0
  let startedAt = 0
  let stoppedAt = 0
  let stopReason: LocalReplayStopReason = 'manual'
  let terminalFailure: LocalReplayFailure | null = null
  const listeners = new Set<() => void>()

  const publish = (next: LocalReplaySnapshot) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const clearDeadline = () => {
    if (deadline === null) return
    platform.clearTimer(deadline)
    deadline = null
  }

  const releaseSession = () => {
    clearDeadline()
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onerror = null
      recorder.onstop = null
    }
    if (trackEndedHandler) {
      audioTrack?.removeEventListener('ended', trackEndedHandler)
      trackEndedHandler = null
    }
    audioTrack = null
    capture?.release()
    capture = null
    recorder = null
    chunks = []
    chunkBytes = 0
  }

  const failSession = (failure: LocalReplayFailure) => {
    const activeRecorder = recorder
    if (activeRecorder) {
      activeRecorder.ondataavailable = null
      activeRecorder.onerror = null
      activeRecorder.onstop = null
      try {
        if (activeRecorder.state !== 'inactive') activeRecorder.stop()
      } catch {
        // The capture tap is still released below.
      }
    }
    releaseSession()
    publish({ status: 'error', busy: false, artifact: snapshot.artifact, error: failure })
  }

  const stop = (reason: LocalReplayStopReason = 'manual') => {
    if (snapshot.busy && snapshot.status !== 'recording') {
      sessionId += 1
      publish({
        status: snapshot.artifact ? 'preview' : 'idle',
        busy: false,
        artifact: snapshot.artifact,
        error: null,
      })
      return true
    }
    if (snapshot.status !== 'recording' || !recorder || snapshot.busy) return false
    const activeRecorder = recorder
    const activeSession = sessionId
    stopReason = reason
    stoppedAt = platform.now()
    clearDeadline()
    publish({ ...snapshot, busy: true, error: null })
    if (disposed || activeSession !== sessionId || recorder !== activeRecorder) return true
    try {
      if (activeRecorder.state !== 'inactive') activeRecorder.stop()
      else failSession(replayFailure('recorder-failed', 'Recording ended before it could be saved. Try again.'))
    } catch {
      if (disposed || activeSession !== sessionId) return true
      failSession(replayFailure('recorder-failed', 'Recording could not stop cleanly. Try again.'))
    }
    return true
  }

  const start = async (input: LocalReplayStartInput) => {
    if (disposed || snapshot.busy || snapshot.status === 'recording') return false
    if (!platform.mediaRecorderSupported) {
      publish({
        status: 'error',
        busy: false,
        artifact: snapshot.artifact,
        error: replayFailure(
          'unsupported',
          'This browser cannot record the master mix. Try the latest Chrome or Edge.',
        ),
      })
      return false
    }

    const currentSession = sessionId + 1
    sessionId = currentSession
    terminalFailure = null
    publish({ ...snapshot, busy: true, error: null })

    let pendingCapture: ReplayAudioCapture | null = null
    try {
      try {
        pendingCapture = await input.createMasterCapture()
      } catch (error) {
        throw replayFailure(
          'audio-unavailable',
          error instanceof Error
            ? error.message
            : 'The master mix is not ready. Load a track and start playback, then try again.',
        )
      }
      if (disposed || currentSession !== sessionId) {
        pendingCapture.release()
        return false
      }

      const liveTrack = pendingCapture.stream.getAudioTracks().find(
        (track) => track.readyState !== 'ended',
      )
      if (!liveTrack) {
        throw replayFailure(
          'audio-unavailable',
          'No live master audio was available. Start a loaded deck, then try again.',
        )
      }

      const nextRecorder = createRecorder(platform, pendingCapture.stream)
      capture = pendingCapture
      pendingCapture = null
      audioTrack = liveTrack
      recorder = nextRecorder
      chunks = []
      chunkBytes = 0
      startedAt = platform.now()
      stoppedAt = 0
      stopReason = 'manual'

      const maxBytes = boundedOverride(input.maxBytes, AIR_MIX_REPLAY_MAX_BYTES, AIR_MIX_REPLAY_MAX_BYTES)
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
            'The local recording reached its safe memory limit and was discarded.',
          )
          if (snapshot.status === 'recording' && !snapshot.busy) stop('max-size')
          return
        }
        chunks.push(event.data)
        if (chunkBytes >= maxBytes && snapshot.status === 'recording' && !snapshot.busy) {
          stop('max-size')
        }
      }
      nextRecorder.onerror = () => {
        if (disposed || currentSession !== sessionId) return
        terminalFailure = replayFailure(
          'recorder-failed',
          'The browser encoder stopped. Your tracks are still safe; try recording again.',
        )
        if (snapshot.status === 'recording' && !snapshot.busy) stop('stream-ended')
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
          failSession(
            replayFailure('empty-recording', 'No audio was captured. Start a deck and try again.'),
          )
          return
        }

        const mimeType = nextRecorder.mimeType || chunks.find((chunk) => chunk.type)?.type || 'audio/webm'
        const blob = new Blob(chunks, { type: mimeType })
        let url: string
        try {
          url = platform.createObjectURL(blob)
        } catch {
          failSession(
            replayFailure('preview-failed', 'The recording finished but its local preview could not open.'),
          )
          return
        }
        const previousUrl = snapshot.artifact?.url
        const artifact: LocalReplayArtifact = {
          blob,
          url,
          mimeType,
          filename: createLocalReplayFilename(mimeType, platform.date()),
          durationMs: Math.max(0, (stoppedAt || platform.now()) - startedAt),
          stopReason,
        }
        releaseSession()
        if (previousUrl && previousUrl !== url) platform.revokeObjectURL(previousUrl)
        publish({ status: 'preview', busy: false, artifact, error: null })
      }

      nextRecorder.start(AIR_MIX_REPLAY_TIMESLICE_MS)
      const maxDurationMs = boundedOverride(
        input.maxDurationMs,
        AIR_MIX_REPLAY_MAX_DURATION_MS,
        AIR_MIX_REPLAY_MAX_DURATION_MS,
      )
      deadline = platform.setTimer(() => stop('max-duration'), maxDurationMs)
      trackEndedHandler = () => {
        if (disposed || currentSession !== sessionId || snapshot.status !== 'recording') return
        stop('stream-ended')
      }
      liveTrack.addEventListener('ended', trackEndedHandler)
      publish({ status: 'recording', busy: false, artifact: snapshot.artifact, error: null })
      if (liveTrack.readyState === 'ended') stop('stream-ended')
      return true
    } catch (error) {
      pendingCapture?.release()
      if (disposed || currentSession !== sessionId) return false
      const failure =
        typeof error === 'object' && error !== null && 'code' in error && 'message' in error
          ? (error as LocalReplayFailure)
          : replayFailure(
              'recorder-failed',
              error instanceof Error ? error.message : 'The local recording could not start.',
            )
      failSession(failure)
      return false
    }
  }

  const discard = () => {
    const url = snapshot.artifact?.url
    if (url) platform.revokeObjectURL(url)
    publish({
      status: snapshot.status === 'recording' ? 'recording' : 'idle',
      busy: snapshot.busy,
      artifact: null,
      error: null,
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
        // Resource release below remains authoritative.
      }
    }
    releaseSession()
    if (snapshot.artifact?.url) platform.revokeObjectURL(snapshot.artifact.url)
    snapshot = INITIAL_SNAPSHOT
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
    stop,
    discard,
    dispose,
  }
}
