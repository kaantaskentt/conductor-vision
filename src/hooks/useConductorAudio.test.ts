import { describe, expect, it } from 'vitest'
import { cueTimeForIndex, validateAudioFile } from './useConductorAudio'

describe('conductor audio safeguards', () => {
  it('maps all eight cue slots across the track duration', () => {
    expect(cueTimeForIndex(1, 210)).toBe(0)
    expect(cueTimeForIndex(4, 210)).toBe(90)
    expect(cueTimeForIndex(8, 210)).toBe(210)
  })

  it('bounds invalid cue indexes and durations', () => {
    expect(cueTimeForIndex(-4, 70)).toBe(0)
    expect(cueTimeForIndex(99, 70)).toBe(70)
    expect(cueTimeForIndex(4, Number.NaN)).toBe(0)
  })

  it('accepts supported local audio and rejects misleading files', () => {
    expect(() => validateAudioFile(new File(['audio'], 'track.mp3', { type: 'audio/mpeg' }))).not.toThrow()
    expect(() => validateAudioFile(new File(['audio'], 'track.wav', { type: '' }))).not.toThrow()
    expect(() => validateAudioFile(new File(['text'], 'notes.txt', { type: 'text/plain' }))).toThrow(
      'Choose an MP3, WAV, FLAC, or OGG audio file.',
    )
    expect(() => validateAudioFile(new File(['text'], 'notes.mp3', { type: 'text/plain' }))).toThrow(
      'Choose an MP3, WAV, FLAC, or OGG audio file.',
    )
  })

  it('rejects audio above the 100 MB limit before creating an object URL', () => {
    const oversized = {
      name: 'huge.wav',
      type: 'audio/wav',
      size: 100 * 1024 * 1024 + 1,
    } as File
    expect(() => validateAudioFile(oversized)).toThrow(
      'Choose an audio file smaller than 100 MB.',
    )
  })
})
