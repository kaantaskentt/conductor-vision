# Ultra Vision demo audio

`neon-pulse.mp3` and `midnight-circuit.mp3` are original, sample-free demo tracks generated from [`src/lib/demoAudio.ts`](../../src/lib/demoAudio.ts). They contain no third-party recordings or samples and are distributed under the repository's MIT license.

The committed MP3 versions replace runtime WAV synthesis so the first performance starts smoothly on ordinary laptops. The deterministic generator remains in the repository as the reproducible source.

The deferred `bundledDemoWaveforms.ts` module contains normalized 512-bucket peak envelopes decoded from these exact MP3 files. Shipping those peaks avoids decoding both tracks a second time during onboarding while keeping the visible waveform tied to the committed audio.
