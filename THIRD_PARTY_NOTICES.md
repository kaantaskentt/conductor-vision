# Third-party notices

Ultra Vision application code is MIT licensed. Dependencies and model assets keep their own licenses.

## Shipped runtime

- **React and React DOM** — MIT License.
- **MediaPipe Tasks Vision** — Apache License 2.0. The lock-pinned browser WASM files are served unchanged from this repository.
- **MediaPipe hand and face model bundles** — fetched from their exact Google-hosted upstream object URLs, verified by expected byte length and SHA-256 before use, and not redistributed in this repository because the object URLs provide no model-specific license statement.
- **Lucide** — ISC License.
- **axe-core and @axe-core/playwright** — MPL 2.0 development-only accessibility testing.
- **Vite, TypeScript, Vitest, and Oxlint** — development tooling under their respective open-source licenses.

Exact dependency versions are recorded in `package-lock.json`.
Exact runtime/model provenance and digests are recorded in [`public/vendor/mediapipe/manifest.json`](./public/vendor/mediapipe/manifest.json), with the asset-specific notice in [`public/vendor/mediapipe/THIRD_PARTY_NOTICES.md`](./public/vendor/mediapipe/THIRD_PARTY_NOTICES.md).

## Experimental research

NVIDIA Eagle / LocateAnything is not shipped in the browser runtime. Repository code and model weights may have different licenses, and LocateAnything weights are restricted to non-commercial research/evaluation use. Read [EAGLE_NEXT.md](./docs/EAGLE_NEXT.md) before implementing that adapter.
