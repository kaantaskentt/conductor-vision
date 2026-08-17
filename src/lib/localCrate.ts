export const MAX_LOCAL_CRATE_TRACKS = 10

const MAX_LOCAL_AUDIO_BYTES = 100 * 1024 * 1024
const AUDIO_EXTENSION = /\.(mp3|wav|flac|ogg)$/i
const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/vnd.wave',
  'audio/flac',
  'audio/x-flac',
  'audio/ogg',
])

export type LocalCrateTrack = Readonly<{
  id: string
  file: File
  name: string
  size: number
}>

export type LocalCrateSelection = Readonly<{
  tracks: LocalCrateTrack[]
  rejected: string[]
  overflow: number
}>

function displayName(file: File) {
  return file.name.replace(/\.[^.]+$/, '')
}

function isSupportedAudio(file: File) {
  if (file.size <= 0 || file.size > MAX_LOCAL_AUDIO_BYTES) return false
  if (file.type) return AUDIO_TYPES.has(file.type)
  return AUDIO_EXTENSION.test(file.name)
}

export function createLocalCrateSelection(
  files: Iterable<File>,
  limit = MAX_LOCAL_CRATE_TRACKS,
): LocalCrateSelection {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  const accepted: File[] = []
  const rejected: string[] = []
  const seen = new Set<string>()

  for (const file of files) {
    const identity = `${file.name}\u0000${file.size}\u0000${file.lastModified}`
    if (seen.has(identity)) continue
    seen.add(identity)
    if (!isSupportedAudio(file)) {
      rejected.push(file.name)
      continue
    }
    accepted.push(file)
  }

  const selected = accepted.slice(0, safeLimit)
  return {
    tracks: selected.map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      file,
      name: displayName(file),
      size: file.size,
    })),
    rejected,
    overflow: Math.max(0, accepted.length - selected.length),
  }
}

export function formatLocalTrackSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}
