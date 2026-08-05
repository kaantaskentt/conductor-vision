import { expect, test, type Page } from '@playwright/test'

const HAND_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
const haveCurrentData = 2
const knownMediaPipeDiagnostics = new Set(['INFO: Created TensorFlow Lite XNNPACK delegate for CPU.'])

type CameraProbe = Readonly<{
  currentTime: number
  readyState: number
  videoWidth: number
  videoHeight: number
  streamId: string | null
  trackId: string | null
  trackState: MediaStreamTrackState | null
}>

function activeCamera(page: Page) {
  return page.locator('.uv-camera-preview video, .uv-performance-stage > video').first()
}

async function readCameraProbe(page: Page): Promise<CameraProbe> {
  return activeCamera(page).evaluate((element) => {
    const video = element as HTMLVideoElement
    const stream = video.srcObject instanceof MediaStream ? video.srcObject : null
    const track = stream?.getVideoTracks()[0] ?? null
    return {
      currentTime: video.currentTime,
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      streamId: stream?.id ?? null,
      trackId: track?.id ?? null,
      trackState: track?.readyState ?? null,
    }
  })
}

async function expectLiveCamera(page: Page) {
  await expect.poll(async () => {
    const probe = await readCameraProbe(page)
    return probe.readyState >= haveCurrentData && probe.videoWidth > 0 && probe.videoHeight > 0 && probe.currentTime > 0 && probe.trackState === 'live'
  }).toBe(true)
  const firstTime = (await readCameraProbe(page)).currentTime
  await expect.poll(async () => (await readCameraProbe(page)).currentTime).toBeGreaterThan(firstTime)
  await expect.poll(() => page.locator('.uv-camera-preview, .uv-performance-stage').first().evaluate((stage) => {
    const video = stage.querySelector('video') as HTMLVideoElement | null
    const canvas = stage.querySelector('canvas') as HTMLCanvasElement | null
    return Boolean(video && canvas && canvas.width === video.videoWidth && canvas.height === video.videoHeight)
  })).toBe(true)
}

test('production camera survives setup-to-performance handoff, stop, and restart', async ({ page }) => {
  test.setTimeout(360_000)
  const runtimeProblems: string[] = []
  const externalRequests: string[] = []

  page.on('pageerror', (error) => runtimeProblems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !knownMediaPipeDiagnostics.has(message.text())) {
      runtimeProblems.push(`console: ${message.text()}`)
    }
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== 'http://127.0.0.1:4173' && ['http:', 'https:'].includes(url.protocol)) {
      externalRequests.push(url.href)
      expect(request.method()).toBe('GET')
      expect(request.postData()).toBeNull()
    }
  })
  page.on('response', (response) => {
    if (response.status() >= 400) runtimeProblems.push(`response: ${response.status()} ${response.url()}`)
  })

  await page.goto('/')
  await expect(page).toHaveTitle(/Ultra Vision/)
  await expect.poll(() => page.evaluate(() => window.isSecureContext)).toBe(true)
  await page.getByRole('button', { name: 'Allow private camera' }).click()
  await expect(page.getByRole('button', { name: 'Camera ready · continue' })).toBeVisible({ timeout: 180_000 })
  await expectLiveCamera(page)
  const setupProbe = await readCameraProbe(page)

  await page.getByRole('button', { name: 'Camera ready · continue' }).click()
  await page.getByRole('button', { name: 'Try generated demo tracks' }).click()
  await expect(page.getByText('Neon Pulse', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open performance · 2 tracks' }).click()
  await expectLiveCamera(page)
  const liveProbe = await readCameraProbe(page)
  expect(liveProbe.streamId).toBe(setupProbe.streamId)
  expect(liveProbe.trackId).toBe(setupProbe.trackId)

  await page.getByRole('button', { name: 'Stop camera' }).click()
  await expect(page.getByText('Manual mode', { exact: true }).first()).toBeVisible()
  await expect.poll(async () => (await readCameraProbe(page)).streamId).toBeNull()

  await page.getByRole('button', { name: 'Start camera' }).click()
  await expectLiveCamera(page)
  const restartedProbe = await readCameraProbe(page)
  expect(restartedProbe.streamId).not.toBe(setupProbe.streamId)
  expect(restartedProbe.trackId).not.toBe(setupProbe.trackId)
  await page.getByRole('button', { name: 'Stop camera' }).click()

  expect([...new Set(externalRequests)]).toEqual([HAND_MODEL_URL])
  expect(runtimeProblems).toEqual([])
})
