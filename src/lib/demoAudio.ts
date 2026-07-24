export type DemoTrack = {
  bpm: number
  file: File
  title: string
}

const SAMPLE_RATE = 22_050
const DURATION_SECONDS = 16
const PCM_MAX = 32_767

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

function deterministicNoise(index: number, seed: number) {
  const value = Math.sin((index + seed * 97) * 12.9898) * 43_758.5453
  return (value - Math.floor(value)) * 2 - 1
}

function synthSample(time: number, bpm: number, rootHz: number, seed: number) {
  const beatSeconds = 60 / bpm
  const beatPhase = time % beatSeconds
  const halfBeatPhase = time % (beatSeconds / 2)
  const beatIndex = Math.floor(time / beatSeconds)

  const kickEnvelope = Math.exp(-beatPhase * 22)
  const kickFrequency = 48 + 62 * Math.exp(-beatPhase * 28)
  const kick = Math.sin(2 * Math.PI * kickFrequency * time) * kickEnvelope * 0.72

  const hatEnvelope = Math.exp(-halfBeatPhase * 74)
  const hat = deterministicNoise(Math.floor(time * SAMPLE_RATE), seed) * hatEnvelope * 0.11

  const bassNotes = [1, 1.5, 4 / 3, 1.25]
  const bassFrequency = rootHz * bassNotes[Math.floor(beatIndex / 2) % bassNotes.length]
  const bassEnvelope = Math.min(1, beatPhase * 35) * Math.exp(-beatPhase * 1.9)
  const bass = Math.sin(2 * Math.PI * bassFrequency * time) * bassEnvelope * 0.22

  const pulse = Math.sin(2 * Math.PI * rootHz * 4 * time) * 0.035
  return Math.tanh((kick + hat + bass + pulse) * 1.15)
}

export function createDemoTrack(
  title: string,
  bpm: number,
  rootHz: number,
  seed: number,
): DemoTrack {
  const sampleCount = SAMPLE_RATE * DURATION_SECONDS
  const dataBytes = sampleCount * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let index = 0; index < sampleCount; index += 1) {
    const value = synthSample(index / SAMPLE_RATE, bpm, rootHz, seed)
    view.setInt16(44 + index * 2, Math.round(value * PCM_MAX), true)
  }

  const fileName = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.wav`
  return {
    bpm,
    title,
    file: new File([buffer], fileName, { type: 'audio/wav' }),
  }
}

export function createDemoTracks(): [DemoTrack, DemoTrack] {
  return [
    createDemoTrack('Neon Pulse', 120, 55, 7),
    createDemoTrack('Midnight Circuit', 126, 65.41, 19),
  ]
}
