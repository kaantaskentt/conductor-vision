const MAX_LAB_IMAGE_BYTES = 12 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function validateLabImage(file: File) {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Choose a PNG, JPEG, or WebP image.')
  }
  if (file.size > MAX_LAB_IMAGE_BYTES) {
    throw new Error('Choose an image smaller than 12 MB.')
  }
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The image could not be decoded. Try another file.'))
    image.src = source
  })
}

export async function drawLabPreview(source: string, canvas: HTMLCanvasElement) {
  const image = await loadImage(source)
  const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight))
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas preview is not available in this browser.')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
}

function sourceCanvas(image: HTMLImageElement) {
  const maxDimension = 1280
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas processing is not available in this browser.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return { canvas, context }
}

export async function createColorMaskPreview(source: string) {
  const image = await loadImage(source)
  const { canvas, context } = sourceCanvas(image)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const centerX = Math.floor(canvas.width / 2)
  const centerY = Math.floor(canvas.height / 2)
  const centerOffset = (centerY * canvas.width + centerX) * 4
  const target = [
    pixels.data[centerOffset],
    pixels.data[centerOffset + 1],
    pixels.data[centerOffset + 2],
  ]

  for (let index = 0; index < pixels.data.length; index += 4) {
    const distance = Math.hypot(
      pixels.data[index] - target[0],
      pixels.data[index + 1] - target[1],
      pixels.data[index + 2] - target[2],
    )
    const selected = distance < 78
    pixels.data[index] = selected ? 124 : 12
    pixels.data[index + 1] = selected ? 74 : 19
    pixels.data[index + 2] = selected ? 245 : 31
    pixels.data[index + 3] = selected ? 245 : 185
  }

  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/webp', 0.9)
}

export async function createDepthStudyPreview(source: string) {
  const image = await loadImage(source)
  const { canvas, context } = sourceCanvas(image)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)

  for (let index = 0; index < pixels.data.length; index += 4) {
    const luminance =
      pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114
    const normalized = luminance / 255
    pixels.data[index] = Math.round(29 + normalized * 91)
    pixels.data[index + 1] = Math.round(45 + Math.sin(normalized * Math.PI) * 155)
    pixels.data[index + 2] = Math.round(86 + (1 - normalized) * 169)
  }

  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/webp', 0.9)
}
