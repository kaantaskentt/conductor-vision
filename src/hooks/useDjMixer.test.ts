import { describe, expect, it } from 'vitest'
import {
  bipolarFilterFrequencies,
  bpmFromTapTimes,
  chooseSyncMaster,
  equalPowerCrossfade,
  estimateBpmFromSamples,
  filterValueFromGesture,
  isGestureFrameEngaged,
  matchedTempoPercent,
  phraseTimeForIndex,
  relativeGestureValue,
  smoothBoundedControlValue,
  smoothControlValue,
  shouldReleaseFilterGesture,
  shortestAngleDelta,
  validateAudioFile,
} from './useDjMixer'

describe('DJ mixer audio safeguards and math', () => {
  it('maps four phrase jumps across the track', () => {
    expect(phraseTimeForIndex(1, 240)).toBe(0)
    expect(phraseTimeForIndex(2, 240)).toBe(60)
    expect(phraseTimeForIndex(4, 240)).toBe(180)
    expect(phraseTimeForIndex(99, 240)).toBe(180)
    expect(phraseTimeForIndex(2, Number.NaN)).toBe(0)
  })

  it('uses an equal-power crossfader curve', () => {
    expect(equalPowerCrossfade(-100)).toEqual({ a: 1, b: 0 })
    expect(equalPowerCrossfade(100).a).toBeCloseTo(0, 8)
    expect(equalPowerCrossfade(100).b).toBeCloseTo(1, 8)
    expect(equalPowerCrossfade(0).a).toBeCloseTo(Math.SQRT1_2, 8)
    expect(equalPowerCrossfade(0).b).toBeCloseTo(Math.SQRT1_2, 8)
  })

  it('calculates tempo matching within the safe playback range', () => {
    expect(matchedTempoPercent(120, 126)).toBe(5)
    expect(matchedTempoPercent(60, 120)).toBe(0)
    expect(matchedTempoPercent(90, 170)).toBe(-5.6)
    expect(matchedTempoPercent(70, 100)).toBeNull()
    expect(matchedTempoPercent(0, 120)).toBeNull()
  })

  it('uses the playing deck as the BPM Sync master and otherwise defaults to Deck A', () => {
    expect(chooseSyncMaster(false, true)).toBe('b')
    expect(chooseSyncMaster(true, false)).toBe('a')
    expect(chooseSyncMaster(false, false)).toBe('a')
    expect(chooseSyncMaster(true, true)).toBe('a')
  })

  it('smooths gesture values without overshooting the target', () => {
    expect(smoothControlValue(0, 100)).toBe(32)
    expect(smoothControlValue(80, 20, 0.5)).toBe(50)
    expect(smoothControlValue(10, 20, 2)).toBe(20)
  })

  it('clamps the hidden gesture accumulator so reversing from an end stop responds immediately', () => {
    expect(smoothBoundedControlValue(140, 160, -100, 100, 0.5)).toBe(100)
    expect(smoothBoundedControlValue(100, -100, -100, 100, 0.32)).toBe(36)
    expect(smoothBoundedControlValue(-20, -40, 0, 100, 0.5)).toBe(0)
  })

  it('keeps the mixer locked until an intentional open-hand clutch is present', () => {
    expect(
      isGestureFrameEngaged({ detected: true, x: 0.9, y: 0.2, wristAngle: 0, openFingers: 0 }),
    ).toBe(false)
    expect(
      isGestureFrameEngaged({ detected: true, x: 0.9, y: 0.2, wristAngle: 0, openFingers: 2 }),
    ).toBe(true)
    expect(
      isGestureFrameEngaged({ detected: false, x: 0.5, y: 0.5, wristAngle: 0, openFingers: 5 }),
    ).toBe(false)
  })

  it('uses relative pickup so a newly seen hand cannot jump a control', () => {
    expect(relativeGestureValue(0, 0.9, 0.9, 200)).toBe(0)
    expect(relativeGestureValue(82, 0.5, 0.51, 120)).toBe(82)
    expect(relativeGestureValue(0, 0.5, 0.75, 200)).toBeCloseTo(45)
    expect(relativeGestureValue(82, 0.6, 0.3, 120)).toBeCloseTo(49)
  })

  it('uses a center-neutral bipolar DJ filter', () => {
    expect(bipolarFilterFrequencies(50)).toEqual({ highpass: 20, lowpass: 20_000 })
    expect(bipolarFilterFrequencies(0).highpass).toBe(20)
    expect(bipolarFilterFrequencies(0).lowpass).toBeCloseTo(220)
    expect(bipolarFilterFrequencies(100).highpass).toBeCloseTo(12_000)
    expect(bipolarFilterFrequencies(100).lowpass).toBe(20_000)
  })

  it('keeps a newly selected filter still until the wrist moves deliberately', () => {
    const baseline = 0.4
    expect(filterValueFromGesture(50, baseline, baseline)).toBe(50)
    expect(filterValueFromGesture(50, baseline, baseline + (5 * Math.PI) / 180)).toBe(50)
    expect(filterValueFromGesture(50, baseline, baseline + (37 * Math.PI) / 180)).toBe(75)
    expect(filterValueFromGesture(50, baseline, baseline - (67 * Math.PI) / 180)).toBe(0)
  })

  it('handles wrist angles across the negative-pi boundary and releases after a short grace period', () => {
    const delta = shortestAngleDelta(-Math.PI + 0.05, Math.PI - 0.05)
    expect(delta).toBeCloseTo(0.1)
    expect(shouldReleaseFilterGesture(1_000, 1_299)).toBe(false)
    expect(shouldReleaseFilterGesture(1_000, 1_300)).toBe(true)
  })

  it('derives a stable BPM from manual taps', () => {
    expect(bpmFromTapTimes([0, 500, 1_000, 1_500])).toBe(120)
    expect(bpmFromTapTimes([0])).toBeNull()
  })

  it('detects a regular 120 BPM impulse train', () => {
    const sampleRate = 44_100
    const samples = new Float32Array(sampleRate * 10)
    for (let beat = 0; beat < 20; beat += 1) {
      const start = Math.floor(beat * sampleRate * 0.5)
      for (let index = 0; index < 1_024; index += 1) {
        samples[start + index] = 1 - index / 1_024
      }
    }
    expect(estimateBpmFromSamples(samples, sampleRate)).toBe(120)
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
