/**
 * @jest-environment jsdom
 *
 * Tests for Editor.js native popover first-item auto-focus and Tab navigation.
 *
 * Requirements:
 *  - When the Editor.js popover opens (`.ce-popover--opened`), the first
 *    non-hidden, non-disabled item gets the `.ce-popover-item--focused` class.
 *  - When the search query changes and items re-render, the first visible
 *    item is refocused.
 *  - Pressing Enter when the popover is open and no item is keyboard-focused
 *    by Editor.js clicks the first visible item.
 *  - Pressing Enter when an item IS already focused by Editor.js does NOT
 *    interfere (lets Editor.js handle it).
 *  - Tab moves focus to the next item; Shift+Tab moves to the previous item.
 *  - Tab/Shift+Tab wrap around at the boundaries.
 *  - Tab/Shift+Tab prevent default (no browser focus ring jump).
 */

import * as fs from 'fs';
import * as path from 'path';

const blockEditorSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'block-editor.js'),
  'utf-8',
);

// ── helpers ────────────────────────────────────────────────────────────────────

const buildDOM = (): void => {
  document.body.innerHTML = `
    <div id="editor-pane">
      <div id="editor-container"></div>
      <div id="slash-menu"></div>
      <div id="vim-statusbar"><span id="vim-mode-label">-- INSERT --</span></div>
    </div>
  `;
};

const fireKeydown = (
  target: EventTarget,
  key: string,
  shiftKey = false,
): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

/** Build a simulated Editor.js popover in opened state. */
const buildPopover = (itemCount = 3): HTMLElement => {
  const popover = document.createElement('div');
  popover.className = 'ce-popover ce-popover--opened';

  const search = document.createElement('div');
  search.className = 'ce-popover__search';
  popover.appendChild(search);

  for (let i = 0; i < itemCount; i++) {
    const item = document.createElement('div');
    item.className = 'ce-popover-item';
    item.textContent = `Tool ${i}`;
    item.addEventListener('click', jest.fn());
    popover.appendChild(item);
  }

  document.body.appendChild(popover);
  return popover;
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
    'BlockEditor', 'EditorJS', 'DragDrop', 'Header', 'EditorjsList',
    'Checklist', 'CodeTool', 'Quote', 'Delimiter', 'MarkdownConverter', 'webviewApi',
  ];
  globals.forEach(g => delete (window as any)[g]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Editor.js native popover — first-item auto-focus', () => {
  describe('auto-focus on popover open', () => {
    it('should add ce-popover-item--focused to the first item when the popover opens', async () => {
      const popover = buildPopover(3);
      await Promise.resolve();
      jest.runAllTimers();

      const items = popover.querySelectorAll('.ce-popover-item');
      expect(items[0].classList.contains('ce-popover-item--focused')).toBe(true);
    });

    it('should NOT focus items after the first when the popover opens', async () => {
      const popover = buildPopover(3);
      await Promise.resolve();
      jest.runAllTimers();

      const focused = popover.querySelectorAll('.ce-popover-item--focused');
      expect(focused.length).toBe(1);
    });

    it('should NOT focus hidden items', async () => {
      const popover = buildPopover(0);
      const hidden = document.createElement('div');
      hidden.className = 'ce-popover-item ce-popover-item--hidden';
      popover.appendChild(hidden);
      const visible = document.createElement('div');
      visible.className = 'ce-popover-item';
      popover.appendChild(visible);
      document.body.appendChild(popover);

      await Promise.resolve();
      jest.runAllTimers();

      expect(hidden.classList.contains('ce-popover-item--focused')).toBe(false);
      expect(visible.classList.contains('ce-popover-item--focused')).toBe(true);
    });

    it('should NOT focus disabled items', async () => {
      const popover = buildPopover(0);
      const disabled = document.createElement('div');
      disabled.className = 'ce-popover-item ce-popover-item--disabled';
      popover.appendChild(disabled);
      const enabled = document.createElement('div');
      enabled.className = 'ce-popover-item';
      popover.appendChild(enabled);
      document.body.appendChild(popover);

      await Promise.resolve();
      jest.runAllTimers();

      expect(disabled.classList.contains('ce-popover-item--focused')).toBe(false);
      expect(enabled.classList.contains('ce-popover-item--focused')).toBe(true);
    });
  });

  describe('re-focus when items change', () => {
    it('should re-focus first item when hidden items become visible', async () => {
      const popover = buildPopover(0);
      const item1 = document.createElement('div');
      item1.className = 'ce-popover-item ce-popover-item--hidden';
      popover.appendChild(item1);
      const item2 = document.createElement('div');
      item2.className = 'ce-popover-item';
      popover.appendChild(item2);
      document.body.appendChild(popover);

      await Promise.resolve();
      jest.runAllTimers();

      expect(item2.classList.contains('ce-popover-item--focused')).toBe(true);

      item1.classList.remove('ce-popover-item--hidden');
      await Promise.resolve();
      jest.runAllTimers();

      expect(item1.classList.contains('ce-popover-item--focused')).toBe(true);
    });
  });

  describe('Enter key with no keyboard-focused item', () => {
    it('should click the first visible item when Enter is pressed', async () => {
      const popover = buildPopover(3);
      await Promise.resolve();
      jest.runAllTimers();

      popover.querySelectorAll('.ce-popover-item--focused').forEach(el =>
        el.classList.remove('ce-popover-item--focused')
      );

      const firstItem = popover.querySelector('.ce-popover-item') as HTMLElement;
      const clickSpy = jest.fn();
      firstItem.addEventListener('click', clickSpy);

      fireKeydown(document.body, 'Enter');

      expect(clickSpy).toHaveBeenCalled();
    });

    it('should prevent default when clicking the first item via Enter', async () => {
      const popover = buildPopover(3);
      await Promise.resolve();
      jest.runAllTimers();

      popover.querySelectorAll('.ce-popover-item--focused').forEach(el =>
        el.classList.remove('ce-popover-item--focused')
      );

      const event = fireKeydown(document.body, 'Enter');
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('Enter key when Editor.js has a focused item', () => {
    it('should NOT click the first item when a different item is already focused by Editor.js', async () => {
      const popover = buildPopover(3);
      await Promise.resolve();
      jest.runAllTimers();

      const items = popover.querySelectorAll('.ce-popover-item');
      items[0].classList.remove('ce-popover-item--focused');
      items[1].classList.add('ce-popover-item--focused');

      const firstClickSpy = jest.fn();
      items[0].addEventListener('click', firstClickSpy);

      fireKeydown(document.body, 'Enter');

      expect(firstClickSpy).not.toHaveBeenCalled();
    });
  });

  describe('no popover visible', () => {
    it('should not interfere with Enter when no popover is open', () => {
      const event = fireKeydown(document.body, 'Enter');
      expect(event.defaultPrevented).toBe(false);
    });
  });
});

describe('Editor.js native popover — Tab / Shift+Tab navigation', () => {
  describe('Tab moves to next item', () => {
    it('should move focus from first item to second item on Tab', async () => {
      const popover = buildPopover(3);
      await Promise.resolve();
      jest.runAllTimers();

      const items = popover.querySelectorAll('.ce-popover-item');
      expect(items[0].classList.contains('ce-popover-item--focused')).toBe(true);

      fireKeydown(document.body, 'Tab');

      expect(items[0].classList.contains('ce-popover-item--focused')).toBe(false);
      expect(items[1].classList.contains('ce-popover-item--focused')).toBe(true);
    });

    it('should move focus from second to third on second Tab press', async () => {
      const popover = buildPopover(3);
      await Promise.resolve();
      jest.runAllTimers();

      const items = popover.querySelectorAll('.ce-popover-item');
      fireKeydown(document.body, 'Tab');
      fireKeydown(document.body, 'Tab');

      expect(items[2].classList.contains('ce-popover-item--focused')).toBe(true);
    });

    it('should wrap from last item to first on Tab', async () => {
      const popover = buildPopover(3);
      await Promise.resolve();
      jest.runAllTimers();

      const items = popover.querySelectorAll('.ce-popover-item');
      fireKeydown(document.body, 'Tab');
      fireKeydown(document.body, 'Tab');
      fireKeydown(document.body, 'Tab');

      expect(items[0].classList.contains('ce-popover-item--focused')).toBe(true);
    });

    it('should prevent default on Tab to avoid browser focus ring jump', async () => {
      buildPopover(3);
      await Promise.resolve();
      jest.runAllTimers();

      const event = fireKeydown(document.body, 'Tab');
      expect(event.defaultPrevented).toBe(true);
    });

    it('should skip hidden items when tabbing forward', async () => {
      const popover = buildPopover(0);
      const item0 = document.createElement('div');
      item0.className = 'ce-popover-item';
      const item1 = document.createElement('div');
      item1.className = 'ce-popover-item ce-popover-item--hidden';
      const item2 = document.createElement('div');
      item2.className = 'ce-popover-item';
      popover.append(item0, item1, item2);
      document.body.appendChild(popover);

      await Promise.resolve();
      jest.runAllTimers();

      fireKeydown(document.body, 'Tab');

      expect(item0.classList.contains('ce-popover-item--focused')).toBe(false);
      expect(item1.classList.contains('ce-popover-item--focused')).toBe(false);
      expect(item2.classList.contains('ce-popover-item--focused')).toBe(true);
    });
  });

  describe('Shift+Tab moves to previous item', () => {
    it('should wrap from first item to last on Shift+Tab', async () => {
      const popover = buildPopover(3);
      await Promise.resolve();
      jest.runAllTimers();

      const items = popover.querySelectorAll('.ce-popover-item');
      fireKeydown(document.body, 'Tab', true);

      expect(items[2].classList.contains('ce-popover-item--focused')).toBe(true);
    });

    it('should move focus from third item to second on Shift+Tab', async () => {
      const popover = buildPopover(3);
      await Promise.resolve();
      jest.runAllTimers();

      const items = popover.querySelectorAll('.ce-popover-item');
      fireKeydown(document.body, 'Tab');
      fireKeydown(document.body, 'Tab');
      fireKeydown(document.body, 'Tab', true);

      expect(items[1].classList.contains('ce-popover-item--focused')).toBe(true);
    });

    it('should prevent default on Shift+Tab', async () => {
      buildPopover(3);
      await Promise.resolve();
      jest.runAllTimers();

      const event = fireKeydown(document.body, 'Tab', true);
      expect(event.defaultPrevented).toBe(true);
    });

    it('should skip hidden items when tabbing backward', async () => {
      const popover = buildPopover(0);
      const item0 = document.createElement('div');
      item0.className = 'ce-popover-item';
      const item1 = document.createElement('div');
      item1.className = 'ce-popover-item ce-popover-item--hidden';
      const item2 = document.createElement('div');
      item2.className = 'ce-popover-item';
      popover.append(item0, item1, item2);
      document.body.appendChild(popover);

      await Promise.resolve();
      jest.runAllTimers();

      fireKeydown(document.body, 'Tab');       // item0 → item2
      fireKeydown(document.body, 'Tab', true); // item2 → skip item1 → item0

      expect(item0.classList.contains('ce-popover-item--focused')).toBe(true);
    });
  });

  describe('no popover — Tab unaffected', () => {
    it('should not prevent default Tab when no popover is open', () => {
      const event = fireKeydown(document.body, 'Tab');
      expect(event.defaultPrevented).toBe(false);
    });

    it('should not prevent default Shift+Tab when no popover is open', () => {
      const event = fireKeydown(document.body, 'Tab', true);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
