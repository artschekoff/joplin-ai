/**
 * @jest-environment jsdom
 *
 * Regression test for TinyMCE.tsx:945 crash:
 *   Uncaught (in promise) TypeError: Cannot read properties of null
 *   (reading 'getElementsByTagName') at docHead → loadDocumentAssets
 *
 * Root cause: block-editor.js's debounced scheduleSave (1200 ms) can fire
 * AFTER the user has switched notes.  The stale joplin.data.put triggers
 * TinyMCE to reload assets into a destroyed iframe whose contentDocument
 * is null.
 *
 * Fix requirements:
 *  1. loadNote MUST cancel any pending save timer from the previous note
 *     so that no saveBlocks message fires from a stale edit.
 *  2. After switching notes, only NEW edits on the new note should trigger
 *     a save.
 */

import * as fs from 'fs';
import * as path from 'path';

const blockEditorSource = fs.readFileSync(
	path.resolve(__dirname, '..', 'block-editor.js'),
	'utf-8',
);

const SAVE_DEBOUNCE_MS = 1200;

/**
 * Flush pending microtasks (resolved promises) without advancing fake timers.
 */
const flushMicrotasks = async (): Promise<void> => {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
};

describe('BlockEditor — save timer race during note switch', () => {
	let mockEditor: Record<string, unknown>;
	let mockPostMessage: jest.Mock;
	let capturedOnChange: (() => void) | null = null;
	let onReadyCallback: (() => void) | null = null;

	const buildDOM = (): void => {
		document.body.innerHTML = `
      <div id="editor-pane">
        <div id="editor-container" tabindex="-1"></div>
        <div id="vim-statusbar"><span id="vim-mode-label">-- INSERT --</span></div>
      </div>
    `;
	};

	const setupGlobals = (): void => {
		mockEditor = {
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
		};

		(window as any).EditorJS = jest.fn().mockImplementation(({ onChange, onReady }: any) => {
			capturedOnChange = onChange;
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
			markdownToBlocks: jest.fn().mockReturnValue([]),
			blocksToMarkdown: jest.fn().mockReturnValue(''),
		};

		mockPostMessage = jest.fn();
		(window as any).webviewApi = {
			postMessage: mockPostMessage,
			onMessage: jest.fn(),
		};
	};

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		capturedOnChange = null;
		onReadyCallback = null;
		window.HTMLElement.prototype.scrollIntoView = jest.fn();
		buildDOM();
		setupGlobals();
		// eslint-disable-next-line no-eval
		eval(blockEditorSource);
		onReadyCallback?.();
	});

	afterEach(() => {
		document.body.innerHTML = '';
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
		jest.useRealTimers();
	});

	it('should cancel pending save timer when a new note is loaded — no saveBlocks fires', async () => {
		// Arrange: load note A and trigger an edit (starts the 1200ms save timer)
		(mockEditor.save as jest.Mock).mockResolvedValue({
			blocks: [{ type: 'paragraph', data: { text: 'note A content' } }],
		});
		(window as any).MarkdownConverter.blocksToMarkdown.mockReturnValue('note A content');

		await (window as any).BlockEditor.loadNote({
			id: 'note-a',
			title: 'Note A',
			body: 'note A content',
		});
		await flushMicrotasks();

		// User edits → onChange fires → scheduleSave queues a 1200ms timer
		capturedOnChange!();
		await flushMicrotasks();

		// Act: user switches to note B BEFORE the save timer fires
		(mockEditor.save as jest.Mock).mockResolvedValue({
			blocks: [{ type: 'paragraph', data: { text: 'note B content' } }],
		});

		await (window as any).BlockEditor.loadNote({
			id: 'note-b',
			title: 'Note B',
			body: 'note B content',
		});
		await flushMicrotasks();
		mockPostMessage.mockClear();

		// Advance time past the save debounce
		jest.advanceTimersByTime(SAVE_DEBOUNCE_MS + 100);
		await flushMicrotasks();

		// Assert: NO saveBlocks message should fire AT ALL — the old timer must be cancelled
		const saveCalls = mockPostMessage.mock.calls.filter(
			(call: unknown[]) => (call[0] as Record<string, unknown>).type === 'saveBlocks',
		);
		expect(saveCalls).toHaveLength(0);
	});

	it('should not fire the save timer after a mid-debounce note switch', async () => {
		// Arrange: load note A and start an edit
		(mockEditor.save as jest.Mock).mockResolvedValue({
			blocks: [{ type: 'paragraph', data: { text: 'A' } }],
		});
		(window as any).MarkdownConverter.blocksToMarkdown.mockReturnValue('A');

		await (window as any).BlockEditor.loadNote({
			id: 'note-a',
			title: 'Note A',
			body: 'A',
		});
		await flushMicrotasks();

		capturedOnChange!();
		await flushMicrotasks();

		// Advance partway through the debounce (timer still pending)
		jest.advanceTimersByTime(SAVE_DEBOUNCE_MS - 100);

		// Switch to note B
		(mockEditor.save as jest.Mock).mockResolvedValue({
			blocks: [{ type: 'paragraph', data: { text: 'B' } }],
		});

		await (window as any).BlockEditor.loadNote({
			id: 'note-b',
			title: 'Note B',
			body: 'B',
		});
		await flushMicrotasks();
		mockPostMessage.mockClear();

		// Advance past the remaining debounce time
		jest.advanceTimersByTime(200);
		await flushMicrotasks();

		// Assert: the old timer must not fire
		const saveCalls = mockPostMessage.mock.calls.filter(
			(call: unknown[]) => (call[0] as Record<string, unknown>).type === 'saveBlocks',
		);
		expect(saveCalls).toHaveLength(0);
	});

	it('should still save correctly when editing the new note after a switch', async () => {
		// Arrange: load note A, edit, switch to note B
		(mockEditor.save as jest.Mock).mockResolvedValue({
			blocks: [{ type: 'paragraph', data: { text: 'A' } }],
		});
		(window as any).MarkdownConverter.blocksToMarkdown.mockReturnValue('A');

		await (window as any).BlockEditor.loadNote({
			id: 'note-a',
			title: 'Note A',
			body: 'A',
		});
		await flushMicrotasks();

		capturedOnChange!();
		await flushMicrotasks();

		// Switch to note B
		(mockEditor.save as jest.Mock).mockResolvedValue({
			blocks: [{ type: 'paragraph', data: { text: 'B edited' } }],
		});
		(window as any).MarkdownConverter.blocksToMarkdown.mockReturnValue('B edited');

		await (window as any).BlockEditor.loadNote({
			id: 'note-b',
			title: 'Note B',
			body: 'B',
		});
		await flushMicrotasks();

		// Now edit note B → triggers a fresh save timer
		capturedOnChange!();
		await flushMicrotasks();
		mockPostMessage.mockClear();

		// Advance past the debounce
		jest.advanceTimersByTime(SAVE_DEBOUNCE_MS + 100);
		await flushMicrotasks();

		// Assert: saveBlocks was sent for note-b with correct content
		const saveCalls = mockPostMessage.mock.calls.filter(
			(call: unknown[]) => (call[0] as Record<string, unknown>).type === 'saveBlocks',
		);
		expect(saveCalls.length).toBeGreaterThanOrEqual(1);
		expect((saveCalls[0][0] as Record<string, unknown>).noteId).toBe('note-b');
		expect((saveCalls[0][0] as Record<string, unknown>).markdown).toBe('B edited');
	});

	it('should not fire save for old note even with rapid note switches', async () => {
		// Arrange: load note A, edit, switch to B, switch to C — all before debounce
		(mockEditor.save as jest.Mock).mockResolvedValue({
			blocks: [{ type: 'paragraph', data: { text: 'A' } }],
		});
		(window as any).MarkdownConverter.blocksToMarkdown.mockReturnValue('A');

		await (window as any).BlockEditor.loadNote({
			id: 'note-a',
			title: 'Note A',
			body: 'A',
		});
		await flushMicrotasks();
		capturedOnChange!();
		await flushMicrotasks();

		// Quick switch to note B
		await (window as any).BlockEditor.loadNote({
			id: 'note-b',
			title: 'Note B',
			body: 'B',
		});
		await flushMicrotasks();
		capturedOnChange!();
		await flushMicrotasks();

		// Quick switch to note C
		(mockEditor.save as jest.Mock).mockResolvedValue({
			blocks: [{ type: 'paragraph', data: { text: 'C' } }],
		});

		await (window as any).BlockEditor.loadNote({
			id: 'note-c',
			title: 'Note C',
			body: 'C',
		});
		await flushMicrotasks();
		mockPostMessage.mockClear();

		// Advance past all debounce periods
		jest.advanceTimersByTime(SAVE_DEBOUNCE_MS * 3);
		await flushMicrotasks();

		// Assert: no stale saves for note-a or note-b
		const saveCalls = mockPostMessage.mock.calls.filter(
			(call: unknown[]) => (call[0] as Record<string, unknown>).type === 'saveBlocks',
		);
		for (const call of saveCalls) {
			const msg = call[0] as Record<string, unknown>;
			expect(msg.noteId).not.toBe('note-a');
			expect(msg.noteId).not.toBe('note-b');
		}
	});
});
