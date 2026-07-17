import {
  Camera,
  Image as ImageIcon,
  Layers3,
  LockKeyhole,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { CameraActions, CameraStage, PageIntro } from '../components/AppShell'
import type { useVisionRuntime } from '../hooks/useVisionRuntime'
import {
  createColorMaskPreview,
  createDepthStudyPreview,
  drawLabPreview,
  validateLabImage,
} from '../lib/lab'

type LabStudy = 'mask' | 'depth'

function LabPreview({ source, label }: { source: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    void drawLabPreview(source, canvas)
  }, [source])

  return (
    <figure className="lab-preview">
      <canvas ref={canvasRef}>{label}</canvas>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  )
}

export function LabScreen({ vision }: { vision: ReturnType<typeof useVisionRuntime> }) {
  const [study, setStudy] = useState<LabStudy>('mask')
  const [source, setSource] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [sourceName, setSourceName] = useState('No image selected')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(
    'These previews are deterministic pixel studies—not segmentation or depth models.',
  )
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  function clearSource() {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    setSource(null)
    setResult(null)
    setSourceName('No image selected')
    setMessage('Choose an image or capture a camera frame.')
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      validateLabImage(file)
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      const url = URL.createObjectURL(file)
      objectUrlRef.current = url
      setSource(url)
      setResult(null)
      setSourceName('Uploaded image')
      setMessage('Image ready. Run an honest local preview.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The image could not be loaded.')
    }
  }

  function capture() {
    try {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
      const dataUrl = vision.captureFrame()
      setSource(dataUrl)
      setResult(null)
      setSourceName('Camera capture')
      setMessage('Frame captured locally. Run a preview.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The frame could not be captured.')
    }
  }

  async function runStudy() {
    if (!source) {
      setMessage('Choose an image or capture a camera frame first.')
      return
    }
    setBusy(true)
    setMessage(study === 'mask' ? 'Building a color similarity mask…' : 'Building a luminance study…')
    try {
      const preview =
        study === 'mask'
          ? await createColorMaskPreview(source)
          : await createDepthStudyPreview(source)
      setResult(preview)
      setMessage(
        study === 'mask'
          ? 'Preview complete. Purple marks pixels similar to the center sample.'
          : 'Preview complete. Color maps image luminance—not physical distance.',
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The preview could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageIntro
        eyebrow="Lab"
        title="Explore pixels without the hype."
        description="Two fast, transparent browser studies for prototyping visual ideas before adding heavier models."
        actions={
          <>
            <label className="button secondary file-button">
              <Upload aria-hidden="true" />
              Upload image
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} />
            </label>
            <button
              type="button"
              className="button primary"
              onClick={capture}
              disabled={vision.status !== 'running'}
            >
              <Camera aria-hidden="true" />
              Capture frame
            </button>
          </>
        }
      />

      <section className="lab-layout">
        <aside className="lab-study-list" aria-label="Lab studies">
          <button
            type="button"
            className={study === 'mask' ? 'active' : ''}
            onClick={() => {
              setStudy('mask')
              setResult(null)
            }}
          >
            <span>
              <Layers3 aria-hidden="true" />
            </span>
            <strong>Color similarity mask</strong>
            <small>Threshold pixels around the center sample.</small>
          </button>
          <button
            type="button"
            className={study === 'depth' ? 'active' : ''}
            onClick={() => {
              setStudy('depth')
              setResult(null)
            }}
          >
            <span>
              <ImageIcon aria-hidden="true" />
            </span>
            <strong>Luminance depth study</strong>
            <small>Map brightness into a near/far-style palette.</small>
          </button>
          <div className="honesty-card">
            <LockKeyhole aria-hidden="true" />
            <strong>Honest runtime</strong>
            <p>
              No cloud upload. No neural-model claim. Eagle and promptable segmentation remain
              documented research directions.
            </p>
          </div>
        </aside>

        <div className="lab-workspace">
          <div className="lab-canvas">
            {result || source ? (
              <LabPreview
                source={result ?? source ?? ''}
                label={result ? `${study} preview` : 'Uploaded source'}
              />
            ) : (
              <CameraStage
                compact
                status={vision.status}
                message={vision.message}
                setVideoElement={vision.setVideoElement}
                setCanvasElement={vision.setCanvasElement}
              />
            )}
            {(source || result) && (
              <span className="lab-source-chip">{result ? 'Processed locally' : sourceName}</span>
            )}
          </div>
          <div className="lab-toolbar">
            <div aria-live="polite">
              <span>{study === 'mask' ? 'Color similarity mask' : 'Luminance depth study'}</span>
              <strong>{message}</strong>
            </div>
            <div>
              {(source || result) && (
                <button type="button" className="button text" onClick={clearSource}>
                  Clear
                </button>
              )}
              {!source && (
                <CameraActions status={vision.status} start={vision.start} stop={vision.stop} />
              )}
              <button
                type="button"
                className="button primary"
                onClick={() => void runStudy()}
                disabled={!source || busy}
              >
                {busy ? 'Processing…' : 'Run preview'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
