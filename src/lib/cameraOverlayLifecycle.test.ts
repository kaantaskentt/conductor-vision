import { describe, expect, it, vi } from 'vitest'
import {
  attachCameraOverlayCanvas,
  claimCameraVideoFrame,
  createCameraOverlayLifecycle,
  getCameraOverlayDrawing,
  resetCameraOverlayFrame,
} from './cameraOverlayLifecycle'

type TestCanvas = { id: 'A' | 'B' }
type TestDrawing = { draw: () => void }

describe('camera overlay lifecycle', () => {
  it('rebinds drawing and renders the same video timestamp after canvas A remounts as B', () => {
    const lifecycle = createCameraOverlayLifecycle<TestCanvas, TestDrawing>()
    const canvasA: TestCanvas = { id: 'A' }
    const canvasB: TestCanvas = { id: 'B' }
    const renderedCanvases: Array<TestCanvas['id']> = []
    const createDrawing = vi.fn(() => {
      const boundCanvas = lifecycle.canvas
      if (!boundCanvas) throw new Error('A drawing helper needs a mounted canvas.')
      return { draw: () => renderedCanvases.push(boundCanvas.id) }
    })

    const renderFrame = (videoTime: number) => {
      if (!lifecycle.canvas || !claimCameraVideoFrame(lifecycle, videoTime)) return false
      getCameraOverlayDrawing(lifecycle, createDrawing).draw()
      return true
    }

    attachCameraOverlayCanvas(lifecycle, canvasA)
    expect(renderFrame(12.5)).toBe(true)
    expect(renderFrame(12.5)).toBe(false)

    // React callback refs detach the old canvas before attaching the new screen's canvas.
    attachCameraOverlayCanvas(lifecycle, null)
    attachCameraOverlayCanvas(lifecycle, canvasB)

    expect(renderFrame(12.5)).toBe(true)
    expect(renderedCanvases).toEqual(['A', 'B'])
    expect(createDrawing).toHaveBeenCalledTimes(2)
  })

  it('keeps the drawing cache and duplicate-frame guard when the canvas identity is unchanged', () => {
    const lifecycle = createCameraOverlayLifecycle<TestCanvas, TestDrawing>()
    const canvasA: TestCanvas = { id: 'A' }
    const createDrawing = vi.fn(() => ({ draw: vi.fn() }))

    expect(attachCameraOverlayCanvas(lifecycle, canvasA)).toBe(true)
    expect(claimCameraVideoFrame(lifecycle, 4)).toBe(true)
    const drawing = getCameraOverlayDrawing(lifecycle, createDrawing)

    expect(attachCameraOverlayCanvas(lifecycle, canvasA)).toBe(false)
    expect(claimCameraVideoFrame(lifecycle, 4)).toBe(false)
    expect(getCameraOverlayDrawing(lifecycle, createDrawing)).toBe(drawing)
    expect(createDrawing).toHaveBeenCalledTimes(1)
  })

  it('rebinds immediately when canvas A is replaced directly by canvas B', () => {
    const lifecycle = createCameraOverlayLifecycle<TestCanvas, TestDrawing>()
    const canvasA: TestCanvas = { id: 'A' }
    const canvasB: TestCanvas = { id: 'B' }
    const createDrawing = vi.fn(() => ({ draw: vi.fn() }))

    attachCameraOverlayCanvas(lifecycle, canvasA)
    expect(claimCameraVideoFrame(lifecycle, 8.25)).toBe(true)
    const drawingA = getCameraOverlayDrawing(lifecycle, createDrawing)

    expect(attachCameraOverlayCanvas(lifecycle, canvasB)).toBe(true)
    expect(claimCameraVideoFrame(lifecycle, 8.25)).toBe(true)
    const drawingB = getCameraOverlayDrawing(lifecycle, createDrawing)

    expect(lifecycle.canvas).toBe(canvasB)
    expect(drawingB).not.toBe(drawingA)
    expect(createDrawing).toHaveBeenCalledTimes(2)
  })

  it('allows the same canvas and video timestamp after camera teardown and restart', () => {
    const lifecycle = createCameraOverlayLifecycle<TestCanvas, TestDrawing>()
    const canvasA: TestCanvas = { id: 'A' }
    const createDrawing = vi.fn(() => ({ draw: vi.fn() }))

    attachCameraOverlayCanvas(lifecycle, canvasA)
    expect(claimCameraVideoFrame(lifecycle, 12.5)).toBe(true)
    const firstDrawing = getCameraOverlayDrawing(lifecycle, createDrawing)

    resetCameraOverlayFrame(lifecycle)

    expect(lifecycle.canvas).toBe(canvasA)
    expect(claimCameraVideoFrame(lifecycle, 12.5)).toBe(true)
    const restartedDrawing = getCameraOverlayDrawing(lifecycle, createDrawing)
    expect(restartedDrawing).not.toBe(firstDrawing)
    expect(createDrawing).toHaveBeenCalledTimes(2)
  })
})
