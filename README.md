# Vision Playground

A deployable browser vision playground for testing live camera interaction.

## What it does

- **Count fingers** — MediaPipe hand landmarks + local geometry.
- **Find color** — choose a target color and see live coverage on the webcam feed.
- **Speed / motion** — local frame-difference motion meter.
- **Everything scan** — combined hand, color, and motion readout.
- **Live HUD** — top-left describes what the app sees; top-right shows cloud token usage.

## Privacy / tokens

This v1 runs entirely in the browser:

- Camera frames stay on-device.
- No backend required.
- No Gemini/OpenAI/NVIDIA API key required.
- Token usage is `0 cloud / local only`.

## Tech stack

- Vite
- React
- TypeScript
- MediaPipe Tasks Vision (`@mediapipe/tasks-vision`)
- Canvas pixel analysis

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL, press **Start camera**, and allow webcam permission.

> Camera access requires a secure context. `localhost` works locally; Vercel HTTPS works when deployed.

## Build

```bash
npm run build
npm run lint
```

## NVIDIA Eagle / LocateAnything note

NVIDIA Eagle / LocateAnything-3B is documented in `docs/EAGLE_NEXT.md` as a future backend for prompted object grounding such as:

- “Find the red mug.”
- “Draw a box around the keyboard.”
- “Which object is closest to my hand?”

It is **not used in v1** because it is a heavy server/GPU model and its model license is non-commercial/research-oriented. This first app is built to be reliable on Vercel as a client-only browser demo.

## Future modes

- Fingertip color picker / color trail game
- Pose mirror with MediaPipe PoseLandmarker
- Face expression triggers with MediaPipe FaceLandmarker
- Optional Gemini narrator through a serverless proxy, only after explicit consent because frames leave the browser and token costs apply
