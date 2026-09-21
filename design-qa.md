# Design QA — sharing and import flows

Date: 2026-09-21

## Source references

- `codex-clipboard-e12d061c-278f-4f72-bf7e-e888fc96cc24.png` — collection sharing dialog
- `codex-clipboard-765d65a6-f31c-4fb5-99cf-e1af9aabdbca.png` — email handoff dialog
- `codex-clipboard-293db774-995b-4964-9d35-0151d9738728.png` — side-panel notification

## Rendered implementation

The implementation was rendered in the Codex in-app browser at a 390 × 820 side-panel viewport using `tests/design-qa.html` and the production `sidepanel.css` classes. The collection share dialog fits at 358 px wide without an inner message scrollbar; import fits within 343 × 793 px; the email handoff fits within 358 × 362 px; and the toast fits within 280 × 49 px without edge clipping.

| State | Result | Checks |
| --- | --- | --- |
| Collection sharing | Passed | Branded visual hierarchy, compact ready message, clear content controls, no nested scrollbar, one dominant action |
| Email handoff | Passed | Clear completion state, friendly wording, visible filename, one primary action, no clipping in RTL |
| Collection import | Passed | Existing-list selector, editable name when creating a list, readable content summary, one contextual primary action, privacy note, no clipping in RTL |
| Success notification | Passed | Bottom-centered layout, readable message, clear status icon and close control, no edge clipping |

## Resolved issues

- P1: The selected articles were discarded before the Research Pack step. The selected array is now passed through explicitly.
- P1: **All lists** could use stale internal list state. The pack scope now follows the visible list selector.
- P1: “Add as a new list” did not allow naming the new list. Import now requires an editable list name.
- P1: Collection import did not allow choosing a different existing list. The destination selector now supports every existing list plus a clearly separated new-list option.
- P2: Sharing and email copy was technical and hard to scan. It now uses a friendly greeting, a compact email-style preview, a clear privacy note and a dynamic email subject.
- P2: Notifications were narrow, edge-aligned and easy to clip. They are now centered, bounded to the panel width and limited to one at a time.

No open P0, P1 or P2 visual issues remain in the reviewed states.

final result: passed
