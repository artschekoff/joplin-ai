/**
 * block-editor.js  —  Phase 2
 * Editor.js + DragDrop + Vim mode
 *
 * Globals expected (loaded before this script):
 *   window.EditorJS, window.Header, window.EditorjsList,
 *   window.Checklist, window.CodeTool, window.Quote,
 *   window.Delimiter, window.DragDrop, window.MarkdownConverter
 */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────

  /** @type {any} */
  let editor = null;
  let currentNoteId = null;
  let saveTimer = null;
  const SAVE_DEBOUNCE_MS = 1200;

  // ── Vim state ──────────────────────────────────────────────────────────────

  /** @type {'insert'|'normal'} */
  let vimMode = 'insert';
  let vimIndex = 0;         // currently selected block in normal mode
  let vimPendingKey = null; // waiting for composite (dd / gg / yy)
  let vimPendingTimer = null;
  const VIM_PENDING_MS = 600;
  /** @type {{ type: string, data: any } | null} */
  let yankBuffer = null;

  // ── Undo stack ─────────────────────────────────────────────────────────────

  /** JSON-serialised snapshots of editor states, oldest first. */
  const undoStack = [];
  const MAX_UNDO_STEPS = 50;
  /** The most-recently captured snapshot (tracks current state). */
  let currentSnapshot = null;
  /** True while an undo restore is in progress — prevents re-entrancy. */
  let isRestoringUndo = false;
  /** True after the first change; once true Cmd+Z is always intercepted. */
  let hasEverChanged = false;

  // ── Save helpers ───────────────────────────────────────────────────────────

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!editor || !currentNoteId) return;
      try {
        const out = await editor.save();
        const md = window.MarkdownConverter.blocksToMarkdown(out.blocks);
        window.webviewApi.postMessage({ type: 'saveBlocks', noteId: currentNoteId, markdown: md });
      } catch (_) {}
    }, SAVE_DEBOUNCE_MS);
  };

  // ── Undo helpers ───────────────────────────────────────────────────────────

  /**
   * Captures the current editor state and pushes the previous snapshot onto
   * the undo stack.  Returns true when a new snapshot was recorded.
   *
   * Only the `blocks` array is compared/stored — EditorJS includes a `time`
   * field in save() output that changes on every call, which would create
   * phantom undo entries for unchanged content.
   */
  const captureSnapshot = async () => {
    if (!editor) return false;
    try {
      const out = await editor.save();
      const snap = JSON.stringify(out.blocks);
      if (snap !== currentSnapshot) {
        if (currentSnapshot !== null) {
          undoStack.push(currentSnapshot);
          if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
        }
        currentSnapshot = snap;
        return true;
      }
    } catch (_) {}
    return false;
  };

  const onEditorChange = async () => {
    if (isRestoringUndo) return;
    await captureSnapshot();
  };

  /**
   * Pops the last snapshot from the undo stack and renders it.
   * Preserves the editor container's scroll position so the view does not
   * jump to the top when editor.render() replaces the DOM.
   */
  const performUndo = async () => {
    if (!editor || undoStack.length === 0) return;
    const snap = undoStack.pop();
    currentSnapshot = snap ?? null;
    isRestoringUndo = true;
    const editorEl = document.getElementById('editor-container');
    const savedScroll = editorEl ? editorEl.scrollTop : 0;
    try {
      await editor.render({ blocks: JSON.parse(snap) });
      if (editorEl) {
        editorEl.scrollTop = savedScroll;
        requestAnimationFrame(() => { editorEl.scrollTop = savedScroll; });
      }
      scheduleSave();
    } catch (_) {} finally {
      isRestoringUndo = false;
    }
  };

  // ── Vim helpers ────────────────────────────────────────────────────────────

  const vimStatusEl = () => document.getElementById('vim-mode-label');

  const updateVimUI = () => {
    const el = vimStatusEl();
    if (el) el.textContent = vimMode === 'normal' ? '-- NORMAL --' : '-- INSERT --';
    const bar = document.getElementById('vim-statusbar');
    if (bar) bar.setAttribute('data-mode', vimMode);

    // Block highlight
    document.querySelectorAll('.ce-block--vim').forEach(b => b.classList.remove('ce-block--vim'));
    if (vimMode === 'normal') {
      const blocks = document.querySelectorAll('#editor-container .ce-block');
      if (blocks[vimIndex]) blocks[vimIndex].classList.add('ce-block--vim');
    }
  };

  const clampIndex = (i) => {
    const count = editor ? editor.blocks.getBlocksCount() : 1;
    return Math.max(0, Math.min(i, count - 1));
  };

  const vimMoveTo = (i) => {
    vimIndex = clampIndex(i);
    updateVimUI();
    const blocks = document.querySelectorAll('#editor-container .ce-block');
    if (blocks[vimIndex]) blocks[vimIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const vimEnterInsert = (position = 'start') => {
    vimMode = 'insert';
    updateVimUI();
    try { editor.caret.setToBlock(vimIndex, position); } catch (_) {}
  };

  const cancelPending = () => {
    clearTimeout(vimPendingTimer);
    vimPendingKey = null;
  };

  /** @returns {boolean} true if key was consumed */
  const handleVimKey = async (e) => {
    if (vimMode !== 'normal') return false;

    const key = e.key;
    const prev = vimPendingKey;
    cancelPending();

    // ── Composite keys ────────────────────────────────────────────────────
    if (prev === 'd' && key === 'd') {
      e.preventDefault();
      if (editor.blocks.getBlocksCount() > 1) {
        editor.blocks.delete(vimIndex);
        vimIndex = clampIndex(vimIndex);
      }
      updateVimUI();
      scheduleSave();
      return true;
    }
    if (prev === 'g' && key === 'g') {
      e.preventDefault();
      vimMoveTo(0);
      return true;
    }
    if (prev === 'y' && key === 'y') {
      e.preventDefault();
      try {
        const out = await editor.save();
        const b = out.blocks[vimIndex];
        if (b) yankBuffer = { type: b.type, data: JSON.parse(JSON.stringify(b.data)) };
      } catch (_) {}
      return true;
    }

    // ── Single-key commands ───────────────────────────────────────────────
    switch (key) {
      case 'j': e.preventDefault(); vimMoveTo(vimIndex + 1); return true;
      case 'k': e.preventDefault(); vimMoveTo(vimIndex - 1); return true;
      case 'G': e.preventDefault(); vimMoveTo(editor.blocks.getBlocksCount() - 1); return true;

      case 'i': e.preventDefault(); vimEnterInsert('start'); return true;
      case 'a': e.preventDefault(); vimEnterInsert('end'); return true;

      case 'o':
        e.preventDefault();
        editor.blocks.insert('paragraph', {}, null, vimIndex + 1, true);
        vimIndex = vimIndex + 1;
        vimMode = 'insert';
        updateVimUI();
        setTimeout(() => { try { editor.caret.setToBlock(vimIndex, 'start'); } catch (_) {} }, 0);
        return true;

      case 'O':
        e.preventDefault();
        editor.blocks.insert('paragraph', {}, null, vimIndex, true);
        vimMode = 'insert';
        updateVimUI();
        setTimeout(() => { try { editor.caret.setToBlock(vimIndex, 'start'); } catch (_) {} }, 0);
        return true;

      case 'p':
        e.preventDefault();
        if (yankBuffer) {
          editor.blocks.insert(yankBuffer.type, yankBuffer.data, null, vimIndex + 1, false);
          vimMoveTo(vimIndex + 1);
          scheduleSave();
        }
        return true;

      case 'P':
        e.preventDefault();
        if (yankBuffer) {
          editor.blocks.insert(yankBuffer.type, yankBuffer.data, null, vimIndex, false);
          updateVimUI();
          scheduleSave();
        }
        return true;

      case 'u':
        e.preventDefault();
        await performUndo();
        return true;

      // Start composite
      case 'd':
      case 'g':
      case 'y':
        e.preventDefault();
        vimPendingKey = key;
        vimPendingTimer = setTimeout(cancelPending, VIM_PENDING_MS);
        return true;

      default:
        return false;
    }
  };

  const attachVimListeners = () => {
    const container = document.getElementById('editor-container');
    if (!container) return;

    // Allow programmatic focus so normal-mode keys keep e.target inside the container
    container.setAttribute('tabindex', '-1');

    // Capture phase — fires before Editor.js handlers
    document.addEventListener('keydown', async (e) => {
      if (!container.contains(e.target) && e.target !== container) return;

      if (e.key === 'Escape' && vimMode === 'insert') {
        try { vimIndex = editor.blocks.getCurrentBlockIndex(); } catch (_) {}
        if (document.activeElement) document.activeElement.blur();
        // Keep focus on the container so subsequent keydown events (hjkl) still
        // pass the container guard above and reach handleVimKey.
        container.focus();
        vimMode = 'normal';
        updateVimUI();
        e.preventDefault();
        return;
      }

      // Ctrl+Z / Cmd+Z — always intercept once any change has been made so
      // EditorJS native undo (broken by render() calls) never fires.
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (hasEverChanged || undoStack.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          // Force-capture closes the async gap: if onEditorChange has not
          // flushed yet, this grabs the current state before we undo.
          await captureSnapshot();
          if (undoStack.length > 0) {
            await performUndo();
          }
          return;
        }
      }

      if (vimMode === 'normal') {
        await handleVimKey(e);
      }
    }, true);
  };

  // ── Editor.js init ─────────────────────────────────────────────────────────

  const initEditorJs = () => {
    if (typeof window.EditorJS === 'undefined') return false;

    editor = new window.EditorJS({
      holder: 'editor-container',
      autofocus: false,
      placeholder: 'Start writing…  (press Escape for Vim Normal mode)',
      inlineToolbar: ['bold', 'italic', 'link'],
      tools: {
        header:    { class: window.Header,      config: { levels: [1, 2, 3], defaultLevel: 2 } },
        list:      { class: window.EditorjsList, inlineToolbar: true, config: { defaultStyle: 'unordered' } },
        checklist: { class: window.Checklist,   inlineToolbar: true },
        code:      { class: window.CodeTool },
        quote:     { class: window.Quote,       inlineToolbar: true },
        delimiter: { class: window.Delimiter },
      },
      onReady: () => {
        if (typeof window.DragDrop === 'function') {
          new window.DragDrop(editor);
        }
        attachVimListeners();
        updateVimUI();
        if (typeof window.webviewApi !== 'undefined') {
          window.webviewApi.postMessage({ type: 'getNote' });
        }
      },
      onChange: () => {
        hasEverChanged = true;
        onEditorChange();
        scheduleSave();
      },
    });

    return true;
  };

  // ── Public API ─────────────────────────────────────────────────────────────

  window.BlockEditor = {
    loadNote: async (note) => {
      currentNoteId = note ? (note.id || null) : null;
      if (!editor) return;
      // Reset undo history whenever a new note is loaded.
      undoStack.length = 0;
      currentSnapshot = null;
      isRestoringUndo = false;
      hasEverChanged = false;
      try {
        await editor.isReady;
        if (!note || !note.body) { await editor.clear(); } else {
          const blocks = window.MarkdownConverter.markdownToBlocks(note.body);
          await editor.render({ blocks });
          vimIndex = 0;
          updateVimUI();
        }
      } catch (err) {
        console.error('[BlockEditor] loadNote:', err);
      }
      // Always capture the initial state — even when render fails the editor
      // still has a DOM state that the user can edit and may want to undo to.
      try {
        const out = await editor.save();
        currentSnapshot = JSON.stringify(out.blocks);
      } catch (_) {}
    },

    getMarkdown: async () => {
      if (!editor) return '';
      try {
        const out = await editor.save();
        return window.MarkdownConverter.blocksToMarkdown(out.blocks);
      } catch (_) { return ''; }
    },

    getNoteId: () => currentNoteId,

    /** Programmatic vim mode switch (called externally if needed) */
    setVimMode: (mode) => {
      vimMode = mode;
      updateVimUI();
    },
  };

  // ── Native Editor.js popover — first-item auto-focus ─────────────────────

  /**
   * Selector for a popover item that can receive focus.
   * Excludes hidden, disabled, and separator elements.
   */
  const FOCUSABLE_POPOVER_ITEM =
    '.ce-popover-item:not(.ce-popover-item--hidden)' +
    ':not(.ce-popover-item--disabled)' +
    ':not(.ce-popover-item-separator)';

  /** Data attribute that marks items auto-focused by us (not by arrow keys). */
  const AUTO_FOCUS_ATTR = 'data-be-auto-focused';

  /** Focus the first selectable item in the given popover element. */
  const focusFirstPopoverItem = (popover) => {
    popover.querySelectorAll(`[${AUTO_FOCUS_ATTR}]`).forEach(el => {
      el.removeAttribute(AUTO_FOCUS_ATTR);
      el.classList.remove('ce-popover-item--focused');
    });
    const first = popover.querySelector(FOCUSABLE_POPOVER_ITEM);
    if (first) {
      first.classList.add('ce-popover-item--focused');
      first.setAttribute(AUTO_FOCUS_ATTR, '1');
    }
  };

  /**
   * Move popover keyboard focus by `delta` (+1 forward, -1 backward).
   * Wraps around. Skips hidden/disabled items.
   */
  const movePopoverFocus = (popover, delta) => {
    const items = Array.from(popover.querySelectorAll(FOCUSABLE_POPOVER_ITEM));
    if (items.length === 0) return;
    const currentIdx = items.findIndex(el => el.classList.contains('ce-popover-item--focused'));
    const nextIdx = (currentIdx + delta + items.length) % items.length;
    items.forEach(el => {
      el.classList.remove('ce-popover-item--focused');
      el.removeAttribute(AUTO_FOCUS_ATTR);
    });
    // Do NOT set AUTO_FOCUS_ATTR here — this is user-initiated navigation.
    // Without the attribute the observer will leave this item alone.
    items[nextIdx].classList.add('ce-popover-item--focused');
    items[nextIdx].scrollIntoView?.({ block: 'nearest' });
  };

  // ── Popover search state ──────────────────────────────────────────────────

  let popoverSearchQuery = '';

  const SEARCH_INDICATOR_CLASS = 'be-popover-search-indicator';

  /** Single printable character (length-1, no control/meta). */
  const isPrintableKey = (e) =>
    e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

  /** Get the text label of a popover item. */
  const getItemLabel = (item) => {
    const title = item.querySelector('.ce-popover-item__title');
    return (title ? title.textContent : item.textContent || '').toLowerCase();
  };

  /** Marker for items hidden by our search (not by Editor.js). */
  const SEARCH_HIDDEN_ATTR = 'data-be-search-hidden';

  /** Apply the current search query to popover items. */
  const applyPopoverFilter = (popover) => {
    const query = popoverSearchQuery.toLowerCase();
    const items = popover.querySelectorAll('.ce-popover-item');
    items.forEach(item => {
      if (!query) {
        if (item.hasAttribute(SEARCH_HIDDEN_ATTR)) {
          item.removeAttribute(SEARCH_HIDDEN_ATTR);
          item.classList.remove('ce-popover-item--hidden');
        }
      } else {
        const label = getItemLabel(item);
        if (label.includes(query)) {
          if (item.hasAttribute(SEARCH_HIDDEN_ATTR)) {
            item.removeAttribute(SEARCH_HIDDEN_ATTR);
            item.classList.remove('ce-popover-item--hidden');
          }
        } else if (!item.hasAttribute(SEARCH_HIDDEN_ATTR)) {
          item.setAttribute(SEARCH_HIDDEN_ATTR, '1');
          item.classList.add('ce-popover-item--hidden');
        }
      }
    });
    updateSearchIndicator(popover);
    focusFirstPopoverItem(popover);
  };

  /** Show or remove the search indicator inside the popover. */
  const updateSearchIndicator = (popover) => {
    let indicator = popover.querySelector('.' + SEARCH_INDICATOR_CLASS);
    if (!popoverSearchQuery) {
      if (indicator) indicator.remove();
      return;
    }
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = SEARCH_INDICATOR_CLASS;
      popover.prepend(indicator);
    }
    indicator.textContent = popoverSearchQuery;
  };

  /** Reset search state and un-hide all items. */
  const resetPopoverSearch = (popover) => {
    if (!popoverSearchQuery) return;
    popoverSearchQuery = '';
    if (popover) applyPopoverFilter(popover);
  };

  const attachPopoverBehavior = () => {
    // MutationObserver: whenever the popover opens or its items change,
    // auto-focus the first visible item.
    /** Tracks whether we saw an open popover last tick. */
    let wasPopoverOpen = false;

    const observer = new MutationObserver(() => {
      try {
        if (!document.body) return;
        const popover = document.querySelector('.ce-popover--opened');
        if (!popover) {
          popoverSearchQuery = '';
          wasPopoverOpen = false;
          return;
        }
        // Popover just (re-)opened — clear stale search state.
        if (!wasPopoverOpen) {
          wasPopoverOpen = true;
          popoverSearchQuery = '';
          // Un-hide only items hidden by our search, not by Editor.js.
          popover.querySelectorAll(`[${SEARCH_HIDDEN_ATTR}]`).forEach(el => {
            el.removeAttribute(SEARCH_HIDDEN_ATTR);
            el.classList.remove('ce-popover-item--hidden');
          });
          const indicator = popover.querySelector('.' + SEARCH_INDICATOR_CLASS);
          if (indicator) indicator.remove();
        }
        const focused = popover.querySelector('.ce-popover-item--focused');
        // User navigated manually (no AUTO_FOCUS_ATTR) — respect their choice.
        if (focused && !focused.hasAttribute(AUTO_FOCUS_ATTR)) return;
        const first = popover.querySelector(FOCUSABLE_POPOVER_ITEM);
        if (!first) return;
        // First item is already correctly focused — stop here (prevents infinite loop
        // where classList.add triggers the observer which calls this again).
        if (focused === first) return;
        focusFirstPopoverItem(popover);
      } catch (_) {}
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    // Capture-phase search handler: printable keys, Backspace, Escape.
    document.addEventListener('keydown', (e) => {
      const popover = document.querySelector('.ce-popover--opened');
      if (!popover) return;

      if (e.key === 'Escape' && popoverSearchQuery) {
        e.preventDefault();
        e.stopImmediatePropagation();
        resetPopoverSearch(popover);
        return;
      }
      if (e.key === 'Backspace' && popoverSearchQuery) {
        e.preventDefault();
        e.stopImmediatePropagation();
        popoverSearchQuery = popoverSearchQuery.slice(0, -1);
        applyPopoverFilter(popover);
        return;
      }
      if (isPrintableKey(e) && e.key !== ' ') {
        e.preventDefault();
        e.stopImmediatePropagation();
        popoverSearchQuery += e.key;
        applyPopoverFilter(popover);
        return;
      }
    }, true);

    // Capture-phase Tab / Shift+Tab handler: cycle through popover items.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const popover = document.querySelector('.ce-popover--opened');
      if (!popover) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      movePopoverFocus(popover, e.shiftKey ? -1 : +1);
    }, true);

    // Capture-phase Enter handler: when the popover is open, click the focused
    // (or first) item and block propagation so EditorJS does not also insert a
    // new paragraph via its default Enter behaviour.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const popover = document.querySelector('.ce-popover--opened');
      if (!popover) return;
      const focused = popover.querySelector(
        '.ce-popover-item--focused:not(.ce-popover-item--hidden)',
      );
      const first = popover.querySelector(FOCUSABLE_POPOVER_ITEM);
      if (!first) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      (focused || first).click();
    }, true);
  };

  // ── Message handler (standalone panel — receives messages from backend) ──

  const attachMessageHandler = () => {
    if (typeof window.webviewApi === 'undefined') return;
    window.webviewApi.onMessage((event) => {
      const message = event && event.message && event.message.type ? event.message : event;
      if (!message) return;
      if (message.type === 'noteLoaded') {
        const note = message.note || null;
        if (window.BlockEditor) window.BlockEditor.loadNote(note);
      }
    });
  };

  // ── Boot ───────────────────────────────────────────────────────────────────

  const boot = () => {
    attachPopoverBehavior();
    attachMessageHandler();

    if (!initEditorJs()) {
      setTimeout(() => { if (!initEditorJs()) console.error('[BlockEditor] EditorJS failed to load'); }, 500);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
