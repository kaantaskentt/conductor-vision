import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  AppHeader,
  PrivacyFooter,
  type Screen,
} from './components/AppShell'
import { useDjMixer } from './hooks/useDjMixer'
import { useVisionRuntime } from './hooks/useVisionRuntime'
import type { HandSummary, TargetColor } from './lib/vision'
import { DjRoomScreen } from './screens/DjRoomScreen'
import { VisionScreen } from './screens/VisionScreen'

const ignorePrimaryGestureFrame = () => undefined

function App() {
  const [screen, setScreen] = useState<Screen>('dj-room')
  const [targetColor, setTargetColor] = useState<TargetColor>('purple')
  const mixer = useDjMixer()
  const {
    cancelDemoMix,
    handleHandsFrame,
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
  const handleVisionHands = useCallback(
    (hands: HandSummary[]) => {
      if (screen === 'dj-room') handleHandsFrame(hands)
    },
    [handleHandsFrame, screen],
  )
  const vision = useVisionRuntime({
    enableFace: screen === 'vision',
    targetColor,
    onGestureFrame: ignorePrimaryGestureFrame,
    onHandsFrame: handleVisionHands,
  })
  const previousScreenRef = useRef(screen)
  const previousCameraStatusRef = useRef(vision.status)

  useEffect(() => {
    const previousScreen = previousScreenRef.current
    const previousCameraStatus = previousCameraStatusRef.current
    previousScreenRef.current = screen
    previousCameraStatusRef.current = vision.status

    if (previousScreen === 'dj-room' && screen === 'vision') {
      cancelDemoMix()
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
  }, [cancelDemoMix, releaseGestureSession, screen, vision.status])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [screen])

  return (
    <div className="app">
      <audio ref={setDeckAAudioElement} preload="metadata" />
      <audio ref={setDeckBAudioElement} preload="metadata" />
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
