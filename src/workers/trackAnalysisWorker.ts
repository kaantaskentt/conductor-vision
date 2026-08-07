import { analyzeTrackPcm } from '../lib/trackAnalysis'

type TrackAnalysisRequest = {
  channels: Float32Array[]
  sampleRate: number
  knownBpm?: number
}

self.onmessage = (event: MessageEvent<TrackAnalysisRequest>) => {
  try {
    const { channels, sampleRate, knownBpm } = event.data
    const sampleCount = channels[0]?.length ?? 0
    const mixed = new Float32Array(sampleCount)
    for (const channel of channels) {
      for (let index = 0; index < sampleCount; index += 1) {
        mixed[index] += channel[index] / channels.length
      }
    }
    self.postMessage({
      analysis: analyzeTrackPcm(mixed, sampleRate, { knownBpm }),
    })
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Track analysis failed.',
    })
  }
}
