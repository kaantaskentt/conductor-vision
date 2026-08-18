import { equalPowerCrossfade } from './djAudio'

export function airMixWaveformOpacities(crossfader: number) {
  const gains = equalPowerCrossfade(crossfader)
  return {
    a: 0.35 + gains.a * 0.65,
    b: 0.35 + gains.b * 0.65,
  }
}
