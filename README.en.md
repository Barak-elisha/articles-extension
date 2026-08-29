# Article Saver

A Chrome extension (Manifest V3, `version 1.0.0`) for saving articles to lists, generating AI summaries, chatting with a Gemini model about each article, taking rich notes, and exporting everything to Excel.

- **Full privacy** — all data is stored locally in the browser's IndexedDB; no server involved.
- Official repository: `https://github.com/Barak-elisha/articles-extention.git` (branch `main`).

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

## Installation

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **"Load unpacked"** and choose this folder.
4. Click the extension icon in the toolbar to open the panel.

## Usage

1. **Create a list** in the "Manage lists" section.
2. Choose an active list and click **"Save current article"**.
3. (Optional) In Settings → "AI settings", paste an **API key** from Google AI Studio and pick a model; click **Save key**.
4. Click **"Export to Excel"** to save `מאמרים.xlsx`.

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
| Summary | `GENERATE_SUMMARY` | A comprehensive Hebrew summary of the article body (up to 12,000 characters sent, up to 2,048 output tokens). |
| Chat | `CHAT_ARTICLE` | Q&A about the article only; `systemInstruction` tells the model to answer solely from the article, and the last 20 messages are sent. |

An API key is required. The "Add AI summary" checkbox controls whether every save generates a summary automatically.

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
| Chat with AI (שיחה עם AI) | `a.chat` formatted as `אני: …` / `AI: …` |

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
| `sidepanel.html/css/js` | The panel UI and the full-window mode |
| `excel-export.js` | Excel export including rich-text styling, links and validation |
| `lib/` | Local libraries: `jszip.min.js`, `xlsx-js-style.min.js`, `cpexcel.js` |
| `icons/` | Extension icons (16/32/48/128) |

Scripts are loaded in `sidepanel.html` in this order (it matters): `jszip` → `cpexcel` → `xlsx-js-style` → `storage` → `excel-export` → `sidepanel`.

### Messaging between the panel and the background

| type | input | output |
| --- | --- | --- |
| `EXTRACT_ARTICLE` | — | `{ ok, data: { title, content, url } }` |
| `GENERATE_SUMMARY` | `{ apiKey, content, title, model }` | `{ ok, summary }` |
| `CHAT_ARTICLE` | `{ apiKey, model, title, content, messages }` | `{ ok, text }` |

`extractFromPage` runs inside the tab (via `chrome.scripting.executeScript`): title from `og:title` → `h1` → `document.title`, body from `article` → `main` → `#content` → `body`, stripping `script/style/nav/header/footer/form/...`.

### IndexedDB schema (`article-saver-db`, version 1)

- **lists** — `{ id, name, createdAt }` (index `name`)
- **articles** — `{ id, listId, title, content, url, savedAt, summary?, notes?, chat? }` (indexes `listId`, `savedAt`)
  - `summary` — Markdown string; `notes` — notes HTML; `chat` — array of `[{ role: "user"|"assistant", text }]`
- **settings** — `{ key, value }`; keys: `activeListId`, `geminiApiKey`, `geminiModel`

### Panel logic (JS — `sidepanel.js`, IIFE)

- `loadAll()` — loads lists + articles + settings, picks the active list, persists `activeListId`, re-renders.
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

## Release history (main commits)

| Commit | Contents |
| --- | --- |
| `db7f0b8` | Page scrolling in full window; sticky full-text panel with internal scroll |
| `b560e4a` | Per-article AI chat + chat column in Excel |
| `28ce530` | Fixed chat input crushed by the send button width |
| `4dcc223` | Sized full-window panels by article length; export fresh data |
| `54ae7bd` | Editable full article text, active-article highlight |
| `ad092f4` | Bound panel height to list height — page ends where the lists end |
| `5841424` | Content-sized panels; scrolling only when needed |
| `903fe2a` | Three equal columns; chat grows to the end of the page |
| `c521aa1` | Fix: true thirds (no proportional splitting) |
| `a805539` | Documented the whole project in the README |
| `293498b` | Removed the PDF export feature (folder picker, `pdf-export.js`, jsPDF) |