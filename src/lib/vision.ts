import type {
  FaceLandmarkerResult,
  HandLandmarkerResult,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision'

export const TARGET_COLORS = {
  red: { rgb: [220, 56, 62], hue: 0, tolerance: 15 },
  orange: { rgb: [245, 132, 42], hue: 28, tolerance: 14 },
  yellow: { rgb: [246, 204, 67], hue: 50, tolerance: 14 },
  green: { rgb: [64, 190, 120], hue: 142, tolerance: 22 },
  cyan: { rgb: [45, 190, 220], hue: 188, tolerance: 18 },
  blue: { rgb: [64, 130, 255], hue: 218, tolerance: 18 },
  purple: { rgb: [170, 96, 255], hue: 265, tolerance: 20 },
  pink: { rgb: [235, 92, 172], hue: 326, tolerance: 18 },
  white: { rgb: [245, 247, 250], hue: 0, tolerance: 180, neutral: 'white' },
  black: { rgb: [25, 31, 42], hue: 0, tolerance: 180, neutral: 'black' },
} as const

const FINGER_JOINTS = {
  thumb: { tip: 4, pip: 3, mcp: 2 },
  index: { tip: 8, pip: 6, mcp: 5 },
  middle: { tip: 12, pip: 10, mcp: 9 },
  ring: { tip: 16, pip: 14, mcp: 13 },
  pinky: { tip: 20, pip: 18, mcp: 17 },
} as const

export type TargetColor = keyof typeof TARGET_COLORS
export type FingerName = keyof typeof FINGER_JOINTS
export type FingerState = Record<FingerName, boolean>

export type HandSummary = {
  id: string
  label: string
  count: number
  raised: FingerState
  x: number
  y: number
  wristAngle: number
}

export type GestureFrame = {
  detected: boolean
  x: number
  y: number
  wristAngle: number
  openFingers: number
}

export type HandAnchor = Pick<HandSummary, 'label' | 'x' | 'y'>

export type VisionAnalysis = {
  hands: HandSummary[]
  fingerCount: number | null
  faceCount: number
  smileScore: number
  eyeOpenScore: number
  faceLabel: string
  fps: number
  framesProcessed: number
  dominantColor: string
  targetCoverage: number
  targetHex: string
  bestColorName: TargetColor | 'none'
  bestColorPercent: number
  motionScore: number
  motionChangedPercent: number
  motionDirection: string
  motionHistory: number[]
}

export type PixelAnalysis = Pick<
  VisionAnalysis,
  | 'dominantColor'
  | 'targetCoverage'
  | 'targetHex'
  | 'bestColorName'
  | 'bestColorPercent'
  | 'motionScore'
  | 'motionChangedPercent'
  | 'motionDirection'
>

export function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

export function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
    .join('')}`
}

export function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  let h = 0

  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2)
    else h = 60 * ((rn - gn) / delta + 4)
  }

  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

function hueDistance(a: number, b: number) {
  const delta = Math.abs(a - b) % 360
  return Math.min(delta, 360 - delta)
}

function matchesColor(r: number, g: number, b: number, targetName: TargetColor) {
  const config = TARGET_COLORS[targetName]
  const hsv = rgbToHsv(r, g, b)
  if ('neutral' in config && config.neutral === 'white') return hsv.s < 0.22 && hsv.v > 0.72
  if ('neutral' in config && config.neutral === 'black') return hsv.v < 0.18
  return hsv.s > 0.28 && hsv.v > 0.18 && hueDistance(hsv.h, config.hue) <= config.tolerance
}

function nearestColorName(r: number, g: number, b: number): TargetColor | 'none' {
  const hsv = rgbToHsv(r, g, b)
  if (hsv.s < 0.18 && hsv.v > 0.72) return 'white'
  if (hsv.v < 0.16) return 'black'
  if (hsv.s < 0.24 || hsv.v < 0.18) return 'none'

  let best: TargetColor = 'red'
  let bestDistance = Number.POSITIVE_INFINITY

  ;(Object.keys(TARGET_COLORS) as TargetColor[]).forEach((name) => {
    const config = TARGET_COLORS[name]
    if ('neutral' in config) return
    const distance = hueDistance(hsv.h, config.hue)
    if (distance < bestDistance) {
      best = name
      bestDistance = distance
    }
  })

  return bestDistance < 34 ? best : 'none'
}

function distance(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, ((a.z ?? 0) - (b.z ?? 0)) * 0.35)
}

function jointAngle(a: NormalizedLandmark, b: NormalizedLandmark, c: NormalizedLandmark) {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) }
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) }
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z
  const magnitude = Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(cb.x, cb.y, cb.z)
  return Math.acos(Math.max(-1, Math.min(1, dot / Math.max(magnitude, 0.00001)))) * (180 / Math.PI)
}

export function countRaisedFingers(landmarks: NormalizedLandmark[], handedness: string) {
  const wrist = landmarks[0]
  const palmScale = Math.max(distance(wrist, landmarks[9]), 0.04)
  const raised = {} as FingerState

  ;(['index', 'middle', 'ring', 'pinky'] as FingerName[]).forEach((name) => {
    const joint = FINGER_JOINTS[name]
    const tip = landmarks[joint.tip]
    const pip = landmarks[joint.pip]
    const mcp = landmarks[joint.mcp]
    const radialOpen = distance(wrist, tip) > distance(wrist, pip) + palmScale * 0.14
    const straight = jointAngle(mcp, pip, tip) > 136
    const verticalOpen = tip.y < pip.y - palmScale * 0.03
    const depthOpen = (tip.z ?? 0) < (pip.z ?? 0) + 0.025
    raised[name] =
      (radialOpen && straight) ||
      (radialOpen && verticalOpen) ||
      (straight && depthOpen && distance(mcp, tip) > palmScale * 0.72)
  })

  const thumb = FINGER_JOINTS.thumb
  const thumbTip = landmarks[thumb.tip]
  const thumbIp = landmarks[thumb.pip]
  const thumbMcp = landmarks[thumb.mcp]
  const thumbRadial = distance(wrist, thumbTip) > distance(wrist, thumbIp) + palmScale * 0.1
  const thumbStraight = jointAngle(thumbMcp, thumbIp, thumbTip) > 126
  const thumbSide =
    handedness === 'Left'
      ? thumbTip.x > thumbIp.x + palmScale * 0.06
      : thumbTip.x < thumbIp.x - palmScale * 0.06
  raised.thumb = (thumbRadial && thumbStraight) || (thumbRadial && thumbSide)

  return { count: Object.values(raised).filter(Boolean).length, raised }
}

export function summarizeHands(result: HandLandmarkerResult): HandSummary[] {
  return result.landmarks.map((landmarks, index) => {
    const label = result.handedness[index]?.[0]?.categoryName ?? `Hand ${index + 1}`
    const fingers = countRaisedFingers(landmarks, label)
    const wrist = landmarks[0]
    const middle = landmarks[9]
    const wristAngle = Math.atan2(middle.y - wrist.y, wrist.x - middle.x)

    return {
      id: `${label}-${index}`,
      label,
      count: fingers.count,
      raised: fingers.raised,
      x: 1 - middle.x,
      y: middle.y,
      wristAngle,
    }
  })
}

export function selectPrimaryHand(
  hands: HandSummary[],
  previous: HandAnchor | null,
): HandSummary | null {
  if (!hands.length) return null
  if (!previous) return hands[0]

  const sameHandedness = hands.filter((hand) => hand.label === previous.label)
  if (!sameHandedness.length) return null

  let closest = sameHandedness[0]
  let closestDistance = Math.hypot(closest.x - previous.x, closest.y - previous.y)

  for (let index = 1; index < sameHandedness.length; index += 1) {
    const candidate = sameHandedness[index]
    const candidateDistance = Math.hypot(candidate.x - previous.x, candidate.y - previous.y)
    if (candidateDistance < closestDistance) {
      closest = candidate
      closestDistance = candidateDistance
    }
  }

  return closestDistance <= 0.35 ? closest : null
}

export function summarizeFace(result: FaceLandmarkerResult) {
  const categories = result.faceBlendshapes?.[0]?.categories ?? []
  const byName = Object.fromEntries(categories.map((item) => [item.categoryName, item.score]))
  const smileScore = Math.round(
    (((byName.mouthSmileLeft ?? 0) + (byName.mouthSmileRight ?? 0)) / 2) * 100,
  )
  const blinkScore = Math.round(
    (((byName.eyeBlinkLeft ?? 0) + (byName.eyeBlinkRight ?? 0)) / 2) * 100,
  )
  const faceCount = result.faceLandmarks.length

  return {
    faceCount,
    smileScore,
    eyeOpenScore: Math.max(0, 100 - blinkScore),
    faceLabel: faceCount === 0 ? 'No face' : smileScore > 35 ? 'Smile detected' : 'Face tracking',
  }
}

export function createEmptyAnalysis(targetColor: TargetColor = 'purple'): VisionAnalysis {
  const target = TARGET_COLORS[targetColor].rgb
  return {
    hands: [],
    fingerCount: null,
    faceCount: 0,
    smileScore: 0,
    eyeOpenScore: 0,
    faceLabel: 'No face',
    fps: 0,
    framesProcessed: 0,
    dominantColor: '#000000',
    targetCoverage: 0,
    targetHex: rgbToHex(target[0], target[1], target[2]),
    bestColorName: 'none',
    bestColorPercent: 0,
    motionScore: 0,
    motionChangedPercent: 0,
    motionDirection: 'Still',
    motionHistory: Array.from({ length: 40 }, () => 0),
  }
}

export function analyzePixels(
  image: ImageData,
  previousGray: Uint8ClampedArray | null,
  targetColor: TargetColor,
) {
  const gray = new Uint8ClampedArray(image.width * image.height)
  const colorCounts = new Map<TargetColor, number>()
  let targetCount = 0
  let changed = 0
  let motionX = 0
  let motionY = 0
  let red = 0
  let green = 0
  let blue = 0
  let samples = 0

  for (let pixel = 0, sample = 0; pixel < image.data.length; pixel += 4, sample += 1) {
    const r = image.data[pixel]
    const g = image.data[pixel + 1]
    const b = image.data[pixel + 2]
    const luminance = Math.round(r * 0.299 + g * 0.587 + b * 0.114)
    gray[sample] = luminance
    red += r
    green += g
    blue += b
    samples += 1

    if (matchesColor(r, g, b, targetColor)) targetCount += 1
    const nearest = nearestColorName(r, g, b)
    if (nearest !== 'none') colorCounts.set(nearest, (colorCounts.get(nearest) ?? 0) + 1)

    if (previousGray && Math.abs(luminance - previousGray[sample]) > 22) {
      changed += 1
      motionX += sample % image.width
      motionY += Math.floor(sample / image.width)
    }
  }

  const changedRatio = samples ? changed / samples : 0
  const motionCenterX = changed ? motionX / changed / image.width : 0.5
  const motionCenterY = changed ? motionY / changed / image.height : 0.5
  const motionScore = Math.round(clamp(changedRatio * 7.5) * 100)
  const motionDirection =
    changedRatio < 0.025
      ? 'Still'
      : Math.abs(motionCenterX - 0.5) > Math.abs(motionCenterY - 0.5)
        ? motionCenterX > 0.5
          ? 'Moving right'
          : 'Moving left'
        : motionCenterY > 0.5
          ? 'Moving down'
          : 'Moving up'

  let bestColorName: TargetColor | 'none' = 'none'
  let bestCount = 0
  colorCounts.forEach((count, name) => {
    if (count > bestCount) {
      bestCount = count
      bestColorName = name
    }
  })

  const target = TARGET_COLORS[targetColor].rgb
  const pixelAnalysis: PixelAnalysis = {
    dominantColor: rgbToHex(red / samples, green / samples, blue / samples),
    targetCoverage: Math.round((targetCount / Math.max(samples, 1)) * 100),
    targetHex: rgbToHex(target[0], target[1], target[2]),
    bestColorName,
    bestColorPercent: Math.round((bestCount / Math.max(samples, 1)) * 100),
    motionScore,
    motionChangedPercent: Math.round(changedRatio * 100),
    motionDirection,
  }

  return { gray, pixelAnalysis }
}

export function describeRaised(raised: FingerState) {
  const names = Object.entries(raised)
    .filter(([, isRaised]) => isRaised)
    .map(([name]) => name)
  return names.length ? names.join(', ') : 'closed fist'
}
