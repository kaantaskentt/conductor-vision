export type CameraOverlayLifecycle<TCanvas, TDrawing> = {
  canvas: TCanvas | null
  drawing: TDrawing | null
  lastVideoTime: number
}

export function createCameraOverlayLifecycle<TCanvas, TDrawing>(): CameraOverlayLifecycle<
  TCanvas,
  TDrawing
> {
  return {
    canvas: null,
    drawing: null,
    lastVideoTime: -1,
  }
}

export function attachCameraOverlayCanvas<TCanvas, TDrawing>(
  lifecycle: CameraOverlayLifecycle<TCanvas, TDrawing>,
  canvas: TCanvas | null,
) {
  if (lifecycle.canvas === canvas) return false

  lifecycle.canvas = canvas
  resetCameraOverlayFrame(lifecycle)
  return true
}

export function resetCameraOverlayFrame<TCanvas, TDrawing>(
  lifecycle: CameraOverlayLifecycle<TCanvas, TDrawing>,
) {
  lifecycle.drawing = null
  lifecycle.lastVideoTime = -1
}

export function claimCameraVideoFrame<TCanvas, TDrawing>(
  lifecycle: CameraOverlayLifecycle<TCanvas, TDrawing>,
  videoTime: number,
) {
  if (videoTime === lifecycle.lastVideoTime) return false

  lifecycle.lastVideoTime = videoTime
  return true
}

export function getCameraOverlayDrawing<TCanvas, TDrawing>(
  lifecycle: CameraOverlayLifecycle<TCanvas, TDrawing>,
  createDrawing: () => TDrawing,
) {
  lifecycle.drawing ??= createDrawing()
  return lifecycle.drawing
}
