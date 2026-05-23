# Note Context Patch Approach

**Date**: 2026-05-23  
**Goal**: Send the note body only once per conversation session. On subsequent messages use the conversation history as AI memory. When the note changes, send a unified diff instead of the full body.

---

## Problem

The note body is re-sent in the system prompt on every API request. System prompts are stateless — they don't persist between calls. Even when `diff.isIdentical` triggers `bodyOmitted = true`, the AI is told to "call `get_note`" to recover the content, costing an extra tool-call round.

## Solution

Store a note snapshot (`currentNoteContext`) in the webview. On the first request: send full body as today. On subsequent requests: inject the note into the `messages` array as a synthetic pair so the AI has it in context. When the note changes: send a unified diff in the system prompt.

---

## Data Flow

### First request (no note-context saved)

```
Webview → Panel: { history: [...], noteContext: null, prompt: '...' }
Service:  system prompt = full note body (current behavior)
Messages: [user: "test"]
Response → Panel sends: { type: 'noteContextUpdate', noteId, noteTitle, noteBody }
Webview:  saves currentNoteContext
```

### Subsequent request — note unchanged

```
Webview → Panel: { history: [...], noteContext: { noteId, noteTitle, noteBody }, prompt: '...' }
Service:  system prompt noteBodyContext = "Note unchanged. Refer to conversation history."
Messages: [
  user: "[NOTE_CONTEXT]\nTitle: ...\n\n<body>",
  assistant: "Note context received.",
  ...real history...,
  user: "BOB"
]
UI indicator: none
```

### Subsequent request — note changed

```
Service:  system prompt noteBodyContext = "[NOTE CHANGED]\n<unified diff>"
Messages: [
  user: "[NOTE_CONTEXT]\nTitle: ...\n\n<snapshot body>",   // old snapshot so AI can apply diff
  assistant: "Note context received.",
  ...real history...,
  user: "..."
]
After response → Panel sends noteContextUpdate with new body
UI indicator: "NOTE DIFF SENT TO AI · +X/-Y chars"
```

---

## Components

### `src/ai/types.ts`

No changes to `ChatMessage`. Add a separate type passed alongside history:

```typescript
export interface NoteContextSnapshot {
  noteId: string;
  noteTitle: string;
  noteBody: string;
}
```

### `src/ai/service.ts`

**`resolveNoteBodyContent`**: add `noteContextInHistory?: NoteContextSnapshot`.

| Condition | Result |
|-----------|--------|
| No noteContext | Full body (current behavior) |
| noteContext present, noteId matches, body identical | `omitted: true` with message "Note unchanged. Refer to conversation history." |
| noteContext present, noteId matches, body differs | Unified diff. If diff size > 50% of original → fall back to full body. |
| noteContext present, noteId differs | Full body (new note), reset signal |

**`runClaudeLoop`**: accept `noteContext?: NoteContextSnapshot`. When present, prepend to messages:
```
{ role: 'user',      content: '[NOTE_CONTEXT]\nTitle: ...\n\n<body>' }
{ role: 'assistant', content: 'Note context received.' }
```

**`runOpenAILoop`**: same, but inject as `{ role: 'system', content: '...' }` right after main system messages.

**`sendToAI`**: accept `noteContext?: NoteContextSnapshot`, pass to loop functions and `buildSystemPromptParts`.

### `src/panel.ts`

- Read `noteContext` from incoming webview message (`message.noteContext as NoteContextSnapshot | null`).
- Pass to `sendToAI`.
- After successful response: send `{ type: 'noteContextUpdate', noteId, noteTitle, noteBody: note.body }` to webview.
- Remove `previousNoteBody` / `lastSentNoteBody` mechanism — superseded by noteContext.

### `src/webview/panel.js`

- New state: `let currentNoteContext = null`.
- Load/save `currentNoteContext` from localStorage (key: `'joplin-ai-note-context'`).
- Include in outgoing message: `noteContext: currentNoteContext`.
- On `noteContextUpdate`: update `currentNoteContext`, save to localStorage.
- On `noteInfo` with different `noteId`: clear `currentNoteContext`.
- On chat clear: clear `currentNoteContext`.
- UI: show "NOTE DIFF SENT TO AI · +X/-Y chars" when diff is sent (new `noteDiffSent` message type from panel).

---

## UI Messages (panel → webview)

| type | payload | display |
|------|---------|---------|
| `noteBodySent` | `{ noteTitle, charCount }` | "NOTE TEXT SENT TO AI · N chars" (existing) |
| `noteDiffSent` | `{ noteTitle, added, removed }` | "NOTE DIFF SENT TO AI · +A/-R chars" (new) |
| `noteContextUpdate` | `{ noteId, noteTitle, noteBody }` | invisible, updates state |

---

## Fallback Rules

- Diff > 50% of snapshot body size → send full body + `noteBodySent` indicator (not diff)
- `workMode === 'edit'` → always full body (unchanged)
- Note navigation (`noteInfo.noteId` changed) → clear `currentNoteContext` → next message sends full body
- Chat clear → clear `currentNoteContext`
- `currentNoteContext` does NOT count toward `MAX_HISTORY_MESSAGES`

---

## Out of Scope

- Selection mode changes (note already handled by existing `isSelection` path)
- Provider-level prompt caching on the synthetic note-context message (can be added later)
- Perplexity provider (already uses a different message format; handle in its loop or skip if not applicable)
