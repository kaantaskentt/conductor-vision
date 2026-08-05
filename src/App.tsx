import { useCallback, useEffect } from 'react'
import './performance.css'
import { useDjMixer } from './hooks/useDjMixer'
import { useVisionRuntime } from './hooks/useVisionRuntime'
import { PerformanceScreen } from './screens/PerformanceScreen'

function App() {
  const mixer = useDjMixer()
  const {
    handleGestureFrame,
    releaseGestureSession,
    setAudioElement,
  } = mixer
  const setDeckAAudioElement = useCallback(
    (element: HTMLAudioElement | null) => setAudioElement('a', element),
    [setAudioElement],
  )
  const setDeckBAudioElement = useCallback(
    (element: HTMLAudioElement | null) => setAudioElement('b', element),
    [setAudioElement],
  )
  const handleVisionGesture = useCallback(
    (frame: Parameters<typeof handleGestureFrame>[0]) => {
      handleGestureFrame(frame)
    },
    [handleGestureFrame],
  )
  const vision = useVisionRuntime({
    enableFace: false,
    targetColor: 'purple',
    onGestureFrame: handleVisionGesture,
  })

  useEffect(() => {
    if (vision.status === 'idle') {
      releaseGestureSession('camera-stopped')
    } else if (vision.status === 'error') {
      releaseGestureSession('camera-error')
    }
  }, [releaseGestureSession, vision.status])

  return (
    <div className="uv-app">
      <audio ref={setDeckAAudioElement} preload="metadata" />
      <audio ref={setDeckBAudioElement} preload="metadata" />
      <PerformanceScreen vision={vision} mixer={mixer} />
      <div className="sr-only" aria-live="polite">
        {vision.message}
      </div>
    </div>
  )
}

export default App
