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

  // ── Save helpers ───────────────────────────────────────────────────────────

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!editor || !currentNoteId) return;
      try {
        const out = await editor.save();
        const md = window.MarkdownConverter.blocksToMarkdown(out);
        window.webviewApi.postMessage({ type: 'saveBlocks', noteId: currentNoteId, markdown: md });
      } catch (_) {}
    }, SAVE_DEBOUNCE_MS);
  };

  // ── Undo helpers ───────────────────────────────────────────────────────────

  /**
   * Called on every editor change.  Pushes the *previous* snapshot onto the
   * undo stack so that Ctrl+Z can restore it, then advances currentSnapshot to
   * the new state.  No-ops when a restore is already in progress.
   */
  const onEditorChange = async () => {
    if (isRestoringUndo || !editor) return;
    try {
      const out = await editor.save();
      const snap = JSON.stringify(out);
      if (snap !== currentSnapshot) {
        if (currentSnapshot !== null) {
          undoStack.push(currentSnapshot);
          if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
        }
        currentSnapshot = snap;
      }
    } catch (_) {}
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
      await editor.render(JSON.parse(snap));
      // Restore scroll immediately and on the next animation frame to
      // cover any async focus/scroll events EditorJS fires after render.
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

      // Slash menu takes priority
      if (slashVisible && handleSlashMenuKey(e)) return;

      if (e.key === 'Escape' && vimMode === 'insert') {
        if (slashVisible) { hideSlashMenu(); e.preventDefault(); return; }
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

      // Ctrl+Z / Cmd+Z — intercept before EditorJS handles it so our undo
      // stack (which correctly tracks multi-block deletions) takes precedence.
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (undoStack.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          await performUndo();
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
        attachSlashListeners();
        updateVimUI();
      },
      onChange: () => {
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
      try {
        await editor.isReady;
        if (!note || !note.body) { await editor.clear(); return; }
        const data = window.MarkdownConverter.markdownToBlocks(note.body);
        await editor.render(data);
        vimIndex = 0;
        updateVimUI();
        // Capture the initial state so the first undo step is tracked correctly.
        try {
          const out = await editor.save();
          currentSnapshot = JSON.stringify(out);
        } catch (_) {}
      } catch (err) {
        console.error('[BlockEditor] loadNote:', err);
      }
    },

    getMarkdown: async () => {
      if (!editor) return '';
      try {
        const out = await editor.save();
        return window.MarkdownConverter.blocksToMarkdown(out);
      } catch (_) { return ''; }
    },

    getNoteId: () => currentNoteId,

    /** Programmatic vim mode switch (called externally if needed) */
    setVimMode: (mode) => {
      vimMode = mode;
      updateVimUI();
    },
  };

  // ── Slash menu ─────────────────────────────────────────────────────────────

  const SVG = {
    paragraph: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 2h5a3 3 0 0 1 0 6H6V2zm0 6v6M4 2v12"/></svg>`,
    h1: `<svg viewBox="0 0 16 16" fill="currentColor"><text x="0" y="12" font-size="11" font-weight="700" font-family="sans-serif">H1</text></svg>`,
    h2: `<svg viewBox="0 0 16 16" fill="currentColor"><text x="0" y="12" font-size="11" font-weight="700" font-family="sans-serif">H2</text></svg>`,
    h3: `<svg viewBox="0 0 16 16" fill="currentColor"><text x="0" y="12" font-size="11" font-weight="700" font-family="sans-serif">H3</text></svg>`,
    bulletList: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="2.5" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="2.5" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="2.5" cy="12" r="1" fill="currentColor" stroke="none"/><line x1="5" y1="4" x2="14" y2="4"/><line x1="5" y1="8" x2="14" y2="8"/><line x1="5" y1="12" x2="14" y2="12"/></svg>`,
    numberedList: `<svg viewBox="0 0 16 16" fill="currentColor" stroke="none"><text x="0" y="5.5" font-size="4.5" font-family="sans-serif">1.</text><text x="0" y="9.5" font-size="4.5" font-family="sans-serif">2.</text><text x="0" y="13.5" font-size="4.5" font-family="sans-serif">3.</text><rect x="5" y="2.5" width="9" height="1.5" rx="0.75"/><rect x="5" y="6.5" width="9" height="1.5" rx="0.75"/><rect x="5" y="10.5" width="9" height="1.5" rx="0.75"/></svg>`,
    checklist: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="1.5" width="5" height="5" rx="1"/><polyline points="2.5,4 3.5,5 5.5,2.5"/><rect x="1.5" y="9.5" width="5" height="5" rx="1"/><line x1="9" y1="4" x2="14.5" y2="4"/><line x1="9" y1="12" x2="14.5" y2="12"/></svg>`,
    code: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5,4 1.5,8 5,12"/><polyline points="11,4 14.5,8 11,12"/></svg>`,
    quote: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h5v5H4a2 2 0 0 0 2 2v2a4 4 0 0 1-4-4V3zm7 0h5v5h-3a2 2 0 0 0 2 2v2a4 4 0 0 1-4-4V3z"/></svg>`,
    divider: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="1" y1="8" x2="15" y2="8"/></svg>`,
  };

  const SLASH_ITEMS = [
    { icon: SVG.paragraph,    label: 'Text',          hint: 'Plain paragraph',   type: 'paragraph', data: {} },
    { icon: SVG.h1,           label: 'Heading 1',     hint: 'Large title',       type: 'header',    data: { level: 1, text: '' } },
    { icon: SVG.h2,           label: 'Heading 2',     hint: 'Medium title',      type: 'header',    data: { level: 2, text: '' } },
    { icon: SVG.h3,           label: 'Heading 3',     hint: 'Small title',       type: 'header',    data: { level: 3, text: '' } },
    { icon: SVG.bulletList,   label: 'Bullet List',   hint: 'Unordered list',    type: 'list',      data: { style: 'unordered', items: [''] } },
    { icon: SVG.numberedList, label: 'Numbered List', hint: 'Ordered list',      type: 'list',      data: { style: 'ordered',   items: [''] } },
    { icon: SVG.checklist,    label: 'Checklist',     hint: 'To-do items',       type: 'checklist', data: { items: [{ text: '', checked: false }] } },
    { icon: SVG.code,         label: 'Code',          hint: 'Code block',        type: 'code',      data: { code: '' } },
    { icon: SVG.quote,        label: 'Quote',         hint: 'Blockquote',        type: 'quote',     data: { text: '', caption: '' } },
    { icon: SVG.divider,      label: 'Divider',       hint: 'Horizontal line',   type: 'delimiter', data: {} },
  ];

  let slashVisible = false;
  let slashQuery = '';
  let slashSelected = 0;
  let slashBlockIdx = -1;

  const slashMenu = () => document.getElementById('slash-menu');

  const filteredItems = () => {
    if (!slashQuery) return SLASH_ITEMS;
    const q = slashQuery.toLowerCase();
    return SLASH_ITEMS.filter(it =>
      it.label.toLowerCase().includes(q) || it.hint.toLowerCase().includes(q)
    );
  };

  const renderSlashMenu = () => {
    const menu = slashMenu();
    if (!menu) return;
    const items = filteredItems();

    menu.innerHTML = '';

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'slash-item slash-item--empty';
      empty.textContent = 'No results';
      menu.appendChild(empty);
      return;
    }

    let selectedRow = null;
    items.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'slash-item' + (idx === slashSelected ? ' slash-item--selected' : '');
      row.innerHTML =
        `<span class="slash-item-icon">${item.icon}</span>` +
        `<span class="slash-item-body">` +
          `<span class="slash-item-label">${item.label}</span>` +
          `<span class="slash-item-hint">${item.hint}</span>` +
        `</span>`;
      row.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep editor focus
        selectSlashItem(item);
      });
      menu.appendChild(row);
      if (idx === slashSelected) selectedRow = row;
    });
    if (selectedRow) selectedRow.scrollIntoView({ block: 'nearest' });
  };

  const positionSlashMenu = () => {
    const menu = slashMenu();
    if (!menu) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const menuH = 280;
    const top = (rect.bottom + 4 + menuH > window.innerHeight)
      ? rect.top - menuH - 4
      : rect.bottom + 4;

    menu.style.top  = Math.max(4, top) + 'px';
    menu.style.left = Math.max(8, rect.left) + 'px';
  };

  const showSlashMenu = () => {
    slashVisible = true;
    slashQuery   = '';
    slashSelected = 0;
    try { slashBlockIdx = editor.blocks.getCurrentBlockIndex(); } catch (_) {}
    try { positionSlashMenu(); } catch (_) {}
    renderSlashMenu();
    slashMenu()?.classList.add('visible');
  };

  const hideSlashMenu = () => {
    slashVisible = false;
    slashQuery   = '';
    slashMenu()?.classList.remove('visible');
  };

  const moveSlashSelection = (delta) => {
    const items = filteredItems();
    if (!items.length) return;
    slashSelected = (slashSelected + delta + items.length) % items.length;
    renderSlashMenu();
  };

  const selectSlashItem = async (item) => {
    hideSlashMenu();
    try {
      const idx = slashBlockIdx >= 0 ? slashBlockIdx : editor.blocks.getCurrentBlockIndex();
      editor.blocks.delete(idx);
      editor.blocks.insert(item.type, item.data, null, idx, true);
      scheduleSave();
    } catch (err) {
      console.error('[BlockEditor] slash insert:', err);
    }
  };

  const handleSlashMenuKey = (e) => {
    if (!slashVisible) return false;
    switch (e.key) {
      case 'ArrowDown':  e.preventDefault(); moveSlashSelection(+1); return true;
      case 'ArrowUp':    e.preventDefault(); moveSlashSelection(-1); return true;
      case 'Tab':
        e.preventDefault();
        moveSlashSelection(e.shiftKey ? -1 : +1);
        return true;
      case 'Enter': {
        e.preventDefault();
        const items = filteredItems();
        if (items[slashSelected]) selectSlashItem(items[slashSelected]);
        return true;
      }
      case 'Escape':     e.preventDefault(); hideSlashMenu(); return true;
      case 'Backspace': {
        if (slashQuery.length === 0) {
          // Backspace removed the '/', close menu (input handler will fire too)
          hideSlashMenu();
        } else {
          slashQuery = slashQuery.slice(0, -1);
          slashSelected = 0;
          renderSlashMenu();
        }
        return false; // let the char be deleted normally
      }
      default: return false;
    }
  };

  const attachSlashListeners = () => {
    const container = document.getElementById('editor-container');
    if (!container) return;

    // Detect '/' typed in an empty block
    container.addEventListener('keydown', (e) => {
      if (slashVisible) return; // handled by capture listener
      if (e.key !== '/') return;
      setTimeout(() => {
        try {
          const idx = editor.blocks.getCurrentBlockIndex();
          const blockEls = container.querySelectorAll('.ce-block');
          const blockEl = blockEls[idx];
          if (!blockEl) return;
          const text = (blockEl.querySelector('[contenteditable]') || blockEl).textContent || '';
          if (text.trim() === '/') showSlashMenu();
        } catch (_) {}
      }, 0);
    });

    // Track filter query via input events
    container.addEventListener('input', () => {
      if (!slashVisible) return;
      try {
        const idx = slashBlockIdx >= 0 ? slashBlockIdx : editor.blocks.getCurrentBlockIndex();
        const blockEls = container.querySelectorAll('.ce-block');
        const blockEl = blockEls[idx];
        if (!blockEl) { hideSlashMenu(); return; }
        const text = (blockEl.querySelector('[contenteditable]') || blockEl).textContent || '';
        if (!text.startsWith('/')) { hideSlashMenu(); return; }
        slashQuery = text.slice(1).toLowerCase();
        slashSelected = 0;
        renderSlashMenu();
        positionSlashMenu();
      } catch (_) { hideSlashMenu(); }
    });
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

  const attachPopoverBehavior = () => {
    // MutationObserver: whenever the popover opens or its items change,
    // auto-focus the first visible item.
    const observer = new MutationObserver(() => {
      try {
        if (!document.body) return;
        const popover = document.querySelector('.ce-popover--opened');
        if (!popover) return;
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

    // Capture-phase Tab / Shift+Tab handler: cycle through popover items.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const popover = document.querySelector('.ce-popover--opened');
      if (!popover) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      movePopoverFocus(popover, e.shiftKey ? -1 : +1);
    }, true);

    // Capture-phase Enter handler: when the popover is open, click the first
    // visible item unless the user already navigated to a different item with
    // arrow keys (in which case Editor.js's own handler handles it).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const popover = document.querySelector('.ce-popover--opened');
      if (!popover) return;
      const focused = popover.querySelector(
        '.ce-popover-item--focused:not(.ce-popover-item--hidden)',
      );
      const first = popover.querySelector(FOCUSABLE_POPOVER_ITEM);
      if (!first) return;
      // If a non-first item is keyboard-focused by the user (no auto attr),
      // let Editor.js handle Enter through its own iterator.
      if (focused && !focused.hasAttribute(AUTO_FOCUS_ATTR)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      first.click();
    }, true);
  };

  // ── Editor pane visibility (owned entirely by block-editor.js) ───────────

  const STORAGE_KEY_EDITOR = 'joplin-ai-editor-visible';
  const STORAGE_KEY_EDITOR_ONLY = 'joplin-ai-editor-only';
  let editorVisible = localStorage.getItem(STORAGE_KEY_EDITOR) === 'true';
  let editorOnlyMode = localStorage.getItem(STORAGE_KEY_EDITOR_ONLY) === 'true';

  const editorPane = () => document.getElementById('editor-pane');
  const editorResizer = () => document.getElementById('editor-resizer');
  const toggleEditorBtn = () => document.getElementById('toggleEditorBtn');

  const applyEditorVisibility = () => {
    const pane = editorPane();
    const resizer = editorResizer();
    if (!pane) return;
    pane.style.display = editorVisible ? '' : 'none';
    if (resizer) resizer.style.display = editorVisible ? '' : 'none';
    const btn = toggleEditorBtn();
    if (btn) {
      btn.classList.toggle('editor-toggle-active', editorVisible);
      btn.title = editorVisible ? 'Hide block editor' : 'Show block editor';
    }
    const app = document.getElementById('app');
    if (app) {
      app.classList.toggle('editor-visible', editorVisible);
      app.classList.toggle('editor-only', editorVisible && editorOnlyMode);
    }
    localStorage.setItem(STORAGE_KEY_EDITOR, String(editorVisible));
  };

  const requestChatVisible = (visible) => {
    window.dispatchEvent(new CustomEvent('be:chatVisibilityRequest', { detail: { visible } }));
  };

  // ── Cross-module event listeners ──────────────────────────────────────────

  window.addEventListener('ai:noteLoaded', (e) => {
    const { note, blockEditorActive } = e.detail || {};
    if (window.BlockEditor) window.BlockEditor.loadNote(note || null);
    if (blockEditorActive) {
      editorVisible = true;
      editorOnlyMode = true;
      applyEditorVisibility();
      requestChatVisible(false);
      localStorage.setItem(STORAGE_KEY_EDITOR_ONLY, 'true');
    }
  });

  window.addEventListener('ai:enableEditor', (e) => {
    const { editorOnly } = (e.detail) || {};
    editorVisible = true;
    editorOnlyMode = !!editorOnly;
    applyEditorVisibility();
    if (editorOnly) {
      requestChatVisible(false);
      localStorage.setItem(STORAGE_KEY_EDITOR_ONLY, 'true');
    } else {
      localStorage.removeItem(STORAGE_KEY_EDITOR_ONLY);
    }
  });

  window.addEventListener('ai:disableEditor', () => {
    editorVisible = false;
    editorOnlyMode = false;
    applyEditorVisibility();
    localStorage.removeItem(STORAGE_KEY_EDITOR_ONLY);
    requestChatVisible(true);
  });

  window.addEventListener('ai:toggleEditor', () => {
    editorVisible = !editorVisible;
    applyEditorVisibility();
  });

  // ── Resizer (lives here since it adjusts the editor pane width) ──────────

  const attachResizer = () => {
    const resizer = editorResizer();
    const pane = editorPane();
    if (!resizer || !pane) return;
    let isResizing = false;
    resizer.addEventListener('mousedown', () => {
      isResizing = true;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const app = document.getElementById('app');
      if (!app) return;
      const appRect = app.getBoundingClientRect();
      const offset = e.clientX - appRect.left;
      const editorPct = Math.min(Math.max((offset / appRect.width) * 100, 15), 65);
      pane.style.flex = `0 0 ${editorPct}%`;
    });
    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      isResizing = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  };

  // ── Boot ───────────────────────────────────────────────────────────────────

  const boot = () => {
    applyEditorVisibility();
    attachResizer();
    attachPopoverBehavior();

    // Restore editor-only mode persisted from a previous session
    if (localStorage.getItem(STORAGE_KEY_EDITOR_ONLY) === 'true') {
      editorVisible = true;
      editorOnlyMode = true;
      applyEditorVisibility();
      requestChatVisible(false);
    }

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
