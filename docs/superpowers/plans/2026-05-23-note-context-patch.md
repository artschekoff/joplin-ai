# Note Context Patch Approach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the note body to the AI only once per conversation session; on subsequent messages with no changes use the conversation message history as AI memory; when the note changes send a compact patch instead of the full body.

**Architecture:** A `NoteContextSnapshot` (noteId + noteTitle + noteBody) is persisted in the webview (`currentNoteContext` in localStorage). The webview sends it alongside every request. `service.ts` uses it to decide: inject the note body into the `messages` array as a synthetic user/assistant pair (so the AI can reference it from history), omit the note from the system prompt when unchanged, or emit a `diff-match-patch` patch when changed. `panel.ts` sends a `noteContextUpdate` event after each successful response so the webview can keep the snapshot current.

**Tech Stack:** TypeScript (backend), plain JS (webview), Jest (tests), `diff-match-patch` npm package (already in dependencies).

**Spec:** `docs/superpowers/specs/2026-05-23-note-context-patch-design.md`

---

## File Map

| File | Change |
|------|--------|
| `src/ai/types.ts` | Add `NoteContextSnapshot` interface; add `bodyIncluded`+`diffStats` to `SystemPromptParts` |
| `src/actions/types.ts` | Add `onDiffSent` callback to `ActionContext` |
| `src/ai/note-diff.ts` | Add `generateNotePatch` using `diff-match-patch` |
| `src/ai/service.ts` | Extend `resolveNoteBodyContent`, `buildSystemPromptParts`, all four loop functions, `sendToAI` |
| `src/panel.ts` | Thread `noteContext` into `handleExecute`; send `noteContextUpdate` + `noteDiffSent` events |
| `src/webview/panel.js` | `currentNoteContext` state + localStorage; include in request; handle `noteContextUpdate`/`noteDiffSent`; clear on note change / history clear |
| `src/ai/__tests__/service.test.ts` | Tests for new noteContext behavior |
| `src/ai/__tests__/note-diff.test.ts` | Tests for `generateNotePatch` |
| `src/__tests__/panel.test.ts` | Test for `noteContextUpdate` dispatch |

---

## Task 1 — Types: NoteContextSnapshot + SystemPromptParts extensions + ActionContext.onDiffSent

**Files:**
- Modify: `src/ai/types.ts`
- Modify: `src/actions/types.ts`

### Background

`NoteContextSnapshot` travels from the webview → panel → service. It tells the service "the AI already saw this note body at the start of this conversation."

`SystemPromptParts` gains two new fields: `bodyIncluded` (true when full body is in noteBodyContext) and `diffStats` (set only when a patch was generated instead of the full body). These let `sendToAI` fire the correct UI callback after prompt building.

`ActionContext.onDiffSent` is called when a patch is emitted, so `panel.ts` can send the `noteDiffSent` UI event.

- [ ] **Step 1: Add `NoteContextSnapshot` to `src/ai/types.ts`**

Open `src/ai/types.ts`. After the `ChatMessage` interface, add:

```typescript
export interface NoteContextSnapshot {
	noteId: string;
	noteTitle: string;
	noteBody: string;
}
```

- [ ] **Step 2: Extend `SystemPromptParts` in `src/ai/types.ts`**

Find the `SystemPromptParts` interface in `src/ai/types.ts` (currently has `staticInstructions`, `noteBodyContext`, `dynamicContext`). Add two fields:

```typescript
export interface SystemPromptParts {
	staticInstructions: string;
	noteBodyContext: string;
	dynamicContext: string;
	/** True when the note's full body is embedded in noteBodyContext. */
	bodyIncluded: boolean;
	/** Set only when a diff-match-patch patch was emitted instead of the full body. */
	diffStats?: { added: number; removed: number };
}
```

- [ ] **Step 3: Add `onDiffSent` to `ActionContext` in `src/actions/types.ts`**

Open `src/actions/types.ts`. Find the `ActionContext` interface. After the existing `onBodyDecision` line, add:

```typescript
	/** Called when a diff patch is sent instead of the full note body. */
	onDiffSent?: (added: number, removed: number) => void;
```

- [ ] **Step 4: Run tests to confirm nothing breaks**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test 2>&1 | tail -20
```

Expected: all existing tests pass (these are additive type changes only).

- [ ] **Step 5: Commit**

```bash
git add src/ai/types.ts src/actions/types.ts
git commit -m "feat: add NoteContextSnapshot, SystemPromptParts extensions, onDiffSent callback"
```

---

## Task 2 — `generateNotePatch` in note-diff.ts

**Files:**
- Modify: `src/ai/note-diff.ts`
- Modify: `src/ai/__tests__/note-diff.test.ts`

### Background

`diff-match-patch` is already in `package.json` (`"diff-match-patch": "^1.0.5"`). Its `patch_toText` produces a standard unified-diff-like format that LLMs handle well. We also count added/removed characters for the UI indicator.

The fallback threshold is 50 % of the new body length: if the patch text is larger than that, the caller should send the full body instead.

- [ ] **Step 1: Write failing tests**

Open `src/ai/__tests__/note-diff.test.ts`. Add at the end of the file (after existing tests):

```typescript
import { generateNotePatch } from '../note-diff';

describe('generateNotePatch', () => {
	it('returns patchText and char counts for a small change', () => {
		const old = 'Hello world\nSecond line\n';
		const updated = 'Hello world\nSecond line updated\n';
		const result = generateNotePatch(old, updated);
		expect(result.patchText).toContain('-Second line\n');
		expect(result.patchText).toContain('+Second line updated\n');
		expect(result.removed).toBeGreaterThan(0);
		expect(result.added).toBeGreaterThan(0);
	});

	it('returns empty patchText for identical bodies', () => {
		const body = 'Same content\n';
		const result = generateNotePatch(body, body);
		expect(result.patchText).toBe('');
		expect(result.added).toBe(0);
		expect(result.removed).toBe(0);
	});

	it('patchText is non-empty and added > 0 when lines are appended', () => {
		const old = 'Line one\n';
		const updated = 'Line one\nLine two\n';
		const result = generateNotePatch(old, updated);
		expect(result.patchText.length).toBeGreaterThan(0);
		expect(result.added).toBeGreaterThan(0);
		expect(result.removed).toBe(0);
	});
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test -- --testPathPattern=note-diff 2>&1 | tail -20
```

Expected: FAIL — `generateNotePatch` is not exported.

- [ ] **Step 3: Implement `generateNotePatch` in `src/ai/note-diff.ts`**

Open `src/ai/note-diff.ts`. At the top add the import:

```typescript
import { diff_match_patch } from 'diff-match-patch';
```

At the end of the file, add:

```typescript
/**
 * Generate a diff-match-patch patch string between two note bodies.
 * Also returns character-level added/removed counts for UI display.
 * Returns empty patchText when bodies are identical.
 */
export const generateNotePatch = (
	oldBody: string,
	newBody: string,
): { patchText: string; added: number; removed: number } => {
	if (oldBody === newBody) {
		return { patchText: '', added: 0, removed: 0 };
	}
	const dmp = new diff_match_patch();
	const diffs = dmp.diff_main(oldBody, newBody);
	dmp.diff_cleanupSemantic(diffs);
	let added = 0;
	let removed = 0;
	for (const [op, text] of diffs) {
		if (op === 1) added += text.length;
		if (op === -1) removed += text.length;
	}
	const patches = dmp.patch_make(oldBody, diffs);
	return { patchText: dmp.patch_toText(patches), added, removed };
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test -- --testPathPattern=note-diff 2>&1 | tail -20
```

Expected: all note-diff tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/note-diff.ts src/ai/__tests__/note-diff.test.ts
git commit -m "feat: add generateNotePatch using diff-match-patch"
```

---

## Task 3 — `resolveNoteBodyContent` + `buildSystemPromptParts` in service.ts

**Files:**
- Modify: `src/ai/service.ts`
- Modify: `src/ai/__tests__/service.test.ts`

### Background

`resolveNoteBodyContent` currently accepts `previousNoteBody` and does an identical/small-diff check. We replace that parameter with `noteContextInHistory?: NoteContextSnapshot` and add new logic:

| Condition | Body in system prompt | `bodyIncluded` | `diffStats` |
|-----------|----------------------|----------------|-------------|
| No noteContext | Full body | `true` | — |
| noteContext, same noteId, same body | Empty / "see history" instruction | `false` | — |
| noteContext, same noteId, diff ≤ 50 % new body length, workMode ≠ 'edit' | Patch text | `false` | `{ added, removed }` |
| noteContext, same noteId, diff > 50 % or workMode = 'edit' | Full body | `true` | — |
| noteContext, different noteId | Full body (new note) | `true` | — |

`buildSystemPromptParts`:
- Receives `noteContextInHistory?: NoteContextSnapshot` (new field in `BuildSystemPromptOptions`).
- Removes the old `previousNoteBody` field.
- Passes `noteContextInHistory` through to `resolveNoteBodyContent`.
- Sets `bodyIncluded` and `diffStats` on the returned `SystemPromptParts`.

The `noteContextLine` (instruction to AI) also changes:
- When unchanged: `"The note content was provided at the start of this conversation. Refer to your conversation context."`
- When diff sent: `"The note has changed since the start of this conversation. A patch is provided below — apply it to your memory of the original note."`
- When full body: current text (unchanged)

- [ ] **Step 1: Write failing tests for noteContext behavior**

Open `src/ai/__tests__/service.test.ts`. Find the `describe('buildSystemPrompt', ...)` block. Add a new describe block after it:

```typescript
describe('buildSystemPromptParts with noteContextInHistory', () => {
	const snapshot: import('../types').NoteContextSnapshot = {
		noteId: 'note-1',
		noteTitle: 'My Note',
		noteBody: 'Original content\nLine two\n',
	};

	it('omits body and sets bodyIncluded=false when note unchanged', () => {
		const parts = buildSystemPromptParts({
			noteTitle: 'My Note',
			noteId: 'note-1',
			noteBody: 'Original content\nLine two\n',
			noteContextInHistory: snapshot,
			workMode: 'ask',
		});
		expect(parts.bodyIncluded).toBe(false);
		expect(parts.diffStats).toBeUndefined();
		expect(parts.noteBodyContext).not.toContain('Original content');
		expect(parts.noteBodyContext).toContain('conversation context');
	});

	it('sends diff and sets diffStats when note changed (small diff, ask mode)', () => {
		const parts = buildSystemPromptParts({
			noteTitle: 'My Note',
			noteId: 'note-1',
			noteBody: 'Original content\nLine two updated\n',
			noteContextInHistory: snapshot,
			workMode: 'ask',
		});
		expect(parts.bodyIncluded).toBe(false);
		expect(parts.diffStats).toBeDefined();
		expect(parts.diffStats!.added).toBeGreaterThan(0);
		expect(parts.noteBodyContext).toContain('[NOTE CHANGED]');
	});

	it('falls back to full body in edit mode even when unchanged', () => {
		const parts = buildSystemPromptParts({
			noteTitle: 'My Note',
			noteId: 'note-1',
			noteBody: 'Original content\nLine two\n',
			noteContextInHistory: snapshot,
			workMode: 'edit',
		});
		expect(parts.bodyIncluded).toBe(true);
		expect(parts.noteBodyContext).toContain('Original content');
	});

	it('sends full body when noteId differs (note navigation)', () => {
		const parts = buildSystemPromptParts({
			noteTitle: 'Different Note',
			noteId: 'note-2',
			noteBody: 'Different content\n',
			noteContextInHistory: snapshot,
			workMode: 'ask',
		});
		expect(parts.bodyIncluded).toBe(true);
		expect(parts.noteBodyContext).toContain('Different content');
	});

	it('sends full body when no noteContextInHistory', () => {
		const parts = buildSystemPromptParts({
			noteTitle: 'My Note',
			noteId: 'note-1',
			noteBody: 'Original content\nLine two\n',
			workMode: 'ask',
		});
		expect(parts.bodyIncluded).toBe(true);
		expect(parts.noteBodyContext).toContain('Original content');
	});
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test -- --testPathPattern=service 2>&1 | tail -30
```

Expected: FAIL — `noteContextInHistory` not recognised, `bodyIncluded` not on return type.

- [ ] **Step 3: Update `BuildSystemPromptOptions` in `src/ai/service.ts`**

Find the `BuildSystemPromptOptions` interface (around line 200). Remove the `previousNoteBody?: string` field. Add:

```typescript
	/** When present, the AI already has the note body in conversation history from an earlier turn. */
	noteContextInHistory?: NoteContextSnapshot;
```

Also add the import at the top of `service.ts` if `NoteContextSnapshot` is not already imported:

```typescript
import { ..., NoteContextSnapshot } from './types';
```

And add `generateNotePatch` to the import from `./note-diff`:

```typescript
import { computeNoteDiff, generateNotePatch } from './note-diff';
```

- [ ] **Step 4: Update `resolveNoteBodyContent` in `src/ai/service.ts`**

Find the `resolveNoteBodyContent` function. Change its parameter type: replace `previousNoteBody?: string` with `noteContextInHistory?: NoteContextSnapshot`. Change the return type to include `decisionType` and `diffStats`:

Replace the function signature and body with:

```typescript
const resolveNoteBodyContent = ({
	noteBody,
	noteBodyOmitted,
	noteContextInHistory,
	workMode,
	isSelection,
	selectionText,
}: {
	noteBody: string;
	noteBodyOmitted?: boolean;
	noteContextInHistory?: NoteContextSnapshot;
	workMode?: WorkMode;
	isSelection?: boolean;
	selectionText?: string;
}): {
	bodyText: string;
	contentLabel: string;
	omitted: boolean;
	diffStats?: { added: number; removed: number };
} => {
	if (noteBodyOmitted) {
		return { bodyText: '', contentLabel: '', omitted: true };
	}

	const cleanBody = sanitizeContent(noteBody);
	const hasSelectionMarkers = isSelection && selectionText && cleanBody.includes(selectionText);
	const markedBody = hasSelectionMarkers
		? embedSelectionMarkers(cleanBody, selectionText)
		: cleanBody;
	const truncated =
		markedBody.length > MAX_NOTE_BODY_LENGTH
			? markedBody.substring(0, MAX_NOTE_BODY_LENGTH) + '\n\n[... note truncated due to length ...]'
			: markedBody;

	// Note-context-in-history optimisation
	if (noteContextInHistory && noteContextInHistory.noteId === /* current noteId — passed via closure */ undefined) {
		// noteId is not available here — handled in buildSystemPromptParts below
	}

	return { bodyText: truncated, contentLabel: 'Current note content:', omitted: false };
};
```

Wait — `noteId` is not available inside `resolveNoteBodyContent`. Move the noteContext decision logic directly into `buildSystemPromptParts` where `noteId` is available. So `resolveNoteBodyContent` keeps its original structure (handling only `noteBodyOmitted` and body text preparation), and the note-context branching happens in `buildSystemPromptParts` right before it calls `resolveNoteBodyContent`.

Here is the revised approach — do NOT change `resolveNoteBodyContent`'s signature at all. Instead, in `buildSystemPromptParts`, intercept before calling `resolveNoteBodyContent`:

```typescript
// Inside buildSystemPromptParts, right after destructuring options, before resolveNoteBodyContent call:

let noteContextDecision: 'full' | 'diff-sent' | 'unchanged' | 'new-note' = 'full';
let diffStats: { added: number; removed: number } | undefined;

if (
	noteContextInHistory &&
	noteContextInHistory.noteId === noteId &&
	workMode !== 'edit'
) {
	if (noteContextInHistory.noteBody === noteBody) {
		noteContextDecision = 'unchanged';
	} else {
		const patch = generateNotePatch(noteContextInHistory.noteBody, noteBody);
		const fallbackThreshold = noteBody.length * 0.5;
		if (patch.patchText.length > 0 && patch.patchText.length <= fallbackThreshold) {
			noteContextDecision = 'diff-sent';
			diffStats = { added: patch.added, removed: patch.removed };
		}
		// else: stays 'full'
	}
} else if (noteContextInHistory && noteContextInHistory.noteId !== noteId) {
	noteContextDecision = 'new-note'; // same as 'full'
}

// Now build noteBodyContext based on decision:
let noteBodyContext: string;
let bodyIncluded: boolean;

const noteIdLine = noteId ? `Current note ID: ${noteId}\n` : '';

if (noteContextDecision === 'unchanged') {
	bodyIncluded = false;
	noteBodyContext = `\nCurrent note title: ${noteTitle}\n${noteIdLine}The note content was provided at the start of this conversation. Refer to your conversation context.\n`;
} else if (noteContextDecision === 'diff-sent') {
	// Generate patch text for the system prompt
	const patch = generateNotePatch(noteContextInHistory!.noteBody, noteBody);
	bodyIncluded = false;
	noteBodyContext = `\nCurrent note title: ${noteTitle}\n${noteIdLine}[NOTE CHANGED]\nThe note has changed since the start of this conversation. Apply this patch to your memory of the original note:\n\n${patch.patchText}\n`;
} else {
	// 'full' or 'new-note': use existing resolveNoteBodyContent path
	const { bodyText, contentLabel, omitted } = resolveNoteBodyContent({
		noteBody,
		noteBodyOmitted,
		previousNoteBody: undefined, // old field removed
		workMode,
		isSelection,
		selectionText,
	});
	bodyIncluded = !omitted;
	// ... (existing noteBodyContext construction)
}
```

Actually, this means we also keep `resolveNoteBodyContent` with its old `previousNoteBody` parameter for the time being since it's used for the `diff.isIdentical` check internally. But wait — the old `previousNoteBody` mechanism in `resolveNoteBodyContent` is now REPLACED by the new `noteContextInHistory` mechanism. We should remove the old diff logic inside `resolveNoteBodyContent` entirely (since that's now handled by `buildSystemPromptParts` using `noteContextInHistory`).

**Simpler approach**: Keep `resolveNoteBodyContent` as-is (with `previousNoteBody`) for now, but bypass it entirely when `noteContextDecision !== 'full'`. For the `'full'` case, call `resolveNoteBodyContent` with `previousNoteBody: undefined` (removing the old optimization since noteContext replaces it). This is clean and doesn't require changing `resolveNoteBodyContent` itself.

Final implementation for `buildSystemPromptParts`:

```typescript
// After destructuring options:
const noteIdLine = noteId ? `Current note ID: ${noteId}\n` : '';

// Determine note-context decision
let diffStats: { added: number; removed: number } | undefined;
let bodyIncluded = true;

// note-context-in-history path (ask/agent modes only — edit always needs full body)
if (noteContextInHistory && noteContextInHistory.noteId === noteId && workMode !== 'edit') {
	if (noteContextInHistory.noteBody === noteBody) {
		// Unchanged: skip body, AI reads from history
		bodyIncluded = false;
		const noteBodyContext = `\nCurrent note title: ${noteTitle}\n${noteIdLine}The note content was provided at the start of this conversation. Refer to your conversation context.\n`;
		// ... build and return SystemPromptParts early
	} else {
		const patch = generateNotePatch(noteContextInHistory.noteBody, noteBody);
		if (patch.patchText.length > 0 && patch.patchText.length <= noteBody.length * 0.5) {
			// Diff fits within threshold: send patch
			bodyIncluded = false;
			diffStats = { added: patch.added, removed: patch.removed };
			const noteBodyContext = `\nCurrent note title: ${noteTitle}\n${noteIdLine}[NOTE CHANGED]\nThe note has changed since the start of this conversation. Apply this patch to your memory of the original note:\n\n${patch.patchText}\n`;
			// ... build and return SystemPromptParts early
		}
		// else: fall through to full body path
	}
}

// Full body path (no noteContext, edit mode, new note, or large diff)
const { bodyText, contentLabel, omitted } = resolveNoteBodyContent({
	noteBody,
	noteBodyOmitted,
	previousNoteBody: undefined,
	workMode,
	isSelection,
	selectionText,
});
bodyIncluded = !omitted;
const noteBodyContext = omitted
	? `\nCurrent note title: ${noteTitle}\n${noteIdLine}`
	: `\nCurrent note title: ${noteTitle}\n${noteIdLine}${contentLabel}\n${bodyText}`;
```

The key point is: when returning `SystemPromptParts`, always include `bodyIncluded` and `diffStats`. The two "early return" branches (unchanged + small diff) must construct the full `SystemPromptParts` object with all required fields.

Let me spell out the exact code to add/change in `buildSystemPromptParts`. The existing function starts with destructuring, then calls `resolveNoteBodyContent`. Here is the complete new body for `buildSystemPromptParts` (replace from the `const { bodyText, contentLabel, omitted: bodyOmitted }` block downward through the two `if (workMode === 'edit')` branches):

```typescript
export const buildSystemPromptParts = (options: BuildSystemPromptOptions): SystemPromptParts => {
	const {
		noteTitle,
		noteId,
		noteBody,
		notebooks,
		agentRolePrompt,
		workMode,
		referencedNotes,
		attachedFiles,
		nativeWebSearch,
		isSelection,
		selectionText,
		noteBodyOmitted,
		noteContextInHistory,  // NEW — replaces previousNoteBody
		kieApiKey,
	} = options;

	const noteIdLine = noteId ? `Current note ID: ${noteId}\n` : '';
	const cleanBody = sanitizeContent(noteBody);
	const hasSelectionMarkers = isSelection && selectionText && cleanBody.includes(selectionText);
	const notebookSection = notebooks?.length ? buildNotebookSection(notebooks) : '';
	const referencedSection = referencedNotes?.length ? buildReferencedNotesSection(referencedNotes) : '';
	const attachedSection = attachedFiles?.length ? buildAttachedFilesSection(attachedFiles) : '';
	const roleSection = agentRolePrompt?.trim() ? `[Agent Role]\n${agentRolePrompt}\n[End Agent Role]\n\n` : '';
	const modeSection = buildWorkModeSection(workMode, noteTitle);
	const webSearchLine = buildWebSearchToolLine(nativeWebSearch);
	const selectionRulesBlock = hasSelectionMarkers ? `\nSELECTION RULES:\n...` : ''; // keep existing text

	// ── Note-context-in-history optimisation ────────────────────────────────
	// When the webview has already injected the note into the messages array
	// (synthetic pair at the start of history), we can skip the full body or
	// send only a patch, saving tokens on every subsequent turn.
	// Edit mode is excluded: update_note needs the full current body in system.
	if (
		!noteBodyOmitted &&
		noteContextInHistory &&
		noteContextInHistory.noteId === noteId &&
		workMode !== 'edit'
	) {
		if (noteContextInHistory.noteBody === noteBody) {
			// Note unchanged — AI already has it in message history
			const noteBodyContext = `\nCurrent note title: ${noteTitle}\n${noteIdLine}The note content was provided at the start of this conversation. Refer to your conversation context.\n`;
			const dynamicContext = `${referencedSection}${attachedSection}`;
			const staticInstructions = buildStaticInstructions(/* ...existing call... */);
			return { staticInstructions, noteBodyContext, dynamicContext, bodyIncluded: false };
		}

		const patch = generateNotePatch(noteContextInHistory.noteBody, noteBody);
		const withinThreshold = patch.patchText.length > 0 && patch.patchText.length <= noteBody.length * 0.5;
		if (withinThreshold) {
			// Small diff — send patch only
			const noteBodyContext = `\nCurrent note title: ${noteTitle}\n${noteIdLine}[NOTE CHANGED]\nThe note has changed since the start of this conversation. Apply this patch to your memory of the original note:\n\n${patch.patchText}\n`;
			const dynamicContext = `${referencedSection}${attachedSection}`;
			const staticInstructions = buildStaticInstructions(/* ... */);
			return {
				staticInstructions,
				noteBodyContext,
				dynamicContext,
				bodyIncluded: false,
				diffStats: { added: patch.added, removed: patch.removed },
			};
		}
		// Large diff — fall through to full body
	}
	// ── End note-context optimisation ───────────────────────────────────────

	// Full body path (first turn, edit mode, large diff, or no context snapshot)
	const { bodyText, contentLabel, omitted: bodyOmitted } = resolveNoteBodyContent({
		noteBody,
		noteBodyOmitted,
		previousNoteBody: undefined,  // old mechanism removed — noteContext handles this now
		workMode,
		isSelection,
		selectionText,
	});

	const noteBodyContext = bodyOmitted
		? `\nCurrent note title: ${noteTitle}\n${noteIdLine}`
		: `\nCurrent note title: ${noteTitle}\n${noteIdLine}${contentLabel}\n${bodyText}`;

	// ... rest of buildSystemPromptParts (if workMode === 'edit' branch, etc.) — keep unchanged
	// At each return statement, add `bodyIncluded: !bodyOmitted` to the SystemPromptParts object.
```

**IMPORTANT**: The existing `buildSystemPromptParts` has two return paths (one for `workMode === 'edit'`, one for the general case). Both must have `bodyIncluded: !bodyOmitted` added. Also remove the old `noteContextLine` and `noteBodyOmitted` check logic that was previously in the static instructions for `workMode !== 'edit'` (the "call get_note" instruction) — replace with appropriate text.

**Specifically**: find the line:
```typescript
const noteContextLine = bodyOmitted
    ? 'The current note title and ID are shown below. Call get_note with the note ID to read its content when needed.'
    : 'The user\'s current note is provided below. The note is in Markdown format.';
```

Change it to:
```typescript
const noteContextLine = bodyOmitted
    ? 'The current note title and ID are shown below.'
    : 'The user\'s current note is provided below. The note is in Markdown format.';
```

(Remove the "Call get_note" instruction — with the new approach, the AI uses history memory instead of fetching the note again.)

- [ ] **Step 5: Run failing tests, then make them pass**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test -- --testPathPattern=service 2>&1 | tail -40
```

Fix any TypeScript or logic issues until the new tests pass and existing tests still pass.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/ai/service.ts src/ai/__tests__/service.test.ts
git commit -m "feat: use noteContextInHistory in buildSystemPromptParts for patch optimisation"
```

---

## Task 4 — Loop functions: inject note-context synthetic pair + update `sendToAI` signature

**Files:**
- Modify: `src/ai/service.ts`
- Modify: `src/ai/__tests__/service.test.ts`

### Background

When `noteContextInHistory` is present (same noteId), the note body must appear in the **messages array** so the AI has it in conversational memory. We inject a synthetic user/assistant pair *before* the real history:

```
[user]: "[NOTE_CONTEXT]\nTitle: {noteTitle}\n\n{noteBody}"
[assistant]: "Note context received."
[user]: "first real message"  ...
```

This works for all four loops. For Claude (strict user/assistant alternation) and OpenAI/Perplexity/Sonar (all accept this pattern) it is identical.

`sendToAI` loses the old `previousNoteBody` parameter (10th positional arg) and gains `noteContext?: NoteContextSnapshot` (10th positional arg, same position — but named differently). The `onBodyDecision` call moves to *after* `buildSystemPromptParts` so it fires based on the actual decision.

- [ ] **Step 1: Write failing tests for message injection**

In `src/ai/__tests__/service.test.ts`, add to the `sendToAI` describe block:

```typescript
describe('sendToAI note-context message injection', () => {
	const noteContext: import('../types').NoteContextSnapshot = {
		noteId: 'n1',
		noteTitle: 'Test Note',
		noteBody: 'Body content\n',
	};
	const history: ChatMessage[] = [
		{ role: 'user', content: 'hello' },
		{ role: 'assistant', content: 'hi' },
	];

	beforeEach(() => {
		mockedStreamClaude.mockResolvedValue({
			textContent: 'response',
			toolCalls: [],
			finishReason: 'end_turn',
			rawAssistantMessage: { role: 'assistant', content: 'response' },
			usage: { inputTokens: 10, outputTokens: 5 },
		});
	});

	it('prepends synthetic note-context pair when noteContext present and note unchanged', async () => {
		await sendToAI(
			'claude',
			'key',
			'claude-sonnet-4-6',
			'user question',
			'Test Note',
			'Body content\n',
			{ currentNoteId: 'n1', currentNoteTitle: 'Test Note', workMode: 'ask' },
			history,
			undefined,
			noteContext,
		);
		const calls = mockedStreamClaude.mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const messages = calls[0][3]; // 4th arg to streamClaudeMessages is messages array
		expect(messages[0]).toMatchObject({ role: 'user', content: expect.stringContaining('[NOTE_CONTEXT]') });
		expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Note context received.' });
		// real history follows
		expect(messages[2]).toMatchObject({ role: 'user', content: 'hello' });
	});

	it('does NOT prepend when noteContext noteId differs (navigation)', async () => {
		await sendToAI(
			'claude',
			'key',
			'claude-sonnet-4-6',
			'user question',
			'Other Note',
			'Different body\n',
			{ currentNoteId: 'n2', currentNoteTitle: 'Other Note', workMode: 'ask' },
			history,
			undefined,
			{ noteId: 'n1', noteTitle: 'Test Note', noteBody: 'Body content\n' },
		);
		const messages = mockedStreamClaude.mock.calls[0][3];
		// first message should be the real history, not a note-context pair
		expect(messages[0]).toMatchObject({ role: 'user', content: 'hello' });
	});
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test -- --testPathPattern=service 2>&1 | tail -30
```

- [ ] **Step 3: Add note-context injection to loop functions in `src/ai/service.ts`**

For **`runClaudeLoop`**: add `noteContext?: NoteContextSnapshot` parameter after `history`. At the start of the function, build the injection:

```typescript
const noteContextPair: { role: 'user' | 'assistant'; content: string }[] =
	noteContext && noteContext.noteId === context.currentNoteId
		? [
				{
					role: 'user',
					content: `[NOTE_CONTEXT]\nTitle: ${noteContext.noteTitle}\n\n${noteContext.noteBody}`,
				},
				{ role: 'assistant', content: 'Note context received.' },
		  ]
		: [];

const messages: any[] = [...noteContextPair, ...historyMessages, userMessage];
```

Replace the existing `const messages: any[] = [...historyMessages, userMessage];` line.

For **`runOpenAILoop`**: same injection, same pattern. Replace:
```typescript
const messages: any[] = [
    { role: 'system', content: promptParts.staticInstructions },
    { role: 'system', content: promptParts.noteBodyContext },
    { role: 'system', content: promptParts.dynamicContext },
    ...historyMessages,
    userMessage,
];
```
With:
```typescript
const noteContextPair: any[] =
	noteContext && noteContext.noteId === context.currentNoteId
		? [
				{
					role: 'user',
					content: `[NOTE_CONTEXT]\nTitle: ${noteContext.noteTitle}\n\n${noteContext.noteBody}`,
				},
				{ role: 'assistant', content: 'Note context received.' },
		  ]
		: [];

const messages: any[] = [
	{ role: 'system', content: promptParts.staticInstructions },
	{ role: 'system', content: promptParts.noteBodyContext },
	{ role: 'system', content: promptParts.dynamicContext },
	...noteContextPair,
	...historyMessages,
	userMessage,
];
```

For **`runPerplexityLoop`**: add `noteContext?: NoteContextSnapshot`. Inject the pair into `historyItems` before real history:
```typescript
const contextItems: PerplexityInputItem[] =
	noteContext && noteContext.noteId === context.currentNoteId
		? [
				{ role: 'user', content: `[NOTE_CONTEXT]\nTitle: ${noteContext.noteTitle}\n\n${noteContext.noteBody}` },
				{ role: 'assistant', content: 'Note context received.' },
		  ]
		: [];
const historyItems: PerplexityInputItem[] = (history ?? []).map((m) => ({ role: m.role, content: m.content }));
let input: string | PerplexityInputItem[] =
	contextItems.length > 0 || historyItems.length > 0
		? [...contextItems, ...historyItems, { role: 'user', content: userPrompt }]
		: userPrompt;
```

For **`runSonarLoop`**: add `noteContext?: NoteContextSnapshot`. Inject before history in the `messages` array:
```typescript
const noteContextPair: SonarChatMessage[] =
	noteContext && noteContext.noteId === context.currentNoteId
		? [
				{ role: 'user', content: `[NOTE_CONTEXT]\nTitle: ${noteContext.noteTitle}\n\n${noteContext.noteBody}` },
				{ role: 'assistant', content: 'Note context received.' },
		  ]
		: [];
const messages: SonarChatMessage[] = [
	{ role: 'system', content: enhancedSystemPrompt },
	...noteContextPair,
	...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
	{ role: 'user', content: userPrompt },
];
```

- [ ] **Step 4: Update `sendToAI` signature in `src/ai/service.ts`**

Find `sendToAI`. Change the 10th parameter from `previousNoteBody?: string` to `noteContext?: NoteContextSnapshot`.

Move the `onBodyDecision` call from *before* `buildSystemPromptParts` to *after* it. Remove the line:
```typescript
actionContext.onBodyDecision?.(includeBody);
```

After `buildSystemPromptParts`, add:
```typescript
if (promptParts.diffStats) {
	actionContext.onDiffSent?.(promptParts.diffStats.added, promptParts.diffStats.removed);
} else {
	actionContext.onBodyDecision?.(promptParts.bodyIncluded);
}
```

Update `buildSystemPromptParts` call — replace `previousNoteBody: includeBody ? previousNoteBody : undefined` with:
```typescript
noteContextInHistory: includeBody ? noteContext : undefined,
```

Pass `noteContext` to the `runLoop` closures:
```typescript
const runLoop = () => {
	if (provider === 'openai')
		return runOpenAILoop(apiKey, model, promptParts, userPrompt, actionContext, history, noteContext);
	if (provider === 'perplexity') {
		if (isSonarApiModel(model))
			return runSonarLoop(apiKey, model, promptParts, userPrompt, actionContext, history, isNativeSearch, noteContext);
		return runPerplexityLoop(apiKey, model, promptParts, userPrompt, actionContext, history, isNativeSearch, noteContext);
	}
	return runClaudeLoop(apiKey, model, promptParts, userPrompt, actionContext, history, noteContext);
};
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test -- --testPathPattern=service 2>&1 | tail -30
```

Fix until all pass.

- [ ] **Step 6: Full test suite**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test 2>&1 | tail -20
```

- [ ] **Step 7: Commit**

```bash
git add src/ai/service.ts src/ai/__tests__/service.test.ts
git commit -m "feat: inject note-context synthetic pair in messages, update sendToAI to use noteContext"
```

---

## Task 5 — panel.ts: thread `noteContext`, send `noteContextUpdate` + `noteDiffSent`

**Files:**
- Modify: `src/panel.ts`
- Modify: `src/__tests__/panel.test.ts`

### Background

`handleExecute` receives `noteContext` from the `execute` webview message and passes it to `sendToAI`. After a successful response, panel.ts sends `noteContextUpdate` with the final note body (post-edit if the AI modified the note) so the webview can keep its snapshot current. `onBodyDecision` and `onDiffSent` callbacks now send the appropriate UI events.

`lastSentNoteId` and `lastSentNoteBody` module-level variables become unused and are removed.

- [ ] **Step 1: Write a failing test**

In `src/__tests__/panel.test.ts`, find the existing test helpers and add a test for `noteContextUpdate`:

```typescript
it('sends noteContextUpdate to webview after successful AI response', async () => {
	// Setup: mock sendToAI to return a successful result
	const mockedSendToAI = require('../ai/service').sendToAI as jest.MockedFunction<any>;
	mockedSendToAI.mockResolvedValueOnce({
		content: 'AI response',
		isEdit: false,
		actions: [],
	});

	// Trigger execute message with noteContext
	await capturedOnMessageCallback({
		type: 'execute',
		prompt: 'hello',
		history: [],
		workMode: 'ask',
		noteContext: { noteId: 'note-1', noteTitle: 'Test', noteBody: 'body' },
	});

	// Verify noteContextUpdate was posted
	const updates = mockPostMessage.mock.calls.filter(
		(c: any[]) => c[1]?.type === 'noteContextUpdate',
	);
	expect(updates.length).toBeGreaterThan(0);
	expect(updates[0][1]).toMatchObject({
		type: 'noteContextUpdate',
		noteId: expect.any(String),
		noteTitle: expect.any(String),
		noteBody: expect.any(String),
	});
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test -- --testPathPattern=panel.test 2>&1 | tail -20
```

- [ ] **Step 3: Update `handleExecute` in `src/panel.ts`**

Add `noteContext?: NoteContextSnapshot` as the 8th parameter (before `onError`):

```typescript
const handleExecute = async (
	handle: ViewHandle,
	prompt: string,
	history?: ChatMessage[],
	agentRolePrompt?: string,
	workMode?: WorkMode,
	attachedFiles?: AttachedFile[],
	noteId?: string,
	noteContext?: NoteContextSnapshot,
	onError?: (message: string) => void,
	suppressPendingEdits?: boolean,
) => {
```

Add the import at the top of `src/panel.ts`:
```typescript
import { ..., NoteContextSnapshot } from './ai/types';
```

- [ ] **Step 4: Remove `lastSentNoteId` / `lastSentNoteBody` and update callbacks**

Remove these two module-level variables (lines 29-30):
```typescript
let lastSentNoteId: string | null = null;
let lastSentNoteBody: string | null = null;
```

Inside `handleExecute`, remove:
```typescript
const previousNoteBody =
    lastSentNoteId === note.id ? (lastSentNoteBody ?? undefined) : undefined;
```

And remove:
```typescript
lastSentNoteId = note.id;
lastSentNoteBody = note.body;
```

And the progressive apply update (`lastSentNoteBody = nextBody` at line 294) — also remove.

And the error-path resets (lines 718-719, 734-735) — remove.

Update the `sendToAI` call: replace `previousNoteBody` 10th arg with `noteContext`:
```typescript
const response = await sendToAI(
	config.provider,
	config.apiKey,
	config.model,
	cleanPrompt,
	note.title,
	note.body,
	context,
	history,
	undefined,
	noteContext,  // was: previousNoteBody
);
```

Update `sendUpdatedContextSize` call: replace `previousNoteBody` with `noteContext?.noteBody`:
```typescript
sendUpdatedContextSize(handle, {
	...
	previousNoteBody: noteContext?.noteBody,
});
```

- [ ] **Step 5: Update `onBodyDecision` callback and add `onDiffSent`**

Replace the existing `onBodyDecision` callback setup with:

```typescript
context.onBodyDecision = (included: boolean) => {
	if (included) {
		const charCount = hasSelection ? editorSelection.trim().length : note.body.length;
		joplin.views.panels.postMessage(handle, {
			type: 'noteBodySent',
			noteTitle: note.title,
			charCount,
		});
	}
};
context.onDiffSent = (added: number, removed: number) => {
	joplin.views.panels.postMessage(handle, {
		type: 'noteDiffSent',
		noteTitle: note.title,
		added,
		removed,
	});
};
```

- [ ] **Step 6: Send `noteContextUpdate` after successful response**

After `sendResult(...)`, determine the final note body and send the update. Insert:

```typescript
// After sendResult(...):
// Determine final note body (post-edit if AI modified the note)
let finalNoteBody = note.body;
if (response.isEdit && collectedEdits.length === 0) {
	const updatedNote = noteId ? await getNoteById(noteId) : await getCurrentNote();
	if (updatedNote && updatedNote.id === note.id) {
		finalNoteBody = updatedNote.body;
	}
	await sendNoteInfo(handle);
}
joplin.views.panels.postMessage(handle, {
	type: 'noteContextUpdate',
	noteId: note.id,
	noteTitle: note.title,
	noteBody: finalNoteBody,
});
```

Remove the old `if (response.isEdit && collectedEdits.length === 0) { ... await sendNoteInfo(handle); }` block that was separate — merge it into the above.

- [ ] **Step 7: Update `execute` message handler to pass `noteContext`**

Find the handler (around line 757):
```typescript
if (message.type === 'execute') {
	await handleExecute(
		chatPanelHandle,
		message.prompt,
		message.history as ChatMessage[],
		message.agentRolePrompt as string | undefined,
		message.workMode as WorkMode | undefined,
		message.attachedFiles as AttachedFile[] | undefined,
		message.noteId as string | undefined,
	);
}
```

Add the `noteContext` argument:
```typescript
if (message.type === 'execute') {
	await handleExecute(
		chatPanelHandle,
		message.prompt,
		message.history as ChatMessage[],
		message.agentRolePrompt as string | undefined,
		message.workMode as WorkMode | undefined,
		message.attachedFiles as AttachedFile[] | undefined,
		message.noteId as string | undefined,
		message.noteContext as NoteContextSnapshot | undefined,
	);
}
```

Also check `src/panel.ts` line 879 where `handleExecute` is called a second time (for non-chat panel), and add `undefined` for `noteContext` there.

- [ ] **Step 8: Run tests**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test 2>&1 | tail -20
```

Fix until all pass.

- [ ] **Step 9: Commit**

```bash
git add src/panel.ts src/__tests__/panel.test.ts
git commit -m "feat: thread noteContext through handleExecute, send noteContextUpdate after response"
```

---

## Task 6 — webview/panel.js: `currentNoteContext` state + persistence + UI events

**Files:**
- Modify: `src/webview/panel.js`
- Modify: `src/webview/__tests__/panel.test.ts` (if this file tests webview events)

### Background

The webview holds `currentNoteContext` in memory and persists it in localStorage under key `'joplin-ai-note-context'`. It is:
- Included in every `execute` message as `noteContext`
- Updated when `noteContextUpdate` arrives from panel
- Cleared when the chat history is cleared
- Cleared when `noteInfo` arrives with a different `noteId` than the snapshot

The `noteDiffSent` event triggers a new UI card: `"NOTE DIFF SENT TO AI · +X/-Y chars"`.

- [ ] **Step 1: Add state variable and localStorage key**

Near the top of `src/webview/panel.js`, after the existing `STORAGE_KEY_MESSAGES` declaration, add:

```javascript
var STORAGE_KEY_NOTE_CONTEXT = 'joplin-ai-note-context';
```

Near `let chatHistory = [];`, add:

```javascript
var currentNoteContext = null;
try {
	var _nc = localStorage.getItem(STORAGE_KEY_NOTE_CONTEXT);
	if (_nc) currentNoteContext = JSON.parse(_nc);
} catch (_e) {}
```

- [ ] **Step 2: Include `noteContext` in the `dispatchExecute` message**

Find the `dispatchExecute` function. Inside `const msg = { type: 'execute', prompt, history, workMode }`, add:

```javascript
if (currentNoteContext) {
	msg.noteContext = currentNoteContext;
}
```

- [ ] **Step 3: Handle `noteContextUpdate` from panel**

In the `webviewApi.onMessage` handler, add:

```javascript
if (message.type === 'noteContextUpdate') {
	currentNoteContext = {
		noteId: message.noteId,
		noteTitle: message.noteTitle,
		noteBody: message.noteBody,
	};
	try { localStorage.setItem(STORAGE_KEY_NOTE_CONTEXT, JSON.stringify(currentNoteContext)); } catch (_e) {}
	return;
}
```

- [ ] **Step 4: Handle `noteDiffSent` — show UI indicator**

In the `webviewApi.onMessage` handler, add:

```javascript
if (message.type === 'noteDiffSent') {
	addMessage(
		'action-info',
		svgIcon('fileText', '14') + ' Note diff sent to AI',
		'Changes in "' + escapeHtml(message.noteTitle) + '" included in context (+' + message.added + '/-' + message.removed + ' chars)',
		null, null, false,
	);
	return;
}
```

- [ ] **Step 5: Clear `currentNoteContext` when chat history is cleared**

In the `clearHistoryBtn.addEventListener('click', ...)` handler, after `chatHistory = [];`, add:

```javascript
currentNoteContext = null;
try { localStorage.removeItem(STORAGE_KEY_NOTE_CONTEXT); } catch (_e) {}
```

- [ ] **Step 6: Clear `currentNoteContext` when note changes (`noteInfo` event)**

Find the `noteInfo` message handler. It currently updates `noteId` / `title` display. Add at the start of the handler:

```javascript
if (message.type === 'noteInfo') {
	if (currentNoteContext && message.noteId && currentNoteContext.noteId !== message.noteId) {
		currentNoteContext = null;
		try { localStorage.removeItem(STORAGE_KEY_NOTE_CONTEXT); } catch (_e) {}
	}
	// ... existing noteInfo handling continues
}
```

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/webview/panel.js
git commit -m "feat: add currentNoteContext state in webview, send with requests, handle noteContextUpdate/noteDiffSent"
```

---

## Final Verification

After all tasks are complete, run the full test suite one more time:

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm test 2>&1 | tail -30
```

All tests must pass. Then run lint:

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npm run lint 2>&1 | tail -10
```

Expected: no lint errors.
