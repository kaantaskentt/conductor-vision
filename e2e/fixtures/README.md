# Synthetic open-palm camera fixtures

`open-palm.mjpeg` is the test-only synthetic source image. `open-palm.y4m` is the
single-frame 640×480 YUV4MPEG2 stream consumed by Chromium's file-backed fake
camera. Neither fixture is shipped in the web application.

## Provenance

- Created on 2026-07-25 with OpenAI's built-in image generation through Codex.
- Generated without an input or reference image. It depicts no real or identifiable person, face, room, text, logo, jewelry, or tattoo.
- Generated specifically for inclusion and redistribution with this MIT-licensed repository.
- Project use: one narrow MediaPipe smoke path from synthetic camera frame → open-palm detection → gesture pickup → mixer UI.
- Source MJPEG SHA-256: `e2a026bbc61613ccf42b1369ebe04927c57329bd5e43c0c77a19b51c7a25455a`
- Fake-camera Y4M SHA-256: `6e3eb12207d988cb2c44991ff7731ff1004eabff65882169d86a0b1988ef9b8d`

## Generation prompt

> Create one clear, anatomically correct open human hand for a privacy-safe computer-vision smoke test. Use a plain matte medium-gray background. Show exactly one hand, palm directly facing the camera, five fingers naturally spread, wrist and a short section of forearm visible. Center it in a front-facing webcam composition with padding and soft even lighting. Use realistic synthetic studio-photo texture. No real or identifiable person, face, room, jewelry, tattoos, nail polish, text, logo, watermark, blur, cropped fingertips, extra limbs, or objects.

## Deterministic transform

The generated 1448×1086 PNG was resized and stripped of metadata to create the
source image:

```bash
ffmpeg -i generated.png -vf scale=640:480:flags=lanczos -frames:v 1 \
  -c:v mjpeg -q:v 2 -map_metadata -1 -f mjpeg open-palm.mjpeg
```

That source is deterministically converted to Chromium's Y4M camera format with:

```bash
ffmpeg -f mjpeg -i open-palm.mjpeg \
  -vf 'scale=640:480:flags=lanczos,format=yuv420p' \
  -frames:v 1 -r 30 -f yuv4mpegpipe open-palm.y4m
```

The generated stream passes a narrow Chromium smoke contract through the real
shipped MediaPipe model: the hand is detected, Filter can be selected, and relative
pickup leaves its neutral value unchanged. One synthetic image does not
measure accuracy across lighting, movement, devices, skin tones, physical cameras,
Safari, or Firefox.
