import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReplayAudioCapture } from '../lib/airMixReplay'
import {
  createLocalReplayEngine,
  LOCAL_REPLAY_LABEL,
  type LocalReplayEngine,
  type LocalReplaySnapshot,
  type LocalReplayStopReason,
} from '../lib/localReplay'

const INITIAL_SNAPSHOT: LocalReplaySnapshot = {
  status: 'idle',
  busy: false,
  artifact: null,
  error: null,
}

export type UseLocalReplayOptions = {
  createMasterCapture: () => Promise<ReplayAudioCapture>
}

export function useLocalReplay({ createMasterCapture }: UseLocalReplayOptions) {
  const createMasterCaptureRef = useRef(createMasterCapture)
  createMasterCaptureRef.current = createMasterCapture
  const engineRef = useRef<LocalReplayEngine | null>(null)
  const [snapshot, setSnapshot] = useState<LocalReplaySnapshot>(INITIAL_SNAPSHOT)

  useEffect(() => {
    const engine = createLocalReplayEngine()
    engineRef.current = engine
    const unsubscribe = engine.subscribe(() => setSnapshot(engine.getSnapshot()))
    const stopWhenHidden = () => {
      if (document.visibilityState === 'hidden') engine.stop('tab-hidden')
    }
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden)
      unsubscribe()
      engine.dispose()
      if (engineRef.current === engine) engineRef.current = null
    }
  }, [])

  const start = useCallback(
    () => engineRef.current?.start({
      createMasterCapture: () => createMasterCaptureRef.current(),
    }) ?? Promise.resolve(false),
    [],
  )
  const stop = useCallback(
    (reason: LocalReplayStopReason = 'manual') => engineRef.current?.stop(reason) ?? false,
    [],
  )
  const discard = useCallback(() => engineRef.current?.discard(), [])

  return {
    ...snapshot,
    label: LOCAL_REPLAY_LABEL,
    download: snapshot.artifact
      ? { url: snapshot.artifact.url, filename: snapshot.artifact.filename }
      : null,
    start,
    stop,
    discard,
  }
}
