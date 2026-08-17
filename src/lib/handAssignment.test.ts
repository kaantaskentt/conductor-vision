import { describe, expect, it } from 'vitest'
import {
  HAND_ASSIGNMENT_LOSS_GRACE_MS,
  assignHandsToStableSlots,
  createHandAssignmentState,
  physicalSlotForRawHandedness,
} from './handAssignment'
import type { HandSummary } from './vision'

function hand(id: string, label: string, x: number, y: number): HandSummary {
  return {
    id,
    label,
    count: 5,
    raised: { thumb: true, index: true, middle: true, ring: true, pinky: true },
    x,
    y,
    pointerX: x,
    pointerY: y,
    wristAngle: 0,
  }
}

describe('stable hand assignment', () => {
  it('maps raw MediaPipe Right to physical Left and Deck A', () => {
    expect(physicalSlotForRawHandedness('Right')).toBe('left')
  })

  it('maps raw MediaPipe Left to physical Right and Deck B', () => {
    expect(physicalSlotForRawHandedness('Left')).toBe('right')
  })

  it('assigns normalized physical slots without changing mirrored cursor coordinates', () => {
    const result = assignHandsToStableSlots(
      createHandAssignmentState(),
      [hand('physical-right', 'lEfT', 0.8, 0.4), hand('physical-left', 'RIGHT', 0.2, 0.4)],
      100,
    )

    expect(result.left?.id).toBe('physical-left')
    expect(result.right?.id).toBe('physical-right')
    expect(result.state.left).toMatchObject({ x: 0.2, y: 0.4, missingSince: null })
    expect(result.state.right).toMatchObject({ x: 0.8, y: 0.4, missingSince: null })
    expect(result.left?.pointerX).toBe(0.2)
    expect(result.right?.pointerX).toBe(0.8)
  })

  it('keeps stable slots when detector ordering changes', () => {
    const initial = assignHandsToStableSlots(
      createHandAssignmentState(),
      [hand('left-first', 'Right', 0.2, 0.4), hand('right-first', 'Left', 0.8, 0.4)],
      100,
    )
    const reordered = assignHandsToStableSlots(
      initial.state,
      [hand('right-next', 'Left', 0.78, 0.41), hand('left-next', 'Right', 0.22, 0.39)],
      116,
    )

    expect(reordered.left?.id).toBe('left-next')
    expect(reordered.right?.id).toBe('right-next')
  })

  it('prefers same-label continuity when both candidates are closer to the opposite anchor', () => {
    const initial = assignHandsToStableSlots(
      createHandAssignmentState(),
      [hand('left-first', 'Right', 0.4, 0.4), hand('right-first', 'Left', 0.6, 0.4)],
      100,
    )
    const crossed = assignHandsToStableSlots(
      initial.state,
      [hand('left-next', 'Right', 0.58, 0.4), hand('right-next', 'Left', 0.42, 0.4)],
      116,
    )

    expect(crossed.left?.id).toBe('left-next')
    expect(crossed.right?.id).toBe('right-next')
  })

  it('rejects a one-frame label swap in favor of spatial continuity', () => {
    const initial = assignHandsToStableSlots(
      createHandAssignmentState(),
      [hand('left-first', 'Right', 0.2, 0.4), hand('right-first', 'Left', 0.8, 0.4)],
      100,
    )
    const swappedLabels = assignHandsToStableSlots(
      initial.state,
      [hand('physical-left', 'Left', 0.21, 0.4), hand('physical-right', 'Right', 0.79, 0.4)],
      116,
    )

    expect(swappedLabels.left?.id).toBe('physical-left')
    expect(swappedLabels.right?.id).toBe('physical-right')
  })

  it('keeps anchors during a short loss without outputting stale live hands', () => {
    const initial = assignHandsToStableSlots(
      createHandAssignmentState(),
      [hand('left', 'Right', 0.2, 0.4), hand('right', 'Left', 0.8, 0.4)],
      100,
    )
    const lost = assignHandsToStableSlots(initial.state, [], 150)

    expect(lost.left).toBeNull()
    expect(lost.right).toBeNull()
    expect(lost.state.left).toMatchObject({ x: 0.2, y: 0.4, lastSeenAt: 100, missingSince: 150 })
    expect(lost.state.right).toMatchObject({ x: 0.8, y: 0.4, lastSeenAt: 100, missingSince: 150 })
  })

  it('never assigns a lone physical Right candidate to a missing Left slot during grace', () => {
    const initial = assignHandsToStableSlots(
      createHandAssignmentState(),
      [hand('left', 'Right', 0.2, 0.4), hand('right', 'Left', 0.8, 0.4)],
      100,
    )
    const onlyRightNearLeft = assignHandsToStableSlots(
      initial.state,
      [hand('right-near-left', 'Left', 0.22, 0.4)],
      150,
    )

    expect(onlyRightNearLeft.left).toBeNull()
    expect(onlyRightNearLeft.right).toBeNull()
    expect(onlyRightNearLeft.state.left).toMatchObject({
      x: 0.2,
      lastSeenAt: 100,
      missingSince: 150,
    })
  })

  it('cancels loss when a nearby hand returns', () => {
    const initial = assignHandsToStableSlots(
      createHandAssignmentState(),
      [hand('left', 'Right', 0.2, 0.4), hand('right', 'Left', 0.8, 0.4)],
      100,
    )
    const lost = assignHandsToStableSlots(initial.state, [], 150)
    const returned = assignHandsToStableSlots(
      lost.state,
      [hand('left-returned', 'Right', 0.23, 0.42)],
      180,
    )

    expect(returned.left?.id).toBe('left-returned')
    expect(returned.right).toBeNull()
    expect(returned.state.left?.missingSince).toBeNull()
    expect(returned.state.right?.missingSince).toBe(150)
  })

  it('rejects a far return during grace and accepts it after grace expires', () => {
    const initial = assignHandsToStableSlots(
      createHandAssignmentState(),
      [hand('left', 'Right', 0.15, 0.2)],
      100,
    )
    const lost = assignHandsToStableSlots(initial.state, [], 120)
    const tooSoon = assignHandsToStableSlots(
      lost.state,
      [hand('far-left', 'Right', 0.85, 0.8)],
      100 + HAND_ASSIGNMENT_LOSS_GRACE_MS,
    )
    const reacquired = assignHandsToStableSlots(
      tooSoon.state,
      [hand('far-left', 'Right', 0.85, 0.8)],
      100 + HAND_ASSIGNMENT_LOSS_GRACE_MS + 1,
    )

    expect(tooSoon.left).toBeNull()
    expect(tooSoon.state.left).toMatchObject({ x: 0.15, y: 0.2, lastSeenAt: 100 })
    expect(reacquired.left?.id).toBe('far-left')
    expect(reacquired.state.left).toMatchObject({
      x: 0.85,
      y: 0.8,
      lastSeenAt: 100 + HAND_ASSIGNMENT_LOSS_GRACE_MS + 1,
      missingSince: null,
    })
  })
})
