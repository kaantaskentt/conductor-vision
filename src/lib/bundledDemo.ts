export type BundledDemoAsset = {
  beatsPerBar: 4
  bpm: number
  fileName: string
  firstBarSeconds: number
  path: `/demo/${string}.mp3`
  title: string
}

export type BundledDemoTrack = {
  beatsPerBar: 4
  bpm: number
  file: File
  firstBarSeconds: number
  title: string
}

export type BundledDemoLoadOptions = {
  fetcher?: typeof fetch
  signal?: AbortSignal
}

export const BUNDLED_DEMO_ASSETS: readonly BundledDemoAsset[] = Object.freeze([
  Object.freeze({
    beatsPerBar: 4,
    bpm: 120,
    fileName: 'neon-pulse.mp3',
    firstBarSeconds: 0,
    path: '/demo/neon-pulse.mp3',
    title: 'Neon Pulse',
  }),
  Object.freeze({
    beatsPerBar: 4,
    bpm: 126,
    fileName: 'midnight-circuit.mp3',
    firstBarSeconds: 0,
    path: '/demo/midnight-circuit.mp3',
    title: 'Midnight Circuit',
  }),
])

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  throw new DOMException('Bundled demo loading was cancelled.', 'AbortError')
}

async function loadBundledDemoAsset(
  asset: BundledDemoAsset,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<BundledDemoTrack> {
  throwIfAborted(signal)
  const response = await fetcher(asset.path, {
    credentials: 'same-origin',
    signal,
  })
  throwIfAborted(signal)

  if (!response.ok) {
    const status = response.statusText
      ? `${response.status} ${response.statusText}`
      : String(response.status)
    throw new Error(`Could not load bundled demo "${asset.title}" (HTTP ${status}).`)
  }

  const blob = await response.blob()
  throwIfAborted(signal)
  if (blob.size === 0) {
    throw new Error(`Bundled demo "${asset.title}" is empty.`)
  }

  return {
    beatsPerBar: asset.beatsPerBar,
    bpm: asset.bpm,
    file: new File([blob], asset.fileName, {
      lastModified: 0,
      type: blob.type || 'audio/mpeg',
    }),
    firstBarSeconds: asset.firstBarSeconds,
    title: asset.title,
  }
}

export async function loadBundledDemoTracks(
  options: BundledDemoLoadOptions = {},
): Promise<[BundledDemoTrack, BundledDemoTrack]> {
  throwIfAborted(options.signal)
  const fetcher = options.fetcher ?? fetch
  const [deckA, deckB] = await Promise.all(
    BUNDLED_DEMO_ASSETS.map((asset) =>
      loadBundledDemoAsset(asset, fetcher, options.signal),
    ),
  )
  return [deckA, deckB]
}
