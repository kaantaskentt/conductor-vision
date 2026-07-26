# DJ Room neon performance-state QA

## Source and implementation evidence

- Visual source: user-supplied portrait neon hand-and-waveform reference (`888×1266`). It was treated as art direction for the loaded performance state, not as a literal replacement for Ultra Vision's functional layout. The source is intentionally not redistributed in this repository.
- Desktop implementation: `docs/design/ultra-vision-readiness.jpg` (`1280×720`, 1× browser viewport), with both generated demo tracks loaded and the camera off.
- Mobile implementation: `docs/design/ultra-vision-dj-room-mobile.jpg` (`390×844`, 1× browser viewport), in the same loaded, camera-off state.
- Comparison evidence: whole-state and focused header/stage contact sheets were inspected with the source and implementation in the same image during review. Those temporary contact sheets were not committed because they contain the user-supplied reference.

The two committed screenshots are synthetic, camera-off product evidence and remain portable for contributors and pull-request review.

## Comparison history

### Pass 1

- `P1 · content honesty`: the first implementation labeled the greater of two deck positions as an Air Mix timer. Seeking or looping could make that value jump. Fixed by showing explicit Deck A and Deck B playheads.
- `P1 · state honesty`: the synthetic hand artwork rendered before tracks were loaded. Fixed by mounting it only when both decks are loaded and labeling the state `Gesture visualizer` plus `Camera off`.
- `P1 · control behavior`: a quick fist-then-reopen could cancel Filter's pending neutral reset. A deliberate fist now commits Filter to `50%` immediately; the grace period remains only for recoverable tracking loss.
- `P2 · image fidelity`: `object-fit: cover` cropped the 16:9 hand asset in the wide desktop stage. Fixed with `contain` on a matching navy background.
- `P2 · layout density`: the desktop mix header was `111px` tall and the inactive stage was `256px`, pushing the decks too far below a `720px` viewport. The final values are `93px` and `230px`; deck cards begin at `y=612`.
- `P2 · mobile readability`: Deck B remained right-aligned after stacking and metadata fell to `8px`. Fixed with left alignment and `9.5px` metadata.
- `P2 · accessibility`: several reset, transport, navigation, disclosure, and quick-mix targets were below `44px`. Visible targets at `390×844` now meet the `44px` minimum.
- `P2 · visual state`: the first waveform glow formula treated the `-100…100` crossfader as `-1…1`. It now follows the existing equal-power gains across the complete range, with left/center/right deterministic coverage.
- `P2 · product claim`: active copy said `Decks synced` even though only playback rates are matched. It now says `BPM matched` / `TEMPO MATCH`, while the deck status keeps the manual-downbeat instruction.

### Pass 2

- Typography: the cyan Deck A / violet Deck B pairing, uppercase display hierarchy, tracking, and divider now carry the supplied poster's hierarchy without obscuring long accessible track names.
- Spacing and layout: the poster language is concentrated in the loaded header and existing camera stage. No extra hero card or duplicate mixer control was added.
- Viewport resilience: `scrollWidth === clientWidth` at both `1280×720` and `390×844`; no horizontal overflow, overlap, or clipped primary action was found.
- Colors and imagery: the generated local artwork follows the navy/cyan/violet source palette, preserves its full 16:9 composition, and disappears when the real camera runs.
- Copy and states: `Playheads A … · B …` and the two-BPM readout are truthful; the stage clearly says the camera is off; the changing time and BPM text is not a live region.
- Controls and semantics: exactly one BPM Sync button remains. The performance controls, setup actions, tabs, camera action, crossfader, deck transports, and reset actions remain real controls.
- Accessibility: the artwork and data-only waveform cues are decorative; track identity remains available in the heading; focus behavior, reduced-motion rules, labels, and visible mobile target sizing are preserved.
- Browser diagnostics: no warning or error console entries were present in the final loaded state.

No actionable `P0`, `P1`, or `P2` design findings remain. A future `P3` enhancement is a short, reduced-motion-aware trail made from recent real landmark frames while the camera is live; the shipped camera-off artwork does not pretend to be live detection.

Final result: passed
