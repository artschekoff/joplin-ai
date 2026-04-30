# Thinking Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display a seconds timer above the "AI thinking" loading indicator that ticks once per second while the AI is processing a request.

**Architecture:** Add a `thinkingSeconds` counter and `thinkingSecondTimer` interval to the panel's loading state. The loading indicator HTML is restructured into two rows: a timer row on top, and the existing spinner + text row below. The timer starts when `showLoading(true)` is called and stops (and is removed) when `showLoading(false)` is called.

**Tech Stack:** Vanilla JS (`panel.js`), CSS (`panel.css`), Jest + jsdom for tests (`panel.test.ts`)

---

## File Map

- **Modify:** `src/webview/panel.js` — add `thinkingSeconds`/`thinkingSecondTimer` variables, `formatThinkingTime()` helper, restructure `showLoading()` HTML, add second-tick interval logic
- **Modify:** `src/webview/panel.css` — change `.loading` to column flex, add `.loading-main-row` and `.loading-timer` rules
- **Modify:** `src/webview/__tests__/panel.test.ts` — add timer-specific test suite with fake timers

---

### Task 1: Write failing tests for the timer feature

**Files:**
- Modify: `src/webview/__tests__/panel.test.ts`

- [ ] **Step 1: Add a new `describe` block at the end of `panel.test.ts` (before the last closing brace of the file, after line 3639)**

Open `src/webview/__tests__/panel.test.ts` and append the following at the end of the file (after the last `});` of `describe('bottom bar layout', ...)`):

```typescript
describe('thinking timer in loading indicator', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let messageHandler: (msg: unknown) => void;

	beforeEach(() => {
		jest.useFakeTimers();
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		messageHandler = mockApi.onMessage.mock.calls[0][0];
	});

	afterEach(() => {
		jest.useRealTimers();
		delete (window as any).webviewApi;
	});

	it('shows a timer element with initial value 0:00 when loading starts', () => {
		messageHandler({ type: 'loading', status: true });

		const loadingEl = document.getElementById('loadingIndicator');
		expect(loadingEl).not.toBeNull();
		const timerEl = loadingEl!.querySelector('.loading-timer');
		expect(timerEl).not.toBeNull();
		expect(timerEl!.textContent).toBe('0:00');
	});

	it('increments the timer every second', () => {
		messageHandler({ type: 'loading', status: true });

		jest.advanceTimersByTime(3000);

		const loadingEl = document.getElementById('loadingIndicator');
		const timerEl = loadingEl!.querySelector('.loading-timer');
		expect(timerEl!.textContent).toBe('0:03');
	});

	it('formats time as M:SS when over 60 seconds', () => {
		messageHandler({ type: 'loading', status: true });

		jest.advanceTimersByTime(75000);

		const loadingEl = document.getElementById('loadingIndicator');
		const timerEl = loadingEl!.querySelector('.loading-timer');
		expect(timerEl!.textContent).toBe('1:15');
	});

	it('removes the timer element when loading stops', () => {
		messageHandler({ type: 'loading', status: true });
		jest.advanceTimersByTime(2000);

		messageHandler({ type: 'loading', status: false });

		expect(document.getElementById('loadingIndicator')).toBeNull();
	});

	it('resets the timer to 0:00 when loading restarts', () => {
		messageHandler({ type: 'loading', status: true });
		jest.advanceTimersByTime(5000);

		messageHandler({ type: 'loading', status: false });
		messageHandler({ type: 'loading', status: true });

		const loadingEl = document.getElementById('loadingIndicator');
		const timerEl = loadingEl!.querySelector('.loading-timer');
		expect(timerEl!.textContent).toBe('0:00');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npx jest src/webview/__tests__/panel.test.ts --testNamePattern="thinking timer" --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `.loading-timer` not found, tests should fail with `expect(timerEl).not.toBeNull()` or similar.

- [ ] **Step 3: Commit the failing tests**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai
git add src/webview/__tests__/panel.test.ts
git commit -m "test: add failing tests for thinking timer feature"
```

---

### Task 2: Add timer state and helper to panel.js

**Files:**
- Modify: `src/webview/panel.js`

- [ ] **Step 1: Add `thinkingSeconds` and `thinkingSecondTimer` variables**

In `src/webview/panel.js`, find the block where `thinkingModelName` is declared (around line 84):

```javascript
	let streamingMsgDiv = null;
	let streamingText = '';
	let sessionTotalCost = 0;
	let thinkingModelName = '';
```

Change it to:

```javascript
	let streamingMsgDiv = null;
	let streamingText = '';
	let sessionTotalCost = 0;
	let thinkingModelName = '';
	let thinkingSeconds = 0;
	let thinkingSecondTimer = null;
```

- [ ] **Step 2: Add `formatThinkingTime` helper function**

In `src/webview/panel.js`, find `function escapeHtml(text)` (line 86) and add the helper directly before it:

```javascript
	function formatThinkingTime(seconds) {
		var m = Math.floor(seconds / 60);
		var s = seconds % 60;
		return m + ':' + (s < 10 ? '0' : '') + s;
	}
```

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npx jest src/webview/__tests__/panel.test.ts --no-coverage 2>&1 | tail -15
```

Expected: all existing tests PASS, new timer tests still FAIL (`.loading-timer` not in DOM yet).

- [ ] **Step 4: Commit**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai
git add src/webview/panel.js
git commit -m "feat: add thinkingSeconds state and formatThinkingTime helper"
```

---

### Task 3: Restructure showLoading to include timer and start/stop interval

**Files:**
- Modify: `src/webview/panel.js`

- [ ] **Step 1: Replace the `showLoading` function body**

Find the entire `showLoading` function (lines 329–346):

```javascript
	function showLoading(show) {
		isLoading = show;
		executeBtn.disabled = show;

		const existing = document.getElementById('loadingIndicator');
		if (show && !existing) {
			const loadingDiv = document.createElement('div');
			loadingDiv.id = 'loadingIndicator';
			loadingDiv.className = 'loading';
			loadingDiv.innerHTML = '<div class="spinner"></div><span class="loading-text">' + escapeHtml(thinkingLabel('is thinking...')) + '</span>';
			messagesEl.appendChild(loadingDiv);
			messagesEl.scrollTop = messagesEl.scrollHeight;
			startThinkingFillers();
		} else if (!show && existing) {
			stopThinkingFillers();
			existing.remove();
		}
	}
```

Replace it with:

```javascript
	function showLoading(show) {
		isLoading = show;
		executeBtn.disabled = show;

		const existing = document.getElementById('loadingIndicator');
		if (show && !existing) {
			thinkingSeconds = 0;
			const loadingDiv = document.createElement('div');
			loadingDiv.id = 'loadingIndicator';
			loadingDiv.className = 'loading';
			loadingDiv.innerHTML =
				'<span class="loading-timer">' + formatThinkingTime(0) + '</span>' +
				'<div class="loading-main-row">' +
				'<div class="spinner"></div>' +
				'<span class="loading-text">' + escapeHtml(thinkingLabel('is thinking...')) + '</span>' +
				'</div>';
			messagesEl.appendChild(loadingDiv);
			messagesEl.scrollTop = messagesEl.scrollHeight;
			startThinkingFillers();
			thinkingSecondTimer = setInterval(function () {
				thinkingSeconds++;
				var timerEl = document.querySelector('#loadingIndicator .loading-timer');
				if (timerEl) timerEl.textContent = formatThinkingTime(thinkingSeconds);
			}, 1000);
		} else if (!show && existing) {
			stopThinkingFillers();
			if (thinkingSecondTimer) {
				clearInterval(thinkingSecondTimer);
				thinkingSecondTimer = null;
			}
			thinkingSeconds = 0;
			existing.remove();
		}
	}
```

- [ ] **Step 2: Run the timer tests to verify they pass**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npx jest src/webview/__tests__/panel.test.ts --testNamePattern="thinking timer" --no-coverage 2>&1 | tail -20
```

Expected: all 5 timer tests PASS.

- [ ] **Step 3: Run the full panel test suite**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npx jest src/webview/__tests__/panel.test.ts --no-coverage 2>&1 | tail -15
```

Expected: all tests PASS (existing tests use `textContent` contains-checks, so the timer text won't break them).

- [ ] **Step 4: Commit**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai
git add src/webview/panel.js
git commit -m "feat: add thinking timer that ticks each second in loading indicator"
```

---

### Task 4: Update CSS for timer layout

**Files:**
- Modify: `src/webview/panel.css`

- [ ] **Step 1: Replace the `.loading` CSS block**

Find the current `.loading` block (lines 254–262):

```css
/* Loading */
.loading {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 12px;
	color: var(--text-secondary);
	font-size: 12px;
}
```

Replace it with:

```css
/* Loading */
.loading {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px;
	color: var(--text-secondary);
	font-size: 12px;
}

.loading-main-row {
	display: flex;
	align-items: center;
	gap: 8px;
}

.loading-timer {
	font-size: 11px;
	font-weight: 600;
	color: var(--text-secondary);
	font-variant-numeric: tabular-nums;
	letter-spacing: 0.02em;
}
```

- [ ] **Step 2: Run the full test suite once more**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npx jest src/webview/__tests__/panel.test.ts --no-coverage 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai
git add src/webview/panel.css
git commit -m "style: update loading indicator layout to stack timer above spinner row"
```

---

## Self-Review

**Spec coverage:**
- Timer ticks each second ✓ (Task 3 — `setInterval(..., 1000)`)
- Timer displayed above "AI thinking" area ✓ (Task 3 — `.loading-timer` is first child of `#loadingIndicator`; Task 4 — column flex puts it on top)
- Timer starts when AI starts thinking ✓ (`showLoading(true)` starts the interval)
- Timer stops / disappears when AI finishes ✓ (`showLoading(false)` clears interval and removes element)

**Placeholder scan:** No TBDs, all code blocks are complete.

**Type consistency:** `formatThinkingTime` is defined in Task 2 and called in Task 3 — consistent. `thinkingSeconds`/`thinkingSecondTimer` declared in Task 2, used in Task 3 — consistent.
