# Changelog

All notable changes to Ultra Vision will be documented here. The project follows semantic versioning once releases are tagged.

## Unreleased

### Added

- A zero-setup, locally generated two-track demo set.
- A live first-mix readiness path for tracks, camera, hand detection, and gesture pickup.
- Explicit open-hand gesture clutch with locked, calibrating, and armed states.
- Stable primary-hand selection and hand-only processing in DJ Room.
- Live analyser signal history for each deck and a bounded, post-master local replay engine.
- Self-hosted, lock-pinned MediaPipe WASM plus byte-length and SHA-256 verification for model downloads.
- A production-build Chromium camera contract covering real MediaPipe startup, tab handoff, local capture, stop, and restart without personal camera imagery.
- A dedicated one-worker camera CI job with synthetic-only failure diagnostics.
- A generated open-palm production-browser contract that proves real MediaPipe
  reaches gesture pickup without moving the neutral crossfader.
- A required browser release gate for keyboard focus, WCAG A/AA checks, mobile
  reflow, camera lifecycle, and the generated-hand happy path.
- An enforced initial-JavaScript bundle budget and a setup-question issue route
  for first-time contributors.
- Contributor guidance for Codex and other coding agents.

### Fixed

- Released gesture control exactly once and exposed a recoverable restart path when camera frames stop advancing.
- Kept hand tracking and the owned camera stream live when optional face analysis fails.
- Prevented mobile quick-deck waveforms and desktop first-mix labels from clipping their controls.
- Prevented a newly detected hand from jumping the crossfader, channel level, or filter.
- Invalidated the Filter wrist baseline after fist or tracking loss so reacquisition always calibrates before moving audio.
- Made Filter return to its neutral 50% position after hand release.
- Rebound the landmark renderer when the live camera canvas moves between Vision and DJ Room.
- Released detached camera views during tab switches while preserving the active local stream.
- Kept Web Audio parameters aligned with visible controls when replacing tracks.
- Restored the exact neutral channel taper, filter frequencies, and filter resonance after track replacement.
- Made failed two-deck playback roll both decks back to a stopped state.
- Made BPM Sync follow the audible side of the crossfader when both decks are playing.
- Kept demo loading on the live setup path instead of scrolling past the camera step.
- Corrected Shift-modified keyboard input so it provides fine knob adjustment.
- Limited assistive announcements to discrete readiness and gesture-state changes.
- Replaced private camera evidence and removed screenshots of retired Tempo and Phrase Jump controls.
- Added recovery when a vision frame fails during processing.
- Kept camera tracking near a 30 FPS inference budget without weakening the
  frozen-frame watchdog, including retry after a failed lazy model load.
- Cancelled in-progress demo synthesis when a newer local track choice or room
  change supersedes it, so stale generated audio cannot overwrite user intent.

### Changed

- Started the camera as soon as hand tracking is ready, then loaded optional face analysis in the background.
- Paused deck-meter animation while music is stopped or the page is hidden, and cleared stopped levels to zero.
- Ratcheted coverage floors near the measured suite and now exercise both advertised Node.js release lines in CI.
- Pinned CI and CodeQL actions to reviewed immutable release commits.
- Renamed misleading phrase controls to track quarters until real beat-grid cues exist.
- Moved deck meters after channel and crossfader gain and added a master limiter.
- Rebuilt DJ Room around a compact camera-first layout, hardware-style knobs, and a master-first mobile order.
- Clarified that the live deck display is analyser signal history rather than a precomputed track waveform or beat grid.
- Deferred MediaPipe until camera use and moved demo synthesis into cooperative,
  abortable work slices so camera-off startup and first interaction stay responsive.
- Refreshed the desktop, mobile, and camera-off Vision screenshots and compressed
  repository artwork without changing its dimensions or intended visual content.
