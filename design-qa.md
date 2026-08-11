# Ultra Vision design QA

## Comparison inputs

- Source concept: `/Users/kaantaskent/.codex/generated_images/019f6e2f-6ca4-7df1-b6d7-b38466db7143/exec-d165389f-271a-4ea3-a5e0-6024e15ba99f.png`
- Side-by-side full-flow comparison: `/tmp/ultra-vision-design-comparison.png`
- Desktop implementation captures:
  - `/tmp/ultra-vision-camera-desktop-final.png`
  - `/tmp/ultra-vision-tracks-desktop-final.png`
  - `/tmp/ultra-vision-perform-desktop-final.png`
- Mobile implementation captures:
  - `/tmp/ultra-vision-camera-mobile-final.png`
  - `/tmp/ultra-vision-perform-mobile-final.png`
- Source pixels: 864 × 1821, containing the three intended states.
- Desktop QA viewport: 1280 × 720 CSS pixels at device scale 1.
- Mobile QA viewport: 390 × 844 CSS pixels at device scale 1.
- States reviewed: camera off, generated demo tracks loaded, camera-off demo performance. Real camera lifecycle and deterministic open-palm behavior are covered by browser tests.

## Full-view comparison

The implementation preserves the selected concept's hierarchy: a three-step camera-first flow, one primary action per setup state, a centered camera as the live emotional focus, large edge performance targets, one BPM Sync control, and two detailed cyan/violet waveforms immediately below the camera. The desktop performance workspace fits both waveforms within a 720-pixel-high viewport. The 390-pixel layout stays one column with no horizontal overflow and keeps all six performance targets at least 44 pixels tall.

The implementation deliberately uses the existing Ultra Vision header and the shipped local hand-vision artwork when no camera is active. It does not fake a live person or camera output. When a real camera is active, the existing MediaPipe video and hand overlay occupy the same centered frame without remounting the runtime.

## Focused regions

### Camera setup

- Heading, instruction, preview frame, primary permission action, demo fallback, and privacy line follow the source order.
- At 1280 × 720, the camera is 1120 × 280 and the full action group ends at y=713, so the path is usable without zooming.
- At 390 × 844, the camera is 366 × 330 and the permission button remains in the first viewport.
- The inactive camera status is honest and visually subordinate to the permission action.

### Track loading

- Deck A and optional Deck B retain cyan/violet ownership and equal visual weight.
- The implementation allows one loaded deck to continue, matching the product requirement rather than the concept's earlier two-track gate.
- Loaded track headings now reserve full card width; `READY` no longer collides with `Deck B · optional`.
- Track names truncate safely, upload controls use semantic buttons, and Deck B remains visibly optional.

### Live performance

- The centered camera measures 1160 × 290 at 1280 × 720, larger than the former DJ Room camera while leaving both waveforms visible.
- CUE and PLAY/PAUSE targets sit at the camera edges. VOLUME and FILTER are the only continuous controls presented in the primary surface.
- BPM Sync appears once, centered between the camera and waveforms, with honest disabled and locked states.
- The waveform stack ends at y=706 in the 720-pixel viewport. Deck A and Deck B remain simultaneously visible.
- The mobile camera is 366 × 330. Edge targets are 78 × 94 and center controls are 95 × 49, with no horizontal overflow.

## Findings and fix history

- P1 responsiveness: the first laptop pass pushed Deck B below a 720-pixel viewport. Fixed with a 290-pixel low-height performance camera and denser waveform rows while preserving the larger camera on taller displays.
- P2 layout: the absolutely positioned Deck B heading allowed `optional` and `READY` to collide. Fixed by pinning the heading to both card edges and adding a 12-pixel gap.
- P2 onboarding: the initial low-height camera layout hid the demo fallback below the fold. Fixed with a 280-pixel low-height setup camera; the primary action, demo fallback, and privacy statement now remain visible.
- P2 recovery: a camera failure during performance only exposed a retry button. Fixed by adding the camera message beside the performance controls with an alert role.
- P3 visual difference: the no-camera implementation uses the existing abstract hand artwork instead of the source concept's photographed performer. Accepted because the product must not imply a live camera image before permission; real video replaces the artwork after consent.

## Final result

passed

No open P0, P1, or P2 design fidelity or usability findings remain in the reviewed desktop and mobile states.
