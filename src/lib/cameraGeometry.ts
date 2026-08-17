export type CameraCoverGeometry = Readonly<{
  sourceWidth: number
  sourceHeight: number
  stageWidth: number
  stageHeight: number
  objectPositionX: number
  objectPositionY: number
}>

export type CameraStagePoint = Readonly<{
  x: number
  y: number
  visible: boolean
}>

/**
 * Maps display-oriented MediaPipe coordinates into the stage coordinates used
 * by DOM overlays when the camera is rendered with object-fit: cover.
 *
 * The caller owns mirroring. Ultra Vision's HandSummary coordinates are
 * already mirrored to match the selfie preview, so this function must not
 * reverse the x axis again.
 */
export function mapCameraPointToStage(
  x: number,
  y: number,
  geometry: CameraCoverGeometry,
): CameraStagePoint {
  const {
    sourceWidth,
    sourceHeight,
    stageWidth,
    stageHeight,
    objectPositionX,
    objectPositionY,
  } = geometry

  if (
    sourceWidth <= 0 || sourceHeight <= 0 ||
    stageWidth <= 0 || stageHeight <= 0 ||
    !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
    !Number.isFinite(stageWidth) || !Number.isFinite(stageHeight)
  ) {
    return { x, y, visible: false }
  }

  const scale = Math.max(stageWidth / sourceWidth, stageHeight / sourceHeight)
  const renderedWidth = sourceWidth * scale
  const renderedHeight = sourceHeight * scale
  const offsetX = (stageWidth - renderedWidth) * objectPositionX
  const offsetY = (stageHeight - renderedHeight) * objectPositionY
  const stageX = (offsetX + x * renderedWidth) / stageWidth
  const stageY = (offsetY + y * renderedHeight) / stageHeight

  return {
    x: stageX,
    y: stageY,
    visible: stageX >= 0 && stageX <= 1 && stageY >= 0 && stageY <= 1,
  }
}
