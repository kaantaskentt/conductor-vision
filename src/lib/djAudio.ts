import { clamp } from './vision'

export function equalPowerCrossfade(value: number) {
  const position = clamp((value + 100) / 200)
  return {
    a: Math.cos(position * Math.PI * 0.5),
    b: Math.sin(position * Math.PI * 0.5),
  }
}
