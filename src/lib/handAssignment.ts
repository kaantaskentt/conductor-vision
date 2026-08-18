import type { HandSummary } from './vision'

export type HandSlot = 'left' | 'right'

export type HandAssignmentAnchor = Readonly<{
  x: number
  y: number
  lastSeenAt: number
  missingSince: number | null
}>

export type HandAssignmentState = Readonly<
  Record<HandSlot, HandAssignmentAnchor | null>
>

export type HandAssignmentResult = Readonly<{
  state: HandAssignmentState
  left: HandSummary | null
  right: HandSummary | null
}>

export const HAND_ASSIGNMENT_LOSS_GRACE_MS = 260
export const HAND_ASSIGNMENT_MAX_JUMP = 0.35

const SLOTS: readonly HandSlot[] = ['left', 'right']

export function createHandAssignmentState(): HandAssignmentState {
  return { left: null, right: null }
}

export function physicalSlotForRawHandedness(label: string): HandSlot | null {
  const normalized = label.trim().toLowerCase()
  // HandLandmarker sees the unmirrored video frame, while MediaPipe handedness
  // labels assume mirrored selfie input. Swap the raw label once at the
  // performance ownership boundary: physical left is Deck A, right is Deck B.
  if (normalized === 'right') return 'left'
  if (normalized === 'left') return 'right'
  return null
}

function distanceFromAnchor(hand: HandSummary, anchor: HandAssignmentAnchor) {
  return Math.hypot(hand.x - anchor.x, hand.y - anchor.y)
}

function continuityIsActive(anchor: HandAssignmentAnchor, now: number) {
  return Math.max(0, now - anchor.lastSeenAt) <= HAND_ASSIGNMENT_LOSS_GRACE_MS
}

export function assignHandsToStableSlots(
  previous: HandAssignmentState,
  candidates: readonly HandSummary[],
  now: number,
): HandAssignmentResult {
  const usableCandidates = candidates
    .map((hand, index) => ({ hand, index }))
    .filter(({ hand }) => Number.isFinite(hand.x) && Number.isFinite(hand.y))
  const assignedHands: Record<HandSlot, HandSummary | null> = {
    left: null,
    right: null,
  }
  const assignedCandidateIndexes = new Set<number>()
  const continuityMatches: Array<{
    slot: HandSlot
    candidateIndex: number
    hand: HandSummary
    distance: number
  }> = []

  for (const slot of SLOTS) {
    const anchor = previous[slot]
    if (!anchor || !continuityIsActive(anchor, now)) continue

    for (const candidate of usableCandidates) {
      if (physicalSlotForRawHandedness(candidate.hand.label) !== slot) continue
      const distance = distanceFromAnchor(candidate.hand, anchor)
      if (distance <= HAND_ASSIGNMENT_MAX_JUMP) {
        continuityMatches.push({
          slot,
          candidateIndex: candidate.index,
          hand: candidate.hand,
          distance,
        })
      }
    }
  }

  continuityMatches.sort((a, b) => a.distance - b.distance)
  for (const match of continuityMatches) {
    if (assignedHands[match.slot] || assignedCandidateIndexes.has(match.candidateIndex)) {
      continue
    }
    assignedHands[match.slot] = match.hand
    assignedCandidateIndexes.add(match.candidateIndex)
  }

  // MediaPipe can briefly invert both handedness labels in one frame. Only
  // accept mismatched labels as a pair, when both anchors are fresh and each
  // candidate is clearly closer to the opposite-label physical anchor.
  const leftAnchor = previous.left
  const rightAnchor = previous.right
  const unassignedCandidates = usableCandidates.filter(
    ({ index }) => !assignedCandidateIndexes.has(index),
  )
  if (
    !assignedHands.left &&
    !assignedHands.right &&
    leftAnchor &&
    rightAnchor &&
    continuityIsActive(leftAnchor, now) &&
    continuityIsActive(rightAnchor, now) &&
    unassignedCandidates.length === 2
  ) {
    const leftSwap = unassignedCandidates.find(
      ({ hand }) => physicalSlotForRawHandedness(hand.label) === 'right',
    )
    const rightSwap = unassignedCandidates.find(
      ({ hand }) => physicalSlotForRawHandedness(hand.label) === 'left',
    )
    if (leftSwap && rightSwap && leftSwap.index !== rightSwap.index) {
      const leftSwapDistance = distanceFromAnchor(leftSwap.hand, leftAnchor)
      const leftLabeledDistance = distanceFromAnchor(leftSwap.hand, rightAnchor)
      const rightSwapDistance = distanceFromAnchor(rightSwap.hand, rightAnchor)
      const rightLabeledDistance = distanceFromAnchor(rightSwap.hand, leftAnchor)
      if (
        leftSwapDistance <= HAND_ASSIGNMENT_MAX_JUMP &&
        rightSwapDistance <= HAND_ASSIGNMENT_MAX_JUMP &&
        leftSwapDistance < leftLabeledDistance &&
        rightSwapDistance < rightLabeledDistance
      ) {
        assignedHands.left = leftSwap.hand
        assignedHands.right = rightSwap.hand
        assignedCandidateIndexes.add(leftSwap.index)
        assignedCandidateIndexes.add(rightSwap.index)
      }
    }
  }

  for (const slot of SLOTS) {
    if (assignedHands[slot]) continue
    const anchor = previous[slot]

    // While an anchor is still fresh, a far-away candidate is more likely to
    // be a detector reorder or handedness glitch than the same physical hand.
    if (anchor && continuityIsActive(anchor, now)) continue

    const matchingCandidate = usableCandidates.find(
      ({ hand, index }) =>
        !assignedCandidateIndexes.has(index) &&
        physicalSlotForRawHandedness(hand.label) === slot,
    )
    if (!matchingCandidate) continue

    assignedHands[slot] = matchingCandidate.hand
    assignedCandidateIndexes.add(matchingCandidate.index)
  }

  const nextState = {} as Record<HandSlot, HandAssignmentAnchor | null>
  for (const slot of SLOTS) {
    const hand = assignedHands[slot]
    const anchor = previous[slot]
    nextState[slot] = hand
      ? { x: hand.x, y: hand.y, lastSeenAt: now, missingSince: null }
      : anchor
        ? { ...anchor, missingSince: anchor.missingSince ?? now }
        : null
  }

  return {
    state: nextState,
    left: assignedHands.left,
    right: assignedHands.right,
  }
}
