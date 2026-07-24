import { describe, expect, it } from 'vitest'
import { createDemoTracks } from './demoAudio'

describe('generated demo audio', () => {
  it('creates two playable, clearly named PCM WAV files with known tempos', async () => {
    const [deckA, deckB] = createDemoTracks()

    expect(deckA.title).toBe('Neon Pulse')
    expect(deckA.bpm).toBe(120)
    expect(deckB.title).toBe('Midnight Circuit')
    expect(deckB.bpm).toBe(126)
    expect(deckA.file.type).toBe('audio/wav')
    expect(deckB.file.size).toBeGreaterThan(500_000)

    const header = new Uint8Array(await deckA.file.slice(0, 12).arrayBuffer())
    expect(String.fromCharCode(...header.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...header.slice(8, 12))).toBe('WAVE')
  })
})
