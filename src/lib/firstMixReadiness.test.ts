import { describe, expect, it } from 'vitest'
import {
  deriveFirstMixReadiness,
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
        label: 'Start camera',
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
