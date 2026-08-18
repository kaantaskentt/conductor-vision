import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createColorMaskPreview,
  createDepthStudyPreview,
  drawPixelStudioPreview,
  validatePixelStudioImage,
} from './pixelStudio'

class FakeImage {
  naturalWidth = 2
  naturalHeight = 1
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(value: string) {
    queueMicrotask(() => {
      if (value === 'bad-image') this.onerror?.()
      else this.onload?.()
    })
  }
}

function studioCanvas() {
  const pixels = new Uint8ClampedArray([100, 100, 100, 255, 200, 0, 0, 255])
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: pixels })),
    putImageData: vi.fn(),
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => 'data:image/webp;base64,preview'),
  }
  return { canvas, context, pixels }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it('draws a bounded preview into the supplied canvas', async () => {
    vi.stubGlobal('Image', FakeImage)
    const { canvas, context } = studioCanvas()

    await drawPixelStudioPreview('frame', canvas as unknown as HTMLCanvasElement)

    expect(canvas.width).toBe(2)
    expect(canvas.height).toBe(1)
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 2, 1)
    expect(context.drawImage).toHaveBeenCalled()
  })

  it('creates deterministic color-mask and luminance previews', async () => {
    vi.stubGlobal('Image', FakeImage)

    const color = studioCanvas()
    vi.stubGlobal('document', { createElement: vi.fn(() => color.canvas) })
    await expect(createColorMaskPreview('frame')).resolves.toBe(
      'data:image/webp;base64,preview',
    )
    expect(color.pixels[0]).toBe(12)
    expect(color.pixels[4]).toBe(124)
    expect(color.context.putImageData).toHaveBeenCalled()

    const depth = studioCanvas()
    vi.stubGlobal('document', { createElement: vi.fn(() => depth.canvas) })
    await expect(createDepthStudyPreview('frame')).resolves.toBe(
      'data:image/webp;base64,preview',
    )
    expect(depth.pixels[0]).toBeGreaterThan(29)
    expect(depth.pixels[2]).toBeLessThanOrEqual(255)
    expect(depth.context.putImageData).toHaveBeenCalled()
  })

  it('reports image decode and canvas failures clearly', async () => {
    vi.stubGlobal('Image', FakeImage)
    const noContextCanvas = {
      width: 0,
      height: 0,
      getContext: () => null,
    } as unknown as HTMLCanvasElement

    await expect(drawPixelStudioPreview('bad-image', noContextCanvas)).rejects.toThrow(
      'The image could not be decoded.',
    )
    await expect(drawPixelStudioPreview('frame', noContextCanvas)).rejects.toThrow(
      'Canvas preview is not available',
    )
  })
})
