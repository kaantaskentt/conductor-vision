# Contributing to Conductor Vision

Thanks for helping improve Conductor Vision. Small, focused changes are easiest to review and test.

## Development setup

```bash
npm ci
npm run dev
```

Use Node.js 20.19+ or 22.12+. Camera work must be tested on `localhost` or HTTPS.

## Before opening a pull request

Run the complete local check:

```bash
npm test
npm run lint
npm run build
npm audit --omit=dev --audit-level=high
```

For interface changes, verify Conductor, Vision, and Lab at desktop and mobile widths. Do not commit camera captures, audio files, generated build output, secrets, or local environment files.

## Product principles

- Keep camera and media processing local unless a feature clearly asks for informed consent.
- Describe the runtime honestly. Pixel heuristics are not neural models.
- Make one selected gesture control one audio parameter at a time.
- Preserve keyboard navigation, visible focus, reduced motion, and readable contrast.
- Prefer deterministic behavior and useful error messages over decorative states.

## Pull requests

Include:

- the problem and the chosen solution;
- screenshots for visible changes;
- tests or a reason they are not applicable;
- privacy, security, or model-license implications.

By contributing, you agree that your contribution is licensed under the MIT License.
