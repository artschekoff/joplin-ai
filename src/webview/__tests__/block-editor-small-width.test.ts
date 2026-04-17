/**
 * @jest-environment jsdom
 *
 * Regression tests for "block editor is hidden on small width".
 *
 * Root cause: when #editor-pane lives inside #app which is flex-direction:column,
 * the pane (flex: 0 0 50%) takes 50% of the panel HEIGHT and is pushed below the
 * visible viewport by the header/messages/input siblings — becoming invisible
 * regardless of the panel width.
 *
 * Fix requirements:
 *  1. applyEditorVisibility() must toggle an `editor-visible` class on #app
 *     so that CSS can switch the container to flex-direction: row (horizontal split).
 *  2. When editorVisible is true, #editor-pane must NOT have display:none.
 *  3. When editorVisible is false, #editor-pane and #editor-resizer must be hidden.
 *  4. editor-visible class must be removed when the editor is hidden.
 *  5. Both editor-visible and editor-only classes are present when in editor-only mode.
 */

import * as fs from 'fs';
import * as path from 'path';

const blockEditorSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'block-editor.js'),
  'utf-8',
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build the full panel DOM that mirrors the expected PANEL_HTML structure:
 * #app wraps both the AI chat pane and the block editor pane side-by-side.
 */
const buildDOM = (): void => {
  document.body.innerHTML = `
    <div id="app">
      <div class="ai-chat-pane">
        <div class="header"></div>
        <div class="messages" id="messages"></div>
        <div id="queueContainer" class="queue-container"></div>
        <div class="input-area"></div>
      </div>
      <div id="editor-resizer"></div>
      <div id="editor-pane">
        <div id="editor-container" tabindex="-1"></div>
        <div id="slash-menu"></div>
        <div id="vim-statusbar"><span id="vim-mode-label">-- INSERT --</span></div>
      </div>
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

  (window as any).EditorJS = jest.fn().mockImplementation(
    ({ onReady }: any) => {
      onReady?.();
      return mockEditor;
    },
  );
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

const loadBlockEditor = (): void => {
  // eslint-disable-next-line no-eval
  eval(blockEditorSource);
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BlockEditor – layout class for small-width fix', () => {
  it('should add editor-visible class to #app when editor is shown', () => {
    // Arrange: editor is visible at boot
    localStorage.setItem('joplin-ai-editor-visible', 'true');

    // Act
    loadBlockEditor();

    // Assert: #app must carry the class so CSS can apply flex-direction:row
    const app = document.getElementById('app');
    expect(app?.classList.contains('editor-visible')).toBe(true);
  });

  it('should NOT add editor-visible class when editor is hidden at boot', () => {
    // Arrange: editor is not visible (default)
    localStorage.setItem('joplin-ai-editor-visible', 'false');

    // Act
    loadBlockEditor();

    // Assert
    const app = document.getElementById('app');
    expect(app?.classList.contains('editor-visible')).toBe(false);
  });

  it('should add editor-visible class when ai:enableEditor fires', () => {
    // Arrange: start hidden
    loadBlockEditor();

    // Act
    window.dispatchEvent(new CustomEvent('ai:enableEditor', { detail: { editorOnly: false } }));

    // Assert
    const app = document.getElementById('app');
    expect(app?.classList.contains('editor-visible')).toBe(true);
  });

  it('should remove editor-visible class when ai:disableEditor fires', () => {
    // Arrange: start visible
    localStorage.setItem('joplin-ai-editor-visible', 'true');
    loadBlockEditor();

    // Act
    window.dispatchEvent(new CustomEvent('ai:disableEditor'));

    // Assert
    const app = document.getElementById('app');
    expect(app?.classList.contains('editor-visible')).toBe(false);
  });

  it('should remove editor-visible class when ai:toggleEditor turns editor off', () => {
    // Arrange: start visible
    localStorage.setItem('joplin-ai-editor-visible', 'true');
    loadBlockEditor();

    // Act: toggle off
    window.dispatchEvent(new CustomEvent('ai:toggleEditor'));

    // Assert
    const app = document.getElementById('app');
    expect(app?.classList.contains('editor-visible')).toBe(false);
  });

  it('should add editor-visible class when ai:toggleEditor turns editor on', () => {
    // Arrange: start hidden
    localStorage.setItem('joplin-ai-editor-visible', 'false');
    loadBlockEditor();

    // Act: toggle on
    window.dispatchEvent(new CustomEvent('ai:toggleEditor'));

    // Assert
    const app = document.getElementById('app');
    expect(app?.classList.contains('editor-visible')).toBe(true);
  });
});

describe('BlockEditor – pane display is not affected by width', () => {
  it('should NOT hide #editor-pane via display:none when editorVisible is true', () => {
    // Arrange
    localStorage.setItem('joplin-ai-editor-visible', 'true');

    // Act
    loadBlockEditor();

    // Assert: pane must remain visible — JS must not set display:none
    const pane = document.getElementById('editor-pane');
    expect(pane?.style.display).not.toBe('none');
  });

  it('should hide #editor-pane when editorVisible is false', () => {
    // Arrange
    localStorage.setItem('joplin-ai-editor-visible', 'false');

    // Act
    loadBlockEditor();

    // Assert
    const pane = document.getElementById('editor-pane');
    expect(pane?.style.display).toBe('none');
  });

  it('should hide #editor-resizer when editorVisible is false', () => {
    // Arrange
    localStorage.setItem('joplin-ai-editor-visible', 'false');

    // Act
    loadBlockEditor();

    // Assert
    const resizer = document.getElementById('editor-resizer');
    expect(resizer?.style.display).toBe('none');
  });

  it('should show #editor-resizer when editorVisible is true and NOT editor-only', () => {
    // Arrange
    localStorage.setItem('joplin-ai-editor-visible', 'true');
    localStorage.setItem('joplin-ai-editor-only', 'false');

    // Act
    loadBlockEditor();

    // Assert: resizer must be visible in split mode
    const resizer = document.getElementById('editor-resizer');
    expect(resizer?.style.display).not.toBe('none');
  });
});

describe('BlockEditor – editor-only mode layout', () => {
  it('should have both editor-visible and editor-only classes in editor-only mode', () => {
    // Arrange
    localStorage.setItem('joplin-ai-editor-visible', 'true');
    localStorage.setItem('joplin-ai-editor-only', 'true');

    // Act
    loadBlockEditor();

    // Assert
    const app = document.getElementById('app');
    expect(app?.classList.contains('editor-visible')).toBe(true);
    expect(app?.classList.contains('editor-only')).toBe(true);
  });

  it('should have editor-visible but NOT editor-only in split mode', () => {
    // Arrange
    localStorage.setItem('joplin-ai-editor-visible', 'true');
    localStorage.removeItem('joplin-ai-editor-only');

    // Act
    loadBlockEditor();

    // Assert
    const app = document.getElementById('app');
    expect(app?.classList.contains('editor-visible')).toBe(true);
    expect(app?.classList.contains('editor-only')).toBe(false);
  });
});
