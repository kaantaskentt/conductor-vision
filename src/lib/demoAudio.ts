export type DemoTrack = {
  bpm: number
  file: File
  title: string
}

export type DemoGenerationOptions = {
  maxWorkMilliseconds?: number
  now?: () => number
  signal?: AbortSignal
  yieldControl?: () => Promise<void>
}

const SAMPLE_RATE = 22_050
const CHANNELS = 2
const BITS_PER_SAMPLE = 16
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8
const BYTES_PER_FRAME = CHANNELS * BYTES_PER_SAMPLE
const BEATS_PER_BAR = 4
const DEMO_BARS = 12
const PCM_MAX = 32_767
const TAU = Math.PI * 2
export const DEMO_AUDIO_WORK_BUDGET_MS = 8
const DEMO_AUDIO_YIELD_CHECK_FRAMES = 256

const BASS_PATTERNS: ReadonlyArray<ReadonlyArray<number | null>> = [
  [0, null, 0, 7, 3, null, 3, 7, 0, null, 10, 7, 3, 7, 10, null],
  [0, 0, null, 7, 12, null, 10, 7, 3, null, 7, 10, 5, null, 3, 7],
]

const ARP_PATTERNS = [
  [0, 7, 12, 15, 12, 7, 3, 7],
  [0, 3, 7, 10, 7, 12, 10, 7],
] as const

const CHORD_ROOTS = [
  [0, -4, 3, -2],
  [0, -5, -3, -7],
] as const

const CHORD_THIRDS = [
  [3, 4, 4, 4],
  [4, 4, 3, 4],
] as const

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function smoothStep(value: number) {
  const normalized = clamp(value)
  return normalized * normalized * (3 - 2 * normalized)
}

function deterministicNoise(index: number, seed: number) {
  let value = Math.imul((index + 1) ^ Math.imul(seed, 0x9e37_79b1), 0x85eb_ca6b)
  value ^= value >>> 13
  value = Math.imul(value, 0xc2b2_ae35)
  value ^= value >>> 16
  return ((value >>> 0) / 0xffff_ffff) * 2 - 1
}

function semitoneRatio(semitones: number) {
  return 2 ** (semitones / 12)
}

function sectionLevels(barIndex: number, barPhase: number) {
  if (barIndex < 2) {
    return { bass: 0.12, drums: 0.58, hats: 0.2, lead: 0.08, pad: 0.58 }
  }
  if (barIndex < 5) {
    return { bass: 0.88, drums: 1, hats: 0.82, lead: 0.68, pad: 0.34 }
  }
  if (barIndex === 5) {
    return { bass: 0.08, drums: 0.12, hats: 0.12, lead: 0.28, pad: 0.82 }
  }
  if (barIndex === 6) {
    const build = smoothStep(barPhase)
    return {
      bass: 0.16 + build * 0.32,
      drums: 0.24 + build * 0.7,
      hats: 0.36 + build * 0.72,
      lead: 0.24 + build * 0.48,
      pad: 0.72 - build * 0.28,
    }
  }
  if (barIndex < 11) {
    return { bass: 1, drums: 1.08, hats: 1, lead: 0.92, pad: 0.4 }
  }
  return { bass: 0.5, drums: 0.72, hats: 0.48, lead: 0.35, pad: 0.5 }
}

function synthStereoFrame(
  output: Float64Array,
  sampleIndex: number,
  time: number,
  durationSeconds: number,
  bpm: number,
  rootHz: number,
  seed: number,
) {
  const style = Math.abs(seed) % 2
  const beatSeconds = 60 / bpm
  const beatPosition = time / beatSeconds
  const beatIndex = Math.floor(beatPosition)
  const beatPhase = beatPosition - beatIndex
  const beatTime = beatPhase * beatSeconds
  const barIndex = Math.min(DEMO_BARS - 1, Math.floor(beatPosition / BEATS_PER_BAR))
  const barPhase = (beatPosition % BEATS_PER_BAR) / BEATS_PER_BAR
  const barTime = (beatPosition % BEATS_PER_BAR) * beatSeconds
  const levels = sectionLevels(barIndex, barPhase)

  const noise = deterministicNoise(sampleIndex, seed)
  const previousNoise = deterministicNoise(sampleIndex - 1, seed)
  const brightNoise = (noise - previousNoise) * 0.5
  const sideNoise = deterministicNoise(sampleIndex, seed + 101)

  const kickEnvelope = Math.exp(-beatTime * 17)
  const kickFrequency = 47 + 92 * Math.exp(-beatTime * 30)
  const kick =
    Math.sin(TAU * kickFrequency * beatTime) *
    kickEnvelope *
    0.78 *
    levels.drums

  const isBackbeat = beatIndex % BEATS_PER_BAR === 1 || beatIndex % BEATS_PER_BAR === 3
  const clapEnvelope = isBackbeat ? Math.exp(-beatTime * 14) : 0
  const clap =
    (brightNoise * 0.72 + Math.sin(TAU * 178 * beatTime) * 0.28) *
    clapEnvelope *
    levels.drums *
    0.28

  const eighthPosition = beatPosition * 2
  const eighthIndex = Math.floor(eighthPosition)
  const eighthPhase = eighthPosition - eighthIndex
  const eighthTime = eighthPhase * (beatSeconds / 2)
  const hatEnvelope = Math.exp(-eighthTime * 62)
  const openHatEnvelope = eighthIndex % 2 === 1 ? Math.exp(-eighthTime * 15) : 0
  const hat =
    brightNoise *
    (hatEnvelope * 0.11 + openHatEnvelope * 0.055) *
    levels.hats
  const hatPan = (eighthIndex + seed) % 2 === 0 ? -0.32 : 0.32

  const sixteenthPosition = beatPosition * 4
  const sixteenthIndex = Math.floor(sixteenthPosition)
  const sixteenthPhase = sixteenthPosition - sixteenthIndex
  const shakerEnvelope = Math.exp(-sixteenthPhase * (beatSeconds / 4) * 78)
  const shaker =
    style === 1 && sixteenthIndex % 4 !== 0
      ? sideNoise * shakerEnvelope * levels.hats * 0.035
      : 0

  const bassPattern = BASS_PATTERNS[style]
  const bassNote = bassPattern[eighthIndex % bassPattern.length]
  let bass = 0
  if (bassNote !== null) {
    const bassFrequency = rootHz * semitoneRatio(bassNote)
    const bassAttack = Math.min(1, eighthTime / 0.012)
    const bassEnvelope = bassAttack * Math.exp(-eighthTime * 4.6)
    const fundamental = Math.sin(TAU * bassFrequency * time)
    const harmonic = Math.sin(TAU * bassFrequency * 2 * time + style * 0.45)
    const sidechain = 1 - kickEnvelope * 0.42
    bass =
      (fundamental * 0.82 + harmonic * 0.18) *
      bassEnvelope *
      sidechain *
      levels.bass *
      0.34
  }

  const chordIndex = barIndex % CHORD_ROOTS[style].length
  const chordRoot =
    rootHz * 4 * semitoneRatio(CHORD_ROOTS[style][chordIndex])
  const chordIntervals = [0, CHORD_THIRDS[style][chordIndex], 7]
  let padLeft = 0
  let padRight = 0
  for (let voice = 0; voice < chordIntervals.length; voice += 1) {
    const frequency = chordRoot * semitoneRatio(chordIntervals[voice])
    padLeft += Math.sin(TAU * frequency * time + voice * 0.73)
    padRight += Math.sin(TAU * frequency * 1.0025 * time + voice * 1.11)
  }
  const padPulse = 0.72 + Math.sin(TAU * (beatPosition / 8)) * 0.28
  padLeft = (padLeft / 3) * levels.pad * padPulse * 0.16
  padRight = (padRight / 3) * levels.pad * padPulse * 0.16

  const arpPattern = ARP_PATTERNS[style]
  const arpNote = arpPattern[eighthIndex % arpPattern.length]
  const arpFrequency = chordRoot * 2 * semitoneRatio(arpNote)
  const arpGate = style === 0 || eighthIndex % 4 === 1 || eighthIndex % 4 === 3
  const arpEnvelope = arpGate ? Math.exp(-eighthTime * (style === 0 ? 8.5 : 15)) : 0
  const arpTone =
    (Math.sin(TAU * arpFrequency * time) +
      Math.sin(TAU * arpFrequency * 2 * time + 0.4) * 0.22) *
    arpEnvelope *
    levels.lead *
    (style === 0 ? 0.12 : 0.1)
  const arpPan = ((eighthIndex % 5) - 2) * 0.14

  const isImpactBar = barIndex === 2 || barIndex === 7
  const impactEnvelope = isImpactBar ? Math.exp(-barTime * 2.2) : 0
  const impact = brightNoise * impactEnvelope * 0.12

  const buildAmount = barIndex === 6 ? smoothStep(barPhase) : 0
  const riser =
    (brightNoise * 0.075 +
      Math.sin(TAU * (360 + buildAmount * 620) * time) * 0.025) *
    buildAmount *
    buildAmount

  let left =
    kick * 0.86 +
    clap * 0.9 +
    hat * (1 - hatPan) +
    shaker * 0.72 +
    bass +
    padLeft +
    arpTone * (1 - arpPan) +
    impact +
    riser
  let right =
    kick * 0.86 +
    clap * 1.05 +
    hat * (1 + hatPan) +
    shaker * 1.18 +
    bass +
    padRight +
    arpTone * (1 + arpPan) +
    impact * 0.82 +
    riser * 0.92

  if (style === 1) {
    left += Math.sin(TAU * rootHz * 8 * time) * levels.lead * 0.018
    right += Math.sin(TAU * rootHz * 8.03 * time + 0.6) * levels.lead * 0.018
  }

  const introFade = smoothStep(time / (beatSeconds * 0.5))
  const outroFade = barIndex === DEMO_BARS - 1 ? 1 - smoothStep(barPhase) : 1
  const edgeFade = clamp((durationSeconds - time) / 0.06)
  const master = introFade * outroFade * edgeFade * (style === 0 ? 0.78 : 0.76)

  left = Math.tanh(left * 1.08) * master
  right = Math.tanh(right * 1.08) * master
  output[0] = left
  output[1] = right
}

function assertTrackInputs(bpm: number, rootHz: number, seed: number) {
  if (!Number.isFinite(bpm) || bpm < 80 || bpm > 180) {
    throw new RangeError('Demo BPM must be between 80 and 180.')
  }
  if (!Number.isFinite(rootHz) || rootHz < 30 || rootHz > 1_000) {
    throw new RangeError('Demo root frequency must be between 30 and 1000 Hz.')
  }
  if (!Number.isFinite(seed)) {
    throw new RangeError('Demo seed must be finite.')
  }
}

type DemoTrackWriter = {
  bpm: number
  buffer: ArrayBuffer
  durationSeconds: number
  frame: Float64Array
  rootHz: number
  sampleCount: number
  seed: number
  title: string
  view: DataView
}

function createDemoTrackWriter(
  title: string,
  bpm: number,
  rootHz: number,
  seed: number,
): DemoTrackWriter {
  assertTrackInputs(bpm, rootHz, seed)
  const durationSeconds = (DEMO_BARS * BEATS_PER_BAR * 60) / bpm
  const sampleCount = Math.round(SAMPLE_RATE * durationSeconds)
  const dataBytes = sampleCount * BYTES_PER_FRAME
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, CHANNELS, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_FRAME, true)
  view.setUint16(32, BYTES_PER_FRAME, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  return {
    bpm,
    buffer,
    durationSeconds,
    frame: new Float64Array(CHANNELS),
    rootHz,
    sampleCount,
    seed,
    title,
    view,
  }
}

function writeDemoTrackFrame(writer: DemoTrackWriter, index: number) {
  synthStereoFrame(
    writer.frame,
    index,
    index / SAMPLE_RATE,
    writer.durationSeconds,
    writer.bpm,
    writer.rootHz,
    writer.seed,
  )
  const frameOffset = 44 + index * BYTES_PER_FRAME
  for (let channel = 0; channel < CHANNELS; channel += 1) {
    const normalized = clamp(writer.frame[channel], -1, 1)
    writer.view.setInt16(
      frameOffset + channel * BYTES_PER_SAMPLE,
      Math.round(normalized * PCM_MAX),
      true,
    )
  }
}

function finishDemoTrack(writer: DemoTrackWriter): DemoTrack {
  const fileName = `${writer.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.wav`
  return {
    bpm: writer.bpm,
    title: writer.title,
    file: new File([writer.buffer], fileName, {
      type: 'audio/wav',
      lastModified: 0,
    }),
  }
}

function throwIfDemoGenerationAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  throw new DOMException('Demo generation was cancelled.', 'AbortError')
}

function yieldToMainThread() {
  const browserScheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> }
    }
  ).scheduler
  if (typeof browserScheduler?.yield === 'function') return browserScheduler.yield()
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

export function createDemoTrack(
  title: string,
  bpm: number,
  rootHz: number,
  seed: number,
): DemoTrack {
  const writer = createDemoTrackWriter(title, bpm, rootHz, seed)
  for (let index = 0; index < writer.sampleCount; index += 1) {
    writeDemoTrackFrame(writer, index)
  }
  return finishDemoTrack(writer)
}

export async function createDemoTrackCooperatively(
  title: string,
  bpm: number,
  rootHz: number,
  seed: number,
  options: DemoGenerationOptions = {},
): Promise<DemoTrack> {
  const maxWorkMilliseconds = options.maxWorkMilliseconds ?? DEMO_AUDIO_WORK_BUDGET_MS
  if (!Number.isFinite(maxWorkMilliseconds) || maxWorkMilliseconds <= 0) {
    throw new RangeError('Demo work budget must be a positive finite number.')
  }

  throwIfDemoGenerationAborted(options.signal)
  const writer = createDemoTrackWriter(title, bpm, rootHz, seed)
  const now = options.now ?? (() => performance.now())
  const yieldControl = options.yieldControl ?? yieldToMainThread
  let workStartedAt = now()

  for (let index = 0; index < writer.sampleCount; index += 1) {
    writeDemoTrackFrame(writer, index)
    if ((index + 1) % DEMO_AUDIO_YIELD_CHECK_FRAMES !== 0) continue

    throwIfDemoGenerationAborted(options.signal)
    if (now() - workStartedAt < maxWorkMilliseconds) continue
    await yieldControl()
    throwIfDemoGenerationAborted(options.signal)
    workStartedAt = now()
  }

  throwIfDemoGenerationAborted(options.signal)
  return finishDemoTrack(writer)
}

export function createDemoTracks(): [DemoTrack, DemoTrack] {
  return [
    createDemoTrack('Neon Pulse', 120, 55, 8),
    createDemoTrack('Midnight Circuit', 126, 65.41, 19),
  ]
}

export async function createDemoTracksCooperatively(
  options: DemoGenerationOptions = {},
): Promise<[DemoTrack, DemoTrack]> {
  const deckA = await createDemoTrackCooperatively('Neon Pulse', 120, 55, 8, options)
  const deckB = await createDemoTrackCooperatively(
    'Midnight Circuit',
    126,
    65.41,
    19,
    options,
  )
  return [deckA, deckB]
}
