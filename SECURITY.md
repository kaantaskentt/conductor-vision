# Security policy

## Supported version

Security fixes are applied to the latest commit on `main`.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** flow on the repository Security tab. Do not open a public issue for an unpatched vulnerability.

Include:

- the affected file, feature, or dependency;
- steps to reproduce;
- expected impact;
- any suggested mitigation.

You can expect an initial acknowledgement within seven days. Please allow time for validation and a coordinated fix before publishing details.

## Security boundaries

Ultra Vision is currently a client-only application:

- camera frames and uploaded media remain in the browser tab;
- there are no accounts, secrets, databases, or application APIs;
- lock-pinned MediaPipe WASM is served from the application origin;
- hand and face model bundles are accepted only after exact byte-length and SHA-256 verification, then supplied to MediaPipe as in-memory bytes;
- the content security policy permits the model host for those verified byte fetches, never as a script origin, and no camera frame is included in the request;
- a future server or model backend requires a new threat review before release.

## Automated checks

Every pull request runs dependency installation, tests, linting, a production build, and CodeQL analysis. GitHub dependency alerts remain enabled, while dependency updates are reviewed and applied manually.
