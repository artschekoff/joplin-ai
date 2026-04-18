/**
 * @jest-environment jsdom
 *
 * Regression tests for undo in block-editor.js.
 *
 * Bug 1: user selects multiple blocks and presses Delete — blocks are removed —
 * but Ctrl+Z does not restore them because EditorJS 2.x does not track
 * multi-block deletions in its native undo history.
 *
 * Bug 2: Cmd+Z doesn't undo normal edits because onEditorChange is async
 * (race condition) and loadNote may fail to capture the initial snapshot.
 *
 * Fix: block-editor.js maintains its own undo stack (via onChange snapshots),
 * intercepts Ctrl+Z / Cmd+Z before EditorJS, and force-captures the
 * current state before attempting undo to close the async gap.
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

		// Track what the editor "shows" so save() matches render() state
		(mockEditor.render as jest.Mock).mockClear();
		(mockEditor.render as jest.Mock).mockImplementation(async (data: unknown) => {
			(mockEditor.save as jest.Mock).mockResolvedValue(data);
		});

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

		// Simulate editor.render triggering onChange during restore, and
		// make save return the rendered state (as real EditorJS would).
		(mockEditor.render as jest.Mock).mockImplementationOnce(async (data: unknown) => {
			(mockEditor.save as jest.Mock).mockResolvedValue(data);
			capturedOnChange!(); // render triggers onChange
		});

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

	// ── Bug-2: Cmd+Z race condition & loadNote failure ─────────────────────────

	it('should undo on Cmd+Z even when onEditorChange has not flushed yet', async () => {
		// Arrange: load a note so currentSnapshot is set to the initial state
		const inputInitialState = {
			blocks: [{ type: 'paragraph', data: { text: 'hello' } }],
		};
		(mockEditor.save as jest.Mock).mockResolvedValue(inputInitialState);
		await (window as any).BlockEditor.loadNote({ id: 'n1', body: 'hello' });
		await flushPromises();

		// User edits — onChange fires but the async snapshot push has NOT completed
		const inputEditedState = {
			blocks: [{ type: 'paragraph', data: { text: 'hello world' } }],
		};
		(mockEditor.save as jest.Mock).mockResolvedValue(inputEditedState);
		capturedOnChange!();
		// Intentionally DO NOT flush — simulates Cmd+Z pressed immediately

		// Act: press Cmd+Z before onEditorChange's editor.save() resolves
		(mockEditor.render as jest.Mock).mockClear();
		const event = fireKeyInContainer({ key: 'z', metaKey: true });
		await flushPromises();

		// Assert: should have prevented default and restored the initial state
		expect(event.defaultPrevented).toBe(true);
		expect(mockEditor.render).toHaveBeenCalledWith(inputInitialState);
	});

	it('should undo after loadNote render failure (initial snapshot still captured)', async () => {
		// Arrange: loadNote's render throws (e.g. "Incorrect data")
		(mockEditor.render as jest.Mock).mockRejectedValueOnce(
			new Error('Incorrect data passed to the render() method'),
		);
		const inputFallbackState = {
			blocks: [{ type: 'paragraph', data: { text: '' } }],
		};
		(mockEditor.save as jest.Mock).mockResolvedValue(inputFallbackState);

		await (window as any).BlockEditor.loadNote({ id: 'n1', body: '# broken' });
		await flushPromises();

		// User types something — editor now has new content
		const inputEditedState = {
			blocks: [{ type: 'paragraph', data: { text: 'typed stuff' } }],
		};
		(mockEditor.save as jest.Mock).mockResolvedValue(inputEditedState);
		capturedOnChange!();
		await flushPromises();

		// Act: press Cmd+Z — should restore the fallback state
		(mockEditor.render as jest.Mock).mockClear();
		(mockEditor.save as jest.Mock).mockResolvedValue(inputEditedState);
		const event = fireKeyInContainer({ key: 'z', metaKey: true });
		await flushPromises();

		expect(event.defaultPrevented).toBe(true);
		expect(mockEditor.render).toHaveBeenCalledWith(inputFallbackState);
	});

	it('should always prevent default on Cmd+Z when editor has had changes (owns undo fully)', async () => {
		// Arrange: load a note and make one change
		const inputInitialState = {
			blocks: [{ type: 'paragraph', data: { text: 'original' } }],
		};
		(mockEditor.save as jest.Mock).mockResolvedValue(inputInitialState);
		await (window as any).BlockEditor.loadNote({ id: 'n1', body: 'original' });
		await flushPromises();

		const inputEditedState = {
			blocks: [{ type: 'paragraph', data: { text: 'changed' } }],
		};
		(mockEditor.save as jest.Mock).mockResolvedValue(inputEditedState);
		capturedOnChange!();
		await flushPromises();

		// Make render update what save returns (real EditorJS behaviour)
		(mockEditor.render as jest.Mock).mockImplementation(async (data: unknown) => {
			(mockEditor.save as jest.Mock).mockResolvedValue(data);
		});

		// First Cmd+Z — restores initial (undo stack has 1 entry)
		(mockEditor.render as jest.Mock).mockClear();
		fireKeyInContainer({ key: 'z', metaKey: true });
		await flushPromises();
		expect(mockEditor.render).toHaveBeenCalledWith(inputInitialState);

		// Second Cmd+Z — stack is now empty, but Cmd+Z should STILL be
		// prevented to avoid EditorJS native undo (broken by prior render calls)
		(mockEditor.render as jest.Mock).mockClear();
		const event = fireKeyInContainer({ key: 'z', metaKey: true });
		await flushPromises();

		expect(event.defaultPrevented).toBe(true);
		expect(mockEditor.render).not.toHaveBeenCalled();
	});
});
