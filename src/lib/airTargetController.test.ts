import { describe, expect, it } from 'vitest'
import {
  createAirTargetControllerState,
  updateAirTargetController,
  type AirPointerSample,
  type AirTarget,
} from './airTargetController'

const targets: AirTarget[] = [
  { id: 'deck-a-play', left: 0, top: 0, right: 0.25, bottom: 0.3 },
  { id: 'deck-b-play', left: 0.75, top: 0, right: 1, bottom: 0.3 },
]

function sample(now: number, x = 0.1, y = 0.1): AirPointerSample {
  return { detected: true, pointing: true, x, y, now }
}

describe('air target controller', () => {
  it('activates a target after a complete dwell', () => {
    const started = updateAirTargetController(
      createAirTargetControllerState(),
      sample(100),
      targets,
    )
    expect(started.hoveredTargetId).toBe('deck-a-play')
    expect(started.dwellProgress).toBe(0)
    expect(started.activatedTargetId).toBeNull()

    const midway = updateAirTargetController(started.state, sample(450), targets)
    expect(midway.dwellProgress).toBe(0.5)
    expect(midway.activatedTargetId).toBeNull()

    const activated = updateAirTargetController(midway.state, sample(800), targets)
    expect(activated.dwellProgress).toBe(1)
    expect(activated.activatedTargetId).toBe('deck-a-play')
  })

  it('does not repeat an activation until the pointer exits the target', () => {
    const started = updateAirTargetController(
      createAirTargetControllerState(),
      sample(0),
      targets,
      { dwellMs: 500, cooldownMs: 100 },
    )
    const activated = updateAirTargetController(
      started.state,
      sample(500),
      targets,
      { dwellMs: 500, cooldownMs: 100 },
    )
    const held = updateAirTargetController(
      activated.state,
      sample(1_500),
      targets,
      { dwellMs: 500, cooldownMs: 100 },
    )
    expect(held.activatedTargetId).toBeNull()
    expect(held.dwellProgress).toBe(0)

    const exited = updateAirTargetController(
      held.state,
      sample(1_550, 0.5, 0.5),
      targets,
      { dwellMs: 500, cooldownMs: 100 },
    )
    const reentered = updateAirTargetController(
      exited.state,
      sample(1_600),
      targets,
      { dwellMs: 500, cooldownMs: 100 },
    )
    const reactivated = updateAirTargetController(
      reentered.state,
      sample(2_100),
      targets,
      { dwellMs: 500, cooldownMs: 100 },
    )
    expect(reactivated.activatedTargetId).toBe('deck-a-play')
  })

  it('starts a fresh dwell only after the global cooldown expires', () => {
    const started = updateAirTargetController(
      createAirTargetControllerState(),
      sample(0),
      targets,
      { dwellMs: 400, cooldownMs: 600 },
    )
    const activated = updateAirTargetController(
      started.state,
      sample(400),
      targets,
      { dwellMs: 400, cooldownMs: 600 },
    )
    const otherDuringCooldown = updateAirTargetController(
      activated.state,
      sample(700, 0.9, 0.1),
      targets,
      { dwellMs: 400, cooldownMs: 600 },
    )
    expect(otherDuringCooldown.hoveredTargetId).toBe('deck-b-play')
    expect(otherDuringCooldown.dwellProgress).toBe(0)

    const cooldownEnded = updateAirTargetController(
      otherDuringCooldown.state,
      sample(1_000, 0.9, 0.1),
      targets,
      { dwellMs: 400, cooldownMs: 600 },
    )
    expect(cooldownEnded.dwellProgress).toBe(0)

    const activatedOther = updateAirTargetController(
      cooldownEnded.state,
      sample(1_400, 0.9, 0.1),
      targets,
      { dwellMs: 400, cooldownMs: 600 },
    )
    expect(activatedOther.activatedTargetId).toBe('deck-b-play')
  })

  it('ignores non-pointing samples and disabled targets', () => {
    const inactive = updateAirTargetController(
      createAirTargetControllerState(),
      { ...sample(0), pointing: false },
      targets,
    )
    expect(inactive.hoveredTargetId).toBeNull()

    const disabled = updateAirTargetController(
      createAirTargetControllerState(),
      sample(0),
      [{ ...targets[0], disabled: true }],
    )
    expect(disabled.hoveredTargetId).toBeNull()
  })
})
