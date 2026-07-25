import { describe, expect, it, vi } from 'vitest'
import {
  appendWaveformSample,
  bipolarFilterFrequencies,
  bipolarFilterResonance,
  bpmFromTapTimes,
  channelGainFromPercent,
  chooseSyncMaster,
  createBpmAnalysisQueue,
  equalPowerCrossfade,
  estimateBpmFromSamples,
  isGestureFrameEngaged,
  MAX_BPM_ANALYSIS_BYTES,
  matchedTempoPercent,
  phraseTimeForIndex,
  relativeGestureValue,
  shouldAutoAnalyzeBpm,
  smoothBoundedControlValue,
  smoothControlValue,
  validateAudioFile,
} from './useDjMixer'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

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

  it('uses the playing deck as the BPM Sync master and the audible deck when both play', () => {
    expect(chooseSyncMaster(false, true, -100)).toBe('b')
    expect(chooseSyncMaster(true, false, 100)).toBe('a')
    expect(chooseSyncMaster(false, false, 100)).toBe('a')
    expect(chooseSyncMaster(true, true, -1)).toBe('a')
    expect(chooseSyncMaster(true, true, 0)).toBe('a')
    expect(chooseSyncMaster(true, true, 1)).toBe('b')
    expect(chooseSyncMaster(true, true, 100)).toBe('b')
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
    ).toBe(false)
    expect(
      isGestureFrameEngaged(
        { detected: true, x: 0.9, y: 0.2, wristAngle: 0, openFingers: 2 },
        true,
      ),
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
    expect(bipolarFilterFrequencies(100).highpass).toBeCloseTo(16_000)
    expect(bipolarFilterFrequencies(100).lowpass).toBe(20_000)
    expect(bipolarFilterFrequencies(40).lowpass).toBeLessThan(5_000)
    expect(bipolarFilterFrequencies(60).highpass).toBeGreaterThan(150)
    expect(bipolarFilterResonance(50)).toBeCloseTo(0.82)
    expect(bipolarFilterResonance(0)).toBeCloseTo(2.1)
    expect(bipolarFilterResonance(100)).toBeCloseTo(2.1)
  })

  it('uses a DJ-style channel fader taper with a true mute at zero', () => {
    expect(channelGainFromPercent(0)).toBe(0)
    expect(channelGainFromPercent(100)).toBe(1)
    expect(channelGainFromPercent(82)).toBeGreaterThan(0.8)
    expect(channelGainFromPercent(50)).toBeCloseTo(0.251, 2)
    expect(channelGainFromPercent(25)).toBeLessThan(0.05)
  })

  it('builds a bounded live waveform history from real analyser levels', () => {
    expect(appendWaveformSample([0, 12, 24], 36, 4)).toEqual([0, 12, 24, 36])
    expect(appendWaveformSample([0, 12, 24, 36], 140, 4)).toEqual([12, 24, 36, 100])
    expect(appendWaveformSample([12], 20, 0)).toEqual([])
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

  it('serializes BPM decoders so two deck loads cannot decode concurrently', async () => {
    const firstGate = deferred<void>()
    const secondGate = deferred<void>()
    let active = 0
    let maximumActive = 0
    const analyze = vi.fn(async (file: File) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await (file.name === 'first.mp3' ? firstGate.promise : secondGate.promise)
      active -= 1
      return file.name === 'first.mp3' ? 120 : 126
    })
    const queue = createBpmAnalysisQueue(analyze)
    const first = queue.enqueue(
      new File(['first'], 'first.mp3', { type: 'audio/mpeg' }),
      () => true,
    )
    const second = queue.enqueue(
      new File(['second'], 'second.mp3', { type: 'audio/mpeg' }),
      () => true,
    )

    await Promise.resolve()
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(maximumActive).toBe(1)

    firstGate.resolve()
    await expect(first).resolves.toEqual({ status: 'complete', bpm: 120 })
    await Promise.resolve()
    expect(analyze).toHaveBeenCalledTimes(2)
    expect(maximumActive).toBe(1)

    secondGate.resolve()
    await expect(second).resolves.toEqual({ status: 'complete', bpm: 126 })
    expect(maximumActive).toBe(1)
  })

  it('skips stale queued BPM work before allocating another decoder', async () => {
    const firstGate = deferred<void>()
    const analyze = vi.fn(async () => {
      await firstGate.promise
      return 120
    })
    const queue = createBpmAnalysisQueue(analyze)
    const first = queue.enqueue(
      new File(['first'], 'first.mp3', { type: 'audio/mpeg' }),
      () => true,
    )
    let secondIsCurrent = true
    const second = queue.enqueue(
      new File(['second'], 'second.mp3', { type: 'audio/mpeg' }),
      () => secondIsCurrent,
    )

    await Promise.resolve()
    secondIsCurrent = false
    firstGate.resolve()
    await first

    await expect(second).resolves.toEqual({ status: 'stale' })
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('bounds automatic BPM analysis before compressed audio is decoded', () => {
    expect(shouldAutoAnalyzeBpm({ size: MAX_BPM_ANALYSIS_BYTES })).toBe(true)
    expect(shouldAutoAnalyzeBpm({ size: MAX_BPM_ANALYSIS_BYTES + 1 })).toBe(false)
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
