/**
 * @jest-environment jsdom
 *
 * After separation, block-editor.js is a standalone panel. Visibility is
 * managed by the Joplin panel API (show/hide), not by CSS classes or
 * localStorage. These tests confirm the old visibility management code
 * is removed and does not interfere.
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
      <div id="slash-menu"></div>
      <div id="vim-statusbar"><span id="vim-mode-label">-- INSERT --</span></div>
    </div>
  `;
};

const setupGlobals = (): void => {
	const mockEditor = {
		blocks: {
			getBlocksCount: jest.fn().mockReturnValue(0),
			getCurrentBlockIndex: jest.fn().mockReturnValue(0),
			delete: jest.fn(),
			insert: jest.fn(),
		},
		caret: { setToBlock: jest.fn() },
		isReady: Promise.resolve(),
		save: jest.fn().mockResolvedValue({ blocks: [] }),
		render: jest.fn().mockResolvedValue(undefined),
		clear: jest.fn().mockResolvedValue(undefined),
	};

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
		markdownToBlocks: jest.fn().mockReturnValue({ blocks: [] }),
		blocksToMarkdown: jest.fn().mockReturnValue(''),
	};
	(window as any).webviewApi = {
		postMessage: jest.fn(),
		onMessage: jest.fn(),
	};
};

beforeEach(() => {
	jest.clearAllMocks();
	window.HTMLElement.prototype.scrollIntoView = jest.fn();
	localStorage.clear();
	buildDOM();
	setupGlobals();
});

afterEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	delete (window as any).BlockEditor;
	delete (window as any).EditorJS;
	delete (window as any).DragDrop;
	delete (window as any).Header;
	delete (window as any).EditorjsList;
	delete (window as any).Checklist;
	delete (window as any).CodeTool;
	delete (window as any).Quote;
	delete (window as any).Delimiter;
	delete (window as any).MarkdownConverter;
	delete (window as any).webviewApi;
});

describe('BlockEditor standalone — no CSS visibility management', () => {
	it('does NOT add editor-visible class to #app at boot', () => {
		eval(blockEditorSource);
		const app = document.getElementById('app');
		expect(app?.classList.contains('editor-visible')).toBe(false);
	});

	it('does NOT add editor-only class to #app at boot', () => {
		eval(blockEditorSource);
		const app = document.getElementById('app');
		expect(app?.classList.contains('editor-only')).toBe(false);
	});

	it('does NOT read editor visibility from localStorage', () => {
		localStorage.setItem('joplin-ai-editor-visible', 'true');
		eval(blockEditorSource);
		const app = document.getElementById('app');
		expect(app?.classList.contains('editor-visible')).toBe(false);
	});

	it('does NOT read editor-only mode from localStorage', () => {
		localStorage.setItem('joplin-ai-editor-only', 'true');
		eval(blockEditorSource);
		const app = document.getElementById('app');
		expect(app?.classList.contains('editor-only')).toBe(false);
	});

	it('does NOT write to localStorage on boot', () => {
		eval(blockEditorSource);
		expect(localStorage.getItem('joplin-ai-editor-visible')).toBeNull();
		expect(localStorage.getItem('joplin-ai-editor-only')).toBeNull();
	});
});
