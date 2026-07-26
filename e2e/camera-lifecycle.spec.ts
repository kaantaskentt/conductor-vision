import { expect, test, type Page } from '@playwright/test'

const allowedExternalAssets = new Set([
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
])
const haveCurrentData = 2
const knownMediaPipeDiagnostics = new Set([
  'INFO: Created TensorFlow Lite XNNPACK delegate for CPU.',
])

type CameraProbe = Readonly<{
  currentTime: number
  readyState: number
  videoWidth: number
  videoHeight: number
  streamId: string | null
  trackId: string | null
  trackState: MediaStreamTrackState | null
}>

type ExternalRequestProbe = Readonly<{
  url: string
  method: string
  postData: string | null
  authorization: string | null
  cookie: string | null
}>

async function readCameraProbe(page: Page): Promise<CameraProbe> {
  return page.locator('video.camera-feed').evaluate((element) => {
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
  await expect(page.getByText('Live on device', { exact: true })).toBeVisible()
  await expect.poll(async () => {
    const probe = await readCameraProbe(page)
    return (
      probe.readyState >= haveCurrentData &&
      probe.videoWidth > 0 &&
      probe.videoHeight > 0 &&
      probe.currentTime > 0 &&
      probe.trackState === 'live'
    )
  }).toBe(true)

  const firstTime = (await readCameraProbe(page)).currentTime
  await expect.poll(async () => (await readCameraProbe(page)).currentTime).toBeGreaterThan(firstTime)

  await expect.poll(() => page.locator('.camera-stage').evaluate((stage) => {
    const video = stage.querySelector('video.camera-feed') as HTMLVideoElement | null
    const canvas = stage.querySelector('canvas.camera-overlay') as HTMLCanvasElement | null
    return Boolean(
      video &&
      canvas &&
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      canvas.width === video.videoWidth &&
      canvas.height === video.videoHeight
    )
  })).toBe(true)
}

test('production camera survives handoff, capture, stop, and restart', async ({ page }) => {
  const runtimeProblems: string[] = []
  const externalRequestProbes: Promise<ExternalRequestProbe>[] = []

  page.on('pageerror', (error) => runtimeProblems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !knownMediaPipeDiagnostics.has(message.text())) {
      runtimeProblems.push(`console: ${message.text()}`)
    }
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    if (url.origin === 'http://127.0.0.1:4173') return

    externalRequestProbes.push(
      request.allHeaders().then((headers) => ({
        url: url.href,
        method: request.method(),
        postData: request.postData(),
        authorization: headers.authorization ?? null,
        cookie: headers.cookie ?? null,
      })),
    )
  })
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('blob:') && request.failure()?.errorText === 'net::ERR_ABORTED') {
      return
    }
    runtimeProblems.push(
      `requestfailed: ${request.url()} (${request.failure()?.errorText ?? 'unknown error'})`,
    )
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      runtimeProblems.push(`response: ${response.status()} ${response.url()}`)
    }
  })

  await page.goto('/')
  await expect(page).toHaveTitle(/Ultra Vision/)
  await expect(page.getByRole('heading', { name: 'Mix with your hands.' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.isSecureContext)).toBe(true)

  await page.getByRole('button', { name: 'Load instant demo' }).click()
  await page.getByRole('button', { name: 'Start performance' }).click()

  try {
    await expectLiveCamera(page)
    await expect.poll(() => page.locator('audio').evaluateAll((audio) =>
      audio.length === 2 && audio.every((track) => !(track as HTMLAudioElement).paused),
    )).toBe(true)
    const djRoomProbe = await readCameraProbe(page)
    expect(djRoomProbe.streamId).not.toBeNull()
    expect(djRoomProbe.trackId).not.toBeNull()

    await page.locator('video.camera-feed').evaluate((element) => {
      const stream = (element as HTMLVideoElement).srcObject as MediaStream | null
      ;(window as typeof window & { __ultraVisionOriginalTrack?: MediaStreamTrack })
        .__ultraVisionOriginalTrack = stream?.getVideoTracks()[0]
    })

    await page.getByRole('button', { name: 'Vision', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'See what the camera understands.' })).toBeVisible()
    await expectLiveCamera(page)
    await expect(
      page.getByText('Live. Camera frames stay in this browser tab.', { exact: true }),
    ).toBeVisible()
    await expect(page.locator('.fps-chip')).toHaveText(/^[1-9]\d? FPS$/)

    const visionProbe = await readCameraProbe(page)
    expect(visionProbe.streamId).toBe(djRoomProbe.streamId)
    expect(visionProbe.trackId).toBe(djRoomProbe.trackId)

    const handsMetric = page.locator('.metric-row').filter({ hasText: 'Hands' })
    await expect(handsMetric.locator('strong')).toHaveText('0')

    await page.getByRole('button', { name: 'Capture frame' }).click()
    await expect(page.getByText('Frame captured locally. Choose a study and run it.')).toBeVisible()
    await expect(page.locator('.pixel-source-chip')).toHaveText('Camera capture')

    await page.getByRole('button', { name: 'DJ Room', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: /mixed with/i })).toBeVisible()
    await expectLiveCamera(page)
    expect((await readCameraProbe(page)).streamId).toBe(djRoomProbe.streamId)

    await page.getByRole('button', { name: 'Stop camera' }).click()
    const restartCamera = page.getByRole('button', {
      name: /^(Turn on hand controls|Start performance)$/,
    })
    await expect(restartCamera).toBeVisible()
    await expect(page.getByText('Camera off', { exact: true }).first()).toBeVisible()
    await expect(page.locator('.camera-stage')).toHaveAttribute('data-camera-status', 'idle')
    await expect.poll(async () => (await readCameraProbe(page)).streamId).toBeNull()
    await expect.poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __ultraVisionOriginalTrack?: MediaStreamTrack })
          .__ultraVisionOriginalTrack?.readyState ?? null,
      ),
    ).toBe('ended')

    await restartCamera.click()
    await expectLiveCamera(page)
    const restartedProbe = await readCameraProbe(page)
    expect(restartedProbe.streamId).not.toBe(djRoomProbe.streamId)
    expect(restartedProbe.trackId).not.toBe(djRoomProbe.trackId)
  } finally {
    const stop = page.getByRole('button', { name: 'Stop camera' })
    if (await stop.isVisible().catch(() => false)) await stop.click()
  }

  const externalRequests = await Promise.all(externalRequestProbes)
  expect([...new Set(externalRequests.map(({ url }) => url))].sort()).toEqual(
    [...allowedExternalAssets].sort(),
  )
  expect(
    externalRequests.map(({ url, method, postData, authorization, cookie }) => ({
      url,
      method,
      postData,
      authorization,
      cookie,
    })).sort((left, right) => left.url.localeCompare(right.url)),
  ).toEqual(
    [...allowedExternalAssets]
      .sort()
      .map((url) => ({
        url,
        method: 'GET',
        postData: null,
        authorization: null,
        cookie: null,
      })),
  )
  expect(runtimeProblems).toEqual([])
})
