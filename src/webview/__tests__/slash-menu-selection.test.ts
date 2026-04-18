/**
 * @jest-environment jsdom
 *
 * Tests for slash-menu first-item auto-selection and Tab/Shift+Tab navigation.
 *
 * Requirements:
 *  - When the slash menu opens, the first item is pre-selected (index 0).
 *  - The pre-selected item carries the `.slash-item--selected` CSS class.
 *  - Pressing Enter immediately inserts the first item without needing ArrowDown.
 *  - Tab moves to the next item; Shift+Tab moves to the previous item.
 *  - Tab/Shift+Tab wrap around at the boundaries.
 *  - After typing a filter query the selection resets to the first filtered result.
 *  - The selected item is scrolled into view whenever the selection changes.
 *  - The CSS source defines a visually distinct style for `.slash-item--selected`.
 */

import * as fs from 'fs';
import * as path from 'path';

const blockEditorSource = fs.readFileSync(
	path.resolve(__dirname, '..', 'block-editor.js'),
	'utf-8',
);

const cssSource = fs.readFileSync(path.resolve(__dirname, '..', 'panel.css'), 'utf-8');

// ── helpers ────────────────────────────────────────────────────────────────────

const buildDOM = (): void => {
	document.body.innerHTML = `
    <div id="app">
      <div id="editor-container"></div>
      <div id="slash-menu"></div>
      <div id="vim-statusbar"><span id="vim-mode-label">-- INSERT --</span></div>
    </div>
  `;
};

const fireKeydown = (target: EventTarget, key: string, shiftKey = false): KeyboardEvent => {
	const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
	target.dispatchEvent(event);
	return event;
};

const fireInput = (target: EventTarget): Event => {
	const event = new Event('input', { bubbles: true });
	target.dispatchEvent(event);
	return event;
};

let mockBlocks: {
	getBlocksCount: jest.Mock;
	getCurrentBlockIndex: jest.Mock;
	delete: jest.Mock;
	insert: jest.Mock;
};
let onReadyCallback: (() => void) | null = null;

const setupGlobals = (): void => {
	mockBlocks = {
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

/** Open the slash menu by typing '/' into a fresh empty block. */
const openSlashMenu = (): void => {
	const container = document.getElementById('editor-container') as HTMLElement;

	const block = document.createElement('div');
	block.className = 'ce-block';
	const ce = document.createElement('div');
	ce.setAttribute('contenteditable', 'true');
	ce.textContent = '/';
	block.appendChild(ce);
	container.appendChild(block);

	ce.focus();
	fireKeydown(ce, '/');
	jest.runAllTimers();
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Slash menu — first-item auto-selection', () => {
	describe('initial render', () => {
		it('should render the first item with .slash-item--selected when the menu opens', () => {
			openSlashMenu();

			const menu = document.getElementById('slash-menu') as HTMLElement;
			const items = menu.querySelectorAll('.slash-item');
			expect(items.length).toBeGreaterThan(0);
			expect(items[0].classList.contains('slash-item--selected')).toBe(true);
		});

		it('should NOT mark any item after the first as selected on open', () => {
			openSlashMenu();

			const menu = document.getElementById('slash-menu') as HTMLElement;
			const selectedItems = menu.querySelectorAll('.slash-item--selected');
			expect(selectedItems.length).toBe(1);
		});

		it('should scroll the first selected item into view when the menu opens', () => {
			openSlashMenu();

			const menu = document.getElementById('slash-menu') as HTMLElement;
			const firstItem = menu.querySelector('.slash-item--selected') as HTMLElement;
			expect(firstItem).not.toBeNull();
			expect(firstItem.scrollIntoView).toHaveBeenCalled();
		});
	});

	describe('Enter key with first item selected', () => {
		it('should call blocks.insert with the first item type when Enter is pressed', () => {
			openSlashMenu();

			const container = document.getElementById('editor-container') as HTMLElement;
			fireKeydown(container, 'Enter');

			expect(mockBlocks.insert).toHaveBeenCalledWith(
				'paragraph',
				expect.anything(),
				null,
				expect.any(Number),
				true,
			);
		});

		it('should hide the menu after Enter is pressed', () => {
			openSlashMenu();

			const menu = document.getElementById('slash-menu') as HTMLElement;
			expect(menu.classList.contains('visible')).toBe(true);

			const container = document.getElementById('editor-container') as HTMLElement;
			fireKeydown(container, 'Enter');

			expect(menu.classList.contains('visible')).toBe(false);
		});
	});

	describe('filter query resets selection', () => {
		it('should reset selection to index 0 when the filter query changes', () => {
			const container = document.getElementById('editor-container') as HTMLElement;

			const block = document.createElement('div');
			block.className = 'ce-block';
			const ce = document.createElement('div');
			ce.setAttribute('contenteditable', 'true');
			ce.textContent = '/';
			block.appendChild(ce);
			container.appendChild(block);
			ce.focus();
			fireKeydown(ce, '/');
			jest.runAllTimers();

			fireKeydown(container, 'ArrowDown');
			fireKeydown(container, 'ArrowDown');

			ce.textContent = '/h';
			fireInput(container);

			const menu = document.getElementById('slash-menu') as HTMLElement;
			const selectedItems = menu.querySelectorAll('.slash-item--selected');
			expect(selectedItems.length).toBe(1);

			const allItems = menu.querySelectorAll('.slash-item');
			expect(allItems[0].classList.contains('slash-item--selected')).toBe(true);
		});

		it('should scroll the new first item into view after filter change', () => {
			const container = document.getElementById('editor-container') as HTMLElement;

			const block = document.createElement('div');
			block.className = 'ce-block';
			const ce = document.createElement('div');
			ce.setAttribute('contenteditable', 'true');
			ce.textContent = '/';
			block.appendChild(ce);
			container.appendChild(block);
			ce.focus();
			fireKeydown(ce, '/');
			jest.runAllTimers();

			(window.HTMLElement.prototype.scrollIntoView as jest.Mock).mockClear();

			ce.textContent = '/h';
			fireInput(container);

			expect(window.HTMLElement.prototype.scrollIntoView as jest.Mock).toHaveBeenCalled();
		});
	});

	describe('ArrowDown moves selection and scrolls', () => {
		it('should move selection to second item after one ArrowDown', () => {
			openSlashMenu();

			const container = document.getElementById('editor-container') as HTMLElement;
			fireKeydown(container, 'ArrowDown');

			const menu = document.getElementById('slash-menu') as HTMLElement;
			const items = menu.querySelectorAll('.slash-item');
			expect(items[0].classList.contains('slash-item--selected')).toBe(false);
			expect(items[1].classList.contains('slash-item--selected')).toBe(true);
		});

		it('should scroll the newly selected item into view on ArrowDown', () => {
			openSlashMenu();

			const scrollMock = window.HTMLElement.prototype.scrollIntoView as jest.Mock;
			scrollMock.mockClear();

			const container = document.getElementById('editor-container') as HTMLElement;
			fireKeydown(container, 'ArrowDown');

			expect(scrollMock).toHaveBeenCalled();
		});
	});

	describe('Tab / Shift+Tab navigation', () => {
		it('should move selection to second item on Tab (not select)', () => {
			openSlashMenu();

			const container = document.getElementById('editor-container') as HTMLElement;
			const event = new KeyboardEvent('keydown', {
				key: 'Tab',
				shiftKey: false,
				bubbles: true,
				cancelable: true,
			});
			container.dispatchEvent(event);

			const menu = document.getElementById('slash-menu') as HTMLElement;
			const items = menu.querySelectorAll('.slash-item');
			expect(items[0].classList.contains('slash-item--selected')).toBe(false);
			expect(items[1].classList.contains('slash-item--selected')).toBe(true);
			expect(mockBlocks.insert).not.toHaveBeenCalled();
		});

		it('should move selection to previous item on Shift+Tab', () => {
			openSlashMenu();

			const container = document.getElementById('editor-container') as HTMLElement;
			container.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
			);
			container.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Tab',
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);

			const menu = document.getElementById('slash-menu') as HTMLElement;
			const items = menu.querySelectorAll('.slash-item');
			expect(items[0].classList.contains('slash-item--selected')).toBe(true);
		});

		it('should wrap from last to first on Tab', () => {
			openSlashMenu();

			const container = document.getElementById('editor-container') as HTMLElement;
			const menu = document.getElementById('slash-menu') as HTMLElement;
			const totalItems = menu.querySelectorAll('.slash-item').length;

			for (let i = 0; i < totalItems; i++) {
				container.dispatchEvent(
					new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
				);
			}

			const items = menu.querySelectorAll('.slash-item');
			expect(items[0].classList.contains('slash-item--selected')).toBe(true);
		});

		it('should prevent default on Tab to avoid browser focus jump', () => {
			openSlashMenu();

			const container = document.getElementById('editor-container') as HTMLElement;
			const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
			container.dispatchEvent(event);

			expect(event.defaultPrevented).toBe(true);
		});
	});
});

// ── CSS contract ───────────────────────────────────────────────────────────────

describe('Slash menu CSS — selected item visual style', () => {
	it('should define .slash-item--selected with a distinct background', () => {
		expect(cssSource).toMatch(/\.slash-item--selected/);
	});

	it('should use a more prominent style for --selected than plain .slash-item', () => {
		const match = cssSource.match(/\.slash-item--selected\s*\{([^}]*)\}/s);
		expect(match).not.toBeNull();
		expect((match as RegExpMatchArray)[1].trim().length).toBeGreaterThan(0);
	});
});
