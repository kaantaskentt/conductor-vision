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

export type FirstMixControl = 'crossfader' | 'volume' | 'filter'
export type FirstMixExperienceStage =
  | 'tracks'
  | 'launch'
  | 'camera'
  | 'recovery'
  | 'hand'
  | 'calibrating'
  | 'ready'

export type FirstMixExperienceAction =
  | 'load-demo'
  | 'show-tracks'
  | 'start-performance'
  | 'play-manual'
  | 'start-camera'
  | 'cancel-camera'
  | 'retry-camera'

export type FirstMixExperienceInput = FirstMixReadinessInput & Readonly<{
  anyPlaying: boolean
  deckALoaded: boolean
  deckBLoaded: boolean
  selectedControl: FirstMixControl
}>

export type FirstMixExperience = Readonly<{
  stage: FirstMixExperienceStage
  progress: string
  title: string
  detail: string
  primaryAction: FirstMixExperienceAction | null
  secondaryAction: FirstMixExperienceAction | null
}>

const CONTROL_COPY: Record<FirstMixControl, {
  label: string
  movement: string
  release: string
}> = {
  crossfader: {
    label: 'the crossfader',
    movement: 'move left or right',
    release: 'Close your hand to lock the mix.',
  },
  volume: {
    label: 'the channel level',
    movement: 'move up or down',
    release: 'Close your hand to lock the level.',
  },
  filter: {
    label: 'the filter',
    movement: 'rotate your wrist',
    release: 'Close your hand and the filter returns to 50%.',
  },
}

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
      label: 'Camera',
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

export function deriveFirstMixExperience({
  bothTracksLoaded,
  cameraStatus,
  cameraMessage,
  handDetected,
  gesturePhase,
  anyPlaying,
  deckALoaded,
  deckBLoaded,
  selectedControl,
}: FirstMixExperienceInput): FirstMixExperience {
  if (cameraStatus === 'error') {
    return {
      stage: 'recovery',
      progress: bothTracksLoaded ? 'Manual mode ready' : 'Camera needs attention',
      title: bothTracksLoaded
        ? 'Camera blocked — the music still works.'
        : 'Camera blocked — you can keep setting up.',
      detail: cameraMessage || 'Check camera access, then retry when you are ready.',
      primaryAction: 'retry-camera',
      secondaryAction: !bothTracksLoaded ? 'show-tracks' : anyPlaying ? null : 'play-manual',
    }
  }

  if (cameraStatus === 'loading') {
    return {
      stage: 'camera',
      progress: 'Preparing on device',
      title: anyPlaying ? 'Music on · preparing hand controls' : 'Preparing hand controls',
      detail: cameraMessage || 'Loading the local vision runtime…',
      primaryAction: 'cancel-camera',
      secondaryAction: bothTracksLoaded ? null : 'show-tracks',
    }
  }

  if (!bothTracksLoaded) {
    if (deckALoaded !== deckBLoaded) {
      const readyDeck = deckALoaded ? 'A' : 'B'
      const missingDeck = deckALoaded ? 'B' : 'A'
      return {
        stage: 'tracks',
        progress: 'Step 1 of 3',
        title: `Deck ${readyDeck} ready. Add Deck ${missingDeck}.`,
        detail: 'Choose one more local track to unlock the performance controls.',
        primaryAction: 'show-tracks',
        secondaryAction: null,
      }
    }

    return {
      stage: 'tracks',
      progress: 'Step 1 of 3',
      title: 'Start with the instant demo',
      detail: 'Two generated tracks. Nothing uploads.',
      primaryAction: 'load-demo',
      secondaryAction: 'show-tracks',
    }
  }

  if (cameraStatus === 'idle') {
    if (!anyPlaying) {
      return {
        stage: 'launch',
        progress: 'Step 2 of 3',
        title: 'Tracks ready. Start the performance.',
        detail: 'One click starts both decks and local hand controls.',
        primaryAction: 'start-performance',
        secondaryAction: 'play-manual',
      }
    }

    return {
      stage: 'camera',
      progress: 'Step 2 of 3',
      title: 'Music live. Turn on hand controls.',
      detail: 'Camera processing stays on this device.',
      primaryAction: 'start-camera',
      secondaryAction: null,
    }
  }

  if (!anyPlaying) {
    return {
      stage: 'launch',
      progress: 'Music paused',
      title: 'Hand controls ready. Start the music.',
      detail: 'The camera can stay live while you restart both decks.',
      primaryAction: 'play-manual',
      secondaryAction: null,
    }
  }

  if (!handDetected) {
    return {
      stage: 'hand',
      progress: 'Step 3 of 3',
      title: 'Raise one open palm',
      detail: 'Keep it inside the frame. Nothing moves until pickup is ready.',
      primaryAction: null,
      secondaryAction: null,
    }
  }

  if (gesturePhase === 'calibrating') {
    return {
      stage: 'calibrating',
      progress: 'Connecting safely',
      title: 'Hold steady — connecting without a jump',
      detail: 'The current mix stays exactly where it is while pickup calibrates.',
      primaryAction: null,
      secondaryAction: null,
    }
  }

  const control = CONTROL_COPY[selectedControl]
  if (gesturePhase === 'armed') {
    return {
      stage: 'ready',
      progress: 'Ready to perform',
      title: `You’re live — ${control.movement}`,
      detail: control.release,
      primaryAction: null,
      secondaryAction: null,
    }
  }

  return {
    stage: 'hand',
    progress: 'Hand found',
    title: `Open your palm to grab ${control.label}`,
    detail: 'It picks up from the current value—no jump.',
    primaryAction: null,
    secondaryAction: null,
  }
}
