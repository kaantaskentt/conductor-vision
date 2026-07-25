# Ultra Vision contributor guide for coding agents

Ultra Vision is a local-first React application for browser computer vision and gesture-controlled audio. Keep every change honest, testable, privacy-preserving, and easy to review.

## Repository map

- `src/hooks/useVisionRuntime.ts` owns camera, MediaPipe lifecycle, frame processing, and gesture-frame delivery.
- `src/hooks/useDjMixer.ts` owns deck state, Web Audio nodes, gesture control, BPM estimation, and sync.
- `src/screens/` contains the two product surfaces: DJ Room and Vision.
- `src/lib/` contains deterministic vision, pixel, and generated-demo utilities.
- `docs/` contains architecture, testing, roadmap, and future Eagle research.
- `.github/` contains CI, CodeQL, issue forms, and the pull-request template.

## Commands

Use Node.js 20.19+ or 22.12+.

```bash
npm ci
npm run check
```

`npm run check` runs tests with coverage, lint, the production build, and the high-severity dependency audit. Use `npm test` for a faster feedback loop while developing. Run the app with `npm run dev`; camera testing requires `localhost` or HTTPS.

## Product invariants

- Camera frames, uploaded images, and audio stay in the browser unless a future feature obtains explicit informed consent.
- The current shipped vision runtime is MediaPipe. NVIDIA Eagle / LocateAnything remains experimental and must not be described as shipped.
- Crossfader neutral is `0`; bipolar filter neutral is `50`; channel reset is `82`.
- A newly detected hand must not cause an audio control to jump. Gesture takeover requires relative pickup and an explicit open-hand clutch; the crossfader adds a brief steady calibration step.
- Closing the hand or losing tracking locks position controls. Filter returns smoothly to neutral after release.
- BPM Sync matches playback rate only until beat-grid and phase alignment are actually implemented.
- Do not bundle copyrighted audio, private camera captures, secrets, or generated build output.

## Code and review rules

- Prefer pure exported functions for gesture, audio, and vision math so behavior can be tested without hardware.
- Keep hot per-frame values in refs and throttle React state updates.
- Lazy-load expensive capabilities; DJ Room should not run face or pixel analysis.
- Preserve keyboard access, visible focus, reduced motion, semantic labels, and readable contrast.
- Put user-facing errors beside the action that failed and provide a recovery path.
- Avoid unrelated rewrites. Preserve user-owned untracked files.

## Definition of done

A change is complete only when:

1. Relevant deterministic tests cover the behavior and failure path.
2. Tests, lint, build, and the full dependency audit pass.
3. The rendered flow is checked at 1280×720 and 390×844 with no relevant console errors.
4. Camera/audio work is checked with a deterministic fixture or documented real-device evidence.
5. Visible changes include current screenshots in the pull request.
6. README and product claims remain aligned with the actual implementation.
