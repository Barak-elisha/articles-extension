# Regression checks

No dependency installation or real Google key is required.

1. Run `node --test tests/background.test.cjs` from the repository root (Node 18+).
2. Run `python3 -m http.server 8767 --bind 127.0.0.1` from the repository root.
3. Open `http://127.0.0.1:8767/tests/browser.html` in Chrome. Expect **11/11 passed**.

The browser tests run production sanitizer, exporter and IndexedDB code on localhost. They create and remove only their own temporary lists. Use an unused localhost port to keep fixtures separate from other local applications. The extension's chrome-extension origin data is not touched. Synthetic clipboard events exercise the paste handler with the browser's actual DOM and editing implementation. They do not prove all OS clipboard formats.

Background tests mock Chrome APIs and fetch, covering active-tab selection, full-window fallback, restricted URLs, AI request headers/payload bounds, response parsing, missing keys, HTTP errors and timeout cleanup. They do not establish native Chrome permissions or real Google service compatibility.

Before release, follow the outstanding native checks in [PRE_RELEASE_REVIEW.md](../PRE_RELEASE_REVIEW.md). Tests, screenshots and development files are not runtime extension assets; exclude them from the Store ZIP.
