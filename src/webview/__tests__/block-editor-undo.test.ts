/**
 * @jest-environment jsdom
 *
 * Regression tests for undo-after-multi-block-deletion in block-editor.js.
 *
 * Bug: user selects multiple blocks and presses Delete — blocks are removed —
 * but Ctrl+Z does not restore them because EditorJS 2.x does not track
 * multi-block deletions in its native undo history.
 *
 * Fix: block-editor.js maintains its own undo stack (via onChange snapshots)
 * and intercepts Ctrl+Z / Cmd+Z before EditorJS can handle it.
 */

import * as fs from 'fs';
import * as path from 'path';

const blockEditorSource = fs.readFileSync(
	path.resolve(__dirname, '..', 'block-editor.js'),
	'utf-8',
);

/** Flush all pending microtasks / resolved promises. */
const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('BlockEditor — undo after multi-block deletion', () => {
	let mockBlocks: {
		getBlocksCount: jest.Mock;
		getCurrentBlockIndex: jest.Mock;
		delete: jest.Mock;
		insert: jest.Mock;
	};
	let mockCaret: { setToBlock: jest.Mock };
	let mockEditor: Record<string, unknown>;
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
		mockBlocks = {
			getBlocksCount: jest.fn().mockReturnValue(3),
			getCurrentBlockIndex: jest.fn().mockReturnValue(0),
			delete: jest.fn(),
			insert: jest.fn(),
		};
		mockCaret = { setToBlock: jest.fn() };
		mockEditor = {
			blocks: mockBlocks,
			caret: mockCaret,
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

	// ── Helper ──────────────────────────────────────────────────────────────────

	/**
	 * Fires a keydown on the editor container (so the capture-phase listener's
	 * container-guard passes) and returns the event.
	 */
	const fireKeyInContainer = (opts: KeyboardEventInit & { key: string }): KeyboardEvent => {
		const container = document.getElementById('editor-container') as HTMLElement;
		container.focus();
		const event = new KeyboardEvent('keydown', {
			bubbles: true,
			cancelable: true,
			...opts,
		});
		container.dispatchEvent(event);
		return event;
	};

	// ── Core undo behaviour ──────────────────────────────────────────────────────

	it('should restore previous state on Ctrl+Z after block deletion', async () => {
		// Arrange: two distinct editor states
		const inputStateBeforeDeletion = {
			blocks: [
				{ type: 'paragraph', data: { text: 'block 1' } },
				{ type: 'paragraph', data: { text: 'block 2' } },
				{ type: 'paragraph', data: { text: 'block 3' } },
			],
		};
		const inputStateAfterDeletion = {
			blocks: [{ type: 'paragraph', data: { text: 'block 1' } }],
		};

		// First onChange: editor has the "before deletion" state
		(mockEditor.save as jest.Mock).mockResolvedValue(inputStateBeforeDeletion);
		capturedOnChange!();
		await flushPromises();

		// Second onChange: editor has the "after deletion" state
		// (the undo stack should now contain inputStateBeforeDeletion)
		(mockEditor.save as jest.Mock).mockResolvedValue(inputStateAfterDeletion);
		capturedOnChange!();
		await flushPromises();

		// Act: press Ctrl+Z inside the editor container
		(mockEditor.render as jest.Mock).mockClear();
		fireKeyInContainer({ key: 'z', ctrlKey: true });
		await flushPromises();

		// Assert: editor.render was called with the pre-deletion state
		expect(mockEditor.render).toHaveBeenCalledWith(inputStateBeforeDeletion);
	});

	it('should restore previous state on Cmd+Z (macOS) after block deletion', async () => {
		// Arrange
		const inputStateBeforeDeletion = {
			blocks: [
				{ type: 'paragraph', data: { text: 'a' } },
				{ type: 'paragraph', data: { text: 'b' } },
			],
		};
		const inputStateAfterDeletion = {
			blocks: [{ type: 'paragraph', data: { text: 'a' } }],
		};

		(mockEditor.save as jest.Mock).mockResolvedValue(inputStateBeforeDeletion);
		capturedOnChange!();
		await flushPromises();

		(mockEditor.save as jest.Mock).mockResolvedValue(inputStateAfterDeletion);
		capturedOnChange!();
		await flushPromises();

		// Act: Cmd+Z (metaKey = true)
		(mockEditor.render as jest.Mock).mockClear();
		fireKeyInContainer({ key: 'z', metaKey: true });
		await flushPromises();

		expect(mockEditor.render).toHaveBeenCalledWith(inputStateBeforeDeletion);
	});

	it('should do nothing on Ctrl+Z when undo stack is empty', async () => {
		// No onChange calls → undoStack is empty
		fireKeyInContainer({ key: 'z', ctrlKey: true });
		await flushPromises();

		expect(mockEditor.render).not.toHaveBeenCalled();
	});

	it('should prevent the default browser undo when our stack has entries', async () => {
		// Arrange: populate the undo stack
		const inputStateBefore = {
			blocks: [
				{ type: 'paragraph', data: { text: 'x' } },
				{ type: 'paragraph', data: { text: 'y' } },
			],
		};
		const inputStateAfter = { blocks: [{ type: 'paragraph', data: { text: 'x' } }] };

		(mockEditor.save as jest.Mock).mockResolvedValue(inputStateBefore);
		capturedOnChange!();
		await flushPromises();

		(mockEditor.save as jest.Mock).mockResolvedValue(inputStateAfter);
		capturedOnChange!();
		await flushPromises();

		// Act
		const event = fireKeyInContainer({ key: 'z', ctrlKey: true });
		await flushPromises();

		// Assert: default prevented so the browser's native undo doesn't fire
		expect(event.defaultPrevented).toBe(true);
	});

	it('should NOT prevent default on Ctrl+Z when undo stack is empty', async () => {
		const event = fireKeyInContainer({ key: 'z', ctrlKey: true });
		await flushPromises();

		expect(event.defaultPrevented).toBe(false);
	});

	it('should support multiple consecutive undos', async () => {
		// Arrange: three distinct states
		const inputState1 = {
			blocks: [
				{ type: 'paragraph', data: { text: 's1' } },
				{ type: 'paragraph', data: { text: 's2' } },
				{ type: 'paragraph', data: { text: 's3' } },
			],
		};
		const inputState2 = {
			blocks: [
				{ type: 'paragraph', data: { text: 's1' } },
				{ type: 'paragraph', data: { text: 's2' } },
			],
		};
		const inputState3 = { blocks: [{ type: 'paragraph', data: { text: 's1' } }] };

		(mockEditor.save as jest.Mock).mockResolvedValue(inputState1);
		capturedOnChange!();
		await flushPromises();

		(mockEditor.save as jest.Mock).mockResolvedValue(inputState2);
		capturedOnChange!();
		await flushPromises();

		(mockEditor.save as jest.Mock).mockResolvedValue(inputState3);
		capturedOnChange!();
		await flushPromises();

		(mockEditor.render as jest.Mock).mockClear();

		// First undo: should restore state2
		fireKeyInContainer({ key: 'z', ctrlKey: true });
		await flushPromises();
		expect(mockEditor.render).toHaveBeenLastCalledWith(inputState2);

		// Second undo: should restore state1
		fireKeyInContainer({ key: 'z', ctrlKey: true });
		await flushPromises();
		expect(mockEditor.render).toHaveBeenLastCalledWith(inputState1);
	});

	it('should not add to undo stack during a restore operation', async () => {
		// Arrange: one undoable state
		const inputStateBefore = {
			blocks: [
				{ type: 'paragraph', data: { text: 'before' } },
				{ type: 'paragraph', data: { text: 'extra' } },
			],
		};
		const inputStateAfter = { blocks: [{ type: 'paragraph', data: { text: 'before' } }] };

		(mockEditor.save as jest.Mock).mockResolvedValue(inputStateBefore);
		capturedOnChange!();
		await flushPromises();

		(mockEditor.save as jest.Mock).mockResolvedValue(inputStateAfter);
		capturedOnChange!();
		await flushPromises();

		// Simulate editor.render triggering onChange during restore
		(mockEditor.render as jest.Mock).mockImplementationOnce(async () => {
			capturedOnChange!(); // render triggers onChange
		});

		(mockEditor.save as jest.Mock).mockResolvedValue(inputStateBefore);

		// First Ctrl+Z
		fireKeyInContainer({ key: 'z', ctrlKey: true });
		await flushPromises();

		// Second Ctrl+Z — undo stack should be empty (onChange during restore was ignored)
		(mockEditor.render as jest.Mock).mockClear();
		fireKeyInContainer({ key: 'z', ctrlKey: true });
		await flushPromises();

		// Nothing to undo → render should NOT be called
		expect(mockEditor.render).not.toHaveBeenCalled();
	});

	it('should not add to undo stack when the same state is saved twice', async () => {
		// Arrange: two identical states
		const inputState = { blocks: [{ type: 'paragraph', data: { text: 'same' } }] };

		(mockEditor.save as jest.Mock).mockResolvedValue(inputState);
		capturedOnChange!();
		await flushPromises();

		// same state again (e.g. focus/blur without content change)
		capturedOnChange!();
		await flushPromises();

		// Act: Ctrl+Z should find nothing to restore
		(mockEditor.render as jest.Mock).mockClear();
		fireKeyInContainer({ key: 'z', ctrlKey: true });
		await flushPromises();

		expect(mockEditor.render).not.toHaveBeenCalled();
	});

	it('should clear undo stack when a new note is loaded', async () => {
		// Arrange: build up some undo history
		const inputStateA = {
			blocks: [
				{ type: 'paragraph', data: { text: 'note-a-v1' } },
				{ type: 'paragraph', data: { text: 'note-a-v2' } },
			],
		};
		const inputStateB = { blocks: [{ type: 'paragraph', data: { text: 'note-a-v1' } }] };

		(mockEditor.save as jest.Mock).mockResolvedValue(inputStateA);
		capturedOnChange!();
		await flushPromises();

		(mockEditor.save as jest.Mock).mockResolvedValue(inputStateB);
		capturedOnChange!();
		await flushPromises();

		// Load a different note — this should wipe the history
		const inputNewNoteState = { blocks: [{ type: 'paragraph', data: { text: 'note-b-v1' } }] };
		(mockEditor.save as jest.Mock).mockResolvedValue(inputNewNoteState);

		await (window as any).BlockEditor.loadNote({ id: 'new-note', body: '' });
		await flushPromises();

		// Act: Ctrl+Z after loading new note
		(mockEditor.render as jest.Mock).mockClear();
		fireKeyInContainer({ key: 'z', ctrlKey: true });
		await flushPromises();

		// Should not restore anything from the old note
		expect(mockEditor.render).not.toHaveBeenCalled();
	});
});
