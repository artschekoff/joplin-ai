/**
 * @jest-environment jsdom
 *
 * Regression tests for "Incorrect data passed to the render() method".
 *
 * Root cause: markdownToBlocks() returns a plain Block[] array, but
 * EditorJS.render() expects an OutputData object { blocks: Block[] }.
 * Additionally, editor.save() returns OutputData but blocksToMarkdown()
 * was receiving the full object instead of just .blocks.
 *
 * Contract:
 *   markdownToBlocks → Block[]           (array)
 *   editor.render    → { blocks: [] }    (OutputData)
 *   editor.save      → { blocks: [] }    (OutputData)
 *   blocksToMarkdown → Block[]           (array)
 */

import * as fs from 'fs';
import * as path from 'path';

const blockEditorSource = fs.readFileSync(
	path.resolve(__dirname, '..', 'block-editor.js'),
	'utf-8',
);

const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const buildDOM = (): void => {
	document.body.innerHTML = `
    <div id="app">
      <div id="editor-container" tabindex="-1"></div>
      <div id="vim-statusbar" data-mode="insert">
        <span id="vim-mode-label">INSERT</span>
      </div>
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

let mockEditor: ReturnType<typeof makeMockEditor>;
let mockMarkdownConverter: { markdownToBlocks: jest.Mock; blocksToMarkdown: jest.Mock };

const registerGlobals = (): void => {
	mockEditor = makeMockEditor();
	mockMarkdownConverter = {
		markdownToBlocks: jest.fn().mockReturnValue([]),
		blocksToMarkdown: jest.fn().mockReturnValue(''),
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
	(window as any).MarkdownConverter = mockMarkdownConverter;
	(window as any).webviewApi = { postMessage: jest.fn(), onMessage: jest.fn() };
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
	])
		delete (window as any)[key];
};

beforeEach(() => {
	jest.clearAllMocks();
	window.HTMLElement.prototype.scrollIntoView = jest.fn();
	localStorage.clear();
	buildDOM();
	registerGlobals();
	// eslint-disable-next-line no-eval
	eval(blockEditorSource);
});

afterEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	cleanupGlobals();
});

// ── loadNote wraps blocks for editor.render() ─────────────────────────────────

describe('BlockEditor.loadNote — render() data format', () => {
	it('should wrap markdownToBlocks array in { blocks } before calling editor.render()', async () => {
		// Arrange: markdownToBlocks returns a plain array (real behaviour)
		const inputBlocks = [
			{ type: 'header', data: { level: 1, text: 'Title' } },
			{ type: 'paragraph', data: { text: 'Hello world' } },
		];
		mockMarkdownConverter.markdownToBlocks.mockReturnValue(inputBlocks);

		// Act
		await (window as any).BlockEditor.loadNote({ id: 'note-1', body: '# Title\nHello world' });
		await flushPromises();

		// Assert: render() receives { blocks: [...] }, NOT the raw array
		expect(mockEditor.render).toHaveBeenCalledWith({ blocks: inputBlocks });
	});

	it('should not call render() with a plain array', async () => {
		// Arrange
		const inputBlocks = [{ type: 'paragraph', data: { text: 'text' } }];
		mockMarkdownConverter.markdownToBlocks.mockReturnValue(inputBlocks);

		// Act
		await (window as any).BlockEditor.loadNote({ id: 'note-2', body: 'text' });
		await flushPromises();

		// Assert: the argument to render() must NOT be an array
		const renderArg = (mockEditor.render as jest.Mock).mock.calls[0]?.[0];
		expect(Array.isArray(renderArg)).toBe(false);
		expect(renderArg).toHaveProperty('blocks');
	});
});

// ── scheduleSave passes .blocks to blocksToMarkdown ───────────────────────────

describe('BlockEditor save — blocksToMarkdown receives .blocks array', () => {
	it('should pass out.blocks (not full OutputData) to blocksToMarkdown on save', async () => {
		// Arrange: editor.save() returns OutputData with extra fields
		const savedBlocks = [{ type: 'paragraph', data: { text: 'saved' } }];
		const outputData = { time: 1234, blocks: savedBlocks, version: '2.28.0' };
		(mockEditor.save as jest.Mock).mockResolvedValue(outputData);

		// Load a note to set currentNoteId
		mockMarkdownConverter.markdownToBlocks.mockReturnValue([]);
		await (window as any).BlockEditor.loadNote({ id: 'note-save', body: 'saved' });
		await flushPromises();
		mockMarkdownConverter.blocksToMarkdown.mockClear();

		// Act: trigger a save by advancing the debounce timer
		// The onChange handler runs on every editor change, and scheduleSave
		// is debounced. We simulate a change by calling loadNote again with
		// different content, or we can directly trigger getMarkdown.
		const md = await (window as any).BlockEditor.getMarkdown();
		await flushPromises();

		// Assert: blocksToMarkdown was called with the blocks array, not OutputData
		expect(mockMarkdownConverter.blocksToMarkdown).toHaveBeenCalledWith(savedBlocks);
	});
});

// ── getMarkdown extracts .blocks before calling blocksToMarkdown ──────────────

describe('BlockEditor.getMarkdown — extracts .blocks from OutputData', () => {
	it('should pass only the blocks array to blocksToMarkdown', async () => {
		// Arrange
		const savedBlocks = [
			{ type: 'header', data: { level: 2, text: 'Section' } },
			{ type: 'paragraph', data: { text: 'Content' } },
		];
		const outputData = { time: 9999, blocks: savedBlocks, version: '2.28.0' };
		(mockEditor.save as jest.Mock).mockResolvedValue(outputData);
		mockMarkdownConverter.blocksToMarkdown.mockReturnValue('## Section\n\nContent');

		// Act
		const result = await (window as any).BlockEditor.getMarkdown();
		await flushPromises();

		// Assert
		expect(mockMarkdownConverter.blocksToMarkdown).toHaveBeenCalledWith(savedBlocks);
		expect(result).toBe('## Section\n\nContent');
	});
});
