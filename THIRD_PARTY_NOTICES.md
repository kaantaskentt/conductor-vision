# Third-party notices

Ultra Vision application code is MIT licensed. Dependencies and model assets keep their own licenses.

## Shipped runtime

- **React and React DOM** — MIT License.
- **MediaPipe Tasks Vision** — Apache License 2.0. Browser WASM is loaded from jsDelivr and hand/face model assets are loaded from Google-hosted MediaPipe model storage.
- **Lucide** — ISC License.
- **Vite, TypeScript, Vitest, and Oxlint** — development tooling under their respective open-source licenses.

Exact dependency versions are recorded in `package-lock.json`.

## Experimental research

NVIDIA Eagle / LocateAnything is not shipped in the browser runtime. Repository code and model weights may have different licenses, and LocateAnything weights are restricted to non-commercial research/evaluation use. Read [EAGLE_NEXT.md](./docs/EAGLE_NEXT.md) before implementing that adapter.
