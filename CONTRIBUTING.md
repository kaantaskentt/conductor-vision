# Contributing to Ultra Vision

Thanks for helping make camera-driven music interaction safer, clearer, and more fun. Small pull requests with visible evidence are the easiest to review and ship.

## Find a useful starting point

- Read the unchecked [roadmap](./ROADMAP.md) outcomes and choose the smallest
  useful slice that matches your skills.
- Check existing issues, then use the
  [issue chooser](https://github.com/kaantaskentt/ultra-vision/issues/new/choose)
  for a reproducible bug, focused feature proposal, setup question, or
  contribution-scoping question.
- Before beginning a large product, audio, camera, or model change, open a focused
  proposal so maintainers can confirm the outcome, evidence plan, and privacy
  boundary.

There may not always be a pre-labeled starter issue. If you want a bounded first
contribution, choose **Setup or contribution question** in the issue chooser,
share the area you want to learn, and ask for help reducing one roadmap outcome
to a reviewable pull request.

You do not need a camera to contribute. Vision math, gesture state, generated audio, replay lifecycle, documentation, accessibility, and much of the interface can be developed with deterministic inputs.

## Five-minute setup

Use Node.js 20.19+ or 22.12+ and npm 10.

```bash
git clone https://github.com/kaantaskentt/ultra-vision.git
cd ultra-vision
npm ci
npm run dev
```

Open the local Vite URL. Camera access requires `localhost` or HTTPS. Choose **Use mouse controls instead** and **Try generated demo tracks** to exercise both decks without supplying private or copyrighted audio.

Run a fast test pass while working:

```bash
npm test
```

Before opening a pull request, run the complete project gate:

```bash
npm run check
```

It runs tests with coverage thresholds, lint, the production build, and the high-severity dependency audit.

If your change touches camera startup, MediaPipe assets, video/canvas ownership,
capture, teardown, or a visible interaction, install Chromium once and run the
complete production-browser contract too:

```bash
npx playwright install chromium
npm run test:browser
```

This uses synthetic cameras and does not need access to your webcam. Focused
camera, generated-hand, and accessibility commands are documented in
[docs/TESTING.md](./docs/TESTING.md).

## Where to work

| Area | Starting point | What it owns |
| --- | --- | --- |
| Camera and MediaPipe | `src/hooks/useVisionRuntime.ts` | Permission, model startup, frame processing, overlay lifecycle, and gesture frames |
| DJ audio | `src/hooks/useDjMixer.ts` | Deck state, Web Audio graphs, meters, BPM estimation, and sync |
| Gesture behavior | `src/lib/gestureController.ts` | Calibration, clutch state, no-jump pickup, locking, and release |
| Replay recording | `src/lib/airMixReplay.ts` | Local recorder state, limits, codec fallback, and cleanup |
| Product surface | `src/screens/PerformanceScreen.tsx` | Camera-first setup, track loading, and live performance composition |
| Deterministic utilities | `src/lib/` | Vision, pixel, generated-demo, and lifecycle helpers |
| Product truth | `README.md`, `ROADMAP.md`, `docs/` | Shipped behavior, limitations, architecture, and testing |

Coding agents must also follow [AGENTS.md](./AGENTS.md), which records the repository's durable product invariants.

## Develop without private media

- Drive gesture logic with synthetic landmark coordinates rather than a contributor's camera recording.
- Use the generated demo set for mixer and Web Audio work.
- Keep camera and audio lifecycle behavior behind injectable or pure boundaries so jsdom tests can supply deterministic fakes.
- Never commit personal camera frames, room recordings, copyrighted tracks, secrets, browser profiles, or generated build output.
- A hand-only test fixture must document how it was produced and confirm that redistribution is permitted.

See [docs/TESTING.md](./docs/TESTING.md) for the browser matrix, deterministic camera strategy, and performance targets.

## Product principles

- Keep camera and media processing local unless a future feature obtains explicit informed consent.
- Describe the runtime honestly. MediaPipe is shipped; NVIDIA Eagle / LocateAnything is experimental research.
- Give one selected gesture control authority over one audio parameter at a time.
- Require relative pickup and an open-hand clutch before movement changes audio; preserve the crossfader's brief steady calibration step.
- Preserve keyboard navigation, visible focus, reduced motion, semantic labels, and readable contrast.
- Prefer a useful recovery path over a decorative error state.

## Pull-request workflow

1. Reproduce the problem or state the user outcome.
2. Add or update a deterministic test before changing camera, gesture, audio, or replay behavior.
3. Keep the diff focused and update documentation when the shipped behavior or limitation changes.
4. Run `npm run check`, plus `npm run test:browser` when the camera/runtime
   boundary or a visible interaction changed.
5. Open a pull request and point reviewers to the best file to inspect first.

For a visible change, attach current evidence at 1280×720 and 390×844. For camera or audio work, include either deterministic fixture evidence or a short description of the real-device flow tested. Do not upload private frames or copyrighted music as evidence.

Every pull request should explain:

- the problem and chosen solution;
- the shortest reviewer route through the diff;
- tests and failure paths covered;
- privacy, security, performance, or model-license implications;
- remaining limitations rather than implied future behavior.

By contributing, you agree that your contribution is licensed under the MIT License. Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md); support and responsible-disclosure routes are listed in [SUPPORT.md](./SUPPORT.md).
