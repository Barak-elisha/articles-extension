# Pre-store review — 2 September 2026

Status: security fix verified and focused checks pass; **store release is not yet signed off**. Native extension installation, a live Gemini request, desktop Excel compatibility, and Store privacy declarations remain unverified. No Store upload or publication was performed during this review.

The review includes the working-tree UI redesign. Those existing changes were preserved. Scope covered first-party JavaScript, rendering and persistence boundaries, Chrome permissions, AI requests and Excel generation. Bundled minified dependencies received version/advisory and integration review, not a complete internal audit.

## Fixed security finding

**Low severity, high confidence: saved article markup could impersonate the extension UI.** The extractor returns text, but the old renderer inferred HTML from its contents. The sanitizer retained arbitrary classes and most CSS; crafted text could become a fixed, high-z-index overlay. No JavaScript execution, credential theft or privilege escalation was demonstrated.

The shared `sanitize.js` boundary now allows formatting-only CSS, drops classes and active markup, rejects encoded/resource styles and forces safe new-tab link behavior. New article records have explicit `contentFormat: "text"`; edited records use sanitized HTML. Legacy records are sanitized. Paste and notes persistence use the same boundary; external rich-text drops are blocked. Inert templates avoid loading resources while parsing untrusted markup. Markdown output receives final sanitization.

The original overlay and encoded-CSS triggers failed before the patch and pass after it: positioning/classes/resources are absent, literal extracted HTML remains text, and legitimate bold/italic, colors, highlights, links, Hebrew and newlines remain. A fresh read-only reviewer found no concrete surviving bypass or regression. Arbitrary page layout/class styling is intentionally not preserved.

Security files: `sanitize.js`, `sidepanel.js`, `storage.js` (content format), `excel-export.js` (safe parsing). Regression evidence: `tests/browser.js`.

## Correctness and readiness fixes

- Excel sheet names handle forbidden characters, duplicate/truncated names, reserved names and edge apostrophes. Per-list exports filter by list ID, preventing identically named lists from mixing articles. Workbook creation errors are now inside the export error handler.
- Save and chat controls guard against repeated submissions during an in-flight operation. Save captures the intended destination before awaiting extraction. Edited records refresh the library rows so reopening uses current content.
- Deleting a list and its articles is one IndexedDB transaction. Saving into a deleted destination fails instead of creating an orphan. Removing an open record returns the interface to the library.
- The retired Gemini 2.0 default is replaced with `gemini-2.5-flash`. Saved 2.0 selections resolve to the supported default. Default-model thinking is disabled so the 2,048-token output budget is available for the answer. Model refresh follows pagination, deduplicates and filters for `generateContent`, puts the key in a header, and has a 30-second timeout. AI generation has a 60-second timeout and ignores thought-only response parts. [Model lifecycle](https://ai.google.dev/gemini-api/docs/deprecations), [thinking configuration](https://ai.google.dev/gemini-api/docs/generate-content/thinking).
- Automatic summaries are off by default and the selection persists. Saving credentials or reopening the panel no longer calls Google. UI text explains when article/chat data and keys are transmitted. `PRIVACY.md` documents storage, optional processing, export and deletion.
- Removed unused `storage` permission, narrowed `<all_urls>` to HTTP/HTTPS and added explicit CSP restrictions. HTTP/HTTPS access remains needed for full-window extraction from the last web tab. `tabs` supports URL inspection; `activeTab` retains user-triggered access where Chrome site access is restricted. Store declarations must explain the actual access.
- Removed the manifest's unimplemented PDF claim and aligned README version with manifest 1.0.0. Chrome 121+ is declared because the full-window fallback uses `Tab.lastAccessed`. [Chrome API reference](https://developer.chrome.com/docs/extensions/reference/api/tabs#property-Tab-lastAccessed).

## Verification results

| Gate | Result |
| --- | --- |
| First-party JavaScript syntax (`node --check` per root JS file) | PASS |
| Diff whitespace/conflict markers (`git diff --check`) | PASS |
| Manifest runtime paths, local script assets, PNG dimensions and configured restrictions | PASS (static checks; not native manifest acceptance) |
| `node --test tests/background.test.cjs` | **8/8 PASS**; mocked Chrome/fetch, no credentials or Google requests |
| `tests/browser.html` | **11/11 PASS**; actual browser DOM, rich-paste handler, IndexedDB and generated XLSX readback |
| Local full-window UI | PASS: create/select list, save, duplicate modal/cancel, save-again into chosen list, reopen article, AI settings/default disclosure, delete temporary list and restore library; no captured console errors |
| Security patch review | PASS: one fresh read-only bypass/regression review |
| Native Chrome installation/service-worker/side-panel integration | NOT RUN: Browser URL policy rejected `chrome://extensions/`; no workaround attempted |
| Real Gemini model refresh/summary/chat | NOT RUN: no real credential or external AI request used |
| Open resulting workbook in Excel/LibreOffice | NOT RUN; browser workbook readback passed |

See [test instructions](tests/README.md) for reproducible commands. Chrome APIs are mocked in background tests: passing them is not proof of permission behavior, service-worker lifetime, real extraction across sites, or Store acceptance. Cross-window concurrent edits and OS-specific clipboard formats were not exercised.

## Remaining release gates

1. **Native smoke check:** load/reload this checkout in Chrome 121+, inspect extension errors, open the side panel from the toolbar, save a public article with AI off, close/reopen Chrome and confirm persistence. Open full-window mode, switch among two public articles, and verify the last-used article is selected. Verify restricted pages fail clearly. Repeat notes/highlights, delete the temporary list, and inspect both the panel and service-worker error logs. Browser automation could not access the required manager page because of its URL policy.
2. **Real AI check:** using your own key and a non-sensitive sample article, refresh models, choose/save a model, generate a summary, send a chat message, and confirm a response. Check Google quota/billing for that key. Do not publish a bundled key.
3. **Dependency decision:** the bundled `xlsx-js-style` includes SheetJS 0.18.5. The maintainer reports CVE-2023-30533 (prototype pollution from crafted-file reading; explicitly excludes export-only workflows) and CVE-2024-22363 (ReDoS, fixed in 0.20.2). Production code exports workbooks and has no imported-workbook entry point; that limits the demonstrated attack path, but this review does not certify all legacy parser code safe. Upgrade/replace the style fork with an audited compatible writer, or document an explicit reachability review before Store submission. Do not replace the library blindly: styled/rich-text export must still work. [Prototype-pollution advisory](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6), [ReDoS advisory](https://cdn.sheetjs.com/advisories/CVE-2024-22363).
4. **Store materials:** review and host `PRIVACY.md` at a public URL, supply that URL and accurate data-use/permission disclosures in the developer dashboard, and replace old screenshots with the current interface. Confirm the upload version is greater than any version already submitted. The dashboard was not accessed. [Chrome privacy requirements](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
5. **Package review:** include only runtime HTML/CSS/JS, manifest, icons, bundled libraries and license notices. Exclude `.git`, tests, development helpers and screenshots. Open the final exported workbook in Excel/LibreOffice and inspect all list sheets before upload.

## Audit trail

Security scan ID: `953974d0-1dff-444c-bc47-61dc32eb998b`. Finding: `csf_3e7e71a358097f042a759dd3`; occurrence: `occ_3c4191a57c33d11bdb5accbe`. The completed scan is the pre-fix snapshot; the fix report is a separate artifact. TAC advisory status was unknown; current public vendor advisories were checked separately.
