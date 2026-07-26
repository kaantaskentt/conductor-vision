import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  AppHeader,
  PrivacyFooter,
  type Screen,
} from './components/AppShell'
import { useDjMixer } from './hooks/useDjMixer'
import { useVisionRuntime } from './hooks/useVisionRuntime'
import type { TargetColor } from './lib/vision'
import { DjRoomScreen } from './screens/DjRoomScreen'
import { VisionScreen } from './screens/VisionScreen'

function App() {
  const [screen, setScreen] = useState<Screen>('dj-room')
  const [targetColor, setTargetColor] = useState<TargetColor>('purple')
  const mixer = useDjMixer()
  const { handleGestureFrame, releaseGestureSession } = mixer
  const handleVisionGesture = useCallback(
    (frame: Parameters<typeof handleGestureFrame>[0]) => {
      if (screen === 'dj-room') handleGestureFrame(frame)
    },
    [handleGestureFrame, screen],
  )
  const vision = useVisionRuntime({
    enableFace: screen === 'vision',
    targetColor,
    onGestureFrame: handleVisionGesture,
  })
  const previousScreenRef = useRef(screen)
  const previousCameraStatusRef = useRef(vision.status)

  useEffect(() => {
    const previousScreen = previousScreenRef.current
    const previousCameraStatus = previousCameraStatusRef.current
    previousScreenRef.current = screen
    previousCameraStatusRef.current = vision.status

    if (previousScreen === 'dj-room' && screen === 'vision') {
      releaseGestureSession('left-dj-room')
    } else if (
      screen === 'dj-room' &&
      previousCameraStatus !== vision.status &&
      vision.status === 'idle'
    ) {
      releaseGestureSession('camera-stopped')
    } else if (screen === 'dj-room' && vision.status === 'error') {
      releaseGestureSession('camera-error')
    }
  }, [releaseGestureSession, screen, vision.status])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [screen])

  return (
    <div className="app">
      <audio ref={(element) => mixer.setAudioElement('a', element)} preload="metadata" />
      <audio ref={(element) => mixer.setAudioElement('b', element)} preload="metadata" />
      <AppHeader screen={screen} onScreenChange={setScreen} />
      <main id="main-content" className="app-main">
        {screen === 'vision' && (
          <VisionScreen
            vision={vision}
            targetColor={targetColor}
            onTargetColorChange={setTargetColor}
          />
        )}
        {screen === 'dj-room' && <DjRoomScreen vision={vision} mixer={mixer} />}
      </main>
      <PrivacyFooter />
      <div className="sr-only" aria-live="polite">
        {vision.message}
      </div>
    </div>
  )
}

export default App
