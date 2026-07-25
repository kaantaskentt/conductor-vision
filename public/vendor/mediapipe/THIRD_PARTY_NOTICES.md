# MediaPipe third-party runtime notice

Ultra Vision serves the MediaPipe WebAssembly runtime in this directory from its own origin. It does not execute a runtime loader from a third-party CDN.

## MediaPipe Tasks Vision 0.10.35

The six files under `tasks-vision/0.10.35/wasm/` are unmodified copies from the lock-pinned npm package `@mediapipe/tasks-vision@0.10.35`.

- Package source: https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.35.tgz
- Package integrity: `sha512-HOvadwVRE6JC+45nyYhmnywnr5h/J8KZvOeUNVOG9q/0875pZgItznFB9bRTvLc264YSJqiZ1NsIpCStJw/egg==`
- Declared package license: Apache-2.0
- Included license text: [Apache License 2.0](./LICENSE-APACHE-2.0.txt)
- MediaPipe project license: https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE

The exact byte counts and SHA-256 digests are recorded in `manifest.json`.

## Externally fetched hand and face model bundles

The two `.task` model binaries are **not included or redistributed in this repository** because their object URLs do not provide clear model-specific redistribution terms. When a user starts vision, Ultra Vision fetches the exact upstream model required for the enabled feature:

- Hand Landmarker, float16 version 1: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- Face Landmarker, float16 version 1: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

Before either model is passed to MediaPipe, the application requires a successful HTTP response, the exact recorded byte count, and the recorded SHA-256 digest calculated with `crypto.subtle`. Verified model promises and buffers are cached only in memory for the current page lifetime. Failed downloads or integrity checks are rejected and are not cached.

The MediaPipe project is published under Apache-2.0, but the model object URLs do not provide a model-specific license statement or sidecar file. The manifest therefore records their model-specific license as `NOASSERTION`. Maintainers must not add these binaries to a public fork or release without first confirming redistribution terms with the upstream publisher. This notice records provenance; it is not legal advice and does not replace upstream terms.
