import { describe, expect, it, vi } from 'vitest'
import {
  BUNDLED_DEMO_ASSETS,
  loadBundledDemoTracks,
} from './bundledDemo'

function audioResponse(content: string, type = 'audio/mpeg') {
  return new Response(new Blob([content], { type }), { status: 200 })
}

describe('bundled demo loader', () => {
  it('loads the two fixed same-origin MP3 assets as mix-ready Files', async () => {
    const signal = new AbortController().signal
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = String(input)
      return audioResponse(path.includes('neon-pulse') ? 'deck-a' : 'deck-b')
    })

    const tracks = await loadBundledDemoTracks({ fetcher, signal })

    expect(fetcher.mock.calls).toEqual([
      [
        '/demo/neon-pulse.mp3',
        { credentials: 'same-origin', signal },
      ],
      [
        '/demo/midnight-circuit.mp3',
        { credentials: 'same-origin', signal },
      ],
    ])
    expect(tracks.map(({ beatsPerBar, bpm, file, firstBarSeconds, title }) => ({
      beatsPerBar,
      bpm,
      firstBarSeconds,
      lastModified: file.lastModified,
      name: file.name,
      title,
      type: file.type,
    }))).toEqual([
      {
        beatsPerBar: 4,
        bpm: 120,
        firstBarSeconds: 0,
        lastModified: 0,
        name: 'neon-pulse.mp3',
        title: 'Neon Pulse',
        type: 'audio/mpeg',
      },
      {
        beatsPerBar: 4,
        bpm: 126,
        firstBarSeconds: 0,
        lastModified: 0,
        name: 'midnight-circuit.mp3',
        title: 'Midnight Circuit',
        type: 'audio/mpeg',
      },
    ])
    await expect(Promise.all(tracks.map((track) => track.file.text()))).resolves.toEqual([
      'deck-a',
      'deck-b',
    ])
  })

  it('keeps its runtime manifest limited to same-origin public assets', () => {
    expect(BUNDLED_DEMO_ASSETS.map((asset) => asset.path)).toEqual([
      '/demo/neon-pulse.mp3',
      '/demo/midnight-circuit.mp3',
    ])
    for (const asset of BUNDLED_DEMO_ASSETS) {
      expect(asset.path).toMatch(/^\/demo\/[a-z0-9-]+\.mp3$/)
      expect(asset.path).not.toMatch(/^https?:\/\//)
      expect(Object.isFrozen(asset)).toBe(true)
    }
    expect(Object.isFrozen(BUNDLED_DEMO_ASSETS)).toBe(true)
  })

  it('rejects a non-successful asset response with the affected title', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('neon-pulse')
        ? new Response(null, { status: 404, statusText: 'Not Found' })
        : audioResponse('deck-b'),
    )

    await expect(loadBundledDemoTracks({ fetcher })).rejects.toThrow(
      'Could not load bundled demo "Neon Pulse" (HTTP 404 Not Found).',
    )
  })

  it('rejects a successful response whose audio body is empty', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('neon-pulse')
        ? audioResponse('')
        : audioResponse('deck-b'),
    )

    await expect(loadBundledDemoTracks({ fetcher })).rejects.toThrow(
      'Bundled demo "Neon Pulse" is empty.',
    )
  })

  it('forwards cancellation and does no work when already aborted', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>()
    controller.abort()

    await expect(
      loadBundledDemoTracks({ fetcher, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('checks cancellation again after a response is received', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>(async () => {
      controller.abort()
      return audioResponse('audio')
    })

    await expect(
      loadBundledDemoTracks({ fetcher, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('uses the MP3 MIME type when the static server omits content type', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => audioResponse('audio', ''))

    const tracks = await loadBundledDemoTracks({ fetcher })

    expect(tracks.every((track) => track.file.type === 'audio/mpeg')).toBe(true)
  })
})
