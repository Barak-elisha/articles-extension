# Security Policy

Article Saver stores API keys and article data locally in your browser's IndexedDB. Because of this, we take security and privacy seriously, and we ask you to do the same when reporting issues.

## Reporting a vulnerability

If you discover a security vulnerability or a sensitive-data issue, **please do not open a public issue** (GitHub Issues are public).

Instead, contact the maintainer directly via GitHub:

- **GitHub:** [Barak-elisha](https://github.com/Barak-elisha)

When reporting, please include:

- A clear description of the issue and its impact.
- Steps to reproduce it (if applicable).
- Any fixes or mitigations you may already have in mind.

## What happens next

1. We will acknowledge your report and start working on a fix as soon as possible.
2. The issue will be handled privately until it is resolved and can be disclosed safely.

## Security reminders

- **Your API key is yours** — the extension stores it only in your local browser storage. Anyone with access to your browser profile could read it, so treat it like a password and revoke/regenerate it in [Google AI Studio](https://aistudio.google.com/) if it is ever exposed.
- Content extracted from external sites is treated as untrusted: it is sanitized before storage and rendering, and never executed as scripts.
