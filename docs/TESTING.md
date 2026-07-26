# Testing Ultra Vision

## Local quality gate

```bash
npm ci
npm run check
```

`npm run check` runs the unit and integration suite with coverage, lint, the production build, and the high-severity dependency audit. Use `npm test` for a faster feedback loop while developing. Run the real-browser camera contract separately after installing Chromium as described below.

## Deterministic tests

Unit tests cover vision math, pixel studies, gesture pickup/release, camera-overlay remounts, audio curves, serialized and size-bounded BPM analysis, file validation, generated demo tracks, verified MediaPipe asset provenance, and the bounded Air Mix Replay recorder lifecycle. React integration tests mount the real mixer and camera hooks to verify timed Filter release, Web Audio parameters, the isolated post-master recording tap, live-stream handoff, overlay remounts, and camera restart. Prefer generated signals and landmark traces over copyrighted or personally identifying fixtures.

Coverage cannot fall below the checked-in project floor: 50% statements and lines, 40% functions, and 35% branches.

## Real-browser camera and mobile contracts

Install Ultra Vision's pinned Chromium build once, then run the camera contract:

```bash
npx playwright install chromium
npm run test:camera
```

The command builds and serves the production application on `127.0.0.1`, grants camera access to Chromium's synthetic device, and runs the real MediaPipe JavaScript, WASM, and verified model pipeline. It also exercises the First Mix experience at phone widths. It proves:

- camera startup reaches a live MediaStream and decoded video frames;
- MediaPipe processes frames and sizes the landmark canvas to the video;
- Vision ↔ DJ Room remounts preserve the same owned stream and track;
- a frame can be captured locally without an unexpected outbound request;
- stop ends the original track and clears the video source;
- restart creates a fresh live stream;
- application page errors, unexpected console errors, failed requests, and unapproved external origins fail the test;
- the generated demo reaches manual playback without requesting camera access;
- generated demo tracks loop so a cold vision-model download cannot end the demo before hand controls are ready;
- the mobile performance bar remains reachable after scrolling, exposes 44px controls, and has no horizontal overflow at 390 CSS pixels; and
- the first-mix and performance controls reflow without horizontal overflow at 320 CSS pixels.

The required harness uses Chromium's non-personal test pattern as a zero-hand negative case. A separate generated open-palm candidate is documented in [`e2e/fixtures/README.md`](../e2e/fixtures/README.md), but its test is intentionally marked `fixme`: the current single-frame fixture reaches the live pipeline without producing stable hand detection. It is excluded from `npm run test:camera` and must not be cited as passing evidence. The required contract does not prove hand-detection quality, a physical device's permission UX, Safari or Firefox behavior, deployed `vercel.json` headers, GPU performance, long-session stability, or accuracy across lighting, motion, devices, and people. Those remain separate checks. The contract deliberately exercises the production model URLs, so a sustained upstream outage will also fail the check; CI retries once to distinguish a transient network fault. It runs with one worker and uploads a trace and synthetic-only failure screenshot when it fails.

## Manual browser matrix

At minimum, check the latest stable Chrome, Safari, and Firefox on desktop. Check 390×844 and 320×844 mobile viewports for reflow even when camera support is desktop-only.

For each browser, verify:

1. Camera permission allowed, denied, missing, and busy.
2. Demo set loading, individual track replacement, playback, seeking, and reset.
3. First visible hand causes no control jump.
4. Open hand engages; fist or loss locks; Filter returns to 50%.
5. BPM Sync toggles and restores original rates.
6. With the camera live, switch Vision → DJ Room → Vision and confirm landmarks remain on the visible canvas.
7. Keyboard focus, arrow-key range control, reduced motion, and readable zoom.
8. First-mix readiness advances only when both tracks, camera, and an armed gesture are actually ready.
9. Screen-reader announcements occur on discrete readiness or clutch transitions, not on continuously changing control percentages.

## Camera automation strategy

The harness has three layers:

1. JSON landmark traces and React integration tests drive pure gesture, permission, recovery, and lifecycle logic on every pull request.
2. The production-build Chromium contract runs a zero-hand test pattern through real MediaPipe and the mobile First Mix checks on every pull request.
3. The documented generated open-palm candidate remains a `fixme` until it detects reliably; a future measured detector-quality corpus can extend it only after representation, provenance, and review rules are defined.

Do not commit a contributor's face or room recording. Crop or generate hand-only fixtures and document their provenance.

## Performance targets

These are release targets until measured and published:

- at least 24 camera frames per second on a current laptop;
- p95 gesture-to-control response below 100 ms;
- no unbounded memory growth in a 30-minute mix;
- no audible click on crossfade, level, filter, sync, or reset;
- no control jump greater than two points during gesture pickup.
