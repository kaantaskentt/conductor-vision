# Testing Ultra Vision

## Local quality gate

```bash
npm ci
npm run check
```

`npm run check` runs the unit and integration suite with coverage, lint, a production build, the initial-JavaScript budget, and the high-severity dependency audit. Use `npm test` for a faster feedback loop while developing. Run the real-browser camera contract separately after installing Chromium as described below.

## Deterministic tests

Unit tests cover vision math, pixel studies, gesture pickup/release, camera-overlay remounts, audio curves, serialized and size-bounded BPM analysis, full-track waveform and estimated beat-grid math, private ten-track crate validation, file validation, bundled demo loading and metadata, Air Mix planning, verified MediaPipe asset provenance, and the bounded local replay lifecycle. React integration tests mount the real mixer and camera hooks to verify timed Filter release, Web Audio parameters, independent left-hand/Deck A and right-hand/Deck B control, Local Crate routing into either deck, Demo Air Mix and Assisted Fade lifecycles, the decoded beat workspace, the isolated post-master recording tap, audio-only replay cleanup, live-stream handoff, frozen-frame release, optional face-analysis failure, overlay remounts, and camera restart. Prefer generated signals and landmark-coordinate cases over copyrighted or personally identifying fixtures.

Coverage cannot fall below the checked-in project floor: 80% statements, 72% branches, 76% functions, and 82% lines.

## Real-browser camera and mobile contracts

Install Ultra Vision's pinned Chromium build once, then run the required browser gate:

```bash
npx playwright install chromium
npm run test:browser
```

Focused commands remain available while developing:

```bash
npm run test:camera
npm run test:camera:hand
npm run test:accessibility
```

The required command builds and serves the production application once on `127.0.0.1`, then runs the real MediaPipe JavaScript, WASM, verified model pipeline, generated positive palm, mobile First Mix checks, keyboard path, and automated accessibility scans. It proves:

- camera startup reaches a live MediaStream and decoded video frames;
- MediaPipe processes frames and sizes the landmark canvas to the video;
- Vision ↔ DJ Room remounts preserve the same owned stream and track;
- a frame can be captured locally without an unexpected outbound request;
- stop ends the original track and clears the video source;
- restart creates a fresh live stream;
- application page errors, unexpected console errors, failed requests, and unapproved external origins fail the test;
- the bundled demo reaches manual playback without requesting camera access;
- bundled demo tracks loop so a cold vision-model download cannot end the demo before hand controls are ready;
- the mobile performance bar remains reachable after scrolling, exposes 44px controls, and has no horizontal overflow at 390 CSS pixels;
- the first-mix and performance controls reflow without horizontal overflow at 320 CSS pixels;
- the primary tabs and first-mix CTA are reachable in keyboard order;
- bundled-demo loading creates no browser long task of 50 ms or more; and
- the camera-off DJ Room, loaded demo, camera-off Vision workspace, and 390px loaded state have no automated WCAG A/AA violations reported by axe-core.

The focused `npm run test:camera` harness uses Chromium's non-personal test
pattern as a zero-hand negative case. `npm run test:camera:hand` is its positive
companion: a generated, provenance-documented open palm is streamed through
Chromium's file-backed camera and the shipped MediaPipe model, then the test
confirms that the crossfader becomes armed without jumping away from center. The
required `npm run test:browser` command runs both focused camera projects plus
the accessibility project in one Playwright invocation so the production build
is shared while each project's evidence remains explicit.

Neither contract proves general hand-detection quality, a physical device's
permission UX, Safari or Firefox behavior, deployed `vercel.json` headers, GPU
performance, long-session stability, or accuracy across lighting, motion,
devices, and people. Those remain separate checks. The contracts deliberately
exercise the production model URLs, so a sustained upstream outage will also
fail the check; CI retries once to distinguish a transient network fault. They
run with one worker and upload a trace and synthetic-only failure screenshot
when they fail.

## Manual browser matrix

At minimum, check the latest stable Chrome, Safari, and Firefox on desktop. Check 390×844 and 320×844 mobile viewports for reflow even when camera support is desktop-only.

For each browser, verify:

1. Camera permission allowed, denied, missing, and busy.
2. Private Local Crate selection with one, ten, and more than ten files; one-track and two-track routing; individual track replacement, playback, seeking, and reset.
3. First visible hand causes no control jump; physical left changes only Deck A and physical right changes only Deck B.
4. Open hand engages; fist or loss locks; Filter returns to 50%.
5. BPM Sync toggles and restores original rates.
6. Demo Air Mix waits for the next authored bar, transitions to the other bundled deck, and restores the source safely when cancelled.
7. Uploaded music is labeled Assisted Fade, starts without a phrase-perfect claim, and omits automatic tempo matching when beat-grid confidence is low.
8. Record captures only the post-master audio, stops cleanly, previews locally, downloads, discards, and releases its object URL and audio tap.
9. With the camera live, switch Vision → DJ Room → Vision and confirm landmarks remain on the visible canvas.
10. Keyboard focus, arrow-key range control, reduced motion, and readable zoom.
11. Camera → tracks → perform advances from real state, allows one loaded deck, and requires a trusted Start performance action before audio or Air Mix.
12. Screen-reader announcements occur on discrete readiness or clutch transitions, not on continuously changing control percentages.

## Camera automation strategy

The harness has four layers:

1. Generated landmark-coordinate cases and React integration tests drive pure gesture, permission, recovery, and lifecycle logic on every pull request. A standalone JSON trace corpus remains roadmap work.
2. The production-build Chromium contract runs a zero-hand test pattern through real MediaPipe and the mobile First Mix checks on every pull request.
3. The generated open-palm companion runs one privacy-safe positive frame through
   the real shipped model and verifies no-jump pickup. A future measured
   detector-quality corpus can extend it only after representation, provenance,
   and review rules are defined.
4. The axe-core project scans representative desktop and mobile camera-off states
   against WCAG A/AA rules and proves the primary keyboard path. Manual assistive
   technology and physical-device checks remain separate release evidence.

Do not commit a contributor's face or room recording. Crop or generate hand-only fixtures and document their provenance.

## Performance targets

The production build keeps initial JavaScript below 96 KiB gzip and requires MediaPipe to remain in a deferred chunk. This protects the camera-off first mix from paying the computer-vision parsing cost before a user asks for hand tracking.

The camera requests at most 30 FPS and the runtime independently caps model inference at 30 FPS even if a device supplies frames faster. Faster video timestamps still refresh the stall watchdog, so intentionally skipped inference frames cannot be mistaken for a frozen camera.

The following runtime targets still require measured device evidence:

- at least 24 camera frames per second on a current laptop;
- p95 gesture-to-control response below 100 ms;
- no unbounded memory growth in a 30-minute mix;
- no audible click on crossfade, level, filter, sync, or reset;
- no control jump greater than two points during gesture pickup.
