# Testing Ultra Vision

## Local quality gate

```bash
npm ci
npm test
npm run test:coverage
npm run lint
npm run build
npm audit --audit-level=high
```

## Deterministic tests

Unit tests cover vision math, pixel studies, gesture pickup/release, camera-overlay remounts, audio curves, BPM math, file validation, generated demo tracks, and the bounded Air Mix Replay recorder lifecycle. React integration tests mount the real mixer and camera hooks to verify timed Filter release, Web Audio parameters, the isolated post-master recording tap, live-stream handoff, overlay remounts, and camera restart. Prefer generated signals and landmark traces over copyrighted or personally identifying fixtures.

Coverage cannot fall below the checked-in project floor: 50% statements and lines, 40% functions, and 35% branches.

## Manual browser matrix

At minimum, check the latest stable Chrome, Safari, and Firefox on desktop. Check a 390×844 mobile viewport for reflow even when camera support is desktop-only.

For each browser, verify:

1. Camera permission allowed, denied, missing, and busy.
2. Demo set loading, individual track replacement, playback, seeking, and reset.
3. First visible hand causes no control jump.
4. Open hand engages; fist or loss locks; Filter returns to 50%.
5. BPM Sync toggles and restores original rates.
6. With the camera live, switch Vision → DJ Room → Vision and confirm landmarks remain on the visible canvas.
7. Keyboard focus, arrow-key range control, reduced motion, and readable zoom.

## Camera automation strategy

The target harness has three layers:

1. JSON landmark traces drive pure gesture logic on every pull request.
2. Browser tests inject deterministic detector and permission results.
3. A consented hand-only fake-camera clip runs through real MediaPipe in scheduled CI.

Do not commit a contributor's face or room recording. Crop or generate hand-only fixtures and document their provenance.

## Performance targets

These are release targets until measured and published:

- at least 24 camera frames per second on a current laptop;
- p95 gesture-to-control response below 100 ms;
- no unbounded memory growth in a 30-minute mix;
- no audible click on crossfade, level, filter, sync, or reset;
- no control jump greater than two points during gesture pickup.
