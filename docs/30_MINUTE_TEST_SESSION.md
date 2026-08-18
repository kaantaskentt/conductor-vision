# Ultra Vision 30-Minute Acceptance Session

Use this checklist to test the exact experience that matters: camera setup, two-hand control, deck transport, BPM Sync, Assisted Fade, and local recording. Run it on the Vercel preview unless a test says to compare localhost.

## Before you begin - 2 minutes

- Use Chrome or Edge on a laptop.
- Lower system volume before the first playback test.
- Keep two tracks ready. For the cleanest Assisted Fade test, choose tracks within 4 BPM of each other.
- Sit far enough back that both hands fit inside the camera.
- Start one short Record & Replay capture when Codex asks you to. Do not include private tabs, passwords, or unrelated applications.

## Feedback format

Reply with one line per failed test:

```text
TEST ID | PASS or FAIL | what you did | what happened | severity 1-5 | video time
```

Example:

```text
AF-2 | FAIL | A was playing at 0:32 and I pressed Assisted Fade to B | output dipped for one second and B entered late | 4 | 18:42
```

Severity:

- 1: Cosmetic only.
- 2: Noticeable but usable.
- 3: Interrupts the flow.
- 4: Feature is unreliable.
- 5: Crash, silence, privacy issue, or data loss.

## Test 1 - First entry and camera - 3 minutes

### CAM-1 - First screen

1. Open the app in a fresh tab.
2. Confirm Camera is step 1, Load Tracks is step 2, and Perform is step 3.
3. Confirm the privacy message says processing stays on the device.

Expected: one obvious Allow camera action, no mixer overload, no horizontal scrolling.

### CAM-2 - Camera recovery

1. Allow the camera.
2. Raise one open hand, then both hands.
3. Stop the camera from the performance actions menu.
4. Start it again.

Expected: the same page recovers, the hand overlay returns, and loaded tracks are not lost.

## Test 2 - Track loading and transport - 4 minutes

### LOAD-1 - Private Local Crate

1. Choose 3 to 10 local audio files.
2. Send one track to Deck A and a different track to Deck B.
3. Replace Deck B with another crate track.

Expected: files remain local, both track names update correctly, and Deck A keeps its current position and settings when Deck B changes.

### PLAY-1 - Play, Pause, and Cue

1. Play Deck A for five seconds, pause it, then play again.
2. Press Cue on Deck A.
3. Repeat on Deck B.

Expected: Play and Pause never affect the other deck. Cue pauses only its deck and returns it to 0:00 without resetting Volume, Filter, or BPM.

## Test 3 - Volume and Filter - 4 minutes

### VOL-1 - Left hand controls Deck A

1. Select Deck A Volume.
2. Show the left hand without moving for one second.
3. Move it slowly up, then down.
4. Close the hand.

Expected: Volume does not jump on first detection. Movement is smooth and stops when the hand closes.

### FIL-1 - Right hand controls Deck B

1. Select Deck B Filter.
2. Show the right hand without rotating for one second.
3. Rotate the wrist in both directions.
4. Close the hand or remove it from view.

Expected: Filter starts from its current value, moves clearly in both directions, then returns smoothly to 50 percent neutral after release.

## Test 4 - Two hands and air selection - 4 minutes

### HAND-1 - Simultaneous control

1. Play both decks at a safe volume.
2. Use the left hand to move Deck A Volume.
3. At the same time, rotate the right wrist to move Deck B Filter.
4. Cross the hands briefly, then separate them.

Expected: each hand keeps its deck. No deck swap, sudden jump, or stuck control occurs.

### AIR-1 - Point and dwell

1. Point at Cue A, Play A, Volume A, and Filter A.
2. Repeat on the visible Deck B controls.
3. Move through the empty center of the camera without dwelling on a control.

Expected: the cursor matches the fingertip, only the intended control activates, and passing through empty space does nothing.

## Test 5 - BPM Sync - 3 minutes

### BPM-1 - Reversible sync

1. Load two tracks with detected BPM values.
2. Note both displayed BPM values.
3. Start both tracks and enable BPM Sync.
4. Disable BPM Sync.

Expected: the target deck displays its effective matched BPM while Sync is active. Disabling Sync restores both original playback rates. Sync must not claim phrase or downbeat alignment.

## Test 6 - Assisted Fade - 6 minutes

Use uploaded tracks for this test. The button must say Assisted Fade, not Demo Air Mix.

### AF-1 - A to B transition

1. Load tracks within 4 BPM if possible.
2. Start Deck A and let it play for at least 20 seconds.
3. Keep Deck B paused near 0:00.
4. Press Assisted Fade once.
5. Do not touch another control until it completes.

Expected: Deck B starts once, audible output never drops to silence, Deck A decreases smoothly, Deck B increases smoothly, and Deck B finishes live.

Listen specifically for:

- a sudden volume hole;
- both songs becoming too loud;
- tempo flutter or pitch wobble;
- Deck B entering noticeably late;
- the button getting stuck in a running state.

### AF-2 - Cancel halfway

1. Start another A to B Assisted Fade.
2. Cancel around the halfway point.

Expected: Deck A becomes the stable audible source again. Deck B pauses at the position it held before the transition, not 0:00 unless it began at 0:00.

### AF-3 - Reverse transition

1. Make Deck B the audible source.
2. Run Assisted Fade from B back to A.

Expected: the reverse path is as smooth as A to B. Report which direction sounds worse.

## Test 7 - Record and recovery - 2 minutes

### REC-1 - Local recording

1. Start Record.
2. Play or mix for 20 seconds.
3. Stop, preview, download, then discard the preview.

Expected: the file contains the master audio, playback remains audible while recording, and the UI says the recording stays on the device.

### ERR-1 - Safe interruption

1. Start an Assisted Fade.
2. Change tracks or leave Perform.

Expected: the transition cancels safely with no stuck automation, no silence, and no console error shown to the user.

## Test 8 - Final score - 2 minutes

Rate each item from 1 to 5:

- Camera confidence:
- Hand tracking confidence:
- Volume feel:
- Filter feel:
- Air selection accuracy:
- Assisted Fade quality:
- Visual clarity:
- Overall demo readiness:

Finish with:

```text
BIGGEST PROBLEM:
BEST MOMENT:
ONE THING TO REMOVE:
ONE THING TO ADD:
WOULD I DEMO THIS TOMORROW: YES / NO
```

## Build sequence after this session

### Phase 1 - Instrument reliability

- Tune Assisted Fade from real recordings.
- Add per-track analysis confidence and a visible transition recommendation.
- Add a short camera and hand calibration step.
- Lock regression fixtures for every reported failure.

### Phase 2 - Smarter transitions

- Move from estimated tempo matching to a shared audio transport.
- Add downbeat and phrase-confidence analysis.
- Offer recommended transition points without claiming certainty.
- Keep manual cancel and manual transport available at all times.

### Phase 3 - Create music

- Add a server-side provider boundary for Suno or another licensed generator.
- Send text direction only by default. Never send camera frames or local audio without explicit consent.
- Normalize generated audio into the existing local deck loader.
- Add spend limits, job status, failure recovery, and clear music rights.

### Phase 4 - Publish and monetize

- Add opt-in video capture and a local 16:9 performance compositor.
- Add trim, preview, export, and explicit upload.
- Add accounts, paid entitlements, storage retention controls, and deletion.
- Ship sharing only after privacy, licensing, and moderation boundaries are explicit.
