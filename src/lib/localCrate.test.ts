import { describe, expect, it } from 'vitest'
import {
  createLocalCrateSelection,
  formatLocalTrackSize,
  MAX_LOCAL_CRATE_TRACKS,
} from './localCrate'

function audio(name: string, size = 1024, type = 'audio/mpeg') {
  return new File([new Uint8Array(size)], name, { type, lastModified: 1 })
}

describe('local crate', () => {
  it('keeps ten unique supported tracks in user order', () => {
    const files = Array.from({ length: 12 }, (_, index) => audio(`Track ${index + 1}.mp3`))
    const result = createLocalCrateSelection(files)

    expect(result.tracks).toHaveLength(MAX_LOCAL_CRATE_TRACKS)
    expect(result.tracks[0].name).toBe('Track 1')
    expect(result.tracks[9].name).toBe('Track 10')
    expect(result.overflow).toBe(2)
  })

  it('rejects unsupported, empty, and oversized files', () => {
    const result = createLocalCrateSelection([
      audio('notes.txt', 100, 'text/plain'),
      audio('empty.mp3', 0),
      audio('huge.mp3', 101 * 1024 * 1024),
      audio('ready.flac', 1024, 'audio/flac'),
    ])

    expect(result.tracks.map((track) => track.name)).toEqual(['ready'])
    expect(result.rejected).toEqual(['notes.txt', 'empty.mp3', 'huge.mp3'])
  })

  it('deduplicates identical selections and accepts extension-only files', () => {
    const first = audio('private-set.ogg', 2048, '')
    const result = createLocalCrateSelection([first, first])

    expect(result.tracks).toHaveLength(1)
    expect(result.rejected).toEqual([])
  })

  it('formats compact track sizes', () => {
    expect(formatLocalTrackSize(5.25 * 1024 * 1024)).toBe('5.3 MB')
    expect(formatLocalTrackSize(18 * 1024 * 1024)).toBe('18 MB')
    expect(formatLocalTrackSize(0)).toBe('0 MB')
  })
})
