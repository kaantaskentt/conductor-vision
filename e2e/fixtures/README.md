# Synthetic open-palm camera fixture

`open-palm.mjpeg` is a test-only, single-frame 640×480 fake-camera fixture. It is not shipped in the web application.

## Provenance

- Created on 2026-07-25 with OpenAI's built-in image generation through Codex.
- Generated without an input or reference image. It depicts no real or identifiable person, face, room, text, logo, jewelry, or tattoo.
- Generated specifically for inclusion and redistribution with this MIT-licensed repository.
- Project use: candidate for one narrow MediaPipe smoke path from synthetic camera frame → open-palm detection → gesture pickup → mixer UI.
- SHA-256: `e2a026bbc61613ccf42b1369ebe04927c57329bd5e43c0c77a19b51c7a25455a`

## Generation prompt

> Create one clear, anatomically correct open human hand for a privacy-safe computer-vision smoke test. Use a plain matte medium-gray background. Show exactly one hand, palm directly facing the camera, five fingers naturally spread, wrist and a short section of forearm visible. Center it in a front-facing webcam composition with padding and soft even lighting. Use realistic synthetic studio-photo texture. No real or identifiable person, face, room, jewelry, tattoos, nail polish, text, logo, watermark, blur, cropped fingertips, extra limbs, or objects.

## Deterministic transform

The generated 1448×1086 PNG was resized and stripped of metadata with:

```bash
ffmpeg -i generated.png -vf scale=640:480:flags=lanczos -frames:v 1 \
  -c:v mjpeg -q:v 2 -map_metadata -1 -f mjpeg open-palm.mjpeg
```

This fixture is a documented candidate, not passing detector evidence. It reaches the live fake-camera pipeline but does not yet produce stable MediaPipe hand detection, so its test is marked `fixme` and excluded from the required CI command. Even after it passes, one image will not measure accuracy across lighting, movement, devices, skin tones, physical cameras, Safari, or Firefox.
