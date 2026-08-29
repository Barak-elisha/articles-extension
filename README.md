# Article Saver

A Chrome extension (Manifest V3, `version 1.0.0`) for saving articles to lists, generating AI summaries, chatting with a Gemini model about each article, taking rich notes, and exporting everything to Excel.

- **Full privacy** — all data is stored locally in the browser's IndexedDB; no server involved.
- Official repository: `https://github.com/Barak-elisha/articles-extension.git` (branch `main`).

## Features

- **Side panel** opens on the right, and opens automatically when the extension icon is clicked.
- **List management** — create, rename and delete lists (deleting a list also deletes its articles).
- **Save article** from the active tab — extracts title, article body and URL, optionally with an automatic AI summary.
- **Chat with AI about each article** — a built-in chat that only references the article's body. The chat is persisted and exported to Excel.
- **Personal notes** per article with a rich editor (bold, italic, lists, font size and color), saved automatically.
- **Edit the full article text** directly in the panel, with automatic saving.
- **Full-window mode** — three equal columns (a third each) on a full screen: lists | summary+notes+chat | full text.
- **Excel export** — an "All articles" sheet plus one sheet per list, with rich text, clickable links, an APA citation and an AI-chat column.
- **AI settings** — API key and model from Google AI Studio (default: `gemini-2.0-flash`).
- **Interface language** — switch between English and Hebrew in Settings (English is the default; the choice is persisted and also drives the AI output language and the Excel headers).

## Installation

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **"Load unpacked"** and choose this folder.
4. Click the extension icon in the toolbar to open the panel.

## Usage

1. **Create a list** in the "Manage lists" section.
2. Choose an active list and click **"Save current article"**.
3. (Optional) In Settings → "AI settings", paste an **API key** from Google AI Studio and pick a model; click **Save key**.
4. (Optional) In Settings → "Interface language", choose **English** or **עברית** (default: English).
5. Click **"Export to Excel"** to save the workbook (`articles.xlsx` in English, `מאמרים.xlsx` in Hebrew).

### Viewing and handling an article

- Clicking an article title opens its details: **AI summary** (+ "Regenerate" button), **My notes**, **Chat with AI**, and the full text.
- Article rows show **Open** (open the source in a new tab) and **✕** (delete).
- The active article is highlighted in blue.
- Summaries are rendered as Markdown (headings, lists, code, links).

### Full-window mode (⛶)

- The **⛶** button opens `sidepanel.html?mode=full` in a new tab of the same window.
- Three equal-width columns: **My lists** | **AI summary + notes + chat** | **Full text**.
- The page height follows the lists column (the page ends where the lists end); panels size to their content and scroll internally only when space is tight. The chat box stretches to the end of the page.

### AI

The extension talks to Google Gemini (v1beta `generateContent`) in two modes:

| Mode | background message | Description |
| --- | --- | --- |
| Summary | `GENERATE_SUMMARY` | A comprehensive summary of the article body in the interface language (up to 12,000 characters sent, up to 2,048 output tokens). |
| Chat | `CHAT_ARTICLE` | Q&A about the article only; `systemInstruction` tells the model to answer solely from the article and in the interface language, and the last 20 messages are sent. |

An API key is required. The "Add AI summary" checkbox controls whether every save generates a summary automatically.

### Security & API key

- **Bring your own key** — the extension does not ship or bundle any API key. You must provide your own key from [Google AI Studio](https://aistudio.google.com/), under Settings → "AI settings".
- **Stored locally only** — the key is saved exclusively in the browser's own storage (IndexedDB via the `settings` store), never transmitted to or stored on any server owned by this extension, and never written to Excel or the article records.
- **Sent only to Google** — the key and your article content are sent directly from your browser to Google's Gemini API only when you generate a summary or chat; nothing is routed through a third-party backend.

> Treat your key like a password: anyone who can access your browser's profile can read saved keys. If a key is ever leaked, revoke and regenerate it in Google AI Studio.

#### Untrusted content hardening (XSS)

The extension renders and stores content that originates outside your control — article bodies, titles, AI output — so it never inserts that data as raw HTML:

- **Article body & title** are always rendered with `textContent` (never `innerHTML`), so HTML from the source page is shown as plain text.
- **AI summaries** are rendered through `renderMarkdown`, which HTML-escapes the entire input (`&<>"`) before building any markup.
- **Notes** (the only HTML the user can author) are passed through a self-contained sanitizer — `sanitizeHtml` in `sanitize.js` — before rendering in the editor and before the Excel rich-text export. It is an allowlist (no external library, works fully offline): it drops `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, interactive elements and every `on*` handler, strips `javascript:`/`vbscript:`/`data:`/`file:` URLs and `expression()`/`url()` CSS, while keeping the safe formatting tags (`b`, `i`, `u`, `font`, lists, …). A malicious `<img onerror=…>` or `<a href="javascript:…">` inside a note is neutralized before it ever reaches the live DOM.
- **Anchor links** produced by the sanitizer always get `rel="noopener noreferrer"`.

#### Prompt-injection hardening

Because article content sent to Gemini is untrusted and could contain hidden instructions, the prompts isolate it:

- The article body is wrapped in explicit, unusual delimiters (`[START_OF_ARTICLE] … [END_OF_ARTICLE]`).
- The system instruction tells the model to treat everything between the markers strictly as **reference data, never as instructions** — to ignore any request, injection attempt, or "ignore previous instructions" text found inside the article.

### Excel

Columns in the "All articles" sheet (and in the per-list sheets):

| Column | Source |
| --- | --- |
| List (רשימה) | List name |
| Title (כותרת) | Article title |
| AI summary (תקציר AI) | `a.summary` (Markdown → rich text) |
| Notes (הערות) | `a.notes` (HTML → runs with bold/italic/underline/color/size) |
| APA citation (ציטוט APA) | `buildApaCitation` — title + date + site + URL |
| URL (כתובת אתר) | active hyperlink |
| Saved at (תאריך שמירה) | `a.savedAt` |
| Chat with AI (שיחה עם AI) | `a.chat` formatted as `Me: …` / `AI: …` (or `אני: …` / `AI: …` in Hebrew) |

The export pipeline:
- `buildExcelBlob` — builds the workbook with `xlsx-js-style` (styles, text wrapping, column widths, one sheet per list).
- `enhanceWorkbook` — a post-processing pass with JSZip: converts the summary into rich-text runs (`inlineStr`), turns every URL column into hyperlinks (with `_rels/sheet*.xml.rels`), and enforces OOXML element ordering.
- `isWellFormedWorkbook` — re-opens the package and verifies well-formed XML and `<rPr>` tag order; if anything breaks, it falls back to the safe raw SheetJS output.

## Architecture

### File layout

| File | Role |
| --- | --- |
| `manifest.json` | Extension configuration and permissions |
| `background.js` | Service worker — article extraction from the active tab and Gemini calls |
| `storage.js` | IndexedDB layer (lists, articles, settings) |
| `i18n.js` | Hebrew/English dictionaries and translation helpers |
| `sanitize.js` | Self-contained HTML sanitizer (allowlist) for untrusted content |
| `sidepanel.html/css/js` | The panel UI and the full-window mode |
| `excel-export.js` | Excel export including rich-text styling, links and validation |
| `lib/` | Local libraries: `jszip.min.js`, `xlsx-js-style.min.js`, `cpexcel.js` |
| `lib/THIRD_PARTY_LICENSES.md` | Preserved license notices for the bundled libraries |
| `icons/` | Extension icons (16/32/48/128) |
| `LICENSE` | The project's MIT license |

Scripts are loaded in `sidepanel.html` in this order (it matters): `jszip` → `cpexcel` → `xlsx-js-style` → `storage` → `i18n` → `sanitize` → `excel-export` → `sidepanel`.

### Messaging between the panel and the background

| type | input | output |
| --- | --- | --- |
| `EXTRACT_ARTICLE` | `{ lang }` | `{ ok, data: { title, content, url } }` |
| `GENERATE_SUMMARY` | `{ apiKey, content, title, model, lang }` | `{ ok, summary }` |
| `CHAT_ARTICLE` | `{ apiKey, model, title, content, messages, lang }` | `{ ok, text }` |

`extractFromPage` runs inside the tab (via `chrome.scripting.executeScript`): title from `og:title` → `h1` → `document.title`, body from `article` → `main` → `#content` → `body`, stripping `script/style/nav/header/footer/form/...`.

### IndexedDB schema (`article-saver-db`, version 1)

- **lists** — `{ id, name, createdAt }` (index `name`)
- **articles** — `{ id, listId, title, content, url, savedAt, summary?, notes?, chat? }` (indexes `listId`, `savedAt`)
  - `summary` — Markdown string; `notes` — notes HTML; `chat` — array of `[{ role: "user"|"assistant", text }]`
- **settings** — `{ key, value }`; keys: `activeListId`, `geminiApiKey`, `geminiModel`, `uiLang`

### Panel logic (JS — `sidepanel.js`, IIFE)

- `loadAll()` — loads lists + articles + settings, picks the active list, persists `activeListId`, applies the interface language, re-renders.
- `window.I18N` (`i18n.js`) — `load()`/`set()` read and write the `uiLang` setting (default `en`), and `apply()` swaps `data-i18n*` strings and sets `<html lang>`/`dir`.
- `renderLists()` / `renderArticleRow()` — built in the DOM (no templates).
- `showDetail(a)` — builds dynamically (per article): title, URL, meta (`meta.dataset.base`), `.detail-mid` with **AI summary** (+ "Regenerate"), **Notes** (`contentEditable` editor with a toolbar wired to `document.execCommand`), **Chat** (`renderChat`/`sendChat`), and the full text (`contentEditable`, saved on `blur`).
- `applyActiveRow()` — highlights `.article-item.active` based on `activeArticleId`.
- `fitDetailToLists()` — in full mode binds `.detailBody` height to the lists column height; also runs on `resize`.
- Re-renders on `visibilitychange` (when the panel comes to the foreground).

### CSS layout

- Base (RTL): cards, buttons, `.rich-text`, `.chat-*`, `.detail-*`; active article state; placeholders for empty values.
- **Full mode** (`@media (min-width:760px)` + `body.full`): a grid with 3 `1fr` columns; `#detailBody` is a `1fr 1fr` grid with `grid-template-rows: auto auto auto 1fr`; `.detail-mid` is a flexible column (`flex`), the chat is `flex: 1 1 auto` (extends to the end of the page), and the text panel is `sticky` with internal scrolling.

## Development

- No build step — load the folder as "load unpacked" and refresh.
- Libraries live locally under `lib/` (no CDN; everything stays fully local).
- Manual Excel checks are done by opening the file in LibreOffice/Excel; the internal validation pipeline in `excel-export.js` guarantees a well-formed file even with fragile XML tweaks.

## License

This project's own code is released under the **MIT License** — see the root [`LICENSE`](LICENSE) file. Copyright (c) 2026 Barak Elisha.

The extension bundles third-party libraries locally under `lib/` (JSZip, xlsx-js-style, cpexcel). Their respective license terms and copyright notices are preserved and reproduced in [`lib/THIRD_PARTY_LICENSES.md`](lib/THIRD_PARTY_LICENSES.md); redistribution of this software must retain those notices.

## Disclaimer

This extension is provided **"AS IS"**, without warranty of any kind, express or implied. To the maximum extent permitted by applicable law, the author(s) disclaim all warranties, including fitness for a particular purpose and non-infringement.

By using this extension you acknowledge that:

- **API costs are yours** — the AI features call Google's Gemini API using your own API key. You are solely responsible for any usage fees billed by Google, and for managing your own quota, limits and billing.
- **Extracted content is yours** — you are responsible for the content you choose to extract, save, summarize, chat about, and export. You must have the right to do so and stay compliant with each source site's terms of service and any applicable copyright law.
- **Content is used for reference only** — summaries and chat answers generated by the AI are informational outputs of a machine-learning model; they may be inaccurate or incomplete and should not be relied upon as authoritative.

## Changelog

### v1.0.0
- Removed the PDF export feature (folder picker, `pdf-export.js`, jsPDF).
- Documented the whole project in the README.
- Fixed the full-window mode so the three columns are true thirds (no proportional splitting).
- Chat grows to the end of the page; three equal columns.
- Content-sized panels; scrolling only when needed.
- Bound the panels' height to the lists height — the page ends where the lists end.
- Editable full article text with active-article highlighting.
- Sized full-window panels by article length; export always uses fresh data.
- Fixed the chat input being crushed by the send-button width.
- Per-article AI chat + a chat column in Excel.
- Page scrolling in full window; sticky full-text panel with internal scroll.