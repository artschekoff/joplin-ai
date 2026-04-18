/**
 * @jest-environment jsdom
 *
 * Tests for popover text-search filtering.
 *
 * When the Editor.js popover is open, typing printable characters should:
 *  - Build a search query and filter items by their text content
 *  - Hide non-matching items via `ce-popover-item--hidden`
 *  - Auto-focus the first matching item (handled by MutationObserver)
 *  - Show a visual search indicator with the current query
 *  - Clear on Backspace (character-by-character) and Escape
 *  - Reset when the popover closes
 *  - Be case-insensitive
 */

import * as fs from 'fs';
import * as path from 'path';

const blockEditorSource = fs.readFileSync(
	path.resolve(__dirname, '..', 'block-editor.js'),
	'utf-8',
);

// ── helpers ────────────────────────────────────────────────────────────────────

const TOOL_NAMES = [
	'Text',
	'Heading',
	'Unordered List',
	'Ordered List',
	'Checklist',
	'Code',
	'Quote',
	'Delimiter',
];

const buildDOM = (): void => {
	document.body.innerHTML = `
    <div id="editor-pane">
      <div id="editor-container"></div>
      <div id="vim-statusbar"><span id="vim-mode-label">-- INSERT --</span></div>
    </div>
  `;
};

const fireKeydown = (
	target: EventTarget,
	key: string,
	extra: Partial<KeyboardEventInit> = {},
): KeyboardEvent => {
	const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
	target.dispatchEvent(event);
	return event;
};

/** Build a popover with named tool items matching the real Editor.js toolbox. */
const buildPopover = (names: string[] = TOOL_NAMES): HTMLElement => {
	const popover = document.createElement('div');
	popover.className = 'ce-popover ce-popover--opened';

	const search = document.createElement('div');
	search.className = 'ce-popover__search';
	popover.appendChild(search);

	for (const name of names) {
		const item = document.createElement('div');
		item.className = 'ce-popover-item';

		const title = document.createElement('span');
		title.className = 'ce-popover-item__title';
		title.textContent = name;
		item.appendChild(title);

		item.addEventListener('click', jest.fn());
		popover.appendChild(item);
	}

	document.body.appendChild(popover);
	return popover;
};

let onReadyCallback: (() => void) | null = null;

const setupGlobals = (): void => {
	const mockBlocks = {
		getBlocksCount: jest.fn().mockReturnValue(3),
		getCurrentBlockIndex: jest.fn().mockReturnValue(0),
		delete: jest.fn(),
		insert: jest.fn(),
	};
	const mockEditor = {
		blocks: mockBlocks,
		caret: { setToBlock: jest.fn() },
		isReady: Promise.resolve(),
		save: jest.fn().mockResolvedValue({ blocks: [] }),
	};

	(window as any).EditorJS = jest.fn().mockImplementation(({ onReady }: any) => {
		onReadyCallback = onReady;
		return mockEditor;
	});
	(window as any).DragDrop = jest.fn();
	(window as any).Header = jest.fn();
	(window as any).EditorjsList = jest.fn();
	(window as any).Checklist = jest.fn();
	(window as any).CodeTool = jest.fn();
	(window as any).Quote = jest.fn();
	(window as any).Delimiter = jest.fn();
	(window as any).MarkdownConverter = {
		markdownToBlocks: jest.fn().mockReturnValue({ blocks: [] }),
		blocksToMarkdown: jest.fn().mockReturnValue(''),
	};
	(window as any).webviewApi = { postMessage: jest.fn(), onMessage: jest.fn() };
};

beforeEach(() => {
	jest.useFakeTimers();
	jest.clearAllMocks();
	onReadyCallback = null;
	window.HTMLElement.prototype.scrollIntoView = jest.fn();
	buildDOM();
	setupGlobals();
	// eslint-disable-next-line no-eval
	eval(blockEditorSource);
	onReadyCallback?.();
});

afterEach(() => {
	jest.useRealTimers();
	document.body.innerHTML = '';
	const globals = [
		'BlockEditor',
		'EditorJS',
		'DragDrop',
		'Header',
		'EditorjsList',
		'Checklist',
		'CodeTool',
		'Quote',
		'Delimiter',
		'MarkdownConverter',
		'webviewApi',
	];
	globals.forEach((g) => delete (window as any)[g]);
});

// ── helpers for assertions ──────────────────────────────────────────────────

const visibleItems = (popover: HTMLElement): HTMLElement[] =>
	Array.from(
		popover.querySelectorAll<HTMLElement>('.ce-popover-item:not(.ce-popover-item--hidden)'),
	);

const hiddenItems = (popover: HTMLElement): HTMLElement[] =>
	Array.from(popover.querySelectorAll<HTMLElement>('.ce-popover-item--hidden'));

const itemTitles = (items: HTMLElement[]): string[] =>
	items.map(
		(el) => el.querySelector('.ce-popover-item__title')?.textContent ?? el.textContent ?? '',
	);

const getSearchIndicator = (): HTMLElement | null =>
	document.querySelector('.be-popover-search-indicator');

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Popover text-search filtering', () => {
	describe('typing filters items', () => {
		it('should hide non-matching items when a character is typed', async () => {
			const popover = buildPopover();
			await Promise.resolve();
			jest.runAllTimers();

			fireKeydown(document.body, 'h');
			await Promise.resolve();
			jest.runAllTimers();

			const visible = visibleItems(popover);
			const titles = itemTitles(visible);
			expect(titles).toEqual(expect.arrayContaining(['Heading']));
			expect(titles).not.toContain('Code');
			expect(titles).not.toContain('Delimiter');
		});

		it('should narrow results as more characters are typed', async () => {
			const popover = buildPopover();
			await Promise.resolve();
			jest.runAllTimers();

			fireKeydown(document.body, 'c');
			await Promise.resolve();
			jest.runAllTimers();

			const afterC = itemTitles(visibleItems(popover));
			expect(afterC).toEqual(expect.arrayContaining(['Checklist', 'Code']));

			fireKeydown(document.body, 'o');
			await Promise.resolve();
			jest.runAllTimers();

			const afterCo = itemTitles(visibleItems(popover));
			expect(afterCo).toEqual(expect.arrayContaining(['Code']));
			expect(afterCo).not.toContain('Checklist');
		});

		it('should be case-insensitive', async () => {
			const popover = buildPopover();
			await Promise.resolve();
			jest.runAllTimers();

			fireKeydown(document.body, 'H');
			await Promise.resolve();
			jest.runAllTimers();

			const titles = itemTitles(visibleItems(popover));
			expect(titles).toEqual(expect.arrayContaining(['Heading']));
		});
	});

	describe('first match auto-focus', () => {
		it('should focus the first visible item after filtering', async () => {
			const popover = buildPopover();
			await Promise.resolve();
			jest.runAllTimers();

			fireKeydown(document.body, 'q');
			await Promise.resolve();
			jest.runAllTimers();

			const visible = visibleItems(popover);
			expect(visible.length).toBeGreaterThan(0);
			expect(visible[0].classList.contains('ce-popover-item--focused')).toBe(true);
		});
	});

	describe('Backspace removes last character', () => {
		it('should widen results when Backspace is pressed', async () => {
			const popover = buildPopover();
			await Promise.resolve();
			jest.runAllTimers();

			fireKeydown(document.body, 'c');
			fireKeydown(document.body, 'o');
			await Promise.resolve();
			jest.runAllTimers();

			const afterCo = visibleItems(popover).length;

			fireKeydown(document.body, 'Backspace');
			await Promise.resolve();
			jest.runAllTimers();

			const afterC = visibleItems(popover).length;
			expect(afterC).toBeGreaterThan(afterCo);
		});

		it('should show all items when search query is fully cleared via Backspace', async () => {
			const popover = buildPopover();
			await Promise.resolve();
			jest.runAllTimers();

			fireKeydown(document.body, 'h');
			await Promise.resolve();
			jest.runAllTimers();

			expect(hiddenItems(popover).length).toBeGreaterThan(0);

			fireKeydown(document.body, 'Backspace');
			await Promise.resolve();
			jest.runAllTimers();

			expect(hiddenItems(popover).length).toBe(0);
		});
	});

	describe('Escape clears search', () => {
		it('should clear the search query and show all items on Escape', async () => {
			const popover = buildPopover();
			await Promise.resolve();
			jest.runAllTimers();

			fireKeydown(document.body, 'h');
			fireKeydown(document.body, 'e');
			await Promise.resolve();
			jest.runAllTimers();

			expect(hiddenItems(popover).length).toBeGreaterThan(0);

			fireKeydown(document.body, 'Escape');
			await Promise.resolve();
			jest.runAllTimers();

			expect(hiddenItems(popover).length).toBe(0);
		});
	});

	describe('search indicator', () => {
		it('should show a search indicator element when typing in the popover', async () => {
			buildPopover();
			await Promise.resolve();
			jest.runAllTimers();

			fireKeydown(document.body, 'h');
			await Promise.resolve();
			jest.runAllTimers();

			const indicator = getSearchIndicator();
			expect(indicator).not.toBeNull();
			expect(indicator!.textContent).toContain('h');
		});

		it('should remove the search indicator when query is cleared', async () => {
			buildPopover();
			await Promise.resolve();
			jest.runAllTimers();

			fireKeydown(document.body, 'h');
			await Promise.resolve();
			jest.runAllTimers();

			expect(getSearchIndicator()).not.toBeNull();

			fireKeydown(document.body, 'Backspace');
			await Promise.resolve();
			jest.runAllTimers();

			expect(getSearchIndicator()).toBeNull();
		});
	});

	describe('non-printable keys are ignored', () => {
		it('should not filter on arrow keys', async () => {
			const popover = buildPopover();
			await Promise.resolve();
			jest.runAllTimers();

			const beforeCount = visibleItems(popover).length;

			fireKeydown(document.body, 'ArrowDown');
			fireKeydown(document.body, 'ArrowUp');
			await Promise.resolve();
			jest.runAllTimers();

			expect(visibleItems(popover).length).toBe(beforeCount);
		});

		it('should not filter on modifier-key combos', async () => {
			const popover = buildPopover();
			await Promise.resolve();
			jest.runAllTimers();

			const beforeCount = visibleItems(popover).length;

			fireKeydown(document.body, 'a', { ctrlKey: true });
			fireKeydown(document.body, 'c', { metaKey: true });
			await Promise.resolve();
			jest.runAllTimers();

			expect(visibleItems(popover).length).toBe(beforeCount);
		});
	});

	describe('no popover — search does nothing', () => {
		it('should not create a search indicator when no popover is open', () => {
			fireKeydown(document.body, 'h');
			jest.runAllTimers();

			expect(getSearchIndicator()).toBeNull();
		});
	});

	describe('popover close resets search', () => {
		it('should reset hidden items when the popover closes and reopens', async () => {
			const popover = buildPopover();
			await Promise.resolve();
			jest.runAllTimers();

			fireKeydown(document.body, 'h');
			await Promise.resolve();
			jest.runAllTimers();

			expect(hiddenItems(popover).length).toBeGreaterThan(0);

			popover.classList.remove('ce-popover--opened');
			await Promise.resolve();
			jest.runAllTimers();

			popover.classList.add('ce-popover--opened');
			await Promise.resolve();
			jest.runAllTimers();

			expect(hiddenItems(popover).length).toBe(0);
		});
	});
});
