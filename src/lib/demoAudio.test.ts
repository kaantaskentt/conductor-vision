import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDemoTrack, createDemoTracks, type DemoTrack } from './demoAudio'

const WAV_HEADER_BYTES = 44
const EXPECTED_BEATS = 48

type WavInfo = {
  bitsPerSample: number
  blockAlign: number
  byteRate: number
  channels: number
  dataBytes: number
  durationSeconds: number
  frameCount: number
  sampleRate: number
  view: DataView
}

function readAscii(view: DataView, offset: number, length: number) {
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(offset + index)),
  ).join('')
}

function parseWav(buffer: ArrayBuffer): WavInfo {
  const view = new DataView(buffer)

  expect(readAscii(view, 0, 4)).toBe('RIFF')
  expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8)
  expect(readAscii(view, 8, 4)).toBe('WAVE')
  expect(readAscii(view, 12, 4)).toBe('fmt ')
  expect(view.getUint32(16, true)).toBe(16)
  expect(view.getUint16(20, true)).toBe(1)
  expect(readAscii(view, 36, 4)).toBe('data')

  const channels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const byteRate = view.getUint32(28, true)
  const blockAlign = view.getUint16(32, true)
  const bitsPerSample = view.getUint16(34, true)
  const dataBytes = view.getUint32(40, true)
  const frameCount = dataBytes / blockAlign

  expect(dataBytes).toBe(buffer.byteLength - WAV_HEADER_BYTES)
  expect(Number.isInteger(frameCount)).toBe(true)

  return {
    bitsPerSample,
    blockAlign,
    byteRate,
    channels,
    dataBytes,
    durationSeconds: frameCount / sampleRate,
    frameCount,
    sampleRate,
    view,
  }
}

function getSignalStats(wav: WavInfo) {
  let leftPeak = 0
  let leftSquared = 0
  let rightPeak = 0
  let rightSquared = 0
  let stereoDifferenceSquared = 0

  for (let frame = 0; frame < wav.frameCount; frame += 1) {
    const offset = WAV_HEADER_BYTES + frame * wav.blockAlign
    const left = wav.view.getInt16(offset, true) / 32_768
    const right = wav.view.getInt16(offset + 2, true) / 32_768
    leftPeak = Math.max(leftPeak, Math.abs(left))
    rightPeak = Math.max(rightPeak, Math.abs(right))
    leftSquared += left * left
    rightSquared += right * right
    stereoDifferenceSquared += (left - right) ** 2
  }

  return {
    finalLeft: wav.view.getInt16(wav.view.byteLength - 4, true) / 32_768,
    finalRight: wav.view.getInt16(wav.view.byteLength - 2, true) / 32_768,
    leftPeak,
    leftRms: Math.sqrt(leftSquared / wav.frameCount),
    rightPeak,
    rightRms: Math.sqrt(rightSquared / wav.frameCount),
    stereoDifferenceRms: Math.sqrt(stereoDifferenceSquared / wav.frameCount),
  }
}

function sha256(buffer: ArrayBuffer) {
  return createHash('sha256').update(new Uint8Array(buffer)).digest('hex')
}

describe('generated demo audio', () => {
  let tracks: [DemoTrack, DemoTrack]
  let buffers: [ArrayBuffer, ArrayBuffer]

  beforeAll(async () => {
    tracks = createDemoTracks()
    buffers = await Promise.all(
      tracks.map((track) => track.file.arrayBuffer()),
    ) as [ArrayBuffer, ArrayBuffer]
  }, 15_000)

  it('creates two clearly named tracks with mix-ready tempo metadata', () => {
    const [deckA, deckB] = tracks

    expect(deckA.title).toBe('Neon Pulse')
    expect(deckA.bpm).toBe(120)
    expect(deckA.file.name).toBe('neon-pulse.wav')
    expect(deckB.title).toBe('Midnight Circuit')
    expect(deckB.bpm).toBe(126)
    expect(deckB.file.name).toBe('midnight-circuit.wav')

    for (const track of tracks) {
      expect(track.file.type).toBe('audio/wav')
      expect(track.file.lastModified).toBe(0)
    }
  })

  it('writes valid stereo 16-bit PCM WAV files at the expected musical duration', () => {
    tracks.forEach((track, index) => {
      const wav = parseWav(buffers[index])

      expect(wav.channels).toBe(2)
      expect(wav.sampleRate).toBe(22_050)
      expect(wav.bitsPerSample).toBe(16)
      expect(wav.blockAlign).toBe(4)
      expect(wav.byteRate).toBe(88_200)
      expect(wav.durationSeconds).toBeCloseTo(
        (EXPECTED_BEATS * 60) / track.bpm,
        4,
      )
    })
  })

  it('puts an audible, bounded signal in both channels with real stereo width', () => {
    buffers.forEach((buffer) => {
      const stats = getSignalStats(parseWav(buffer))

      expect(stats.leftRms).toBeGreaterThan(0.04)
      expect(stats.rightRms).toBeGreaterThan(0.04)
      expect(stats.leftPeak).toBeGreaterThan(0.2)
      expect(stats.rightPeak).toBeGreaterThan(0.2)
      expect(stats.leftPeak).toBeLessThanOrEqual(1)
      expect(stats.rightPeak).toBeLessThanOrEqual(1)
      expect(stats.stereoDifferenceRms).toBeGreaterThan(0.01)
      expect(Math.abs(stats.finalLeft)).toBeLessThan(0.01)
      expect(Math.abs(stats.finalRight)).toBeLessThan(0.01)
    })
  })

  it('stays deterministic and bounded for browser generation', async () => {
    const startedAt = performance.now()
    const regeneratedTracks = createDemoTracks()
    const elapsedMilliseconds = performance.now() - startedAt
    const regeneratedBuffers = await Promise.all(
      regeneratedTracks.map((track) => track.file.arrayBuffer()),
    )

    expect(regeneratedTracks.map((track) => track.file.size)).toEqual(
      tracks.map((track) => track.file.size),
    )
    expect(regeneratedTracks.reduce((size, track) => size + track.file.size, 0))
      .toBeLessThan(4_300_000)
    expect(elapsedMilliseconds).toBeLessThan(5_000)
    expect(regeneratedBuffers.map(sha256)).toEqual(buffers.map(sha256))
  }, 15_000)

  it('rejects out-of-range inputs before allocating audio', () => {
    expect(() => createDemoTrack('Too slow', 60, 55, 1)).toThrow(RangeError)
    expect(() => createDemoTrack('Too high', 120, 1_001, 1)).toThrow(RangeError)
    expect(() => createDemoTrack('Bad seed', 120, 55, Number.NaN)).toThrow(
      RangeError,
    )
  })
})
