<p align="center">
  <img src="./public/ultra-vision-icon.png" alt="Ultra Vision" width="88" />
</p>

<h1 align="center">Ultra Vision</h1>

<p align="center">
  A local-first browser instrument for real-time vision and gesture-controlled audio.
</p>

<p align="center">
  <a href="https://github.com/kaantaskentt/ultra-vision/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/kaantaskentt/ultra-vision/ci.yml?branch=main&label=CI&style=flat-square"></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-8255ff?style=flat-square"></a>
  <img alt="No backend required" src="https://img.shields.io/badge/backend-none-69d4ea?style=flat-square">
</p>

<p align="center">
  <a href="https://ultra-vision.vercel.app"><strong>Try Ultra Vision live</strong></a>
  ·
  <a href="./ROADMAP.md">Roadmap</a>
  ·
  <a href="./CONTRIBUTING.md">Contribute</a>
</p>

### Vision workspace

![Ultra Vision real-time vision analysis](./docs/design/ultra-vision-analysis.jpg)

<p align="center">
  <em>Real-time hand landmarks, face signals, motion, and color sampling—all processed locally.</em>
</p>

### DJ Room

![Ultra Vision camera and gesture clutch](./docs/design/ultra-vision-gesture-clutch.png)

![Ultra Vision generated demo set and two-deck DJ mixer](./docs/design/ultra-vision-demo-mixer.png)

Ultra Vision turns a webcam and two audio files into a private, interactive visual instrument and DJ mixer. It tracks hands and faces, studies pixels, detects track tempo, and maps deliberate movement to focused mix controls—all inside the browser tab.

## What it can do

- **Instant demo set** — generate two original rhythmic loops locally and reach a playable two-deck mix without finding audio files.
- **DJ Room** — mix two local tracks with independent transports, hardware-style level and bipolar filter knobs, track-quarter jumps, post-fader meters, a master limiter, and an equal-power crossfader.
- **BPM tools** — estimate BPM locally, tap a tempo when analysis needs help, and use one reversible BPM Sync control to match the idle deck to the playing deck.
- **Vision** — inspect hand landmarks, raised fingers, face signals, motion direction, and color coverage.
- **Pixel Studio** — run transparent color-similarity and luminance studies on an upload or captured frame inside Vision.
- **Intentional gesture routing** — choose the crossfader or one deck's channel or filter, open your hand to engage, and close it to lock. Relative pickup prevents the first frame from jumping a control.
- **Local media** — camera frames, images, and uploaded tracks are not sent to an application backend.
- **Responsive interface** — the complete workflow works from a phone-sized viewport through desktop.

## Quick start

Requirements: Node.js 20.19+ or 22.12+ and a modern Chromium, Firefox, or Safari browser.

```bash
git clone https://github.com/kaantaskentt/ultra-vision.git
cd ultra-vision
npm ci
npm run dev
```

Open the local Vite URL, choose **Start camera**, and allow camera access. Camera access requires `localhost` or HTTPS.

No API keys, database, or backend service are required.

## DJ Room workflow

1. Choose **Try demo set** for two generated local loops, or load one of your own tracks into each deck. For files up to 12 MB, Ultra Vision examines up to the first 90 seconds locally to estimate BPM. Larger files skip the memory-heavy analysis and remain ready for **Tap BPM**.
2. If a tempo is missing or incorrect, use **Tap BPM** a few times on the beat.
3. Press the center **BPM Sync** control. The playing deck becomes the master; if neither or both are playing, Deck A leads. Press it again to restore both original tempos. Sync works within the ±20% deck range, including sensible half-time and double-time matches, and preserves pitch where the browser supports it.
4. Use the track-quarter pads as coarse navigation, align the downbeat manually, then mix with the channel controls and equal-power crossfader.
5. Start the camera and route hand movement to the crossfader, channel level, or filter. Hold an open hand steady to calibrate without a jump, then move. Close your hand to lock; Filter returns to its 50% neutral position after release. Use **Reset**, **Reset mix**, or double-click a mode or knob at any time.

BPM Sync matches tempo; it does not claim automatic beat-grid or phase alignment.

## Runtime architecture

```mermaid
flowchart LR
  Camera["Webcam"] --> Vision["MediaPipe Tasks Vision"]
  Vision --> Signals["Hand, face, and gesture signals"]
  Camera --> Pixels["Canvas pixel sampling"]
  Pixels --> Signals
  DeckA["Local track A"] --> TempoA["BPM analysis + deck A graph"]
  DeckB["Local track B"] --> TempoB["BPM analysis + deck B graph"]
  Demo["Generated demo set"] --> TempoA
  Demo --> TempoB
  TempoA --> Mixer["Equal-power mixer"]
  TempoB --> Mixer
  Signals --> Mixer
  Mixer --> Output["Browser audio output"]
```

The current runtime uses:

- React 19, TypeScript, and Vite
- MediaPipe Tasks Vision for hand and face landmarks
- Canvas sampling for motion and color analysis
- Web Audio for per-deck bipolar filters, channel gain, meters, internal BPM matching, and equal-power mixing
- Lucide for accessible interface icons

## Honest model scope

NVIDIA Eagle / LocateAnything is **not** part of the current browser runtime. It is a researched next step for open-vocabulary grounding such as “find the red mug” or “locate the object closest to my hand.”

The integration plan and model-license warning live in [docs/EAGLE_NEXT.md](./docs/EAGLE_NEXT.md). Keeping this boundary explicit prevents pixel heuristics from being presented as neural-model output.

## Quality checks

```bash
npm test
npm run lint
npm run build
npm audit --audit-level=high
```

The CI workflow runs tests with coverage thresholds, lint, the production build, and a full dependency audit on every push and pull request.

## Privacy and security

- Camera and uploaded media are processed in the active browser tab.
- File types and sizes are checked before object URLs are created.
- MediaPipe's pinned browser runtime and the models required at startup are fetched from explicitly allow-listed jsDelivr and Google origins before the camera opens. If you switch a running DJ camera into Vision, the optional face model can load afterward. These origins are not sent camera frames, but they remain an external runtime trust boundary until the assets are self-hosted.
- GPU initialization falls back to CPU when needed.
- The project has no secrets, accounts, analytics, or application backend.

See [SECURITY.md](./SECURITY.md) for responsible disclosure.

## Project status

Ultra Vision is an active experimental project. Vision and two-deck mixing are functional; BPM Sync currently matches tempo rather than phase. The public roadmap covers deterministic camera tests, waveform beat grids, local performance clips, saved calibration profiles, and optional open-vocabulary grounding.

Read the [roadmap](./ROADMAP.md), [architecture](./docs/ARCHITECTURE.md), [testing strategy](./docs/TESTING.md), and [third-party notices](./THIRD_PARTY_NOTICES.md).

## Contributing

Issues and focused pull requests are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a change.

## License

The application code is available under the [MIT License](./LICENSE). Third-party models and libraries retain their own licenses. In particular, review the LocateAnything model license before any future integration or commercial use.
