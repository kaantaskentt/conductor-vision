import { describe, expect, it } from 'vitest'
import {
  deriveFirstMixExperience,
  deriveFirstMixReadiness,
  type FirstMixExperienceInput,
  type FirstMixReadinessInput,
  type FirstMixReadinessStepState,
} from './firstMixReadiness'

function derive(overrides: Partial<FirstMixReadinessInput> = {}) {
  return deriveFirstMixReadiness({
    bothTracksLoaded: false,
    cameraStatus: 'idle',
    cameraMessage: 'Camera is off.',
    handDetected: false,
    gesturePhase: 'locked',
    ...overrides,
  })
}

function states(overrides: Partial<FirstMixReadinessInput> = {}) {
  return derive(overrides).map(({ state }) => state)
}

function experience(overrides: Partial<FirstMixExperienceInput> = {}) {
  return deriveFirstMixExperience({
    bothTracksLoaded: false,
    cameraStatus: 'idle',
    cameraMessage: 'Camera is off.',
    handDetected: false,
    gesturePhase: 'locked',
    anyPlaying: false,
    deckALoaded: false,
    deckBLoaded: false,
    selectedControl: 'crossfader',
    ...overrides,
  })
}

describe('first-mix readiness', () => {
  it('starts with track loading active and later steps pending', () => {
    const steps = derive()

    expect(steps).toEqual([
      {
        id: 'tracks',
        state: 'active',
        label: 'Load tracks',
        detail: 'Try the demo set or load one track into each deck.',
      },
      {
        id: 'camera',
        state: 'pending',
        label: 'Camera',
        detail: 'Camera comes next after both tracks are ready.',
      },
      {
        id: 'gesture',
        state: 'pending',
        label: 'Open hand',
        detail: 'Hand control begins after the camera is ready.',
      },
    ])
  })

  it('moves to camera setup when both tracks are ready', () => {
    const steps = derive({ bothTracksLoaded: true })

    expect(states({ bothTracksLoaded: true })).toEqual(['complete', 'active', 'pending'])
    expect(steps[0].detail).toBe('Deck A and Deck B are ready.')
    expect(steps[1].detail).toBe('Start local hand tracking when you are ready.')
  })

  it('asks for a visible open hand once the camera is running', () => {
    const steps = derive({ bothTracksLoaded: true, cameraStatus: 'running' })

    expect(states({ bothTracksLoaded: true, cameraStatus: 'running' })).toEqual([
      'complete',
      'complete',
      'active',
    ])
    expect(steps[1].detail).toBe('Camera is live and processing on this device.')
    expect(steps[2].detail).toBe('Show one open hand inside the camera frame.')
  })

  it('distinguishes a detected hand from an armed gesture', () => {
    const steps = derive({
      bothTracksLoaded: true,
      cameraStatus: 'running',
      handDetected: true,
    })

    expect(steps[2]).toEqual({
      id: 'gesture',
      state: 'active',
      label: 'Open hand',
      detail: 'Hand found. Open your palm to grab the selected control.',
    })
  })

  it('completes all three steps only when the selected gesture is armed', () => {
    const steps = derive({
      bothTracksLoaded: true,
      cameraStatus: 'running',
      handDetected: true,
      gesturePhase: 'armed',
    })

    expect(steps.map(({ state }) => state)).toEqual(['complete', 'complete', 'complete'])
    expect(steps[2].detail).toBe('The selected control is armed and follows your hand.')
  })

  it('keeps states sequential when later signals arrive before their prerequisites', () => {
    const steps = derive({
      cameraStatus: 'running',
      handDetected: true,
      gesturePhase: 'armed',
    })

    expect(steps.map(({ state }) => state)).toEqual<FirstMixReadinessStepState[]>([
      'active',
      'pending',
      'pending',
    ])
    expect(steps[1].detail).toBe('Camera is live; load both tracks to continue.')
    expect(steps[2].detail).toBe(
      'Hand found; finish the earlier steps before grabbing a control.',
    )
  })

  it('reports camera preparation and recovery messages without claiming the camera is off', () => {
    expect(
      derive({
        bothTracksLoaded: true,
        cameraStatus: 'loading',
        cameraMessage: 'Models ready · requesting camera permission…',
      })[1],
    ).toMatchObject({
      state: 'active',
      detail: 'Models ready · requesting camera permission…',
    })

    expect(
      derive({
        bothTracksLoaded: true,
        cameraStatus: 'error',
        cameraMessage: 'Camera permission was blocked. Allow access, then try again.',
      })[1],
    ).toMatchObject({
      state: 'active',
      detail: 'Camera permission was blocked. Allow access, then try again.',
    })
  })

  it('announces the steady calibration step before a gesture becomes armed', () => {
    expect(
      derive({
        bothTracksLoaded: true,
        cameraStatus: 'running',
        handDetected: true,
        gesturePhase: 'calibrating',
      })[2].detail,
    ).toBe('Hand found. Hold steady while the selected control calibrates.')
  })
})

describe('first-mix experience director', () => {
  it('starts with one instant-demo action and a quiet path to personal tracks', () => {
    expect(experience()).toEqual({
      stage: 'tracks',
      progress: 'Step 1 of 3',
      title: 'Start with the instant demo',
      detail: 'Two generated tracks. Nothing uploads.',
      primaryAction: 'load-demo',
      secondaryAction: 'show-tracks',
    })
  })

  it('keeps camera cancel and track setup available when camera starts before tracks', () => {
    expect(experience({
      cameraStatus: 'loading',
      cameraMessage: 'Requesting camera permission…',
    })).toEqual({
      stage: 'camera',
      progress: 'Preparing on device',
      title: 'Preparing hand controls',
      detail: 'Requesting camera permission…',
      primaryAction: 'cancel-camera',
      secondaryAction: 'show-tracks',
    })
  })

  it('keeps camera retry and the missing-deck path available after an early failure', () => {
    expect(experience({
      cameraStatus: 'error',
      cameraMessage: 'Camera permission was blocked.',
      deckALoaded: true,
    })).toEqual({
      stage: 'recovery',
      progress: 'Camera needs attention',
      title: 'Camera blocked — you can keep setting up.',
      detail: 'Camera permission was blocked.',
      primaryAction: 'retry-camera',
      secondaryAction: 'show-tracks',
    })
  })

  it('offers one-click music plus camera after both decks are ready', () => {
    expect(experience({
      bothTracksLoaded: true,
      deckALoaded: true,
      deckBLoaded: true,
    })).toMatchObject({
      stage: 'launch',
      title: 'Tracks ready. Start the performance.',
      primaryAction: 'start-performance',
      secondaryAction: 'play-manual',
    })
  })

  it('moves from manual playback into local hand controls', () => {
    expect(experience({
      bothTracksLoaded: true,
      deckALoaded: true,
      deckBLoaded: true,
      anyPlaying: true,
    })).toMatchObject({
      stage: 'camera',
      title: 'Music live. Turn on hand controls.',
      primaryAction: 'start-camera',
      secondaryAction: null,
    })
  })

  it('does not claim the performance is ready when camera starts but audio is paused', () => {
    expect(experience({
      bothTracksLoaded: true,
      deckALoaded: true,
      deckBLoaded: true,
      cameraStatus: 'running',
      anyPlaying: false,
      handDetected: true,
      gesturePhase: 'armed',
    })).toEqual({
      stage: 'launch',
      progress: 'Music paused',
      title: 'Hand controls ready. Start the music.',
      detail: 'The camera can stay live while you restart both decks.',
      primaryAction: 'play-manual',
      secondaryAction: null,
    })
  })

  it('keeps music usable when camera permission fails', () => {
    expect(experience({
      bothTracksLoaded: true,
      deckALoaded: true,
      deckBLoaded: true,
      cameraStatus: 'error',
      cameraMessage: 'Camera permission was blocked.',
    })).toEqual({
      stage: 'recovery',
      progress: 'Manual mode ready',
      title: 'Camera blocked — the music still works.',
      detail: 'Camera permission was blocked.',
      primaryAction: 'retry-camera',
      secondaryAction: 'play-manual',
    })
  })

  it('turns hand pickup into distinct find, hold, and live instructions', () => {
    expect(experience({
      bothTracksLoaded: true,
      deckALoaded: true,
      deckBLoaded: true,
      cameraStatus: 'running',
      anyPlaying: true,
    })).toMatchObject({
      stage: 'hand',
      title: 'Raise one open palm',
    })
    expect(experience({
      bothTracksLoaded: true,
      deckALoaded: true,
      deckBLoaded: true,
      cameraStatus: 'running',
      anyPlaying: true,
      handDetected: true,
      gesturePhase: 'calibrating',
    })).toMatchObject({
      stage: 'calibrating',
      title: 'Hold steady — connecting without a jump',
    })
    expect(experience({
      bothTracksLoaded: true,
      deckALoaded: true,
      deckBLoaded: true,
      cameraStatus: 'running',
      anyPlaying: true,
      handDetected: true,
      gesturePhase: 'armed',
      selectedControl: 'filter',
    })).toMatchObject({
      stage: 'ready',
      title: 'You’re live — rotate your wrist',
      detail: 'Close your hand and the filter returns to 50%.',
    })
  })

  it('guides personal-track loading to whichever deck is still empty', () => {
    expect(experience({ deckALoaded: true })).toEqual({
      stage: 'tracks',
      progress: 'Step 1 of 3',
      title: 'Deck A ready. Add Deck B.',
      detail: 'Choose one more local track to unlock the performance controls.',
      primaryAction: 'show-tracks',
      secondaryAction: null,
    })
    expect(experience({ deckBLoaded: true })).toMatchObject({
      title: 'Deck B ready. Add Deck A.',
      primaryAction: 'show-tracks',
    })
  })
})
