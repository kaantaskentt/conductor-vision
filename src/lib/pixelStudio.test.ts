import { describe, expect, it } from 'vitest'
import { validatePixelStudioImage } from './pixelStudio'

describe('Pixel Studio image safeguards', () => {
  it('accepts supported browser image formats', () => {
    expect(() => validatePixelStudioImage(new File(['image'], 'frame.webp', { type: 'image/webp' }))).not.toThrow()
  })

  it('rejects unsupported types and oversized files', () => {
    expect(() =>
      validatePixelStudioImage(new File(['svg'], 'frame.svg', { type: 'image/svg+xml' })),
    ).toThrow('Choose a PNG, JPEG, or WebP image.')

    expect(() =>
      validatePixelStudioImage({
        name: 'large.png',
        type: 'image/png',
        size: 12 * 1024 * 1024 + 1,
      } as File),
    ).toThrow('Choose an image smaller than 12 MB.')
  })
})
