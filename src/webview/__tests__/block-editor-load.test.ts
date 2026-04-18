/**
 * @jest-environment jsdom
 *
 * Regression test for "[BlockEditor] EditorJS failed to load".
 *
 * Root cause: block-editor.js depends on window.EditorJS (and plugin globals)
 * being loaded before it runs, but the plugin never registered those UMD bundles
 * via addScript. When neither initEditorJs() call succeeds the boot function
 * logs the error and the editor is silently dead.
 *
 * Fix requirements:
 *  1. When window.EditorJS IS defined at boot time, no error is logged and
 *     new EditorJS() is called exactly once.
 *  2. When window.EditorJS is missing at first check but arrives within the
 *     retry window (500 ms), no error is logged and the editor still
 *     initialises.
 *  3. When window.EditorJS is absent for both attempts, console.error is
 *     called with the expected message.
 *  4. window.BlockEditor.loadNote() is a no-op (does not throw) when the
 *     editor failed to initialise.
 */

import * as fs from 'fs';
import * as path from 'path';

const blockEditorSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'block-editor.js'),
  'utf-8',
);

/** Flush microtasks + one setTimeout tick. */
const flushAll = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 0));

const buildDOM = (): void => {
  document.body.innerHTML = `
    <div id="app">
      <div id="editor-resizer"></div>
      <div id="editor-pane">
        <div id="editor-container" tabindex="-1"></div>
        <div id="vim-statusbar"><span id="vim-mode-label">-- INSERT --</span></div>
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

const registerPluginGlobals = (mockEditorJsCtor: jest.Mock): void => {
  (window as any).EditorJS = mockEditorJsCtor;
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

const cleanupGlobals = (): void => {
  for (const key of [
    'BlockEditor', 'EditorJS', 'DragDrop', 'Header', 'EditorjsList',
    'Checklist', 'CodeTool', 'Quote', 'Delimiter', 'MarkdownConverter', 'webviewApi',
  ]) delete (window as any)[key];
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  localStorage.clear();
  buildDOM();
});

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  cleanupGlobals();
  jest.useRealTimers();
});

// ── 1. Happy path: globals available at boot ─────────────────────────────────

describe('BlockEditor boot — EditorJS globals present at startup', () => {
  it('should call new EditorJS() exactly once and not log an error', () => {
    // Arrange
    const mockEditor = makeMockEditor();
    const mockEditorJsCtor = jest.fn().mockImplementation(({ onReady }: any) => {
      onReady?.();
      return mockEditor;
    });
    registerPluginGlobals(mockEditorJsCtor);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Act
    // eslint-disable-next-line no-eval
    eval(blockEditorSource);
    jest.runAllTimers();

    // Assert
    expect(mockEditorJsCtor).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[BlockEditor] EditorJS failed to load'),
    );
    errorSpy.mockRestore();
  });

  it('should expose window.BlockEditor with loadNote / getMarkdown / getNoteId', () => {
    // Arrange
    const mockEditor = makeMockEditor();
    registerPluginGlobals(
      jest.fn().mockImplementation(({ onReady }: any) => { onReady?.(); return mockEditor; }),
    );

    // Act
    // eslint-disable-next-line no-eval
    eval(blockEditorSource);

    // Assert
    expect(typeof (window as any).BlockEditor?.loadNote).toBe('function');
    expect(typeof (window as any).BlockEditor?.getMarkdown).toBe('function');
    expect(typeof (window as any).BlockEditor?.getNoteId).toBe('function');
  });
});

// ── 2. Late globals: EditorJS arrives within the retry window ─────────────────

describe('BlockEditor boot — EditorJS globals arrive before retry fires', () => {
  it('should initialise without error when globals become available within 500 ms', () => {
    // Arrange — NO globals yet
    (window as any).MarkdownConverter = {
      markdownToBlocks: jest.fn().mockReturnValue({ blocks: [] }),
      blocksToMarkdown: jest.fn().mockReturnValue(''),
    };
    (window as any).webviewApi = { postMessage: jest.fn(), onMessage: jest.fn() };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Act: load the script — initEditorJs() will return false (no window.EditorJS)
    // eslint-disable-next-line no-eval
    eval(blockEditorSource);

    // Simulate vendor scripts arriving before the 500 ms timeout fires
    const mockEditor = makeMockEditor();
    registerPluginGlobals(
      jest.fn().mockImplementation(({ onReady }: any) => { onReady?.(); return mockEditor; }),
    );

    jest.runAllTimers(); // fires the 500 ms retry

    // Assert
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[BlockEditor] EditorJS failed to load'),
    );
    errorSpy.mockRestore();
  });
});

// ── 3. Failure path: globals never arrive ────────────────────────────────────

describe('BlockEditor boot — EditorJS globals never load', () => {
  it('should log the expected error message after retry timeout', () => {
    // Arrange — register everything EXCEPT window.EditorJS
    (window as any).MarkdownConverter = {
      markdownToBlocks: jest.fn().mockReturnValue({ blocks: [] }),
      blocksToMarkdown: jest.fn().mockReturnValue(''),
    };
    (window as any).webviewApi = { postMessage: jest.fn(), onMessage: jest.fn() };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Act
    // eslint-disable-next-line no-eval
    eval(blockEditorSource);
    jest.runAllTimers(); // advance past the 500 ms retry

    // Assert
    expect(errorSpy).toHaveBeenCalledWith(
      '[BlockEditor] EditorJS failed to load',
    );
    errorSpy.mockRestore();
  });
});

// ── 4. loadNote is safe when editor never initialised ────────────────────────

describe('BlockEditor.loadNote — graceful no-op when init failed', () => {
  it('should not throw when called after EditorJS failed to load', async () => {
    // Arrange — no EditorJS globals
    (window as any).MarkdownConverter = {
      markdownToBlocks: jest.fn().mockReturnValue({ blocks: [] }),
      blocksToMarkdown: jest.fn().mockReturnValue(''),
    };
    (window as any).webviewApi = { postMessage: jest.fn(), onMessage: jest.fn() };
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // eslint-disable-next-line no-eval
    eval(blockEditorSource);
    jest.runAllTimers();

    // Act & Assert — must not throw
    await expect(
      (window as any).BlockEditor.loadNote({ id: 'note-1', body: '# Hello' }),
    ).resolves.toBeUndefined();

    (console.error as jest.Mock).mockRestore();
  });
});
