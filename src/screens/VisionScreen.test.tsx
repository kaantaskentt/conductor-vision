/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { useVisionRuntime } from '../hooks/useVisionRuntime'
import { createEmptyAnalysis } from '../lib/vision'

const drawPixelStudioPreview = vi.hoisted(() => vi.fn())
const createColorMaskPreview = vi.hoisted(() => vi.fn())
const createDepthStudyPreview = vi.hoisted(() => vi.fn())
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

vi.mock('../lib/pixelStudio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/pixelStudio')>()
  return {
    ...actual,
    createColorMaskPreview,
    createDepthStudyPreview,
    drawPixelStudioPreview,
  }
})

import { VisionScreen } from './VisionScreen'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function createVisionFixture() {
  return {
    status: 'idle',
    message: 'Camera is off.',
    analysis: createEmptyAnalysis('purple'),
    start: vi.fn(),
    stop: vi.fn(),
    setVideoElement: vi.fn(),
    setCanvasElement: vi.fn(),
    captureFrame: vi.fn(),
  } as unknown as ReturnType<typeof useVisionRuntime>
}

function fileInput(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('.pixel-studio input[type="file"]')
  if (!input) throw new Error('Pixel Studio file input was not rendered.')
  return input
}

async function upload(input: HTMLInputElement, file: File) {
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

describe('Pixel Studio preview failures', () => {
  let root: Root
  let container: HTMLDivElement
  let objectUrlId: number

  beforeEach(async () => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    drawPixelStudioPreview.mockReset()
    drawPixelStudioPreview.mockResolvedValue(undefined)
    createColorMaskPreview.mockReset()
    createDepthStudyPreview.mockReset()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    objectUrlId = 0
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((file: File) => `blob:${++objectUrlId}-${file.name}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        <VisionScreen
          vision={createVisionFixture()}
          targetColor="purple"
          onTargetColorChange={vi.fn()}
        />,
      )
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL')
    }
    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })

  it('turns a corrupt-image decode rejection into a visible recovery message', async () => {
    drawPixelStudioPreview.mockRejectedValueOnce(
      new Error('The image could not be decoded. Try another file.'),
    )

    await upload(
      fileInput(container),
      new File(['not really a png'], 'corrupt.png', { type: 'image/png' }),
    )
    await act(async () => {
      await Promise.resolve()
    })

    const status = container.querySelector('.pixel-toolbar [aria-live="polite"] strong')
    expect(status?.textContent).toBe('The image could not be decoded. Try another file.')
    expect(container.querySelector('.pixel-preview canvas')).not.toBeNull()
  })

  it('ignores stale preview failures and never lets async drawing target the live canvas', async () => {
    const firstPreview = deferred<void>()
    const secondPreview = deferred<void>()
    drawPixelStudioPreview
      .mockImplementationOnce(() => firstPreview.promise)
      .mockImplementationOnce(() => secondPreview.promise)

    const input = fileInput(container)
    await upload(input, new File(['first'], 'first.png', { type: 'image/png' }))
    const firstPendingCanvas = drawPixelStudioPreview.mock.calls[0]?.[1] as HTMLCanvasElement
    const liveCanvas = container.querySelector<HTMLCanvasElement>('.pixel-preview canvas')
    expect(firstPendingCanvas).not.toBe(liveCanvas)
    expect(firstPendingCanvas.isConnected).toBe(false)

    await upload(input, new File(['second'], 'second.png', { type: 'image/png' }))
    const secondPendingCanvas = drawPixelStudioPreview.mock.calls[1]?.[1] as HTMLCanvasElement
    expect(secondPendingCanvas).not.toBe(liveCanvas)
    expect(secondPendingCanvas).not.toBe(firstPendingCanvas)

    await act(async () => {
      firstPreview.reject(new Error('The stale preview failed.'))
      await firstPreview.promise.catch(() => undefined)
    })

    const status = container.querySelector('.pixel-toolbar [aria-live="polite"] strong')
    expect(status?.textContent).toBe('Image ready. Choose a study and run it locally.')
    expect(status?.textContent).not.toContain('stale preview')
  })

  it('does not publish a completed study after a newer image is uploaded', async () => {
    const firstStudy = deferred<string>()
    createColorMaskPreview.mockReturnValueOnce(firstStudy.promise)

    const input = fileInput(container)
    await upload(input, new File(['first'], 'first.png', { type: 'image/png' }))

    const runButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Run study'),
    )
    if (!runButton) throw new Error('Run study button was not rendered.')
    await act(async () => runButton.click())
    expect(runButton.textContent).toContain('Processing')

    await upload(input, new File(['second'], 'second.png', { type: 'image/png' }))
    expect(runButton.textContent).toContain('Run study')

    await act(async () => {
      firstStudy.resolve('data:image/webp;base64,stale-result')
      await firstStudy.promise
    })

    const status = container.querySelector('.pixel-toolbar [aria-live="polite"] strong')
    expect(status?.textContent).toBe('Image ready. Choose a study and run it locally.')
    expect(container.textContent).not.toContain('Processed locally')
  })

  it('cancels a pending study when the selected study changes', async () => {
    const firstStudy = deferred<string>()
    createColorMaskPreview.mockReturnValueOnce(firstStudy.promise)

    await upload(
      fileInput(container),
      new File(['source'], 'source.png', { type: 'image/png' }),
    )
    const runButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Run study'),
    )
    const luminanceButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.pixel-study-list button'),
    ).find((button) => button.textContent?.includes('Luminance map'))
    if (!runButton || !luminanceButton) throw new Error('Pixel Studio controls were not rendered.')

    await act(async () => runButton.click())
    await act(async () => luminanceButton.click())
    expect(runButton.textContent).toContain('Run study')

    await act(async () => {
      firstStudy.resolve('data:image/webp;base64,stale-mask')
      await firstStudy.promise
    })

    expect(container.textContent).not.toContain('Processed locally')
    expect(container.textContent).not.toContain('Purple marks pixels')
    expect(container.textContent).toContain('Luminance map selected. Run it locally.')
  })
})
