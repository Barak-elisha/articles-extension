# Contributing

Thanks for considering contributing to Article Saver!

This is a small, fully **local-first** Chrome extension. Before you open a pull request, please keep the following guidelines in mind.

## Guiding principles

- **Local-first** — all data stays in the browser's IndexedDB and the extension never talks to a server it owns. Please keep new features local-only; do not introduce a backend or third-party service for core functionality.
- **No unnecessary dependencies** — libraries are bundled locally under `lib/` (no CDN). Avoid adding new third-party dependencies unless they are truly required.
- **Security** — any content from external pages is untrusted. New code that renders or stores such content must go through the existing sanitizer (`sanitize.js`) and keep the XSS and prompt-injection hardening intact.
- **Keep it simple** — the codebase has no build step. Prefer minimal, readable changes over clever abstractions.

## How to contribute

1. Fork the repository and create a feature branch.
2. Make your changes.
3. Test manually: load the folder as an unpacked extension (`chrome://extensions` → Developer mode → **Load unpacked**) and refresh.
4. Open a pull request with a clear description of what it changes and why.

## Reporting bugs and suggesting features

- For **bugs and feature requests**, open a [GitHub Issue](https://github.com/Barak-elisha/articles-extension/issues).
- For **security vulnerabilities or sensitive-data issues**, please do **not** open a public issue — see the [Security Policy](SECURITY.md).
