export type FirstMixReadinessInput = Readonly<{
  bothTracksLoaded: boolean
  cameraStatus: 'idle' | 'loading' | 'running' | 'error'
  cameraMessage: string
  handDetected: boolean
  gesturePhase: 'locked' | 'calibrating' | 'armed'
}>

export type FirstMixReadinessStepId = 'tracks' | 'camera' | 'gesture'
export type FirstMixReadinessStepState = 'complete' | 'active' | 'pending'

export type FirstMixReadinessStep = Readonly<{
  id: FirstMixReadinessStepId
  state: FirstMixReadinessStepState
  label: string
  detail: string
}>

function sequentialState(complete: boolean, active: boolean): FirstMixReadinessStepState {
  if (complete) return 'complete'
  return active ? 'active' : 'pending'
}

export function deriveFirstMixReadiness({
  bothTracksLoaded,
  cameraStatus,
  cameraMessage,
  handDetected,
  gesturePhase,
}: FirstMixReadinessInput): FirstMixReadinessStep[] {
  const tracksComplete = bothTracksLoaded
  const cameraRunning = cameraStatus === 'running'
  const cameraComplete = tracksComplete && cameraRunning
  const gestureComplete = cameraComplete && handDetected && gesturePhase === 'armed'

  const tracksActive = !tracksComplete
  const cameraActive = tracksComplete && !cameraComplete
  const gestureActive = cameraComplete && !gestureComplete

  return [
    {
      id: 'tracks',
      state: sequentialState(tracksComplete, tracksActive),
      label: 'Load tracks',
      detail: tracksComplete
        ? 'Deck A and Deck B are ready.'
        : 'Try the demo set or load one track into each deck.',
    },
    {
      id: 'camera',
      state: sequentialState(cameraComplete, cameraActive),
      label: 'Start camera',
      detail: cameraComplete
        ? 'Camera is live and processing on this device.'
        : cameraStatus === 'error'
          ? cameraMessage || 'Camera setup failed. Check access, then try again.'
          : cameraStatus === 'loading'
            ? cameraMessage || 'Preparing local hand tracking…'
            : cameraRunning
              ? 'Camera is live; load both tracks to continue.'
              : tracksComplete
                ? 'Start local hand tracking when you are ready.'
                : 'Camera comes next after both tracks are ready.',
    },
    {
      id: 'gesture',
      state: sequentialState(gestureComplete, gestureActive),
      label: 'Open hand',
      detail: gestureComplete
        ? 'The selected control is armed and follows your hand.'
        : !cameraComplete
          ? handDetected
            ? 'Hand found; finish the earlier steps before grabbing a control.'
            : 'Hand control begins after the camera is ready.'
          : handDetected
            ? gesturePhase === 'calibrating'
              ? 'Hand found. Hold steady while the selected control calibrates.'
              : 'Hand found. Open your palm to grab the selected control.'
            : 'Show one open hand inside the camera frame.',
    },
  ]
}
