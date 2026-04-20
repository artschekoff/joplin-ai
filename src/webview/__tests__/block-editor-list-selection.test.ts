/**
 * @jest-environment jsdom
 *
 * Regression test: selecting multiple list items by drag in the block editor.
 *
 * Root cause: @editorjs/list sets `contentEditable="true"` on each
 * `.cdx-list__item-content` div individually. Browsers cannot extend a
 * native text selection across separate contentEditable boundaries.
 *
 * Fix: after Editor.js renders, set `contentEditable="true"` on the
 * parent `.cdx-list` wrapper. This makes all items belong to the same
 * editable region, allowing cross-item drag selection. Individual item
 * `contentEditable` attributes become inherited (effectively no-ops).
 *
 * Additionally, dynamically added list blocks (e.g. new list via toolbar)
 * must also be patched via a MutationObserver.
 */

import * as fs from 'fs';
import * as path from 'path';

const blockEditorSource = fs.readFileSync(
	path.resolve(__dirname, '..', 'block-editor.js'),
	'utf-8',
);

const buildDOM = (): void => {
	document.body.innerHTML = `
		<div id="app">
			<div id="editor-container" tabindex="-1"></div>
			<div id="vim-statusbar" data-mode="insert">
				<span id="vim-mode-label">INSERT</span>
			</div>
			<div id="toc-panel" class="toc-hidden">
				<div id="toc-header">Contents</div>
				<div id="toc-list"></div>
			</div>
			<button id="toc-toggle-btn"></button>
		</div>
	`;
};

const makeMockEditor = () => ({
	blocks: {
		getBlocksCount: jest.fn().mockReturnValue(1),
		getCurrentBlockIndex: jest.fn().mockReturnValue(0),
		delete: jest.fn(),
		insert: jest.fn(),
	},
	caret: { setToBlock: jest.fn() },
	isReady: Promise.resolve(),
	save: jest.fn().mockResolvedValue({ blocks: [] }),
	render: jest.fn().mockResolvedValue(undefined),
	clear: jest.fn().mockResolvedValue(undefined),
});

/** Builds a list DOM structure identical to what @editorjs/list renders. */
const injectListBlock = (container: HTMLElement): HTMLElement => {
	const ceBlock = document.createElement('div');
	ceBlock.className = 'ce-block';
	const ceContent = document.createElement('div');
	ceContent.className = 'ce-block__content';

	const ul = document.createElement('ul');
	ul.className = 'cdx-list cdx-list-unordered';

	for (const text of ['Item A', 'Item B', 'Item C']) {
		const li = document.createElement('li');
		li.className = 'cdx-list__item';
		const content = document.createElement('div');
		content.className = 'cdx-list__item-content';
		content.setAttribute('contenteditable', 'true');
		content.textContent = text;
		li.appendChild(content);
		ul.appendChild(li);
	}

	ceContent.appendChild(ul);
	ceBlock.appendChild(ceContent);
	container.appendChild(ceBlock);
	return ul;
};

const registerGlobals = (): void => {
	const mockEditor = makeMockEditor();
	(window as any).EditorJS = jest.fn().mockImplementation(({ onReady }: any) => {
		onReady?.();
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
		markdownToBlocks: jest.fn().mockReturnValue([]),
		blocksToMarkdown: jest.fn().mockReturnValue(''),
	};
	(window as any).webviewApi = {
		postMessage: jest.fn(),
		onMessage: jest.fn(),
	};
};

const cleanupGlobals = (): void => {
	for (const key of [
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
	]) {
		delete (window as any)[key];
	}
};

beforeEach(() => {
	jest.clearAllMocks();
	jest.useFakeTimers();
	window.HTMLElement.prototype.scrollIntoView = jest.fn();
	localStorage.clear();
	buildDOM();
	registerGlobals();
});

afterEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	cleanupGlobals();
	jest.useRealTimers();
});

describe('list cross-item selection patch', () => {
	it('sets contentEditable on .cdx-list wrapper present at boot time', () => {
		const container = document.getElementById('editor-container')!;
		const ul = injectListBlock(container);

		// Boot the block editor
		eval(blockEditorSource);
		jest.runAllTimers();

		expect(ul.getAttribute('contenteditable')).toBe('true');
	});

	it('patches dynamically added .cdx-list elements via MutationObserver', async () => {
		eval(blockEditorSource);
		jest.runAllTimers();

		const container = document.getElementById('editor-container')!;
		const ul = injectListBlock(container);

		// MutationObserver fires asynchronously
		await Promise.resolve();
		jest.runAllTimers();
		await Promise.resolve();

		expect(ul.getAttribute('contenteditable')).toBe('true');
	});

	it('does not remove contentEditable from individual item-content divs', () => {
		const container = document.getElementById('editor-container')!;
		const ul = injectListBlock(container);

		eval(blockEditorSource);
		jest.runAllTimers();

		const items = ul.querySelectorAll('.cdx-list__item-content');
		items.forEach((item) => {
			expect(item.getAttribute('contenteditable')).toBe('true');
		});
	});

	it('patches ordered lists as well', () => {
		const container = document.getElementById('editor-container')!;

		const ceBlock = document.createElement('div');
		ceBlock.className = 'ce-block';
		const ceContent = document.createElement('div');
		ceContent.className = 'ce-block__content';
		const ol = document.createElement('ol');
		ol.className = 'cdx-list cdx-list-ordered';
		const li = document.createElement('li');
		li.className = 'cdx-list__item';
		const content = document.createElement('div');
		content.className = 'cdx-list__item-content';
		content.setAttribute('contenteditable', 'true');
		content.textContent = 'First';
		li.appendChild(content);
		ol.appendChild(li);
		ceContent.appendChild(ol);
		ceBlock.appendChild(ceContent);
		container.appendChild(ceBlock);

		eval(blockEditorSource);
		jest.runAllTimers();

		expect(ol.getAttribute('contenteditable')).toBe('true');
	});
});
