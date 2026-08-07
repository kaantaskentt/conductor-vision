# Ultra Vision roadmap

The roadmap is organized around product outcomes, not feature volume. Checked
items are implemented in the current release candidate; they do not imply that a
Git tag or GitHub Release exists.

## Release candidate — v0.2.0 (not tagged)

- [x] Two focused product surfaces: DJ Room and Vision.
- [x] Generated demo tracks, local track loading, two-deck playback, filtering,
      channel levels, crossfading, and reversible BPM-rate matching.
- [x] A guided first mix with explicit camera-off and recovery paths.
- [x] Open-palm clutch, relative no-jump takeover, and safe gesture release.
- [x] Deterministic camera, gesture, audio, permission, and lifecycle tests.
- [x] Privacy-safe real-browser camera contracts for zero-hand and generated
      open-palm cases.
- [x] Contributor, architecture, testing, security, and model-boundary docs.

## Release gate — before creating the v0.2.0 tag

- [ ] Merge the reviewed release candidate into `main` with a clean public history.
- [ ] Run `npm ci`, `npm run check`, and `npm run test:browser` from the exact
      release commit.
- [ ] Complete a physical-camera and real-audio smoke pass in current Chrome,
      including no-jump pickup, filter return to 50%, stop, and restart.
- [ ] Verify the production Vercel deployment resolves to the exact release commit
      and has no relevant browser-console errors.
- [ ] Confirm screenshots, changelog entries, limitations, and model claims match
      the shipped interface.
- [ ] Create the `v0.2.0` tag and GitHub Release only after every gate above passes.

## Next — make mixing more musically intelligent

- [ ] Decode track waveforms and add confidence-aware beat and downbeat positions.
- [ ] Add phase-aware sync against one shared transport clock; keep current BPM
      matching honestly labeled until then.
- [ ] Add local calibration profiles and dominant-hand selection without storing
      camera frames.
- [ ] Add keyboard performance shortcuts and a documented shortcut reference.
- [ ] Build Replay Studio UI on the existing privacy-safe post-master recording
      foundation.
- [ ] Publish measured startup, frame-rate, control-latency, and 30-minute
      stability results for a documented device/browser matrix.

## Later — expand the vision instrument

- [ ] Add gesture-mapping presets and community-authored control packs.
- [ ] Add local effects only with a measured audio-performance budget.
- [ ] Build a benchmark gallery across devices, browsers, lighting, and camera
      quality using consented or generated evidence.
- [ ] Research optional open-vocabulary grounding behind a separate adapter,
      consent flow, deployment boundary, and model-license review.

Ultra Vision will not upload camera or music by default, claim beat alignment from
BPM matching alone, present pixel heuristics as neural-model output, bundle
copyrighted demo music, or make the core DJ experience depend on a large hosted
model.
