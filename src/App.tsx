import { useState } from 'react'
import './App.css'
import {
  AppHeader,
  PrivacyFooter,
  type Screen,
} from './components/AppShell'
import { useConductorAudio } from './hooks/useConductorAudio'
import { useVisionRuntime } from './hooks/useVisionRuntime'
import type { TargetColor } from './lib/vision'
import { ConductorScreen } from './screens/ConductorScreen'
import { LabScreen } from './screens/LabScreen'
import { VisionScreen } from './screens/VisionScreen'

function App() {
  const [screen, setScreen] = useState<Screen>('conductor')
  const [targetColor, setTargetColor] = useState<TargetColor>('purple')
  const audio = useConductorAudio()
  const vision = useVisionRuntime({
    targetColor,
    onGestureFrame: audio.handleGestureFrame,
  })

  return (
    <div className="app">
      <audio ref={audio.setAudioElement} preload="metadata" />
      <AppHeader screen={screen} onScreenChange={setScreen} />
      <main id="main-content" className="app-main">
        {screen === 'vision' && (
          <VisionScreen
            vision={vision}
            targetColor={targetColor}
            onTargetColorChange={setTargetColor}
          />
        )}
        {screen === 'lab' && <LabScreen vision={vision} />}
        {screen === 'conductor' && <ConductorScreen vision={vision} audio={audio} />}
      </main>
      <PrivacyFooter />
      <div className="sr-only" aria-live="polite">
        {vision.message}
      </div>
    </div>
  )
}

export default App
