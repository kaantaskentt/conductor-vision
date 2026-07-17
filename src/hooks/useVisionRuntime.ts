import {
  DrawingUtils,
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
} from '@mediapipe/tasks-vision'
import {
  analyzePixels,
  createEmptyAnalysis,
  summarizeFace,
  summarizeHands,
  type GestureFrame,
  type TargetColor,
  type VisionAnalysis,
} from '../lib/vision'
import { useCallback, useEffect, useRef, useState } from 'react'

export type CameraStatus = 'idle' | 'loading' | 'running' | 'error'

type VisionRuntimeOptions = {
  targetColor: TargetColor
  onGestureFrame: (frame: GestureFrame) => void
}

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>

function cameraErrorMessage(error: unknown) {
  if (!window.isSecureContext) return 'Camera access needs HTTPS or localhost.'
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Camera permission was blocked. Allow access in your browser, then try again.'
    }
    if (error.name === 'NotFoundError') return 'No camera was found on this device.'
    if (error.name === 'NotReadableError') return 'Another app is currently using the camera.'
  }
  if (error instanceof Error && /fetch|network|model|wasm/i.test(error.message)) {
    return 'The local vision runtime could not load. Check your connection and retry.'
  }
  return 'The camera could not start. Refresh the page and try again.'
}

async function createHandLandmarker(vision: VisionFileset) {
  const options = {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' as const },
    runningMode: 'VIDEO' as const,
    numHands: 2,
    minHandDetectionConfidence: 0.38,
    minHandPresenceConfidence: 0.38,
    minTrackingConfidence: 0.38,
  }
  try {
    return await HandLandmarker.createFromOptions(vision, options)
  } catch {
    return HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'CPU' },
    })
  }
}

async function createFaceLandmarker(vision: VisionFileset) {
  const options = {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' as const },
    runningMode: 'VIDEO' as const,
    numFaces: 1,
    minFaceDetectionConfidence: 0.42,
    minFacePresenceConfidence: 0.42,
    minTrackingConfidence: 0.42,
    outputFaceBlendshapes: true,
  }
  try {
    return await FaceLandmarker.createFromOptions(vision, options)
  } catch {
    return FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
    })
  }
}

export function useVisionRuntime({ targetColor, onGestureFrame }: VisionRuntimeOptions) {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [message, setMessage] = useState('Camera is off. Processing begins only when you start it.')
  const [analysis, setAnalysis] = useState<VisionAnalysis>(() => createEmptyAnalysis(targetColor))

  const videoElementRef = useRef<HTMLVideoElement | null>(null)
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null)
  const samplerRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const handLandmarkerRef = useRef<HandLandmarker | null>(null)
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null)
  const animationRef = useRef<number | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const previousGrayRef = useRef<Uint8ClampedArray | null>(null)
  const lastFrameAtRef = useRef(performance.now())
  const lastUiUpdateRef = useRef(0)
  const frameCountRef = useRef(0)
  const runningRef = useRef(false)
  const loadingRef = useRef(false)
  const targetColorRef = useRef(targetColor)
  const gestureCallbackRef = useRef(onGestureFrame)

  useEffect(() => {
    targetColorRef.current = targetColor
    setAnalysis((current) => ({
      ...current,
      targetHex: createEmptyAnalysis(targetColor).targetHex,
    }))
  }, [targetColor])

  useEffect(() => {
    gestureCallbackRef.current = onGestureFrame
  }, [onGestureFrame])

  const setVideoElement = useCallback((element: HTMLVideoElement | null) => {
    videoElementRef.current = element
    if (element && streamRef.current) {
      element.srcObject = streamRef.current
      void element.play().catch(() => undefined)
    }
  }, [])

  const setCanvasElement = useCallback((element: HTMLCanvasElement | null) => {
    canvasElementRef.current = element
  }, [])

  const teardown = useCallback((updateState: boolean) => {
    runningRef.current = false
    loadingRef.current = false
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
    animationRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    previousGrayRef.current = null
    lastVideoTimeRef.current = -1
    frameCountRef.current = 0

    if (videoElementRef.current) videoElementRef.current.srcObject = null
    const canvas = canvasElementRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)

    if (updateState) {
      gestureCallbackRef.current({
        detected: false,
        x: 0.5,
        y: 0.5,
        wristAngle: 0,
        openFingers: 0,
      })
      setStatus('idle')
      setMessage('Camera is off. Processing begins only when you start it.')
      setAnalysis(createEmptyAnalysis(targetColorRef.current))
    }
  }, [])

  const predictLoop = useCallback(() => {
    if (!runningRef.current) return

    const video = videoElementRef.current
    const canvas = canvasElementRef.current
    const hands = handLandmarkerRef.current
    const face = faceLandmarkerRef.current

    if (!video || !canvas || !hands || !face || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      animationRef.current = requestAnimationFrame(predictLoop)
      return
    }

    if (video.currentTime === lastVideoTimeRef.current) {
      animationRef.current = requestAnimationFrame(predictLoop)
      return
    }
    lastVideoTimeRef.current = video.currentTime

    const now = performance.now()
    const sourceWidth = video.videoWidth || 1280
    const sourceHeight = video.videoHeight || 720
    canvas.width = sourceWidth
    canvas.height = sourceHeight
    const context = canvas.getContext('2d')
    if (!context) {
      animationRef.current = requestAnimationFrame(predictLoop)
      return
    }
    context.clearRect(0, 0, sourceWidth, sourceHeight)

    const handResult = hands.detectForVideo(video, now)
    const faceResult = face.detectForVideo(video, now)
    const handSummaries = summarizeHands(handResult)
    const faceSummary = summarizeFace(faceResult)

    const drawing = new DrawingUtils(context)
    handResult.landmarks.forEach((landmarks) => {
      drawing.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
        color: '#7c4dff',
        lineWidth: 4,
      })
      drawing.drawLandmarks(landmarks, {
        color: '#78d9f2',
        fillColor: '#091321',
        lineWidth: 2,
        radius: 3.5,
      })
    })

    faceResult.faceLandmarks.forEach((landmarks) => {
      drawing.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
        color: 'rgba(120, 217, 242, 0.32)',
        lineWidth: 1,
      })
    })

    let sampler = samplerRef.current
    if (!sampler) {
      sampler = document.createElement('canvas')
      sampler.width = 96
      sampler.height = 54
      samplerRef.current = sampler
    }
    const samplerContext = sampler.getContext('2d', { willReadFrequently: true })
    let pixelResult: ReturnType<typeof analyzePixels> | null = null
    if (samplerContext) {
      samplerContext.drawImage(video, 0, 0, sampler.width, sampler.height)
      pixelResult = analyzePixels(
        samplerContext.getImageData(0, 0, sampler.width, sampler.height),
        previousGrayRef.current,
        targetColorRef.current,
      )
      previousGrayRef.current = pixelResult.gray
    }

    frameCountRef.current += 1
    const frameDuration = Math.max(now - lastFrameAtRef.current, 1)
    lastFrameAtRef.current = now
    const primaryHand = handSummaries[0]
    gestureCallbackRef.current(
      primaryHand
        ? {
            detected: true,
            x: primaryHand.x,
            y: primaryHand.y,
            wristAngle: primaryHand.wristAngle,
            openFingers: primaryHand.count,
          }
        : { detected: false, x: 0.5, y: 0.5, wristAngle: 0, openFingers: 0 },
    )

    if (now - lastUiUpdateRef.current >= 90) {
      lastUiUpdateRef.current = now
      setAnalysis((current) => ({
        ...current,
        ...(pixelResult?.pixelAnalysis ?? {}),
        hands: handSummaries,
        fingerCount: handSummaries.length
          ? handSummaries.reduce((total, hand) => total + hand.count, 0)
          : null,
        ...faceSummary,
        fps: Math.min(60, Math.round(1000 / frameDuration)),
        framesProcessed: frameCountRef.current,
        motionHistory: [
          ...current.motionHistory.slice(1),
          pixelResult?.pixelAnalysis.motionScore ?? 0,
        ],
      }))
    }

    animationRef.current = requestAnimationFrame(predictLoop)
  }, [])

  const start = useCallback(async () => {
    if (loadingRef.current || runningRef.current) return
    loadingRef.current = true
    setStatus('loading')
    setMessage('Loading the local hand and face models…')

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access is not supported in this browser.')
      }
      if (!handLandmarkerRef.current || !faceLandmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
        const [handLandmarker, faceLandmarker] = await Promise.all([
          handLandmarkerRef.current
            ? Promise.resolve(handLandmarkerRef.current)
            : createHandLandmarker(vision),
          faceLandmarkerRef.current
            ? Promise.resolve(faceLandmarkerRef.current)
            : createFaceLandmarker(vision),
        ])
        handLandmarkerRef.current = handLandmarker
        faceLandmarkerRef.current = faceLandmarker
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      streamRef.current = stream
      const video = videoElementRef.current
      if (!video) throw new Error('The camera view is not available.')
      video.srcObject = stream
      await video.play()

      loadingRef.current = false
      runningRef.current = true
      lastFrameAtRef.current = performance.now()
      lastUiUpdateRef.current = 0
      setStatus('running')
      setMessage('Live. Camera frames stay in this browser tab.')
      predictLoop()
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      loadingRef.current = false
      runningRef.current = false
      setStatus('error')
      setMessage(cameraErrorMessage(error))
    }
  }, [predictLoop])

  const stop = useCallback(() => teardown(true), [teardown])

  const captureFrame = useCallback(() => {
    const video = videoElementRef.current
    if (!video || !runningRef.current || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new Error('Start the camera before capturing a frame.')
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Frame capture is not available in this browser.')
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.9)
  }, [])

  useEffect(() => {
    return () => {
      teardown(false)
      handLandmarkerRef.current?.close()
      faceLandmarkerRef.current?.close()
      handLandmarkerRef.current = null
      faceLandmarkerRef.current = null
    }
  }, [teardown])

  return {
    status,
    message,
    analysis,
    setVideoElement,
    setCanvasElement,
    start,
    stop,
    captureFrame,
  }
}
