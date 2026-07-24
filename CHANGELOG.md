# Changelog

All notable changes to Ultra Vision will be documented here. The project follows semantic versioning once releases are tagged.

## Unreleased

### Added

- A zero-setup, locally generated two-track demo set.
- Explicit open-hand gesture clutch with locked and armed states.
- Stable primary-hand selection and hand-only processing in DJ Room.
- Contributor guidance for Codex and other coding agents.

### Fixed

- Prevented a newly detected hand from jumping the crossfader or channel level.
- Invalidated the Filter wrist baseline after fist or tracking loss so reacquisition always calibrates before moving audio.
- Made Filter return to its neutral 50% position after hand release.
- Rebound the landmark renderer when the live camera canvas moves between Vision and DJ Room.
- Released detached camera views during tab switches while preserving the active local stream.
- Kept Web Audio parameters aligned with visible controls when replacing tracks.
- Made failed two-deck playback roll both decks back to a stopped state.
- Added recovery when a vision frame fails during processing.

### Changed

- Renamed misleading phrase controls to track quarters until real beat-grid cues exist.
- Moved deck meters after channel and crossfader gain and added a master limiter.
